"""Native desktop toasts for SakaDesk.

The planner (:mod:`backend.services.notification_planner`) decides what to
show; this module delivers it. On Windows a toast is sent through
``windows_toasts`` under the ``SakaDesk`` AUMID. A click fires the toast's
in-process ``on_activated`` callback, whose closure holds the plan, and opens
that chat via :mod:`backend.services.desktop_bridge`, scrolled to the message
the toast previews (``newest_id``). A Memories toast (:func:`send_memory`)
works the same way: its click opens Memories at the plan's route through
:func:`desktop_bridge.open_memories`. No launch action is set: in windows-toasts
it turns the click into a protocol activation. Everywhere else (or when
``windows_toasts`` cannot be imported) a :class:`NullNotifier` is used.

Logs carry ids, counts, codes and error types only: never titles, bodies,
names, paths, URLs or Memories routes.
"""

from __future__ import annotations

import asyncio
import sys
import threading
from collections import deque
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Callable, Protocol

import structlog

from backend.services import desktop_bridge
from backend.services.app_identity import AUMID
from backend.services.i18n import get_strings
from backend.services.notification_planner import (
    ChatTarget,
    MemoryToastPlan,
    ToastPlan,
)

logger = structlog.get_logger(__name__)

_BACKEND_WINDOWS = "windows_toasts"
_BACKEND_NONE = "none"
_LIVE_TOASTS = 64  # keep recent Toast objects alive so WinRT callbacks still fire
_SHOW_TIMEOUT_S = 10  # seconds one show may take before it counts as failed
_SIMPLE_TAG = "app:hint"  # hint toasts share one Action Center slot
_SIMPLE_GROUP = "app"
_MEMORY_GROUP = "memories"
_TAG_MAX = 64  # Windows caps a toast tag at 64 characters

_notifications_enabled = True

# Toast shows run on one dedicated worker thread, so a hung WinRT call can
# only ever block this thread, never the default executor other code uses.
_toast_executor: ThreadPoolExecutor | None = None
# A show exceeded _SHOW_TIMEOUT_S and its worker job has not finished yet.
# Set by the timed-out caller, cleared by the job's done-callback.
_show_stuck = False
_show_state_lock = threading.Lock()
# Serialises shows on the event loop: one show at a time, in arrival order.
# Bound to the loop that created it (a new loop, e.g. in tests, gets its own).
_show_order: tuple[asyncio.AbstractEventLoop, asyncio.Lock] | None = None


class Notifier(Protocol):
    """Shows one planned toast and reports its own health."""

    def show(self, plan: ToastPlan) -> bool: ...

    def show_simple(self, title: str, body: str) -> bool: ...

    def show_login(self, service: str, title: str, body: str) -> bool: ...

    def show_memory(self, plan: MemoryToastPlan) -> bool: ...

    def status(self) -> dict: ...


# ------------------------------------------------------------------- notifiers


def memory_tag(plan: MemoryToastPlan) -> str:
    """The Action Center tag of a Memories toast: ``mem-{kind}-{service}-{subject}``.

    At most :data:`_TAG_MAX` characters. Only the subject is cut, never the
    kind or the group, so two groups never share a tag (kinds and group ids
    are short; a subject is ``""`` / a recap phase / a member id).
    """
    prefix = f"mem-{plan.kind}-{plan.service}-"
    return (prefix + (plan.subject or "all"))[:_TAG_MAX]


def _click_message_id(newest_id: str) -> tuple[int | None, str | None]:
    """The message a click jumps to: ``(id, None)`` or ``(None, reason)``.

    ``newest_id`` is an ASCII decimal id above zero; anything else yields no
    jump, with ``reason`` ``no_id`` (empty) or ``bad_id`` (not such an id).
    """
    if not newest_id:
        return None, "no_id"
    if newest_id.isascii() and newest_id.isdigit() and int(newest_id) > 0:
        return int(newest_id), None
    return None, "bad_id"


class NullNotifier:
    """Used where toasts are unavailable. ``show`` returns ``False``.

    :func:`get_notifier` logs ``notify_unavailable`` (with the reason) once,
    when it builds this notifier; ``show`` itself does not log.
    """

    def __init__(self, reason: str) -> None:
        self._reason = reason

    def show(self, plan: ToastPlan) -> bool:
        return False

    def show_simple(self, title: str, body: str) -> bool:
        return False

    def show_login(self, service: str, title: str, body: str) -> bool:
        return False

    def show_memory(self, plan: MemoryToastPlan) -> bool:
        return False

    def status(self) -> dict:
        return {
            "available": False,
            "backend": _BACKEND_NONE,
            "last_error": self._reason,
            "aumid": AUMID,
        }


class WindowsToastNotifier:
    """Sends toasts through ``windows_toasts`` (imported lazily).

    Raises ``ImportError`` (or another exception from the toaster) from
    ``__init__``; :func:`get_notifier` turns that into a :class:`NullNotifier`.
    """

    def __init__(self) -> None:
        import windows_toasts as wt  # lazy: Windows-only dependency

        self._wt = wt
        self._toaster = wt.InteractableWindowsToaster(AUMID, notifierAUMID=AUMID)
        self._last_error: str | None = None
        self._live: deque[Any] = deque(maxlen=_LIVE_TOASTS)

    def show(self, plan: ToastPlan) -> bool:
        """Show the toast; raises on failure (callers log ``notify_failed``)."""
        wt = self._wt
        try:
            # Never set launch_action: windows-toasts then makes the click a
            # protocol activation (Windows opens it as a URI) instead of
            # firing on_activated in this process.
            toast = wt.Toast(text_fields=[plan.title, plan.body])
            if plan.group_id and plan.member_id:
                # Ids only (<= 64 chars): a newer toast for the same chat
                # replaces the older one in the Action Center.
                toast.tag = f"{plan.group_id}:{plan.member_id}"
                toast.group = plan.target.service
            if plan.avatar is not None:
                self._add_avatar(toast, plan)
            toast.on_activated = lambda _args, p=plan: self._on_click(p)
            toast.on_failed = lambda args, p=plan: self._on_failed(p, args)
            self._live.append(toast)
            self._toaster.show_toast(toast)
        except Exception as e:
            self._last_error = type(e).__name__
            raise
        self._last_error = None
        return True

    def show_simple(self, title: str, body: str) -> bool:
        """Show an app-level hint toast (no chat, no avatar); raises on failure.

        A click shows the main window through :func:`desktop_bridge.open_window`
        (a no-op when no handler is registered).
        """
        wt = self._wt
        try:
            toast = wt.Toast(text_fields=[title, body])
            # One fixed slot: a newer hint replaces the older one.
            toast.tag = _SIMPLE_TAG
            toast.group = _SIMPLE_GROUP
            toast.on_activated = lambda _args: self._on_simple_click()
            toast.on_failed = lambda args: self._on_simple_failed(args)
            self._live.append(toast)
            self._toaster.show_toast(toast)
        except Exception as e:
            self._last_error = type(e).__name__
            raise
        self._last_error = None
        return True

    def show_login(self, service: str, title: str, body: str) -> bool:
        """Show a "log in again" toast for ``service``; raises on failure.

        A click opens that service's login dialog through
        :func:`desktop_bridge.open_login`. One slot per service: a newer toast
        for the same service replaces the older one.
        """
        wt = self._wt
        try:
            toast = wt.Toast(text_fields=[title, body])
            toast.tag = f"login-{service}"
            toast.group = _SIMPLE_GROUP
            toast.on_activated = lambda _args: self._on_login_click(service)
            toast.on_failed = lambda args: self._on_login_failed(args)
            self._live.append(toast)
            self._toaster.show_toast(toast)
        except Exception as e:
            self._last_error = type(e).__name__
            raise
        self._last_error = None
        return True

    def show_memory(self, plan: MemoryToastPlan) -> bool:
        """Show a Memories toast (spec 15); raises on failure.

        The avatar is the AppLogo image and the hero (an On This Day photo)
        the Hero image; either failing is logged and never costs the toast.
        One Action Center slot per kind, group and subject
        (:func:`memory_tag`): a newer toast of the same kind, group and
        subject replaces the older one, and two groups never replace each
        other's. A click opens Memories at ``plan.route`` through
        :func:`desktop_bridge.open_memories`.
        """
        wt = self._wt
        try:
            toast = wt.Toast(text_fields=[plan.title, plan.body])
            toast.tag = memory_tag(plan)
            toast.group = _MEMORY_GROUP
            if plan.avatar is not None:
                self._add_memory_image(toast, plan, plan.avatar, "avatar")
            if plan.hero is not None:
                self._add_memory_image(toast, plan, plan.hero, "hero")
            toast.on_activated = lambda _args, p=plan: self._on_memory_click(p)
            toast.on_failed = lambda args, p=plan: self._on_memory_failed(p, args)
            self._live.append(toast)
            self._toaster.show_toast(toast)
        except Exception as e:
            self._last_error = type(e).__name__
            raise
        self._last_error = None
        return True

    def status(self) -> dict:
        return {
            "available": True,
            "backend": _BACKEND_WINDOWS,
            "last_error": self._last_error,
            "aumid": AUMID,
        }

    def _add_avatar(self, toast: Any, plan: ToastPlan) -> None:
        wt = self._wt
        try:
            toast.AddImage(
                wt.ToastDisplayImage(
                    wt.ToastImage(plan.avatar),
                    position=wt.ToastImagePosition.AppLogo,
                )
            )
        except Exception as e:
            # A missing or unreadable avatar must not cost the user the toast.
            logger.warning(
                "notify_failed",
                stage="avatar",
                service=plan.target.service,
                group_id=plan.group_id,
                member_id=plan.member_id,
                error_type=type(e).__name__,
            )

    def _add_memory_image(
        self, toast: Any, plan: MemoryToastPlan, path: Any, stage: str
    ) -> None:
        """Add ``path`` as the AppLogo (``avatar``) or Hero (``hero``) image."""
        wt = self._wt
        try:
            position = (
                wt.ToastImagePosition.AppLogo
                if stage == "avatar"
                else wt.ToastImagePosition.Hero
            )
            toast.AddImage(wt.ToastDisplayImage(wt.ToastImage(path), position=position))
        except Exception as e:
            # A missing or unreadable image must not cost the user the toast.
            logger.warning(
                "notify_failed",
                stage=stage,
                kind="memories",
                memory_kind=plan.kind,
                service=plan.service,
                member_id=plan.member_id,
                error_type=type(e).__name__,
            )

    def _on_memory_click(self, plan: MemoryToastPlan) -> None:
        """WinRT-thread ``on_activated`` callback for a Memories toast. Never raises."""
        try:
            logger.info(
                "notify_clicked",
                kind="memories",
                memory_kind=plan.kind,
                service=plan.service,
            )
            desktop_bridge.open_memories(plan.service, dict(plan.route))
        except Exception as e:
            logger.warning("memories_open_failed", error_type=type(e).__name__)

    def _on_memory_failed(self, plan: MemoryToastPlan, event_args: Any) -> None:
        """WinRT-thread callback for a Memories toast. Never raises."""
        self._last_error = "ToastFailed"
        try:
            logger.warning(
                "notify_failed",
                kind="memories",
                memory_kind=plan.kind,
                service=plan.service,
                error_type="ToastFailed",
                error_code=getattr(event_args, "error_code", None),
            )
        except Exception:  # pragma: no cover - logging must not break WinRT
            pass

    def _on_click(self, plan: ToastPlan) -> None:
        """WinRT-thread ``on_activated`` callback for ``plan``'s toast. Never raises."""
        try:
            if not plan.target.service or not plan.target.path:
                # The test toast has no chat behind it.
                logger.info("notify_click_unhandled", reason="no_target")
                return
            # The chat opens at the message the toast previews; without a
            # usable id it still opens, just without the jump.
            message_id, no_target = _click_message_id(plan.newest_id)
            fields: dict[str, Any] = {"has_target": message_id is not None}
            if no_target is not None:
                fields["target_reason"] = no_target
            logger.info(
                "notify_clicked",
                service=plan.target.service,
                group_id=plan.group_id,
                member_id=plan.member_id,
                **fields,
            )
            desktop_bridge.open_chat(plan.target, message_id)
        except Exception as e:
            logger.warning("notify_open_chat_failed", error_type=type(e).__name__)

    def _on_simple_click(self) -> None:
        """WinRT-thread ``on_activated`` callback for a hint toast. Never raises."""
        try:
            logger.info("notify_clicked", kind="simple")
            desktop_bridge.open_window()
        except Exception as e:  # pragma: no cover - open_window never raises
            logger.warning("window_open_failed", error_type=type(e).__name__)

    def _on_login_click(self, service: str) -> None:
        """WinRT-thread ``on_activated`` callback for a login toast. Never raises."""
        try:
            logger.info("notify_clicked", kind="login", service=service)
            desktop_bridge.open_login(service)
        except Exception as e:  # pragma: no cover - open_login never raises
            logger.warning("login_open_failed", error_type=type(e).__name__)

    def _on_login_failed(self, event_args: Any) -> None:
        """WinRT-thread callback for a login toast. Never raises."""
        self._last_error = "ToastFailed"
        try:
            logger.warning(
                "notify_failed",
                kind="login",
                error_type="ToastFailed",
                error_code=getattr(event_args, "error_code", None),
            )
        except Exception:  # pragma: no cover - logging must not break WinRT
            pass

    def _on_simple_failed(self, event_args: Any) -> None:
        """WinRT-thread callback for a hint toast. Never raises."""
        self._last_error = "ToastFailed"
        try:
            logger.warning(
                "notify_failed",
                kind="simple",
                error_type="ToastFailed",
                error_code=getattr(event_args, "error_code", None),
            )
        except Exception:  # pragma: no cover - logging must not break WinRT
            pass

    def _on_failed(self, plan: ToastPlan, event_args: Any) -> None:
        """WinRT-thread callback. Never raises."""
        self._last_error = "ToastFailed"
        try:
            logger.warning(
                "notify_failed",
                service=plan.target.service,
                group_id=plan.group_id,
                member_id=plan.member_id,
                error_type="ToastFailed",
                error_code=getattr(event_args, "error_code", None),
            )
        except Exception:  # pragma: no cover - logging must not break WinRT
            pass


# ------------------------------------------------------------------- singleton

_notifier: Notifier | None = None
_notifier_lock = threading.Lock()


def _is_windows() -> bool:
    return sys.platform == "win32"


def _build_notifier() -> Notifier:
    """Build the notifier; log ``notify_unavailable`` with the reason when it is null."""
    if not _is_windows():
        logger.warning("notify_unavailable", reason="not_windows")
        return NullNotifier("not_windows")
    try:
        return WindowsToastNotifier()
    except ImportError as e:
        logger.warning(
            "notify_unavailable",
            reason="import_error",
            error_type=type(e).__name__,
            module=e.name,
        )
        return NullNotifier("import_error")
    except Exception as e:
        logger.warning(
            "notify_unavailable", reason="init_error", error_type=type(e).__name__
        )
        return NullNotifier("init_error")


def get_notifier() -> Notifier:
    """The process-wide notifier (Windows toasts, else a :class:`NullNotifier`).

    Built once per process, so ``notify_unavailable`` is logged at most once.
    """
    global _notifier
    with _notifier_lock:
        if _notifier is None:
            _notifier = _build_notifier()
        return _notifier


def _reset_notifier_for_tests() -> None:
    global _notifier
    with _notifier_lock:
        _notifier = None


# -------------------------------------------------------------------- delivery


def _fail_fields(plan: ToastPlan) -> dict[str, Any]:
    return {
        "service": plan.target.service,
        "group_id": plan.group_id,
        "member_id": plan.member_id,
    }


def _get_toast_executor() -> ThreadPoolExecutor:
    """The single-worker toast executor (created on first use)."""
    global _toast_executor
    with _show_state_lock:
        if _toast_executor is None:
            _toast_executor = ThreadPoolExecutor(
                max_workers=1, thread_name_prefix="toast"
            )
        return _toast_executor


def _get_show_order_lock() -> asyncio.Lock:
    """The lock that serialises shows on the running event loop."""
    global _show_order
    loop = asyncio.get_running_loop()
    if _show_order is None or _show_order[0] is not loop:
        _show_order = (loop, asyncio.Lock())
    return _show_order[1]


def _mark_stuck_unless_done(job: Future[bool]) -> None:
    """Flag ``job`` as stuck if it is still running (its done-callback clears it)."""
    global _show_stuck
    with _show_state_lock:
        if not job.done():
            _show_stuck = True


def _clear_stuck(_job: Future[bool]) -> None:
    global _show_stuck
    with _show_state_lock:
        _show_stuck = False


def _is_stuck() -> bool:
    with _show_state_lock:
        return _show_stuck


def _reset_toast_executor_for_tests() -> None:
    """Drop the executor, order lock and stuck flag (does not wait for a stuck worker)."""
    global _toast_executor, _show_stuck, _show_order
    with _show_state_lock:
        executor, _toast_executor = _toast_executor, None
        _show_stuck = False
    _show_order = None
    if executor is not None:
        executor.shutdown(wait=False)


async def _run_guarded(
    job_fn: Callable[[], bool],
    fields: dict[str, Any],
    *,
    skip_extra: dict[str, Any],
    sent_extra: dict[str, Any],
) -> bool:
    """Run ``job_fn`` (a notifier show) on the toast worker; log the outcome.

    Never raises. ``fields`` are added to every failure/skip log, ``skip_extra``
    to the busy skip and ``sent_extra`` to the success log.

    Shows are serialised: a show that starts while another is running waits
    its turn and then displays, so concurrent callers (per-service scheduler
    ticks, tray "Sync now", popup fallback toasts, the tray hint) are never
    dropped. A show that takes longer than ``_SHOW_TIMEOUT_S`` is logged as
    ``notify_failed`` (``error_type=TimeoutError``) and marked stuck; its
    worker thread is left to finish on its own. Only while such a stuck show
    is still running are further shows (including those already waiting)
    skipped with ``notify_skip reason=busy``, instead of queuing behind it.
    """
    async with _get_show_order_lock():
        if _is_stuck():
            logger.info("notify_skip", reason="busy", **fields, **skip_extra)
            return False
        try:
            job = _get_toast_executor().submit(job_fn)
        except Exception as e:  # e.g. the executor was shut down
            logger.warning("notify_failed", **fields, error_type=type(e).__name__)
            return False
        try:
            shown = await asyncio.wait_for(
                asyncio.wrap_future(job), timeout=_SHOW_TIMEOUT_S
            )
        except TimeoutError:
            # Flag first, then attach the callback: if the job finishes in
            # between, the callback runs at once and clears the flag.
            _mark_stuck_unless_done(job)
            job.add_done_callback(_clear_stuck)
            logger.warning("notify_failed", **fields, error_type="TimeoutError")
            return False
        except Exception as e:
            logger.warning("notify_failed", **fields, error_type=type(e).__name__)
            return False
    if not shown:
        logger.warning("notify_failed", **fields, reason="not_shown")
        return False
    logger.info("notify_sent", **fields, **sent_extra)
    return True


async def _show_one(notifier: Notifier, plan: ToastPlan) -> bool:
    """Show ``plan`` on the toast worker thread; log the outcome. Never raises.

    Guarded as described in :func:`_run_guarded`; logs carry ids and ``count``
    only.
    """
    return await _run_guarded(
        lambda: notifier.show(plan),
        _fail_fields(plan),
        skip_extra={"count": plan.count},
        sent_extra={"count": plan.count, "newest_type": plan.newest_type},
    )


async def send_planned(plans: list[ToastPlan]) -> int:
    """Show every plan (off the event loop) and return how many were shown.

    Skips everything when notifications are disabled (the planner already
    skips in that case, so this is a second guard; ``notify_skip
    reason=disabled``) or when the notifier is unavailable (``notify_skip
    reason=unavailable`` with ``backend_reason``; the notifier already logged
    ``notify_unavailable`` once, when it was built). Each show is bounded by
    ``_SHOW_TIMEOUT_S`` and waits its turn behind any other running show;
    while a timed-out show is still stuck the rest are skipped (``notify_skip
    reason=busy``). The notifier is resolved on a worker thread: its first use
    imports ``windows_toasts``/WinRT and builds the toaster.
    """
    if not plans:
        return 0
    if not _notifications_enabled:
        logger.info("notify_skip", reason="disabled", count=len(plans))
        return 0
    notifier = await asyncio.to_thread(get_notifier)
    status = notifier.status()
    if not status.get("available", True):
        logger.info(
            "notify_skip",
            reason="unavailable",
            backend_reason=status.get("last_error"),
            count=len(plans),
        )
        return 0
    sent = 0
    for plan in plans:
        if await _show_one(notifier, plan):
            sent += 1
    return sent


async def send_simple(title: str, body: str) -> bool:
    """Show an app-level hint toast (off the event loop); return whether it showed.

    Goes through the same worker thread, show queue, stuck guard and timeout
    as chat toasts. Not gated on the notifications flag: it is a one-time lifecycle
    hint, not a message notification. Skipped when the notifier is unavailable
    (``notify_skip reason=unavailable kind=simple``). Outcomes are logged as
    ``notify_sent`` / ``notify_failed`` with ``kind=simple``; the title and
    body are never logged. Never raises.
    """
    notifier = await asyncio.to_thread(get_notifier)
    status = notifier.status()
    if not status.get("available", True):
        logger.info(
            "notify_skip",
            reason="unavailable",
            kind="simple",
            backend_reason=status.get("last_error"),
        )
        return False
    return await _run_guarded(
        lambda: notifier.show_simple(title, body),
        {"kind": "simple"},
        skip_extra={},
        sent_extra={},
    )


async def send_login_alert(service: str, title: str, body: str) -> bool:
    """Show the "log in again" toast for ``service``; return whether it showed.

    Same worker thread, queue, stuck guard and timeout as other toasts. The
    caller (session_alert) applies the notifications setting. Skipped when the
    notifier is unavailable (``notify_skip reason=unavailable kind=login``).
    Outcomes are logged as ``notify_sent`` / ``notify_failed`` with
    ``kind=login``; the title and body are never logged. Never raises.
    """
    notifier = await asyncio.to_thread(get_notifier)
    status = notifier.status()
    if not status.get("available", True):
        logger.info(
            "notify_skip",
            reason="unavailable",
            kind="login",
            backend_reason=status.get("last_error"),
        )
        return False
    return await _run_guarded(
        lambda: notifier.show_login(service, title, body),
        {"kind": "login", "service": service},
        skip_extra={},
        sent_extra={},
    )


async def send_memory(plan: MemoryToastPlan) -> bool:
    """Show a Memories toast; return whether it showed.

    Same worker thread, queue, stuck guard and timeout as other toasts. The
    caller (the Memories scheduler) applies the settings, including the
    global notifications switch. Skipped when the notifier is unavailable
    (``notify_skip reason=unavailable kind=memories``). Outcomes are logged
    as ``notify_sent`` / ``notify_failed`` / ``notify_skip`` with
    ``kind=memories``, ``memory_kind`` and ``service``; the title, body and
    route are never logged. Never raises.
    """
    fields: dict[str, Any] = {
        "kind": "memories",
        "memory_kind": plan.kind,
        "service": plan.service,
    }
    notifier = await asyncio.to_thread(get_notifier)
    status = notifier.status()
    if not status.get("available", True):
        logger.info(
            "notify_skip",
            reason="unavailable",
            backend_reason=status.get("last_error"),
            **fields,
        )
        return False
    return await _run_guarded(
        lambda: notifier.show_memory(plan),
        fields,
        skip_extra={},
        sent_extra={},
    )


async def send_test(lang: str | None) -> bool:
    """Show a test toast in ``lang``. Ignores the enabled flag (user-initiated)."""
    strings = get_strings("notifications", lang)
    plan = ToastPlan(
        target=ChatTarget(service="", path="", name="", is_group_chat=False),
        group_id="",
        member_id="",
        title=strings["test_title"],
        body=strings["test_body"],
        avatar=None,
        count=1,
        newest_type="text",
        newest_id="",
    )
    return await _show_one(await asyncio.to_thread(get_notifier), plan)


# ---------------------------------------------------------------------- state


def set_notifications_enabled(enabled: bool) -> None:
    """Enable or disable notifications."""
    global _notifications_enabled
    _notifications_enabled = enabled
    logger.info("notifications_enabled_changed", enabled=enabled)


def get_notifications_enabled() -> bool:
    """Check if notifications are enabled."""
    return _notifications_enabled


def get_notification_status() -> dict:
    """Diagnostics: the enabled flag plus the notifier's own status."""
    return {"enabled": _notifications_enabled, **get_notifier().status()}
