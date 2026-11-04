"""CallPopupController: state machine, watchdogs, toasts and heard retries (spec C3 §4.4)."""

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, call

import pytest
from structlog.testing import capture_logs

from backend.services.call_popup import (
    CONNECTED_WATCHDOG_S,
    RESERVED_WATCHDOG_S,
    RING_WATCHDOG_S,
    START_WATCHDOG_S,
    CallCandidate,
    CallEvent,
    CallInfo,
    CallPopupController,
    _reset_controller_for_tests,
    get_call_popup_controller,
)
from backend.services.desktop_bridge import HeardTarget
from backend.services.notification_planner import ChatTarget, ToastPlan, UiState

PATH = "日向坂46/messages/34 金村 美玖/58 金村 美玖"
STRINGS = {
    "missed_title": "Missed call: {name}",
    "missed_body": "Click to open the chat",
    "missed_more": "+{n} more messages",
}
IDLE_UI = UiState(None, None, None, False)
VIEWING_UI = UiState("hinatazaka46", "34", "58", True)
ELSEWHERE_UI = UiState("hinatazaka46", "34", "99", True)


def plan(count: int = 1) -> ToastPlan:
    return ToastPlan(
        target=ChatTarget("hinatazaka46", PATH, "金村 美玖", False),
        group_id="34",
        member_id="58",
        title="金村 美玖",
        body="Sent a voice message",
        avatar=None,
        count=count,
        newest_type="voice",
        newest_id="10",
    )


CAND = CallCandidate("34", "58", "10", Path("out") / PATH)


class Bridge:
    def __init__(self, *, start=True, reveal=True, heard=("delivered",)):
        self.start_result, self.reveal_result = start, reveal
        self.heard = list(heard)
        self.calls: list[tuple] = []
        self.reveal_hook: Any = None  # awaited inside call_popup_reveal

    async def call_popup_start(self, call_id):
        self.calls.append(("start", call_id))
        return self.start_result

    async def call_popup_reveal(self, call_id):
        self.calls.append(("reveal", call_id))
        if self.reveal_hook is not None:
            await self.reveal_hook()
        return self.reveal_result

    async def call_popup_hide(self, call_id):
        self.calls.append(("hide", call_id))

    async def call_popup_cancel(self, call_id):
        self.calls.append(("cancel", call_id))

    async def call_popup_deliver_heard(self, target):
        self.calls.append(("heard", target))
        return self.heard.pop(0) if len(self.heard) > 1 else self.heard[0]


class Sleeper:
    """Injected watchdog sleep: parks every call until release()."""

    def __init__(self):
        self.durations: list[float] = []
        self._futs: list[asyncio.Future] = []

    async def __call__(self, s: float) -> None:
        self.durations.append(s)
        fut = asyncio.get_running_loop().create_future()
        self._futs.append(fut)
        await fut

    def release(self) -> None:
        for f in self._futs:
            if not f.done():
                f.set_result(None)
        self._futs.clear()


class Env:
    def __init__(
        self, *, ui: UiState = IDLE_UI, notifications: bool = True, **bridge_kw: Any
    ):
        self.ui, self.bridge, self.sleeper, self.sent = (
            ui,
            Bridge(**bridge_kw),
            Sleeper(),
            [],
        )
        self.config = {"notifications_enabled": notifications, "language": "en"}
        self.heard_sleep = AsyncMock()

        async def send(plans):
            self.sent.extend(plans)
            return len(plans)

        async def load():
            return dict(self.config)

        async def strings(_c):
            return dict(STRINGS)

        self.ctrl = CallPopupController(
            send_toasts=send,
            bridge=self.bridge,
            get_ui_state=lambda: self.ui,
            load_config=load,
            strings_for=strings,
            sleep=self.sleeper,
            heard_sleep=self.heard_sleep,
        )

    async def settle(self) -> None:
        for _ in range(5):
            await asyncio.sleep(0)
        await self.ctrl.wait_tasks()

    async def ringing(self, count: int = 1) -> int:
        p = self.ctrl.reserve(plan(count), CAND)
        await self.ctrl.dispatch(p.call_id)
        assert await self.ctrl.on_event(p.call_id, CallEvent("ringing"))
        return p.call_id

    async def starting(self) -> int:
        p = self.ctrl.reserve(plan(), CAND)
        await self.ctrl.dispatch(p.call_id)
        return p.call_id

    async def connected(self) -> int:
        cid = await self.ringing()
        assert await self.ctrl.on_event(cid, CallEvent("answered", message_id=10))
        await self.settle()
        return cid

    async def to_phase(self, phase: str) -> int:
        return await {
            "starting": self.starting,
            "ringing": self.ringing,
            "connected": self.connected,
        }[phase]()


def events(logs, name):
    return [e for e in logs if e["event"] == name]


# 1
@pytest.mark.asyncio
async def test_reserve_allocates_ids_and_rejects_while_busy():
    env = Env()
    with capture_logs() as logs:
        p = env.ctrl.reserve(plan(3), CAND)
    assert (
        p is not None and p.call_id == 1 and p.plan == plan(3) and p.candidate == CAND
    )
    assert env.ctrl.phase == "reserved" and env.ctrl.busy
    (rec,) = events(logs, "call_popup_reserved")
    assert (
        rec["call_id"] == 1 and rec["count"] == 3 and rec["service"] == "hinatazaka46"
    )
    assert (rec["group_id"], rec["member_id"], rec["message_id"]) == ("34", "58", "10")
    with capture_logs() as logs:
        assert env.ctrl.reserve(plan(), CAND) is None
    assert logs == []
    env.ctrl.abandon(1, "cancelled")
    assert not env.ctrl.busy and env.ctrl.phase == "idle"
    assert env.ctrl.reserve(plan(), CAND).call_id == 2


# 2
@pytest.mark.asyncio
async def test_dispatch_starts_popup_and_arms_start_watchdog():
    env = Env()
    p = env.ctrl.reserve(plan(), CAND)
    with capture_logs() as logs:
        await env.ctrl.dispatch(p.call_id)
        await env.settle()
    assert env.bridge.calls == [("start", 1)]
    assert env.ctrl.phase == "starting"
    assert [e["result"] for e in events(logs, "call_popup_dispatch")] == ["started"]
    assert env.sleeper.durations == [START_WATCHDOG_S] == [20]


@pytest.mark.asyncio
async def test_page_may_fetch_before_start_returns():
    """The phase is `starting` (and info() answers) while call_popup_start is still awaited."""
    env = Env()
    seen: list[CallInfo | None] = []

    async def start(call_id):
        seen.append(env.ctrl.info(call_id))
        return True

    env.bridge.call_popup_start = start  # type: ignore[method-assign]
    p = env.ctrl.reserve(plan(), CAND)
    await env.ctrl.dispatch(p.call_id)
    assert seen == [CallInfo(1, "hinatazaka46", PATH, False, "34", "58", 10)]


@pytest.mark.asyncio
async def test_start_watchdog_is_rearmed_when_start_returns():
    """A slow start must not eat the page's budget: the 20 s count from its return."""
    env = Env()
    gate = asyncio.Event()

    async def slow_start(call_id):
        await gate.wait()
        return True

    env.bridge.call_popup_start = slow_start  # type: ignore[method-assign]
    p = env.ctrl.reserve(plan(), CAND)
    dispatching = asyncio.ensure_future(env.ctrl.dispatch(p.call_id))
    await env.settle()
    first = env.ctrl._watchdog
    assert first is not None and env.ctrl.phase == "starting"
    assert env.sleeper.durations == [RESERVED_WATCHDOG_S, START_WATCHDOG_S]
    gate.set()
    with capture_logs() as logs:
        await dispatching
        await env.settle()
    second = env.ctrl._watchdog
    assert first.cancelled() and second is not None and second is not first
    assert env.sleeper.durations == [
        RESERVED_WATCHDOG_S,
        START_WATCHDOG_S,
        START_WATCHDOG_S,
    ]
    assert [e["result"] for e in events(logs, "call_popup_dispatch")] == ["started"]
    # The preload completes within 20 s of start's return: the call rings, no watchdog.
    assert await env.ctrl.on_event(p.call_id, CallEvent("ringing"))
    await env.settle()
    assert env.ctrl.phase == "ringing" and second.cancelled()
    assert events(logs, "call_popup_watchdog") == []
    assert env.sent == []
    await env.ctrl.shutdown()


@pytest.mark.parametrize("started", [True, False])
@pytest.mark.parametrize("trigger", ["foreground", "disabled", "watchdog"])
@pytest.mark.asyncio
async def test_call_ended_while_start_is_awaited_is_superseded(trigger, started):
    """foreground / cancel / watchdog during call_popup_start: no toast, idle, superseded."""
    env = Env()
    gate = asyncio.Event()

    async def start(call_id):
        env.bridge.calls.append(("start", call_id))
        await gate.wait()
        return started

    env.bridge.call_popup_start = start  # type: ignore[method-assign]
    p = env.ctrl.reserve(plan(), CAND)
    dispatching = asyncio.ensure_future(env.ctrl.dispatch(p.call_id))
    await env.settle()
    assert env.ctrl.phase == "starting"
    with capture_logs() as logs:
        if trigger == "foreground":
            await env.ctrl.on_foreground()
        elif trigger == "disabled":
            await env.ctrl.cancel("disabled")
        else:
            env.sleeper.release()
            await env.settle()
        assert env.ctrl.phase == "idle"
        gate.set()
        await dispatching
        await env.settle()
    assert env.ctrl.phase == "idle"
    assert [e["result"] for e in events(logs, "call_popup_dispatch")] == ["superseded"]
    assert env.bridge.calls == [("start", 1), ("cancel", 1)]
    if trigger == "watchdog":
        # The watchdog's own fallback is the only toast; superseded sends none more.
        assert env.sent == [plan()]
        assert [e["reason"] for e in events(logs, "call_popup_toast")] == ["watchdog"]
    else:
        assert env.sent == [] and events(logs, "call_popup_toast") == []
        (rec,) = events(logs, "call_popup_cancel")
        assert (rec["call_id"], rec["reason"], rec["phase"]) == (1, trigger, "starting")


# 3
@pytest.mark.asyncio
async def test_dispatch_start_failure_sends_fallback_toast():
    env = Env(start=False)
    p = env.ctrl.reserve(plan(), CAND)
    with capture_logs() as logs:
        await env.ctrl.dispatch(p.call_id)
        await env.settle()
    assert env.ctrl.phase == "idle"
    assert [e["result"] for e in events(logs, "call_popup_dispatch")] == [
        "start_failed"
    ]
    assert env.sent == [plan()]
    (toast,) = events(logs, "call_popup_toast")
    assert (toast["kind"], toast["reason"], toast["sent"]) == (
        "fallback",
        "start_failed",
        True,
    )


# 4
@pytest.mark.asyncio
async def test_dispatch_focused_on_chat_is_viewing():
    env = Env(ui=VIEWING_UI)
    p = env.ctrl.reserve(plan(), CAND)
    with capture_logs() as logs:
        await env.ctrl.dispatch(p.call_id)
        await env.settle()
    assert env.ctrl.phase == "idle"
    assert [e["result"] for e in events(logs, "call_popup_dispatch")] == ["viewing"]
    assert env.bridge.calls == [] and env.sent == []


@pytest.mark.asyncio
async def test_dispatch_focused_elsewhere_sends_fallback():
    env = Env(ui=ELSEWHERE_UI)
    p = env.ctrl.reserve(plan(), CAND)
    with capture_logs() as logs:
        await env.ctrl.dispatch(p.call_id)
        await env.settle()
    assert env.ctrl.phase == "idle"
    assert [e["result"] for e in events(logs, "call_popup_dispatch")] == ["foreground"]
    assert env.bridge.calls == [] and env.sent == [plan()]
    assert events(logs, "call_popup_toast")[0]["reason"] == "foreground"


# 5
@pytest.mark.asyncio
async def test_dispatch_of_unreserved_id_is_logged_only():
    env = Env()
    with capture_logs() as logs:
        await env.ctrl.dispatch(7)
        env.ctrl.reserve(plan(), CAND)
        await env.ctrl.dispatch(7)
    assert [e["result"] for e in events(logs, "call_popup_dispatch")] == [
        "not_reserved"
    ] * 2
    assert env.bridge.calls == [] and env.ctrl.phase == "reserved"
    await env.ctrl.dispatch(1)
    await env.ctrl.dispatch(1)  # already starting
    assert env.bridge.calls == [("start", 1)]
    await env.ctrl.shutdown()


# 6
@pytest.mark.asyncio
async def test_info_and_is_active_for_follow_the_phase():
    env = Env()
    expected = CallInfo(1, "hinatazaka46", PATH, False, "34", "58", 10)
    env.ctrl.reserve(plan(), CAND)
    assert env.ctrl.info(1) is None
    assert env.ctrl.is_active_for("hinatazaka46", "34", "58", 10)
    await env.ctrl.dispatch(1)
    assert env.ctrl.info(1) == expected and env.ctrl.info(2) is None
    assert env.ctrl.is_active_for("hinatazaka46", "34", "58", 10)
    assert not env.ctrl.is_active_for("hinatazaka46", "34", "58", 11)
    assert not env.ctrl.is_active_for("sakurazaka46", "34", "58", 10)
    assert not env.ctrl.is_active_for("hinatazaka46", "34", "59", 10)
    assert await env.ctrl.on_event(1, CallEvent("ringing"))
    assert env.ctrl.info(1) == expected
    assert await env.ctrl.on_event(1, CallEvent("answered", message_id=10))
    assert env.ctrl.info(1) == expected
    assert env.ctrl.is_active_for("hinatazaka46", "34", "58", 10)
    assert await env.ctrl.on_event(1, CallEvent("ended"))
    assert env.ctrl.info(1) is None
    assert not env.ctrl.is_active_for("hinatazaka46", "34", "58", 10)
    await env.settle()


# 7
@pytest.mark.parametrize(
    ("event", "before", "after", "hide", "toast"),
    [
        (CallEvent("ringing"), "starting", "ringing", False, None),
        (
            CallEvent("skipped", reason="no_photo"),
            "starting",
            "idle",
            False,
            "fallback",
        ),
        (CallEvent("skipped", reason="already_read"), "starting", "idle", False, None),
        (CallEvent("answered", message_id=10), "ringing", "connected", False, None),
        (CallEvent("declined"), "ringing", "idle", True, "missed"),
        (CallEvent("timeout"), "ringing", "idle", True, "missed"),
        (CallEvent("ended"), "connected", "idle", True, None),
        (CallEvent("ended", reason="played"), "connected", "idle", True, None),
        (CallEvent("ended", reason="hung_up"), "connected", "idle", True, None),
        (CallEvent("error", error_type="X"), "starting", "idle", True, "fallback"),
        (CallEvent("cancelled"), "starting", "idle", True, "fallback"),
        (CallEvent("error"), "ringing", "idle", True, "missed"),
        (CallEvent("cancelled"), "ringing", "idle", True, "missed"),
        (CallEvent("error"), "connected", "idle", True, None),
        (CallEvent("cancelled"), "connected", "idle", True, None),
    ],
)
@pytest.mark.asyncio
async def test_event_phase_matrix(event, before, after, hide, toast):
    env = Env()
    cid = await env.to_phase(before)
    env.bridge.calls.clear()
    env.sent.clear()
    with capture_logs() as logs:
        assert await env.ctrl.on_event(cid, event) is True
        await env.settle()
    assert env.ctrl.phase == after
    calls = [c[0] for c in env.bridge.calls if c[0] != "heard"]
    expected_calls = (["hide"] if hide else []) + (
        ["reveal"] if event.kind == "ringing" else []
    )
    assert calls == expected_calls
    (rec,) = events(logs, "call_popup_event")
    assert (rec["call_id"], rec["call_event"], rec["phase"]) == (
        cid,
        event.kind,
        before,
    )
    assert rec["reason"] == event.reason and rec["error_type"] == event.error_type
    assert [e["reason"] for e in events(logs, "call_popup_hide")] == (
        [event.kind] if hide else []
    )
    if toast is None:
        assert env.sent == []
    elif toast == "fallback":
        assert env.sent == [plan()]
        assert events(logs, "call_popup_toast")[0]["reason"] == (
            event.reason or event.kind
        )
    else:
        assert len(env.sent) == 1 and env.sent[0].title == "Missed call: 金村 美玖"
        assert events(logs, "call_popup_toast")[0]["reason"] == event.kind
    await env.ctrl.shutdown()


# 8
@pytest.mark.asyncio
async def test_stale_events_change_nothing():
    env = Env()
    cid = await env.starting()
    with capture_logs() as logs:
        assert not await env.ctrl.on_event(99, CallEvent("ringing"))
        assert not await env.ctrl.on_event(cid, CallEvent("declined"))
        assert env.ctrl.phase == "starting"
        assert await env.ctrl.on_event(cid, CallEvent("ringing"))
        assert not await env.ctrl.on_event(cid, CallEvent("answered", message_id=11))
        assert not await env.ctrl.on_event(cid, CallEvent("answered"))
        assert env.ctrl.phase == "ringing"
    stale = events(logs, "call_popup_event_stale")
    assert [(e["call_event"], e["reason"]) for e in stale] == [
        ("ringing", "unknown_call"),
        ("declined", "wrong_phase"),
        ("answered", "message_mismatch"),
        ("answered", "message_mismatch"),
    ]
    assert env.sent == []
    await env.ctrl.shutdown()


@pytest.mark.asyncio
async def test_event_while_idle_or_reserved_is_unknown_or_wrong():
    env = Env()
    with capture_logs() as logs:
        assert not await env.ctrl.on_event(1, CallEvent("ringing"))
        env.ctrl.reserve(plan(), CAND)
        assert not await env.ctrl.on_event(1, CallEvent("ringing"))
    assert [e["reason"] for e in events(logs, "call_popup_event_stale")] == [
        "unknown_call",
        "wrong_phase",
    ]


# 9 covered by the matrix; explicit log assertions here.
@pytest.mark.asyncio
async def test_skipped_already_read_has_no_toast_and_no_hide():
    env = Env()
    cid = await env.starting()
    with capture_logs() as logs:
        await env.ctrl.on_event(cid, CallEvent("skipped", reason="already_read"))
        await env.settle()
    assert env.sent == [] and events(logs, "call_popup_toast") == []
    assert ("hide", cid) not in env.bridge.calls and env.ctrl.phase == "idle"


# 10
@pytest.mark.asyncio
async def test_reveal_failure_cancels_and_falls_back():
    env = Env(reveal=False)
    cid = await env.starting()
    with capture_logs() as logs:
        assert await env.ctrl.on_event(cid, CallEvent("ringing"))
        await env.settle()
    assert env.ctrl.phase == "idle"
    assert env.bridge.calls[-2:] == [("reveal", cid), ("cancel", cid)]
    assert [e["reason"] for e in events(logs, "call_popup_hide")] == ["reveal_failed"]
    assert env.sent == [plan()]
    assert events(logs, "call_popup_toast")[0]["reason"] == "reveal_failed"


@pytest.mark.parametrize("trigger", ["foreground", "disabled", "declined"])
@pytest.mark.asyncio
async def test_call_ended_during_reveal_hides_again(trigger):
    """A cancel whose hide lands before the reveal's ShowWindow must not leave a popup."""
    env = Env()
    cid = await env.starting()

    async def end_meanwhile():
        if trigger == "foreground":
            await env.ctrl.on_foreground()
        elif trigger == "disabled":
            await env.ctrl.cancel("disabled")
        else:
            assert await env.ctrl.on_event(cid, CallEvent("declined"))

    env.bridge.reveal_hook = end_meanwhile
    env.bridge.calls.clear()
    with capture_logs() as logs:
        assert await env.ctrl.on_event(cid, CallEvent("ringing"))
        await env.settle()
    assert env.ctrl.phase == "idle"
    assert env.bridge.calls[-1] == ("hide", cid)
    assert "superseded" in [e["reason"] for e in events(logs, "call_popup_hide")]
    await env.ctrl.shutdown()


@pytest.mark.asyncio
async def test_answer_during_reveal_keeps_the_popup():
    env = Env()
    cid = await env.starting()

    async def answer_meanwhile():
        assert await env.ctrl.on_event(cid, CallEvent("answered", message_id=10))

    env.bridge.reveal_hook = answer_meanwhile
    env.bridge.calls.clear()
    with capture_logs() as logs:
        assert await env.ctrl.on_event(cid, CallEvent("ringing"))
        await env.settle()
    assert env.ctrl.phase == "connected"
    assert ("hide", cid) not in env.bridge.calls
    assert events(logs, "call_popup_hide") == []
    await env.ctrl.shutdown()


@pytest.mark.parametrize(
    ("phase", "toast"),
    [("starting", "fallback"), ("ringing", "missed"), ("connected", None)],
)
@pytest.mark.asyncio
async def test_lost_window_ends_the_call_now(phase, toast):
    env = Env()
    cid = await env.to_phase(phase)
    env.bridge.calls.clear()
    env.sent.clear()
    with capture_logs() as logs:
        assert await env.ctrl.on_event(
            cid, CallEvent("error", error_type="window_lost")
        )
        await env.settle()
    assert env.ctrl.phase == "idle" and env.bridge.calls == [("hide", cid)]
    (rec,) = events(logs, "call_popup_event")
    assert rec["error_type"] == "window_lost"
    kinds = [e["kind"] for e in events(logs, "call_popup_toast")]
    assert kinds == ([] if toast is None else [toast])


# 11
@pytest.mark.asyncio
async def test_answer_delivers_heard():
    env = Env()
    with capture_logs() as logs:
        cid = await env.connected()
    assert env.ctrl.phase == "connected"
    assert ("heard", HeardTarget("hinatazaka46", PATH, 10)) in env.bridge.calls
    (rec,) = events(logs, "call_popup_heard")
    assert rec["call_id"] == cid and rec["message_id"] == "10"
    assert rec["delivered"] is True and rec["attempts"] == 1 and "reason" not in rec
    env.heard_sleep.assert_not_awaited()
    assert env.sleeper.durations[-1] == CONNECTED_WATCHDOG_S
    await env.ctrl.shutdown()


@pytest.mark.asyncio
async def test_heard_retries_while_not_ready():
    env = Env(heard=("not_ready", "not_ready", "delivered"))
    with capture_logs() as logs:
        await env.connected()
    (rec,) = events(logs, "call_popup_heard")
    assert rec["delivered"] is True and rec["attempts"] == 3
    assert env.heard_sleep.await_args_list == [call(1.0), call(1.0)]
    await env.ctrl.shutdown()


@pytest.mark.asyncio
async def test_heard_gives_up_after_three_errors():
    env = Env(heard=("error",))
    with capture_logs() as logs:
        await env.connected()
    (rec,) = events(logs, "call_popup_heard")
    assert (
        rec["delivered"] is False and rec["attempts"] == 3 and rec["reason"] == "error"
    )
    assert env.heard_sleep.await_count == 2
    await env.ctrl.shutdown()


@pytest.mark.asyncio
async def test_heard_stops_on_no_host():
    env = Env(heard=("no_host",))
    with capture_logs() as logs:
        await env.connected()
    (rec,) = events(logs, "call_popup_heard")
    assert (
        rec["delivered"] is False
        and rec["attempts"] == 1
        and rec["reason"] == "no_host"
    )
    env.heard_sleep.assert_not_awaited()
    await env.ctrl.shutdown()


# 12
@pytest.mark.parametrize(
    ("count", "body"), [(1, "Click to open the chat"), (4, "+3 more messages")]
)
@pytest.mark.asyncio
async def test_missed_toast_text(count, body):
    env = Env()
    cid = await env.ringing(count)
    await env.ctrl.on_event(cid, CallEvent("declined"))
    await env.settle()
    (sent,) = env.sent
    assert sent.title == "Missed call: 金村 美玖" and sent.body == body
    assert sent.target == plan().target


# 13
async def _decline(env):
    await env.ctrl.on_event(await env.ringing(), CallEvent("declined"))


async def _timeout(env):
    await env.ctrl.on_event(await env.ringing(), CallEvent("timeout"))


async def _skip(env):
    await env.ctrl.on_event(
        await env.starting(), CallEvent("skipped", reason="no_photo")
    )


async def _start_failed(env):
    env.bridge.start_result = False
    await env.starting()


async def _foreground(env):
    env.ui = ELSEWHERE_UI
    await env.starting()


async def _sync_failed(env):
    env.ctrl.reserve(plan(), CAND)
    env.ctrl.abandon(1, "sync_failed")


@pytest.mark.parametrize(
    ("scenario", "kind", "reason"),
    [
        (_decline, "missed", "declined"),
        (_timeout, "missed", "timeout"),
        (_skip, "fallback", "no_photo"),
        (_start_failed, "fallback", "start_failed"),
        (_foreground, "fallback", "foreground"),
        (_sync_failed, "fallback", "sync_failed"),
    ],
)
@pytest.mark.asyncio
async def test_notifications_off_suppresses_toasts_only(scenario, kind, reason):
    env = Env(notifications=False)
    with capture_logs() as logs:
        await scenario(env)
        await env.settle()
    assert env.sent == [] and env.ctrl.phase == "idle"
    (skip,) = events(logs, "call_popup_toast_skip")
    assert (skip["kind"], skip["reason"]) == (kind, "notifications_disabled")
    assert events(logs, "call_popup_toast") == []


@pytest.mark.asyncio
async def test_notifications_off_still_rings_the_popup():
    env = Env(notifications=False)
    cid = await env.ringing()
    assert env.ctrl.phase == "ringing" and env.ctrl.info(cid) is not None
    await env.ctrl.shutdown()


@pytest.mark.asyncio
async def test_toast_failure_is_logged_with_error_type_only():
    env = Env()

    async def boom(_plans):
        raise RuntimeError("secret 金村")

    env.ctrl._send_toasts = boom  # type: ignore[assignment]
    with capture_logs() as logs:
        await env.ctrl.on_event(await env.ringing(), CallEvent("declined"))
        await env.settle()
    (rec,) = events(logs, "call_popup_toast")
    assert rec["sent"] is False and rec["error_type"] == "RuntimeError"
    assert "secret" not in repr(logs)


@pytest.mark.asyncio
async def test_toast_with_nothing_shown_logs_sent_false():
    env = Env()

    async def none_shown(_plans):
        return 0

    env.ctrl._send_toasts = none_shown  # type: ignore[assignment]
    with capture_logs() as logs:
        await env.ctrl.on_event(await env.ringing(), CallEvent("timeout"))
        await env.settle()
    assert events(logs, "call_popup_toast")[0]["sent"] is False


# 14
@pytest.mark.asyncio
async def test_watchdog_in_starting_falls_back():
    env = Env()
    cid = await env.starting()
    await env.settle()
    env.bridge.calls.clear()
    with capture_logs() as logs:
        env.sleeper.release()
        await env.settle()
    assert env.ctrl.phase == "idle"
    assert env.bridge.calls == [
        ("cancel", cid),
    ]
    (wd,) = events(logs, "call_popup_watchdog")
    assert (wd["call_id"], wd["phase"]) == (cid, "starting")
    assert [e["reason"] for e in events(logs, "call_popup_hide")] == ["watchdog"]
    assert env.sent == [plan()]


@pytest.mark.asyncio
async def test_watchdog_in_ringing_sends_missed():
    env = Env()
    cid = await env.ringing()
    await env.settle()
    assert env.sleeper.durations[-1] == RING_WATCHDOG_S == 45
    with capture_logs() as logs:
        env.sleeper.release()
        await env.settle()
    assert env.ctrl.phase == "idle" and ("cancel", cid) in env.bridge.calls
    assert events(logs, "call_popup_watchdog")[0]["phase"] == "ringing"
    assert len(env.sent) == 1 and env.sent[0].title.startswith("Missed call")
    assert events(logs, "call_popup_toast")[0]["reason"] == "watchdog"


@pytest.mark.asyncio
async def test_watchdog_in_connected_cancels_without_toast():
    env = Env()
    cid = await env.connected()
    assert env.sleeper.durations[-1] == CONNECTED_WATCHDOG_S == 900
    with capture_logs() as logs:
        env.sleeper.release()
        await env.settle()
    assert env.ctrl.phase == "idle" and ("cancel", cid) in env.bridge.calls
    assert events(logs, "call_popup_watchdog")[0]["phase"] == "connected"
    assert env.sent == []


@pytest.mark.asyncio
async def test_transition_cancels_the_watchdog():
    env = Env()
    cid = await env.ringing()
    await env.settle()
    ring_watchdog = env.ctrl._watchdog
    assert ring_watchdog is not None and not ring_watchdog.done()
    await env.ctrl.on_event(cid, CallEvent("declined"))
    await env.settle()
    assert ring_watchdog.cancelled()
    n_calls, n_sent = len(env.bridge.calls), len(env.sent)
    with capture_logs() as logs:
        env.sleeper.release()
        await env.settle()
    assert events(logs, "call_popup_watchdog") == []
    assert len(env.bridge.calls) == n_calls and len(env.sent) == n_sent


@pytest.mark.asyncio
async def test_stale_watchdog_for_a_newer_call_does_nothing():
    env = Env()
    env.ctrl.reserve(plan(), CAND)
    await env.ctrl.dispatch(1)
    await env.settle()
    old = env.ctrl._watchdog
    assert old is not None
    old_fut = env.sleeper._futs[-1]
    # Replace the call without cancelling the old watchdog task, then let it fire.
    with env.ctrl._lock:
        env.ctrl._watchdog = None
        env.ctrl._to_idle_locked()
    env.ctrl.reserve(plan(), CAND)
    await env.ctrl.dispatch(2)
    await env.settle()
    with capture_logs() as logs:
        old_fut.set_result(None)
        await env.settle()
    assert events(logs, "call_popup_watchdog") == []
    assert env.ctrl.phase == "starting"
    await env.ctrl.shutdown()
    old.cancel()


# 15
@pytest.mark.parametrize("phase", ["starting", "ringing"])
@pytest.mark.asyncio
async def test_foreground_cancels_started_calls(phase):
    env = Env()
    cid = await env.to_phase(phase)
    env.bridge.calls.clear()
    with capture_logs() as logs:
        await env.ctrl.on_foreground()
        await env.settle()
    assert env.ctrl.phase == "idle" and env.bridge.calls == [("cancel", cid)]
    (rec,) = events(logs, "call_popup_cancel")
    assert (rec["call_id"], rec["reason"], rec["phase"]) == (cid, "foreground", phase)
    assert env.sent == []


@pytest.mark.asyncio
async def test_foreground_leaves_connected_alone():
    env = Env()
    cid = await env.connected()
    env.bridge.calls.clear()
    with capture_logs() as logs:
        await env.ctrl.on_foreground()
    assert env.ctrl.phase == "connected" and env.bridge.calls == []
    (rec,) = events(logs, "call_popup_foreground_kept")
    assert rec["call_id"] == cid
    await env.ctrl.shutdown()


@pytest.mark.asyncio
async def test_foreground_ignores_reserved_and_idle():
    env = Env()
    await env.ctrl.on_foreground()
    env.ctrl.reserve(plan(), CAND)
    await env.ctrl.on_foreground()
    assert env.ctrl.phase == "reserved" and env.bridge.calls == []
    env.ui = ELSEWHERE_UI
    await env.ctrl.dispatch(1)
    await env.settle()
    assert env.sent == [plan()]


# 16
@pytest.mark.parametrize("phase", ["reserved", "starting", "ringing", "connected"])
@pytest.mark.asyncio
async def test_cancel_disabled(phase):
    env = Env()
    if phase == "reserved":
        env.ctrl.reserve(plan(), CAND)
        cid = 1
    else:
        cid = await env.to_phase(phase)
    env.bridge.calls.clear()
    with capture_logs() as logs:
        await env.ctrl.cancel("disabled")
        await env.settle()
    assert env.ctrl.phase == "idle"
    assert env.bridge.calls == ([] if phase == "reserved" else [("cancel", cid)])
    (rec,) = events(logs, "call_popup_cancel")
    assert (rec["call_id"], rec["reason"], rec["phase"]) == (cid, "disabled", phase)
    if phase == "reserved":
        # The plan was diverted and no popup exists: the chat still gets its toast.
        assert env.sent == [plan()]
        (toast,) = events(logs, "call_popup_toast")
        assert (toast["kind"], toast["reason"], toast["sent"]) == (
            "fallback",
            "disabled",
            True,
        )
        with capture_logs() as logs:
            await env.ctrl.dispatch(cid)  # the sync arrives later
        assert events(logs, "call_popup_dispatch")[0]["result"] == "not_reserved"
    else:
        assert env.sent == []


@pytest.mark.asyncio
async def test_cancel_disabled_while_reserved_respects_notifications_off():
    env = Env(notifications=False)
    env.ctrl.reserve(plan(), CAND)
    with capture_logs() as logs:
        await env.ctrl.cancel("disabled")
        await env.settle()
    assert env.sent == []
    (skip,) = events(logs, "call_popup_toast_skip")
    assert (skip["kind"], skip["reason"]) == ("fallback", "notifications_disabled")


@pytest.mark.asyncio
async def test_cancel_when_idle_is_silent():
    env = Env()
    with capture_logs() as logs:
        await env.ctrl.cancel("disabled")
        await env.ctrl.shutdown()
    assert logs == [] and env.bridge.calls == []


# 17
@pytest.mark.asyncio
async def test_shutdown_while_ringing():
    env = Env()
    cid = await env.ringing()
    await env.settle()
    watchdog = env.ctrl._watchdog
    assert watchdog is not None
    env.bridge.calls.clear()
    with capture_logs() as logs:
        await env.ctrl.shutdown()
    assert env.ctrl.phase == "idle" and env.sent == [] and env.bridge.calls == []
    (rec,) = events(logs, "call_popup_cancel")
    assert (rec["call_id"], rec["reason"], rec["phase"]) == (cid, "app_exit", "ringing")
    await asyncio.sleep(0)
    assert watchdog.cancelled() and env.ctrl._watchdog is None


@pytest.mark.asyncio
async def test_shutdown_during_watchdog_cancel_sends_no_toast():
    """A watchdog already past its sleep is cancelled by shutdown(): no toast after it."""
    env = Env()
    cid = await env.ringing()
    await env.settle()
    watchdog = env.ctrl._watchdog
    assert watchdog is not None
    in_cancel, gate = asyncio.Event(), asyncio.Event()

    async def slow_cancel(call_id):
        env.bridge.calls.append(("cancel", call_id))
        in_cancel.set()
        await gate.wait()

    env.bridge.call_popup_cancel = slow_cancel  # type: ignore[method-assign]
    with capture_logs() as logs:
        env.sleeper.release()
        await in_cancel.wait()
        assert env.ctrl.phase == "idle" and env.ctrl._watchdog is None
        await env.ctrl.shutdown()
        gate.set()
        await env.settle()
    assert watchdog.cancelled() and env.ctrl._firing is None
    assert env.sent == [] and events(logs, "call_popup_toast") == []
    assert events(logs, "call_popup_hide") == []
    assert [e["call_id"] for e in events(logs, "call_popup_watchdog")] == [cid]


@pytest.mark.asyncio
async def test_shutdown_cancels_spawned_tasks():
    env = Env()
    gate = asyncio.Event()

    async def slow(_plans):
        await gate.wait()
        return 1

    env.ctrl._send_toasts = slow  # type: ignore[assignment]
    await env.ctrl.on_event(await env.ringing(), CallEvent("declined"))
    await asyncio.sleep(0)
    assert env.ctrl._tasks
    await env.ctrl.shutdown()
    assert not env.ctrl._tasks


# 18
@pytest.mark.asyncio
async def test_abandon_sync_failed_sends_fallback():
    env = Env()
    env.ctrl.reserve(plan(), CAND)
    with capture_logs() as logs:
        env.ctrl.abandon(1, "sync_failed")
        await env.settle()
    assert env.ctrl.phase == "idle" and env.sent == [plan()]
    (rec,) = events(logs, "call_popup_abandoned")
    assert (rec["call_id"], rec["reason"], rec["toast"]) == (1, "sync_failed", "sent")


@pytest.mark.asyncio
async def test_abandon_cancelled_sends_nothing():
    env = Env()
    env.ctrl.reserve(plan(), CAND)
    with capture_logs() as logs:
        env.ctrl.abandon(1, "cancelled")
        await env.settle()
    assert env.ctrl.phase == "idle" and env.sent == []
    (rec,) = events(logs, "call_popup_abandoned")
    assert (rec["reason"], rec["toast"]) == ("cancelled", "skipped")


@pytest.mark.asyncio
async def test_abandon_when_not_reserved_changes_nothing():
    env = Env()
    cid = await env.starting()
    with capture_logs() as logs:
        env.ctrl.abandon(cid, "sync_failed")
        env.ctrl.abandon(42, "sync_failed")
        await env.settle()
    assert env.ctrl.phase == "starting" and env.sent == []
    recs = events(logs, "call_popup_abandoned")
    assert [r["toast"] for r in recs] == ["skipped", "skipped"]
    await env.ctrl.shutdown()


# 19
@pytest.mark.asyncio
async def test_no_log_carries_names_text_or_paths():
    env = Env(heard=("not_ready", "delivered"))
    with capture_logs() as logs:
        c1 = await env.ringing(3)
        await env.ctrl.on_event(c1, CallEvent("declined"))
        await env.settle()
        await env.connected()
        await env.ctrl.on_event(1 + 1, CallEvent("ended"))
        env.ctrl.reserve(plan(), CAND)
        env.ctrl.abandon(3, "sync_failed")
        env.ui = ELSEWHERE_UI
        await env.ctrl.cancel("disabled")
        await env.settle()
        await env.ctrl.shutdown()
    assert logs
    for e in logs:
        for v in e.values():
            assert "金村" not in str(v) and "messages/" not in str(v), e


# 20
ROOT = Path(__file__).resolve().parents[2]


def _ms(rel: str, name: str) -> int:
    text = (ROOT / rel).read_text(encoding="utf-8")
    m = re.search(rf"{name}\s*=\s*([\d_]+)", text)
    assert m, name
    return int(m.group(1).replace("_", ""))


def test_watchdogs_outlast_b_timers():
    ring = _ms(
        "frontend/src/features/incomingCall/useIncomingCall.ts", "RING_TIMEOUT_MS"
    )
    preload = _ms(
        "frontend/src/features/incomingCall/preloadAudio.ts", "PRELOAD_TIMEOUT_MS"
    )
    assert RING_WATCHDOG_S * 1000 > ring
    assert START_WATCHDOG_S * 1000 > preload
    assert CONNECTED_WATCHDOG_S == 900


# singleton
def test_singleton_is_process_wide_and_resettable():
    _reset_controller_for_tests()
    a = get_call_popup_controller()
    assert get_call_popup_controller() is a
    _reset_controller_for_tests()
    assert get_call_popup_controller() is not a
    _reset_controller_for_tests()


# --- RESERVED watchdog: a leaked reservation can never wedge the controller ---
@pytest.mark.asyncio
async def test_reserved_watchdog_is_armed_and_falls_back():
    env = Env()
    p = env.ctrl.reserve(plan(), CAND)
    await env.settle()
    assert env.sleeper.durations == [RESERVED_WATCHDOG_S] == [1800]
    assert env.ctrl.phase == "reserved" and env.ctrl.busy
    with capture_logs() as logs:
        env.sleeper.release()
        await env.settle()
    assert env.ctrl.phase == "idle" and not env.ctrl.busy
    (wd,) = events(logs, "call_popup_watchdog")
    assert (wd["call_id"], wd["phase"]) == (p.call_id, "reserved")
    assert env.bridge.calls == []  # no popup exists yet
    assert env.sent == [plan()]
    assert events(logs, "call_popup_toast")[0]["reason"] == "watchdog"
    # The sync that finally wakes up finds nothing to dispatch or abandon.
    with capture_logs() as late:
        await env.ctrl.dispatch(p.call_id)
        env.ctrl.abandon(p.call_id, "cancelled")
    assert [e["result"] for e in events(late, "call_popup_dispatch")] == [
        "not_reserved"
    ]
    assert env.ctrl.phase == "idle"


@pytest.mark.asyncio
async def test_reserved_watchdog_respects_notifications_off():
    env = Env(notifications=False)
    env.ctrl.reserve(plan(), CAND)
    await env.settle()
    with capture_logs() as logs:
        env.sleeper.release()
        await env.settle()
    assert env.ctrl.phase == "idle" and env.sent == []
    assert [e["reason"] for e in events(logs, "call_popup_toast_skip")] == [
        "notifications_disabled"
    ]


@pytest.mark.asyncio
async def test_reserved_watchdog_is_cancelled_by_dispatch_and_abandon():
    env = Env()
    p = env.ctrl.reserve(plan(), CAND)
    await env.settle()
    first = env.ctrl._watchdog
    await env.ctrl.dispatch(p.call_id)
    await env.settle()
    assert first is not None and first.cancelled()
    await env.ctrl.shutdown()

    env = Env()
    p = env.ctrl.reserve(plan(), CAND)
    await env.settle()
    wd = env.ctrl._watchdog
    env.ctrl.abandon(p.call_id, "cancelled")
    await env.settle()
    assert wd is not None and wd.cancelled() and env.ctrl._watchdog is None
    assert env.sent == [] and env.ctrl.phase == "idle"


@pytest.mark.asyncio
async def test_shutdown_cancels_the_reserved_watchdog():
    env = Env()
    env.ctrl.reserve(plan(), CAND)
    await env.settle()
    wd = env.ctrl._watchdog
    await env.ctrl.shutdown()
    await asyncio.sleep(0)
    assert wd is not None and wd.cancelled()
    assert env.ctrl.phase == "idle" and env.sent == []
