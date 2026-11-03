"""Background incoming-call popup (spec C3 §4).

This module holds the pure decision code (candidate, gate, divert hook,
missed-call plan) and, from Task 5 on, the process-wide
``CallPopupController`` that owns the single active popup call. Logs carry
ids, codes and counts only; names, text and paths are never logged.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import structlog

from backend.services.chat_kind import is_group_chat
from backend.services.new_message_collector import CollectedChat, newest_key
from backend.services.notification_planner import ToastPlan, UiState
from backend.services.quiet_state import QuietState

logger = structlog.get_logger(__name__)


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
