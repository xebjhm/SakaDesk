"""Tests for the pure part of the background call popup (candidate, gate, hook)."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import Any

from structlog.testing import capture_logs

from backend.services.call_popup import (
    CallCandidate,
    PendingCall,
    QuietProbe,
    build_missed_plan,
    divert_gate,
    log_gate_skip,
    make_call_divert,
    select_call_candidate,
)
from backend.services.chat_kind import GROUP_CHAT_IDS
from backend.services.new_message_collector import CollectedChat
from backend.services.notification_planner import (
    ChatTarget,
    Skip,
    ToastPlan,
    UiState,
    plan_toasts,
)
from backend.services.quiet_state import QuietState

SERVICE, DISPLAY = "hinatazaka46", "日向坂46"
IDLE = UiState(None, None, None, False)
FOCUSED = UiState(SERVICE, "34", "58", True)
LOUD = QuietState("accepts", False, 5, 0)
QUIET = QuietState("fullscreen", True, 2, -1)
T = "2026-11-04T10:00:00Z"
ROOT = Path("/out")


def voice(mid: int, ts: str) -> dict[str, Any]:
    return {
        "id": mid,
        "timestamp": ts,
        "type": "voice",
        "content": None,
        "state": "published",
    }


def chat(
    root: Path,
    gid: str,
    mid: str,
    *,
    newest_voice: dict | None,
    name: str = "金村 美玖",
    count: int = 1,
) -> CollectedChat:
    newest = newest_voice or {
        "id": 1,
        "timestamp": "2026-11-04T09:00:00Z",
        "type": "text",
        "content": "hi",
        "state": "published",
    }
    return CollectedChat(
        group_id=gid,
        group_name=name,
        member_id=mid,
        member_name=name,
        member_dir=root / DISPLAY / "messages" / f"{gid} {name}" / f"{mid} {name}",
        count=count,
        newest=newest,
        newest_voice=newest_voice,
    )


def one(_gid: str) -> int:
    return 1


def two(_gid: str) -> int:
    return 2


# --- select_call_candidate -------------------------------------------------


def test_candidate_picks_newest_timestamp_not_largest_id():
    a = chat(ROOT, "34", "58", newest_voice=voice(10, "2026-11-04T10:00:00Z"))
    b = chat(ROOT, "35", "59", newest_voice=voice(9, "2026-11-04T11:00:00Z"))
    c = select_call_candidate([a, b], service=SERVICE, member_count_for=one)
    assert c == CallCandidate("35", "59", "9", b.member_dir)


def test_candidate_ties_on_timestamp_break_by_id():
    a = chat(ROOT, "34", "58", newest_voice=voice(9, T))
    b = chat(ROOT, "35", "59", newest_voice=voice(10, T))
    c = select_call_candidate([a, b], service=SERVICE, member_count_for=one)
    assert c is not None and c.message_id == "10" and c.group_id == "35"


def test_candidate_ignores_chats_without_voice():
    a = chat(ROOT, "34", "58", newest_voice=None)
    b = chat(ROOT, "35", "59", newest_voice=voice(3, T))
    c = select_call_candidate([a, b], service=SERVICE, member_count_for=one)
    assert c is not None and c.group_id == "35"


def test_candidate_none_without_voices():
    a = chat(ROOT, "34", "58", newest_voice=None)
    assert select_call_candidate([a], service=SERVICE, member_count_for=one) is None
    assert select_call_candidate([], service=SERVICE, member_count_for=one) is None


def test_candidate_excludes_rooms_by_member_count():
    a = chat(ROOT, "34", "58", newest_voice=voice(3, T))
    assert select_call_candidate([a], service=SERVICE, member_count_for=two) is None


def test_candidate_excludes_one_member_group_chat_id():
    gid = str(next(iter(GROUP_CHAT_IDS[SERVICE])))
    a = chat(ROOT, gid, "58", newest_voice=voice(3, T))
    assert select_call_candidate([a], service=SERVICE, member_count_for=one) is None


# --- divert_gate ------------------------------------------------------------

CAND = CallCandidate("34", "58", "10", ROOT / "x")


def gate(**over):
    args: dict[str, Any] = dict(
        candidate=CAND,
        enabled=True,
        host_available=True,
        ui_state=IDLE,
        busy=False,
        quiet=lambda: LOUD,
    )
    args.update(over)
    return divert_gate(**args)


def test_gate_passes():
    assert gate() is None


def test_gate_each_reason():
    assert gate(enabled=False) == "popup_disabled"
    assert gate(candidate=None) == "no_candidate"
    assert gate(host_available=False) == "unavailable"
    assert gate(ui_state=FOCUSED) == "foreground"
    assert gate(busy=True) == "busy"
    assert gate(quiet=lambda: QUIET) == "quiet"


def test_gate_order_first_failure_wins():
    assert (
        gate(
            enabled=False,
            candidate=None,
            host_available=False,
            ui_state=FOCUSED,
            busy=True,
            quiet=lambda: QUIET,
        )
        == "popup_disabled"
    )
    assert (
        gate(candidate=None, host_available=False, ui_state=FOCUSED, busy=True)
        == "no_candidate"
    )
    assert gate(host_available=False, ui_state=FOCUSED, busy=True) == "unavailable"
    assert gate(ui_state=FOCUSED, busy=True) == "foreground"


def test_gate_reads_quiet_last_and_only_when_needed():
    calls: list[int] = []

    def quiet() -> QuietState:
        calls.append(1)
        return LOUD

    assert gate(enabled=False, quiet=quiet) == "popup_disabled"
    assert gate(candidate=None, quiet=quiet) == "no_candidate"
    assert gate(host_available=False, quiet=quiet) == "unavailable"
    assert gate(ui_state=FOCUSED, quiet=quiet) == "foreground"
    assert gate(busy=True, quiet=quiet) == "busy"
    assert calls == []
    assert gate(quiet=quiet) is None
    assert calls == [1]


# --- QuietProbe ---------------------------------------------------------------


def test_quiet_probe_queries_once():
    calls: list[int] = []

    def query() -> QuietState:
        calls.append(1)
        return QUIET

    probe = QuietProbe(query)
    assert probe.state is None
    assert probe() is QUIET
    assert probe() is QUIET
    assert calls == [1]
    assert probe.state is QUIET


# --- divert hook with the real plan_toasts ---------------------------------------


class FakeReserver:
    def __init__(self, result: bool = True):
        self.result, self.calls = result, []

    def reserve(self, plan: ToastPlan, candidate: CallCandidate) -> PendingCall | None:
        self.calls.append((plan, candidate))
        return PendingCall(1, plan, candidate) if self.result else None


def plan_with(chats, root, divert, *, enabled=True, ui=IDLE):
    strings = {
        "sent_photo": "p",
        "sent_video": "v",
        "sent_voice": "Sent a voice message",
        "sent_message": "m",
        "hidden_body": "h",
        "more": "+{n} more",
    }
    return plan_toasts(
        chats,
        service=SERVICE,
        service_display=DISPLAY,
        output_service_dir=root / DISPLAY,
        ui_state=ui,
        enabled=enabled,
        hide_content=False,
        strings=strings,
        avatar_for=lambda _d: None,
        divert=divert,
        member_count_for=one,
    )


def two_chats():
    a = chat(ROOT, "34", "58", newest_voice=voice(10, T))
    b = chat(ROOT, "35", "59", newest_voice=None, name="齊藤 京子")
    cand = select_call_candidate([a, b], service=SERVICE, member_count_for=one)
    assert cand is not None
    return [a, b], cand


def test_hook_diverts_only_the_candidate():
    chats, cand = two_chats()
    rs = FakeReserver()
    hook = make_call_divert(cand, None, rs)
    plans, skips = plan_with(chats, ROOT, hook)
    assert skips == [Skip("diverted", "34", "58", 1)]
    assert [p.group_id for p in plans] == ["35"]
    assert hook.pending is not None and hook.pending.plan.group_id == "34"
    assert len(rs.calls) == 1


def test_hook_lost_race_keeps_plan_and_logs_busy():
    chats, cand = two_chats()
    rs = FakeReserver(False)
    hook = make_call_divert(cand, None, rs)
    with capture_logs() as logs:
        plans, skips = plan_with(chats, ROOT, hook)
    assert skips == []
    assert {p.group_id for p in plans} == {"34", "35"}
    assert hook.pending is None
    ev = [e for e in logs if e["event"] == "call_popup_skip"]
    assert len(ev) == 1
    assert ev[0]["reason"] == "busy"
    assert ev[0]["service"] == SERVICE
    assert (ev[0]["group_id"], ev[0]["member_id"], ev[0]["message_id"]) == (
        "34",
        "58",
        "10",
    )


def test_hook_gate_reason_reserves_nothing():
    chats, cand = two_chats()
    rs = FakeReserver()
    hook = make_call_divert(cand, "quiet", rs)
    plans, skips = plan_with(chats, ROOT, hook)
    assert rs.calls == []
    assert skips == []
    assert len(plans) == 2


def test_hook_without_candidate_never_diverts():
    chats, _ = two_chats()
    rs = FakeReserver()
    hook = make_call_divert(None, None, rs)
    plans, skips = plan_with(chats, ROOT, hook)
    assert rs.calls == [] and skips == [] and len(plans) == 2


def test_hook_with_notifications_off_still_reserves_candidate():
    chats, cand = two_chats()
    hook = make_call_divert(cand, None, FakeReserver())
    plans, skips = plan_with(chats, ROOT, hook, enabled=False)
    assert plans == []
    assert sorted((s.reason, s.group_id) for s in skips) == [
        ("disabled", "35"),
        ("diverted", "34"),
    ]


def test_hook_gate_reason_with_notifications_off_is_disabled():
    chats, cand = two_chats()
    rs = FakeReserver()
    hook = make_call_divert(cand, "quiet", rs)
    plans, skips = plan_with(chats, ROOT, hook, enabled=False)
    assert plans == [] and rs.calls == []
    assert {s.reason for s in skips} == {"disabled"}


def test_hook_never_diverts_a_room_plan():
    cand = CallCandidate("34", "0", "10", ROOT / "x")
    rs = FakeReserver()
    hook = make_call_divert(cand, None, rs)
    plan = ToastPlan(
        target=ChatTarget(SERVICE, "x", "room", True),
        group_id="34",
        member_id="0",
        title="room",
        body="b",
        avatar=None,
        count=1,
        newest_type="voice",
        newest_id="10",
    )
    assert hook(plan) is False
    assert rs.calls == []


def test_hook_diverts_once():
    chats, cand = two_chats()
    rs = FakeReserver()
    hook = make_call_divert(cand, None, rs)
    plan_with(chats, ROOT, hook)
    assert hook.pending is not None
    assert hook(hook.pending.plan) is False
    assert len(rs.calls) == 1


# --- log_gate_skip -------------------------------------------------------------


def test_log_gate_skip_with_candidate_and_quiet():
    with capture_logs() as logs:
        log_gate_skip(service=SERVICE, reason="quiet", candidate=CAND, quiet=QUIET)
    assert logs == [
        {
            "event": "call_popup_skip",
            "log_level": "info",
            "service": SERVICE,
            "reason": "quiet",
            "group_id": "34",
            "member_id": "58",
            "message_id": "10",
            "quiet_state": "fullscreen",
        }
    ]


def test_log_gate_skip_without_candidate():
    with capture_logs() as logs:
        log_gate_skip(
            service=SERVICE, reason="no_candidate", candidate=None, quiet=None
        )
    assert logs == [
        {
            "event": "call_popup_skip",
            "log_level": "info",
            "service": SERVICE,
            "reason": "no_candidate",
        }
    ]


# --- build_missed_plan -----------------------------------------------------------

STR = {
    "missed_title": "Missed call: {name}",
    "missed_body": "Click to open the chat",
    "missed_more": "+{n} more messages",
}


def _plan(count: int) -> ToastPlan:
    return ToastPlan(
        target=ChatTarget(SERVICE, "p", "金村 美玖", False),
        group_id="34",
        member_id="58",
        title="金村 美玖",
        body="Sent a voice message",
        avatar=Path("/a.jpg"),
        count=count,
        newest_type="voice",
        newest_id="10",
    )


def test_missed_plan_single():
    p = _plan(1)
    out = build_missed_plan(p, STR)
    assert out == replace(
        p, title="Missed call: 金村 美玖", body="Click to open the chat"
    )


def test_missed_plan_with_more():
    p = _plan(4)
    out = build_missed_plan(p, STR)
    assert out == replace(p, title="Missed call: 金村 美玖", body="+3 more messages")
