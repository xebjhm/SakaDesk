"""Background incoming-call popup (spec C3 §4).

This module holds the pure decision code (candidate, gate, divert hook,
missed-call plan) and the process-wide ``CallPopupController``, the one
backend owner of the active popup call. The controller runs the state machine
``idle -> reserved -> starting -> ringing -> connected``, guards each stage
with a watchdog, sends the fallback and missed-call toasts, and asks the main
window (through the desktop bridge) to mark the voice heard; it never writes
heard state itself. Logs carry ids, codes and counts only; names, text and
paths are never logged.
"""

from __future__ import annotations

import asyncio
import dataclasses
import threading
from collections.abc import Awaitable, Callable, Coroutine
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import structlog

from backend.services import desktop_bridge
from backend.services.background_tasks import track_background_task
from backend.services.chat_kind import is_group_chat
from backend.services.desktop_bridge import HeardTarget
from backend.services.i18n import get_strings, resolve_ui_language
from backend.services.new_message_collector import CollectedChat, newest_key
from backend.services.notification_planner import ToastPlan, UiState
from backend.services.quiet_state import QuietState

logger = structlog.get_logger(__name__)

RESERVED_WATCHDOG_S = 1800  # a sync with a big media queue may legitimately take long
START_WATCHDOG_S = 20  # B's PRELOAD_TIMEOUT_MS (10 s) + 10 s for the page fetches
RING_WATCHDOG_S = 45  # B's RING_TIMEOUT_MS (30 s) + 15 s
CONNECTED_WATCHDOG_S = 900
HEARD_ATTEMPTS = 3
HEARD_RETRY_S = 1.0


@dataclass(frozen=True)
class CallCandidate:
    """The newest new voice over this sync's 1:1 chats."""

    group_id: str
    member_id: str
    message_id: str  # the voice's id, as a string (ToastPlan convention)
    member_dir: Path


@dataclass(frozen=True)
class PendingCall:
    """A reserved popup call: the diverted C1 plan plus its candidate."""

    call_id: int
    plan: ToastPlan
    candidate: CallCandidate


class Reserver(Protocol):
    def reserve(
        self, plan: ToastPlan, candidate: CallCandidate
    ) -> PendingCall | None: ...


def select_call_candidate(
    chats: list[CollectedChat],
    *,
    service: str,
    member_count_for: Callable[[str], int],
) -> CallCandidate | None:
    """The 1:1 chat whose new voice is newest (timestamp, then id); rooms never ring."""
    best: CollectedChat | None = None
    for c in chats:
        if c.newest_voice is None:
            continue
        if is_group_chat(service, c.group_id, member_count_for(c.group_id)):
            continue
        if best is None or newest_key(c.newest_voice) > newest_key(
            best.newest_voice or {}
        ):
            best = c
    if best is None or best.newest_voice is None:
        return None
    return CallCandidate(
        best.group_id,
        best.member_id,
        str(best.newest_voice.get("id", "")),
        best.member_dir,
    )


def divert_gate(
    *,
    candidate: CallCandidate | None,
    enabled: bool,
    host_available: bool,
    ui_state: UiState,
    busy: bool,
    quiet: Callable[[], QuietState],
) -> str | None:
    """The first failing gate's reason, or None to divert. ``quiet`` is read last."""
    if not enabled:
        return "popup_disabled"
    if candidate is None:
        return "no_candidate"
    if not host_available:
        return "unavailable"
    if ui_state.focused:
        return "foreground"
    if busy:
        return "busy"
    if quiet().quiet:
        return "quiet"
    return None


class QuietProbe:
    """Wraps a quiet-state query so it runs at most once and its result can be logged."""

    def __init__(self, query: Callable[[], QuietState]) -> None:
        self._query = query
        self._state: QuietState | None = None

    def __call__(self) -> QuietState:
        if self._state is None:
            self._state = self._query()
        return self._state

    @property
    def state(self) -> QuietState | None:
        return self._state


class CallDivert:
    """C1 ``divert`` hook: diverts only the candidate's 1:1 plan, once, when reserved."""

    def __init__(
        self,
        candidate: CallCandidate | None,
        gate_reason: str | None,
        controller: Reserver,
    ) -> None:
        self._candidate = candidate
        self._gate_reason = gate_reason
        self._controller = controller
        self.pending: PendingCall | None = None

    def __call__(self, plan: ToastPlan) -> bool:
        c = self._candidate
        if c is None or self._gate_reason is not None or self.pending is not None:
            return False
        if plan.target.is_group_chat or (plan.group_id, plan.member_id) != (
            c.group_id,
            c.member_id,
        ):
            return False
        pending = self._controller.reserve(plan, c)
        if pending is None:
            logger.info(
                "call_popup_skip",
                service=plan.target.service,
                reason="busy",
                group_id=c.group_id,
                member_id=c.member_id,
                message_id=c.message_id,
            )
            return False
        self.pending = pending
        return True


def make_call_divert(
    candidate: CallCandidate | None, gate_reason: str | None, controller: Reserver
) -> CallDivert:
    """Build the divert hook for one ``plan_toasts`` call."""
    return CallDivert(candidate, gate_reason, controller)


def log_gate_skip(
    *,
    service: str,
    reason: str,
    candidate: CallCandidate | None,
    quiet: QuietState | None,
) -> None:
    """Log why the popup was not used for this sync (``call_popup_skip``)."""
    fields: dict[str, object] = {"service": service, "reason": reason}
    if candidate is not None:
        fields.update(
            group_id=candidate.group_id,
            member_id=candidate.member_id,
            message_id=candidate.message_id,
        )
    if reason == "quiet" and quiet is not None:
        fields["quiet_state"] = quiet.code
    logger.info("call_popup_skip", **fields)


def build_missed_plan(plan: ToastPlan, strings: dict[str, str]) -> ToastPlan:
    """The missed-call toast: same target/tag/avatar, title and body from ``strings``.

    ``notifications_hide_content`` does not apply: the popup already showed the
    caller's name and the title carries no message content.
    """
    body = (
        strings["missed_more"].format(n=plan.count - 1)
        if plan.count > 1
        else strings["missed_body"]
    )
    return dataclasses.replace(
        plan, title=strings["missed_title"].format(name=plan.title), body=body
    )


IDLE, RESERVED, STARTING, RINGING, CONNECTED = (
    "idle",
    "reserved",
    "starting",
    "ringing",
    "connected",
)
_ACTIVE = frozenset({STARTING, RINGING, CONNECTED})
_VALID: dict[str, frozenset[str]] = {
    "ringing": frozenset({STARTING}),
    "skipped": frozenset({STARTING}),
    "answered": frozenset({RINGING}),
    "declined": frozenset({RINGING}),
    "timeout": frozenset({RINGING}),
    "ended": frozenset({CONNECTED}),
    "error": _ACTIVE,
    "cancelled": _ACTIVE,
}


@dataclass(frozen=True)
class CallEvent:
    """What the popup page (or the host) reports about the call."""

    kind: str  # ringing|skipped|answered|declined|timeout|ended|cancelled|error
    reason: str | None = None
    error_type: str | None = None
    message_id: int | None = None


@dataclass(frozen=True)
class CallInfo:
    """What the popup page fetches for the active call."""

    call_id: int
    service: str
    path: str  # plan.target.path; returned to the popup page, never logged
    is_group_chat: bool
    group_id: str
    member_id: str
    message_id: int


class _Bridge(Protocol):
    async def call_popup_start(self, call_id: int) -> bool: ...
    async def call_popup_reveal(self) -> bool: ...
    async def call_popup_hide(self) -> None: ...
    async def call_popup_cancel(self, call_id: int) -> None: ...
    async def call_popup_deliver_heard(self, target: HeardTarget) -> str: ...


async def _default_strings(config: dict[str, Any]) -> dict[str, str]:
    return get_strings(
        "call_popup", await asyncio.to_thread(resolve_ui_language, config)
    )


class CallPopupController:
    """Owns the one active popup call (spec §4.4). Methods run on the server loop.

    State is guarded by a ``threading.Lock`` that is never held across an
    ``await``. Toasts and the heard hand-off run as tracked background tasks.
    """

    def __init__(
        self,
        *,
        send_toasts: Callable[[list[ToastPlan]], Awaitable[int]] | None = None,
        bridge: _Bridge | None = None,
        get_ui_state: Callable[[], UiState] | None = None,
        load_config: Callable[[], Awaitable[dict[str, Any]]] | None = None,
        strings_for: Callable[[dict[str, Any]], Awaitable[dict[str, str]]]
        | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        heard_sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        reserved_watchdog_s: float = RESERVED_WATCHDOG_S,
        start_watchdog_s: float = START_WATCHDOG_S,
        ring_watchdog_s: float = RING_WATCHDOG_S,
        connected_watchdog_s: float = CONNECTED_WATCHDOG_S,
    ) -> None:
        if send_toasts is None:
            from backend.services.notification_service import send_planned

            send_toasts = send_planned
        if get_ui_state is None:
            from backend.services.ui_state import get_ui_state as _default_ui_state

            get_ui_state = _default_ui_state
        if load_config is None:
            from backend.services.settings_store import load_config as _default_load

            load_config = _default_load
        self._send_toasts = send_toasts
        self._bridge: _Bridge = bridge if bridge is not None else desktop_bridge
        self._get_ui_state = get_ui_state
        self._load_config = load_config
        self._strings_for = strings_for or _default_strings
        self._sleep, self._heard_sleep = sleep, heard_sleep
        self._durations = {
            RESERVED: reserved_watchdog_s,
            STARTING: start_watchdog_s,
            RINGING: ring_watchdog_s,
            CONNECTED: connected_watchdog_s,
        }
        self._lock = threading.Lock()
        self._phase = IDLE
        self._pending: PendingCall | None = None
        self._next_id = 1
        self._watchdog: asyncio.Task[None] | None = None
        self._firing: asyncio.Task[None] | None = None  # a watchdog past its sleep
        self._tasks: set[asyncio.Task[Any]] = set()

    # --- state ---
    @property
    def phase(self) -> str:
        return self._phase

    @property
    def busy(self) -> bool:
        return self._phase != IDLE

    # --- helpers (the *_locked ones expect the lock to be held) ---
    def _current_id(self) -> int | None:
        return self._pending.call_id if self._pending is not None else None

    def _cancel_watchdog_locked(self) -> None:
        task, self._watchdog = self._watchdog, None
        if task is not None and not task.done() and task is not asyncio.current_task():
            task.cancel()

    def _to_idle_locked(self) -> None:
        self._cancel_watchdog_locked()
        self._phase, self._pending = IDLE, None

    def _enter_locked(self, phase: str, call_id: int) -> None:
        self._cancel_watchdog_locked()
        self._phase = phase
        self._watchdog = asyncio.get_running_loop().create_task(
            self._watch(call_id, phase, self._durations[phase])
        )

    def _spawn(self, coro: Coroutine[Any, Any, Any], name: str) -> None:
        task = track_background_task(coro, name=name)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def _spawn_toast(self, pending: PendingCall, kind: str, reason: str) -> None:
        self._spawn(self._send_toast(pending, kind, reason), "call_popup_toast")

    async def wait_tasks(self) -> None:
        """Await the spawned toast and heard tasks (tests and shutdown)."""
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    # --- reservation ---
    def reserve(self, plan: ToastPlan, candidate: CallCandidate) -> PendingCall | None:
        """Reserve the controller for ``plan``; None while another call is active."""
        with self._lock:
            if self._phase != IDLE:
                return None
            pending = PendingCall(self._next_id, plan, candidate)
            self._next_id += 1
            self._pending = pending
            # Safety net: a sync that never dispatches nor abandons (a leak)
            # must not leave the controller busy for the life of the process.
            self._enter_locked(RESERVED, pending.call_id)
        logger.info(
            "call_popup_reserved",
            call_id=pending.call_id,
            service=plan.target.service,
            group_id=candidate.group_id,
            member_id=candidate.member_id,
            message_id=candidate.message_id,
            count=plan.count,
        )
        return pending

    async def dispatch(self, call_id: int) -> None:
        """Start the popup for a reserved call, or fall back to a toast."""
        with self._lock:
            pending = self._pending
            if pending is None or pending.call_id != call_id or self._phase != RESERVED:
                pending = None
            else:
                ui = self._get_ui_state()
                if ui.focused:
                    self._to_idle_locked()
                    viewing: bool | None = (
                        ui.service == pending.plan.target.service
                        and ui.group_id == pending.candidate.group_id
                        and ui.member_id == pending.candidate.member_id
                    )
                else:
                    viewing = None
                    # Enter starting BEFORE the await: the page's GET /calls/{id}
                    # may reach the loop before call_popup_start returns.
                    self._enter_locked(STARTING, call_id)
        if pending is None:
            logger.info("call_popup_dispatch", call_id=call_id, result="not_reserved")
            return
        if viewing is True:
            logger.info("call_popup_dispatch", call_id=call_id, result="viewing")
            return
        if viewing is False:
            logger.info("call_popup_dispatch", call_id=call_id, result="foreground")
            self._spawn_toast(pending, "fallback", "foreground")
            return
        started = await self._bridge.call_popup_start(call_id)
        with self._lock:
            current = self._current_id() == call_id and self._phase in _ACTIVE
            still = current and self._phase == STARTING
            if still and started:
                # The start call may have used most of the first budget (it can
                # recreate a lost window): count the 20 s from its return.
                self._enter_locked(STARTING, call_id)
            elif still:
                self._to_idle_locked()
        if started and current:
            logger.info("call_popup_dispatch", call_id=call_id, result="started")
        elif not started and still:
            logger.info("call_popup_dispatch", call_id=call_id, result="start_failed")
            self._spawn_toast(pending, "fallback", "start_failed")
        else:
            # Cancelled, watchdogged or replaced while call_popup_start was awaited.
            logger.info("call_popup_dispatch", call_id=call_id, result="superseded")

    def abandon(self, call_id: int, reason: str) -> None:
        """Drop a reserved call whose sync did not reach dispatch (never awaits)."""
        with self._lock:
            pending = self._pending
            ok = (
                pending is not None
                and pending.call_id == call_id
                and self._phase == RESERVED
            )
            if ok:
                self._to_idle_locked()
        send = ok and reason == "sync_failed"
        logger.info(
            "call_popup_abandoned",
            call_id=call_id,
            reason=reason,
            toast="sent" if send else "skipped",
        )
        if send and pending is not None:
            self._spawn_toast(pending, "fallback", "sync_failed")

    # --- queries ---
    def info(self, call_id: int) -> CallInfo | None:
        """The active call's info for the popup page (starting, ringing, connected)."""
        with self._lock:
            pending = self._pending
            if (
                pending is None
                or pending.call_id != call_id
                or self._phase not in _ACTIVE
            ):
                return None
        target = pending.plan.target
        return CallInfo(
            call_id=call_id,
            service=target.service,
            path=target.path,
            is_group_chat=target.is_group_chat,
            group_id=pending.candidate.group_id,
            member_id=pending.candidate.member_id,
            message_id=int(pending.candidate.message_id),
        )

    def is_active_for(
        self, service: str, group_id: str, member_id: str, message_id: int
    ) -> bool:
        """True when the non-idle call is for exactly this voice."""
        with self._lock:
            pending = self._pending
            if pending is None or self._phase == IDLE:
                return False
            return (
                pending.plan.target.service,
                pending.candidate.group_id,
                pending.candidate.member_id,
                pending.candidate.message_id,
            ) == (service, group_id, member_id, str(message_id))

    # --- events ---
    async def on_event(self, call_id: int, event: CallEvent) -> bool:
        """Apply a popup event; False (and a stale log) when it does not fit the call."""
        with self._lock:
            phase, pending = self._phase, self._pending
            if pending is None or pending.call_id != call_id or phase == IDLE:
                stale: str | None = "unknown_call"
            elif phase not in _VALID.get(event.kind, frozenset()):
                stale = "wrong_phase"
            elif (
                event.kind == "answered"
                and str(event.message_id) != pending.candidate.message_id
            ):
                stale = "message_mismatch"
            else:
                stale = None
                if event.kind == "ringing":
                    self._enter_locked(RINGING, call_id)
                elif event.kind == "answered":
                    self._enter_locked(CONNECTED, call_id)
                else:
                    self._to_idle_locked()
        if stale is not None or pending is None:
            logger.info(
                "call_popup_event_stale",
                call_id=call_id,
                call_event=event.kind,
                reason=stale,
            )
            return False
        logger.info(
            "call_popup_event",
            call_id=call_id,
            call_event=event.kind,
            phase=phase,
            reason=event.reason,
            error_type=event.error_type,
        )
        kind = event.kind
        if kind == "ringing":
            if not await self._bridge.call_popup_reveal():
                with self._lock:
                    still = self._current_id() == call_id and self._phase == RINGING
                    if still:
                        self._to_idle_locked()
                if still:
                    await self._bridge.call_popup_cancel(call_id)
                    logger.info(
                        "call_popup_hide", call_id=call_id, reason="reveal_failed"
                    )
                    self._spawn_toast(pending, "fallback", "reveal_failed")
        elif kind == "answered":
            self._spawn(self._deliver_heard(pending), "call_popup_heard")
        elif kind == "skipped":
            if event.reason != "already_read":
                self._spawn_toast(pending, "fallback", event.reason or "skipped")
        else:
            await self._bridge.call_popup_hide()
            logger.info("call_popup_hide", call_id=call_id, reason=kind)
            if kind in ("declined", "timeout"):
                self._spawn_toast(pending, "missed", kind)
            elif phase == STARTING:
                self._spawn_toast(pending, "fallback", kind)
            elif phase == RINGING:
                self._spawn_toast(pending, "missed", "error")
        return True

    # --- lifecycle ---
    async def on_foreground(self) -> None:
        """The main window came to the foreground: cancel a call that has not been answered."""
        with self._lock:
            phase, pending = self._phase, self._pending
            cancelled = phase in (STARTING, RINGING) and pending is not None
            if cancelled:
                self._to_idle_locked()
        if pending is None:
            return
        if cancelled:
            await self._bridge.call_popup_cancel(pending.call_id)
            logger.info(
                "call_popup_cancel",
                call_id=pending.call_id,
                reason="foreground",
                phase=phase,
            )
        elif phase == CONNECTED:
            logger.debug("call_popup_foreground_kept", call_id=pending.call_id)

    async def cancel(self, reason: str) -> None:
        """Cancel the call (no toast), e.g. when the popup setting is turned off."""
        with self._lock:
            phase, pending = self._phase, self._pending
            if pending is not None:
                self._to_idle_locked()
        if pending is None:
            return
        if phase in _ACTIVE:
            await self._bridge.call_popup_cancel(pending.call_id)
        logger.info(
            "call_popup_cancel", call_id=pending.call_id, reason=reason, phase=phase
        )

    async def shutdown(self) -> None:
        """App exit: drop the call and stop spawned work. No toast, no bridge call."""
        with self._lock:
            phase, pending = self._phase, self._pending
            self._to_idle_locked()
            tasks = list(self._tasks)
            firing, self._firing = self._firing, None
        if firing is not None:
            tasks.append(firing)
        if pending is not None:
            logger.info(
                "call_popup_cancel",
                call_id=pending.call_id,
                reason="app_exit",
                phase=phase,
            )
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    # --- spawned work ---
    async def _watch(self, call_id: int, phase: str, seconds: float) -> None:
        await self._sleep(seconds)
        with self._lock:
            if self._current_id() != call_id or self._phase != phase:
                return
            pending = self._pending
            self._watchdog = None  # never cancel ourselves
            self._to_idle_locked()
            # Past this point shutdown() cancels us instead of the (cleared) handle.
            self._firing = asyncio.current_task()
        try:
            logger.warning("call_popup_watchdog", call_id=call_id, phase=phase)
            if phase == RESERVED:
                # No popup exists yet: behave like abandon(reason="watchdog").
                if pending is not None:
                    self._spawn_toast(pending, "fallback", "watchdog")
                return
            await self._bridge.call_popup_cancel(call_id)
            logger.info("call_popup_hide", call_id=call_id, reason="watchdog")
            if pending is not None and phase == STARTING:
                self._spawn_toast(pending, "fallback", "watchdog")
            elif pending is not None and phase == RINGING:
                self._spawn_toast(pending, "missed", "watchdog")
        finally:
            with self._lock:
                if self._firing is asyncio.current_task():
                    self._firing = None

    async def _send_toast(self, pending: PendingCall, kind: str, reason: str) -> None:
        call_id = pending.call_id
        try:
            config = await self._load_config()
            if not config.get("notifications_enabled", True):
                logger.info(
                    "call_popup_toast_skip",
                    call_id=call_id,
                    kind=kind,
                    reason="notifications_disabled",
                )
                return
            plan = pending.plan
            if kind == "missed":
                plan = build_missed_plan(plan, await self._strings_for(config))
            sent = await self._send_toasts([plan]) > 0
            logger.info(
                "call_popup_toast", call_id=call_id, kind=kind, reason=reason, sent=sent
            )
        except Exception as e:
            logger.warning(
                "call_popup_toast",
                call_id=call_id,
                kind=kind,
                reason=reason,
                sent=False,
                error_type=type(e).__name__,
            )

    async def _deliver_heard(self, pending: PendingCall) -> None:
        target = HeardTarget(
            pending.plan.target.service,
            pending.plan.target.path,
            int(pending.candidate.message_id),
        )
        result, attempts = "", 0
        while attempts < HEARD_ATTEMPTS:
            attempts += 1
            result = await self._bridge.call_popup_deliver_heard(target)
            if result in ("delivered", "no_host"):
                break
            if attempts < HEARD_ATTEMPTS:
                await self._heard_sleep(HEARD_RETRY_S)
        delivered = result == "delivered"
        logger.info(
            "call_popup_heard",
            call_id=pending.call_id,
            message_id=pending.candidate.message_id,
            delivered=delivered,
            attempts=attempts,
            **({} if delivered else {"reason": result}),
        )


_controller: CallPopupController | None = None


def get_call_popup_controller() -> CallPopupController:
    """The process-wide controller (one popup call at a time across all services)."""
    global _controller
    if _controller is None:
        _controller = CallPopupController()
    return _controller


def _reset_controller_for_tests() -> None:
    global _controller
    _controller = None
