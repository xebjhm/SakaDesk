"""Native toast notifier: Null/Windows notifiers, click callback, delivery."""

import asyncio
import sys
import threading
import types
from pathlib import Path
from unittest.mock import patch

import pytest
from structlog.testing import capture_logs

from backend.services import notification_service as ns
from backend.services.notification_planner import ChatTarget, ToastPlan

CJK_TARGET = ChatTarget(
    service="hinatazaka46",
    path="日向坂46/messages/34 金村 美玖/58 金村 美玖",
    name="金村 美玖",
    is_group_chat=False,
)
ROOM_TARGET = ChatTarget(
    service="hinatazaka46",
    path="日向坂46/messages/79 日向坂46 ライブ",
    name="A&B=C 100% ライブ",
    is_group_chat=True,
)


def make_plan(
    target: ChatTarget = CJK_TARGET,
    *,
    avatar: Path | None = None,
    count: int = 1,
) -> ToastPlan:
    return ToastPlan(
        target=target,
        group_id="34",
        member_id="58",
        title=target.name,
        body="こんにちは 🎉",
        avatar=avatar,
        count=count,
        newest_type="text",
        newest_id="101",
    )


@pytest.fixture(autouse=True)
def _reset_state():
    ns.set_notifications_enabled(True)
    ns._reset_notifier_for_tests()
    ns._reset_toast_executor_for_tests()
    yield
    ns.set_notifications_enabled(True)
    ns._reset_notifier_for_tests()
    ns._reset_toast_executor_for_tests()


# --------------------------------------------------------------- NullNotifier


def test_null_notifier_returns_false_without_logging() -> None:
    """The reason is logged once, when the notifier is built (not per show)."""
    n = ns.NullNotifier("not_windows")
    with capture_logs() as logs:
        assert n.show(make_plan()) is False
        assert n.show(make_plan()) is False
    assert logs == []


def test_null_notifier_show_simple_returns_false_without_logging() -> None:
    n = ns.NullNotifier("not_windows")
    with capture_logs() as logs:
        assert n.show_simple("t", "b") is False
    assert logs == []


def test_null_notifier_status() -> None:
    st = ns.NullNotifier("import_error").status()
    assert st["available"] is False
    assert st["backend"] == "none"
    assert st["aumid"] == "SakaDesk"
    assert st["last_error"] == "import_error"


def _unavailable(logs: list[dict]) -> list[dict]:
    return [e for e in logs if e["event"] == "notify_unavailable"]


def test_get_notifier_is_null_off_windows_and_a_singleton() -> None:
    with patch.object(ns, "_is_windows", lambda: False):
        with capture_logs() as logs:
            a = ns.get_notifier()
            b = ns.get_notifier()
            a.show(make_plan())
    assert isinstance(a, ns.NullNotifier)
    assert a is b
    assert a.status()["last_error"] == "not_windows"
    (event,) = _unavailable(logs)  # once per process, at construction
    assert event["reason"] == "not_windows"


def test_get_notifier_falls_back_on_import_error() -> None:
    with patch.object(ns, "_is_windows", lambda: True):
        with patch.dict(sys.modules, {"windows_toasts": None}):
            with capture_logs() as logs:
                n = ns.get_notifier()
                ns.get_notifier()
    assert isinstance(n, ns.NullNotifier)
    assert n.status()["last_error"] == "import_error"
    (event,) = _unavailable(logs)
    assert event["reason"] == "import_error"
    assert event["error_type"] == "ModuleNotFoundError"
    assert event["module"] == "windows_toasts"


def test_get_notifier_falls_back_on_init_error() -> None:
    fake = _fake_windows_toasts()

    def boom(*_a, **_k):
        raise OSError("no winrt")

    fake.InteractableWindowsToaster = boom
    with patch.object(ns, "_is_windows", lambda: True):
        with patch.dict(sys.modules, {"windows_toasts": fake}):
            with capture_logs() as logs:
                n = ns.get_notifier()
    assert isinstance(n, ns.NullNotifier)
    assert n.status()["last_error"] == "init_error"
    (event,) = _unavailable(logs)
    assert event["reason"] == "init_error"
    assert event["error_type"] == "OSError"
    assert "no winrt" not in repr(logs)


# ----------------------------------------------------------- WindowsToastNotifier


def _fake_windows_toasts() -> types.ModuleType:
    mod = types.ModuleType("windows_toasts")
    shown: list = []

    class Toaster:
        def __init__(self, text, notifierAUMID=None):
            self.text = text
            self.aumid = notifierAUMID

        def show_toast(self, toast):
            shown.append(toast)

    class Toast:
        def __init__(self, text_fields=None, **kw):
            assert "launch_action" not in kw, "launch_action makes clicks protocol"
            self.text_fields = text_fields
            self.images: list = []
            self.on_activated = None
            self.on_failed = None
            self.tag = "uuid-default"
            self.group = None
            self.launch_action_set: list = []

        @property
        def launch_action(self):
            return None

        @launch_action.setter
        def launch_action(self, value):
            # windows-toasts 1.3.1 turns any launch action into a protocol
            # activation; record it so tests can prove it is never set.
            self.launch_action_set.append(value)

        def AddImage(self, image):
            self.images.append(image)

    class ToastImage:
        def __init__(self, path):
            self.path = path

    class ToastDisplayImage:
        def __init__(self, image, position=None):
            self.image = image
            self.position = position

    class ToastImagePosition:
        AppLogo = "AppLogo"

    mod.InteractableWindowsToaster = Toaster
    mod.Toast = Toast
    mod.ToastImage = ToastImage
    mod.ToastDisplayImage = ToastDisplayImage
    mod.ToastImagePosition = ToastImagePosition
    mod.shown = shown  # type: ignore[attr-defined]
    return mod


@pytest.fixture
def fake_wt():
    mod = _fake_windows_toasts()
    with patch.dict(sys.modules, {"windows_toasts": mod}):
        yield mod


def test_windows_notifier_builds_and_shows_the_toast(fake_wt, tmp_path) -> None:
    avatar = tmp_path / "a.jpg"
    avatar.write_bytes(b"x")
    n = ns.WindowsToastNotifier()
    assert n._toaster.aumid == "SakaDesk"
    assert n._toaster.text == "SakaDesk"
    plan = make_plan(avatar=avatar)
    assert n.show(plan) is True
    (toast,) = fake_wt.shown
    assert toast.text_fields == [plan.title, plan.body]
    assert toast.launch_action_set == []
    assert toast.tag == "34:58"
    assert toast.group == "hinatazaka46"
    (img,) = toast.images
    assert img.position == "AppLogo"
    assert img.image.path == avatar
    assert n.status() == {
        "available": True,
        "backend": "windows_toasts",
        "last_error": None,
        "aumid": "SakaDesk",
    }


def test_windows_notifier_without_avatar_adds_no_image(fake_wt) -> None:
    n = ns.WindowsToastNotifier()
    n.show(make_plan(avatar=None))
    assert fake_wt.shown[0].images == []


def test_windows_notifier_bad_avatar_still_shows_toast(fake_wt, tmp_path) -> None:
    def bad_image(_p):
        raise ValueError("cannot read 金村.jpg")

    fake_wt.ToastImage = bad_image
    n = ns.WindowsToastNotifier()
    with capture_logs() as logs:
        assert n.show(make_plan(avatar=tmp_path / "gone.jpg")) is True
    assert fake_wt.shown[0].images == []
    failed = [e for e in logs if e["event"] == "notify_failed"]
    assert failed[0]["stage"] == "avatar"
    assert failed[0]["error_type"] == "ValueError"
    assert "金村" not in repr(logs) and "gone" not in repr(logs)


def test_windows_notifier_show_failure_sets_last_error(fake_wt) -> None:
    n = ns.WindowsToastNotifier()

    def boom(_t):
        raise RuntimeError("winrt 0x80070005 金村")

    n._toaster.show_toast = boom
    with pytest.raises(RuntimeError):
        n.show(make_plan())
    assert n.status()["last_error"] == "RuntimeError"


def test_windows_notifier_show_simple_builds_a_hint_toast(fake_wt) -> None:
    n = ns.WindowsToastNotifier()
    assert n.show_simple("タイトル 🎉", "本文") is True
    (toast,) = fake_wt.shown
    assert toast.text_fields == ["タイトル 🎉", "本文"]
    assert toast.tag == "app:hint"
    assert toast.group == "app"
    assert toast.images == []
    assert toast.launch_action_set == []
    assert n.status()["last_error"] is None


def test_windows_notifier_show_simple_failure_sets_last_error(fake_wt) -> None:
    n = ns.WindowsToastNotifier()
    n._toaster.show_toast = lambda _t: (_ for _ in ()).throw(RuntimeError("x"))
    with pytest.raises(RuntimeError):
        n.show_simple("t", "b")
    assert n.status()["last_error"] == "RuntimeError"


def test_simple_toast_click_opens_the_window(fake_wt) -> None:
    n = ns.WindowsToastNotifier()
    n.show_simple("t", "b")
    calls: list[int] = []
    with patch.object(ns.desktop_bridge, "open_window", lambda: calls.append(1)):
        fake_wt.shown[0].on_activated(types.SimpleNamespace(arguments="x"))
    assert calls == [1]


def test_simple_toast_click_without_handler_is_a_noop(fake_wt) -> None:
    n = ns.WindowsToastNotifier()
    n.show_simple("t", "b")
    ns.desktop_bridge.set_open_window_handler(None)
    with capture_logs() as logs:
        fake_wt.shown[0].on_activated(types.SimpleNamespace(arguments="x"))
    assert [e["event"] for e in logs] == ["notify_clicked", "window_open_unhandled"]


def test_simple_toast_click_never_raises(fake_wt) -> None:
    n = ns.WindowsToastNotifier()
    n.show_simple("t", "b")

    def boom() -> None:
        raise ValueError("x")

    with patch.object(ns.desktop_bridge, "open_window", boom):
        fake_wt.shown[0].on_activated(types.SimpleNamespace(arguments="x"))


def test_simple_toast_failure_callback_logs_kind_simple(fake_wt) -> None:
    n = ns.WindowsToastNotifier()
    n.show_simple("t", "b")
    with capture_logs() as logs:
        fake_wt.shown[0].on_failed(types.SimpleNamespace(error_code=7))
    (e,) = logs
    assert e["event"] == "notify_failed"
    assert e["kind"] == "simple"
    assert e["error_code"] == 7
    assert n.status()["last_error"] == "ToastFailed"


class _Opened(list):
    """Records ``desktop_bridge.open_chat(target, message_id)`` calls."""

    def __call__(self, target: ChatTarget, message_id: int | None = None) -> None:
        self.append((target, message_id))


def test_on_activated_opens_the_planned_chat_and_logs_ids(fake_wt) -> None:
    n = ns.WindowsToastNotifier()
    n.show(make_plan())
    toast = fake_wt.shown[0]
    opened = _Opened()
    with patch.object(ns.desktop_bridge, "open_chat", opened):
        with capture_logs() as logs:
            # The WinRT event args are ignored: the target comes from the plan.
            toast.on_activated(types.SimpleNamespace(arguments="uuid-default"))
    # The chat opens at the message the toast previews (newest_id "101").
    assert opened == [(CJK_TARGET, 101)]
    (clicked,) = [e for e in logs if e["event"] == "notify_clicked"]
    assert clicked["service"] == "hinatazaka46"
    assert clicked["group_id"] == "34"
    assert clicked["member_id"] == "58"
    assert clicked["has_target"] is True
    assert "target_reason" not in clicked
    assert "金村" not in repr(logs)


@pytest.mark.parametrize(
    ("newest_id", "reason"),
    [
        ("", "no_id"),
        ("0", "bad_id"),
        ("-5", "bad_id"),
        ("12a", "bad_id"),
        ("１２", "bad_id"),  # full-width digits are not an ASCII id
        ("²", "bad_id"),
    ],
)
def test_click_without_a_usable_id_still_opens_the_chat(
    fake_wt, newest_id: str, reason: str
) -> None:
    n = ns.WindowsToastNotifier()
    plan = ToastPlan(CJK_TARGET, "34", "58", "t", "b", None, 1, "text", newest_id)
    n.show(plan)
    opened = _Opened()
    with patch.object(ns.desktop_bridge, "open_chat", opened):
        with capture_logs() as logs:
            fake_wt.shown[0].on_activated(None)
    assert opened == [(CJK_TARGET, None)]
    (clicked,) = [e for e in logs if e["event"] == "notify_clicked"]
    assert clicked["has_target"] is False
    assert clicked["target_reason"] == reason


def test_each_toast_opens_its_own_chat(fake_wt) -> None:
    n = ns.WindowsToastNotifier()
    room = ToastPlan(ROOM_TARGET, "79", "0", "t", "b", None, 2, "text", "9")
    n.show(make_plan())
    n.show(room)
    first, second = fake_wt.shown
    assert second.tag == "79:0"
    opened = _Opened()
    with patch.object(ns.desktop_bridge, "open_chat", opened):
        with capture_logs() as logs:
            second.on_activated(None)
            first.on_activated(None)
    assert opened == [(ROOM_TARGET, 9), (CJK_TARGET, 101)]
    clicked = [e for e in logs if e["event"] == "notify_clicked"]
    assert [(e["group_id"], e["member_id"]) for e in clicked] == [
        ("79", "0"),
        ("34", "58"),
    ]


def test_tag_is_short_and_id_only(fake_wt) -> None:
    n = ns.WindowsToastNotifier()
    plan = ToastPlan(CJK_TARGET, "1" * 12, "2" * 12, "t", "b", None, 1, "text", "1")
    n.show(plan)
    tag = fake_wt.shown[0].tag
    assert tag == f"{'1' * 12}:{'2' * 12}" and len(tag) <= 64


def test_test_toast_click_is_unhandled_and_keeps_default_tag(fake_wt) -> None:
    fake = FakeNotifier()
    with patch.object(ns, "get_notifier", lambda: fake):
        asyncio.run(ns.send_test("en"))
    (plan,) = fake.shown
    n = ns.WindowsToastNotifier()
    n.show(plan)
    toast = fake_wt.shown[0]
    assert toast.tag == "uuid-default" and toast.group is None
    opened = _Opened()
    with patch.object(ns.desktop_bridge, "open_chat", opened):
        with capture_logs() as logs:
            toast.on_activated(None)
    assert opened == []
    (unhandled,) = [e for e in logs if e["event"] == "notify_click_unhandled"]
    assert unhandled["reason"] == "no_target"


def test_on_activated_never_raises(fake_wt) -> None:
    n = ns.WindowsToastNotifier()
    n.show(make_plan())
    toast = fake_wt.shown[0]

    def boom(_t, _m=None):
        raise RuntimeError("x 金村")

    with patch.object(ns.desktop_bridge, "open_chat", boom):
        with capture_logs() as logs:
            toast.on_activated(None)
    (failed,) = [e for e in logs if e["event"] == "notify_open_chat_failed"]
    assert failed["error_type"] == "RuntimeError"
    assert "金村" not in repr(logs)


def test_on_failed_logs_error_type_and_records_last_error(fake_wt) -> None:
    n = ns.WindowsToastNotifier()
    n.show(make_plan())
    toast = fake_wt.shown[0]
    with capture_logs() as logs:
        toast.on_failed(types.SimpleNamespace(error_code=-2147024891))
    (failed,) = [e for e in logs if e["event"] == "notify_failed"]
    assert failed["error_type"] == "ToastFailed"
    assert failed["error_code"] == -2147024891
    assert failed["group_id"] == "34" and failed["member_id"] == "58"
    assert n.status()["last_error"] == "ToastFailed"


def test_get_notifier_builds_windows_notifier_on_win32(fake_wt) -> None:
    with patch.object(ns, "_is_windows", lambda: True):
        n = ns.get_notifier()
    assert isinstance(n, ns.WindowsToastNotifier)


# ----------------------------------------------------------------- send_planned


class FakeNotifier:
    def __init__(self, results=None, exc=None, simple_result=True, simple_exc=None):
        self.shown: list[ToastPlan] = []
        self.simple: list[tuple[str, str]] = []
        self.login: list[tuple[str, str, str]] = []
        self._simple_result = simple_result
        self._simple_exc = simple_exc
        self._results = results
        self._exc = exc

    def show(self, plan):
        self.shown.append(plan)
        if self._exc is not None and plan.group_id in self._exc:
            raise self._exc[plan.group_id]
        if self._results is not None:
            return self._results[len(self.shown) - 1]
        return True

    def show_simple(self, title, body):
        self.simple.append((title, body))
        if self._simple_exc is not None:
            raise self._simple_exc
        return self._simple_result

    def show_login(self, service, title, body):
        self.login.append((service, title, body))
        return True

    def status(self):
        return {}


def _plan(group_id: str, member_id: str = "58", count: int = 1) -> ToastPlan:
    return ToastPlan(
        ChatTarget("hinatazaka46", f"x/messages/{group_id} n", "n", False),
        group_id,
        member_id,
        "title 金村",
        "body 秘密",
        None,
        count,
        "picture",
        "1",
    )


def test_send_planned_logs_sent_per_plan_and_returns_count() -> None:
    fake = FakeNotifier()
    plans = [_plan("34", count=3), _plan("79", "0")]
    with patch.object(ns, "get_notifier", lambda: fake):
        with capture_logs() as logs:
            sent = asyncio.run(ns.send_planned(plans))
    assert sent == 2
    events = [e for e in logs if e["event"] == "notify_sent"]
    assert [(e["group_id"], e["member_id"], e["count"]) for e in events] == [
        ("34", "58", 3),
        ("79", "0", 1),
    ]
    assert events[0]["service"] == "hinatazaka46"
    assert events[0]["newest_type"] == "picture"
    assert "金村" not in repr(logs) and "秘密" not in repr(logs)


def test_send_planned_failing_show_logs_notify_failed_without_raising() -> None:
    fake = FakeNotifier(exc={"34": RuntimeError("boom 金村")})
    with patch.object(ns, "get_notifier", lambda: fake):
        with capture_logs() as logs:
            sent = asyncio.run(ns.send_planned([_plan("34"), _plan("79")]))
    assert sent == 1
    failed = [e for e in logs if e["event"] == "notify_failed"]
    assert len(failed) == 1
    assert failed[0]["error_type"] == "RuntimeError"
    assert failed[0]["group_id"] == "34"
    assert len(fake.shown) == 2  # one failure does not stop the rest
    assert "金村" not in repr(logs)


def test_send_planned_show_false_logs_not_shown() -> None:
    fake = FakeNotifier(results=[False])
    with patch.object(ns, "get_notifier", lambda: fake):
        with capture_logs() as logs:
            sent = asyncio.run(ns.send_planned([_plan("34")]))
    assert sent == 0
    (failed,) = [e for e in logs if e["event"] == "notify_failed"]
    assert failed["reason"] == "not_shown"


def test_send_planned_disabled_is_a_second_guard() -> None:
    fake = FakeNotifier()
    ns.set_notifications_enabled(False)
    with patch.object(ns, "get_notifier", lambda: fake):
        with capture_logs() as logs:
            sent = asyncio.run(ns.send_planned([_plan("34"), _plan("79")]))
    assert sent == 0
    assert fake.shown == []
    (skip,) = [e for e in logs if e["event"] == "notify_skip"]
    assert skip["reason"] == "disabled" and skip["count"] == 2


def test_send_planned_unavailable_notifier_logs_one_skip() -> None:
    null = ns.NullNotifier("not_windows")
    with patch.object(ns, "get_notifier", lambda: null):
        with capture_logs() as logs:
            sent = asyncio.run(ns.send_planned([_plan("34"), _plan("79")]))
    assert sent == 0
    assert not [e for e in logs if e["event"] == "notify_failed"]
    (skip,) = [e for e in logs if e["event"] == "notify_skip"]
    assert skip["reason"] == "unavailable" and skip["count"] == 2
    assert skip["backend_reason"] == "not_windows"


def test_stuck_show_times_out_then_later_shows_are_skipped_as_busy() -> None:
    release = threading.Event()

    class Stuck(FakeNotifier):
        def show(self, plan):
            self.shown.append(plan)
            if plan.group_id == "34":
                release.wait(5)  # a hung WinRT call
            return True

    fake = Stuck()
    try:
        with patch.object(ns, "_SHOW_TIMEOUT_S", 0.05):
            with patch.object(ns, "get_notifier", lambda: fake):
                with capture_logs() as logs:
                    sent = asyncio.run(
                        ns.send_planned([_plan("34"), _plan("79", count=3)])
                    )
    finally:
        release.set()
    assert sent == 0
    (failed,) = [e for e in logs if e["event"] == "notify_failed"]
    assert failed["error_type"] == "TimeoutError"
    assert failed["group_id"] == "34"
    (busy,) = [e for e in logs if e["event"] == "notify_skip"]
    assert busy["reason"] == "busy"
    assert busy["group_id"] == "79" and busy["member_id"] == "58"
    assert busy["count"] == 3
    assert [p.group_id for p in fake.shown] == ["34"]  # 79 never reached show
    assert not [e for e in logs if e["event"] == "notify_sent"]


def test_shows_work_again_after_the_stuck_show_finishes() -> None:
    release = threading.Event()
    started = threading.Event()

    class Stuck(FakeNotifier):
        def show(self, plan):
            self.shown.append(plan)
            if plan.group_id == "34":
                started.set()
                release.wait(5)
            return True

    fake = Stuck()

    async def run():
        with patch.object(ns, "_SHOW_TIMEOUT_S", 0.05):
            with patch.object(ns, "get_notifier", lambda: fake):
                first = await ns.send_planned([_plan("34")])
                assert started.is_set()
                busy = await ns.send_planned([_plan("79")])
                release.set()
                # the stuck flag is cleared by the worker's done-callback
                for _ in range(100):
                    if not ns._show_stuck:
                        break
                    await asyncio.sleep(0.01)
                after = await ns.send_planned([_plan("80")])
        return first, busy, after

    try:
        with capture_logs() as logs:
            first, busy, after = asyncio.run(run())
    finally:
        release.set()
    assert (first, busy, after) == (0, 0, 1)
    assert [p.group_id for p in fake.shown] == ["34", "80"]
    assert [e["group_id"] for e in logs if e["event"] == "notify_sent"] == ["80"]
    assert [e["reason"] for e in logs if e["event"] == "notify_skip"] == ["busy"]


def test_concurrent_shows_all_display_in_turn() -> None:
    """Shows that start while another is running queue; none is dropped.

    Per-service scheduler ticks fire in lockstep and the tray hint / popup
    fallback can land at the same moment, so every concurrent show must
    display, one after another on the toast thread.
    """
    release = threading.Event()
    started = threading.Event()
    order: list[str] = []

    class Slow(FakeNotifier):
        def show(self, plan):
            order.append(plan.group_id)
            if plan.group_id == "34":
                started.set()
                release.wait(5)  # slow, but well inside the timeout
            return True

        def show_simple(self, title, body):
            order.append("simple")
            return True

    fake = Slow()

    async def run():
        with patch.object(ns, "get_notifier", lambda: fake):
            first = asyncio.create_task(ns.send_planned([_plan("34")]))
            while not started.is_set():
                await asyncio.sleep(0.005)
            others = asyncio.gather(
                ns.send_planned([_plan("79")]),
                ns.send_simple("t", "b"),
                ns.send_planned([_plan("80")]),
            )
            await asyncio.sleep(0.05)  # the others are now waiting their turn
            release.set()
            return await first, await others

    try:
        with capture_logs() as logs:
            first, others = asyncio.run(run())
    finally:
        release.set()
    assert first == 1
    assert list(others) == [1, True, 1]
    # The running show finishes first; the queued ones each resolve the notifier
    # on a worker thread, so their relative order is not guaranteed.
    assert order[0] == "34"
    assert sorted(order[1:]) == ["79", "80", "simple"]
    assert not [e for e in logs if e["event"] == "notify_skip"]
    assert len([e for e in logs if e["event"] == "notify_sent"]) == 4


def test_show_queued_behind_a_stuck_show_is_skipped_as_busy() -> None:
    """Skip only once a show is known stuck (it exceeded its timeout)."""
    release = threading.Event()

    class Stuck(FakeNotifier):
        def show(self, plan):
            self.shown.append(plan)
            if plan.group_id == "34":
                release.wait(5)
            return True

    fake = Stuck()

    async def run():
        with patch.object(ns, "_SHOW_TIMEOUT_S", 0.05):
            with patch.object(ns, "get_notifier", lambda: fake):
                return await asyncio.gather(
                    ns.send_planned([_plan("34")]),
                    ns.send_planned([_plan("79", count=2)]),
                )

    try:
        with capture_logs() as logs:
            results = asyncio.run(run())
    finally:
        release.set()
    assert results == [0, 0]
    assert [p.group_id for p in fake.shown] == ["34"]
    (failed,) = [e for e in logs if e["event"] == "notify_failed"]
    assert failed["error_type"] == "TimeoutError" and failed["group_id"] == "34"
    (busy,) = [e for e in logs if e["event"] == "notify_skip"]
    assert busy["reason"] == "busy" and busy["group_id"] == "79"
    assert busy["count"] == 2


def test_raising_show_frees_the_slot_for_the_next_one() -> None:
    fake = FakeNotifier(exc={"34": RuntimeError("boom")})
    with patch.object(ns, "get_notifier", lambda: fake):
        with capture_logs() as logs:
            sent = asyncio.run(ns.send_planned([_plan("34"), _plan("79")]))
    assert sent == 1
    assert not [e for e in logs if e["event"] == "notify_skip"]


def test_shows_run_on_the_dedicated_toast_thread() -> None:
    names: list[str] = []

    class Spy(FakeNotifier):
        def show(self, plan):
            names.append(threading.current_thread().name)
            return True

    with patch.object(ns, "get_notifier", lambda: Spy()):
        asyncio.run(ns.send_planned([_plan("34"), _plan("79")]))
    assert len(names) == 2 and all(n.startswith("toast") for n in names)
    assert ns._get_toast_executor() is ns._get_toast_executor()


def test_executor_failure_is_logged_and_frees_the_slot() -> None:
    ns._get_toast_executor().shutdown(wait=False)  # submit() now raises
    with patch.object(ns, "get_notifier", lambda: FakeNotifier()):
        with capture_logs() as logs:
            sent = asyncio.run(ns.send_planned([_plan("34")]))
    assert sent == 0
    (failed,) = [e for e in logs if e["event"] == "notify_failed"]
    assert failed["error_type"] == "RuntimeError"
    assert not ns._show_stuck


# ------------------------------------------------------------------ send_simple


def test_send_simple_logs_sent_kind_simple_without_text() -> None:
    fake = FakeNotifier()
    with patch.object(ns, "get_notifier", lambda: fake):
        with capture_logs() as logs:
            assert asyncio.run(ns.send_simple("標題 金村", "内容 秘密")) is True
    assert fake.simple == [("標題 金村", "内容 秘密")]
    (sent,) = [e for e in logs if e["event"] == "notify_sent"]
    assert sent["kind"] == "simple"
    assert "金村" not in repr(logs) and "秘密" not in repr(logs)


def test_send_simple_runs_on_the_toast_thread() -> None:
    names: list[str] = []

    class Spy(FakeNotifier):
        def show_simple(self, title, body):
            names.append(threading.current_thread().name)
            return True

    with patch.object(ns, "get_notifier", lambda: Spy()):
        assert asyncio.run(ns.send_simple("t", "b")) is True
    assert names and names[0].startswith("toast")


def test_send_simple_exception_is_logged_not_raised() -> None:
    fake = FakeNotifier(simple_exc=RuntimeError("boom 金村"))
    with patch.object(ns, "get_notifier", lambda: fake):
        with capture_logs() as logs:
            assert asyncio.run(ns.send_simple("t", "b")) is False
    (failed,) = [e for e in logs if e["event"] == "notify_failed"]
    assert failed["kind"] == "simple"
    assert failed["error_type"] == "RuntimeError"
    assert "金村" not in repr(logs)
    assert not ns._show_stuck


def test_send_simple_false_result_logs_not_shown() -> None:
    fake = FakeNotifier(simple_result=False)
    with patch.object(ns, "get_notifier", lambda: fake):
        with capture_logs() as logs:
            assert asyncio.run(ns.send_simple("t", "b")) is False
    (failed,) = [e for e in logs if e["event"] == "notify_failed"]
    assert failed["kind"] == "simple" and failed["reason"] == "not_shown"


def test_send_simple_unavailable_notifier_is_skipped() -> None:
    class Down(FakeNotifier):
        def status(self):
            return {"available": False, "last_error": "not_windows"}

    fake = Down()
    with patch.object(ns, "get_notifier", lambda: fake):
        with capture_logs() as logs:
            assert asyncio.run(ns.send_simple("t", "b")) is False
    assert fake.simple == []
    (skip,) = [e for e in logs if e["event"] == "notify_skip"]
    assert skip["reason"] == "unavailable" and skip["kind"] == "simple"


def test_send_simple_times_out_then_is_busy_like_plans() -> None:
    release = threading.Event()

    class Stuck(FakeNotifier):
        def show_simple(self, title, body):
            release.wait(5)
            return True

    fake = Stuck()

    async def run():
        with patch.object(ns, "_SHOW_TIMEOUT_S", 0.05):
            with patch.object(ns, "get_notifier", lambda: fake):
                first = await ns.send_simple("t", "b")
                # shares the guard with plans: a plan is skipped as busy too
                plan_sent = await ns.send_planned([_plan("34")])
                second = await ns.send_simple("t", "b")
        return first, plan_sent, second

    try:
        with capture_logs() as logs:
            first, plan_sent, second = asyncio.run(run())
    finally:
        release.set()
    assert (first, plan_sent, second) == (False, 0, False)
    failed = [e for e in logs if e["event"] == "notify_failed"]
    assert failed[0]["error_type"] == "TimeoutError"
    assert failed[0]["kind"] == "simple"
    skips = [e for e in logs if e["event"] == "notify_skip"]
    assert [e["reason"] for e in skips] == ["busy", "busy"]
    assert skips[1]["kind"] == "simple"


def test_show_timeout_is_ten_seconds() -> None:
    assert ns._SHOW_TIMEOUT_S == 10


def test_notifier_is_resolved_off_the_event_loop() -> None:
    import threading

    threads: list[int] = []

    def resolve():
        threads.append(threading.get_ident())
        return FakeNotifier()

    async def run():
        main = threading.get_ident()
        with patch.object(ns, "get_notifier", resolve):
            await ns.send_planned([_plan("34")])
            await ns.send_test("en")
        return main

    main = asyncio.run(run())
    assert len(threads) == 2 and all(t != main for t in threads)


def test_send_planned_runs_show_off_the_event_loop() -> None:
    import threading

    threads: list[int] = []

    class Spy(FakeNotifier):
        def show(self, plan):
            threads.append(threading.get_ident())
            return True

    async def run():
        main = threading.get_ident()
        with patch.object(ns, "get_notifier", lambda: Spy()):
            await ns.send_planned([_plan("34")])
        return main

    main = asyncio.run(run())
    assert threads and threads[0] != main


def test_send_planned_empty_is_a_noop() -> None:
    with capture_logs() as logs:
        assert asyncio.run(ns.send_planned([])) == 0
    assert logs == []


# --------------------------------------------------------------------- send_test


@pytest.mark.parametrize(
    ("lang", "body"),
    [
        ("en", "Notifications are working"),
        ("ja", "通知は正常に動作しています"),
        (None, "Notifications are working"),
    ],
)
def test_send_test_uses_i18n_strings(lang, body) -> None:
    fake = FakeNotifier()
    with patch.object(ns, "get_notifier", lambda: fake):
        ok = asyncio.run(ns.send_test(lang))
    assert ok is True
    (plan,) = fake.shown
    assert plan.title == "SakaDesk"
    assert plan.body == body


def test_send_test_reports_failure_without_raising() -> None:
    fake = FakeNotifier(exc={"": RuntimeError("x")})
    with patch.object(ns, "get_notifier", lambda: fake):
        with capture_logs() as logs:
            assert asyncio.run(ns.send_test("en")) is False
    assert any(e["event"] == "notify_failed" for e in logs)


def test_send_test_ignores_the_enabled_flag() -> None:
    fake = FakeNotifier()
    ns.set_notifications_enabled(False)
    with patch.object(ns, "get_notifier", lambda: fake):
        assert asyncio.run(ns.send_test("en")) is True


# ----------------------------------------------------------------------- status


def test_status_shape() -> None:
    with patch.object(ns, "get_notifier", lambda: ns.NullNotifier("not_windows")):
        st = ns.get_notification_status()
    assert set(st) == {"enabled", "available", "backend", "last_error", "aumid"}
    assert st["enabled"] is True
    assert st["available"] is False
    assert st["aumid"] == "SakaDesk"


def test_enabled_flag_round_trip() -> None:
    ns.set_notifications_enabled(False)
    assert ns.get_notifications_enabled() is False
    ns.set_notifications_enabled(True)
    assert ns.get_notifications_enabled() is True


# ------------------------------------------------------------------ send_login_alert


def test_send_login_alert_calls_show_login_and_logs_kind_login() -> None:
    fake = FakeNotifier()
    with patch.object(ns, "get_notifier", lambda: fake):
        with capture_logs() as logs:
            assert (
                asyncio.run(ns.send_login_alert("yodel", "標題 金村", "内容")) is True
            )
    assert fake.login == [("yodel", "標題 金村", "内容")]
    (sent,) = [e for e in logs if e["event"] == "notify_sent"]
    assert sent["kind"] == "login"
    assert "金村" not in repr(logs)


def test_send_login_alert_unavailable_is_skipped() -> None:
    class Down(FakeNotifier):
        def status(self):
            return {"available": False, "last_error": "not_windows"}

    fake = Down()
    with patch.object(ns, "get_notifier", lambda: fake):
        with capture_logs() as logs:
            assert asyncio.run(ns.send_login_alert("yodel", "t", "b")) is False
    assert fake.login == []
    (skip,) = [e for e in logs if e["event"] == "notify_skip"]
    assert skip["kind"] == "login"


def test_null_notifier_show_login_returns_false() -> None:
    assert ns.NullNotifier("x").show_login("yodel", "t", "b") is False


def test_windows_notifier_show_login_builds_toast_and_click_opens_login(
    fake_wt,
) -> None:
    n = ns.WindowsToastNotifier()
    assert n.show_login("yodel", "タイトル", "本文") is True
    (toast,) = fake_wt.shown
    assert toast.text_fields == ["タイトル", "本文"]
    assert toast.tag == "login-yodel"
    assert toast.group == "app"
    calls: list[str] = []
    with patch.object(ns.desktop_bridge, "open_login", calls.append):
        toast.on_activated(types.SimpleNamespace(arguments="x"))
    assert calls == ["yodel"]


def test_windows_notifier_show_login_failure_sets_last_error(fake_wt) -> None:
    n = ns.WindowsToastNotifier()
    n._toaster.show_toast = lambda _t: (_ for _ in ()).throw(RuntimeError("x"))
    with pytest.raises(RuntimeError):
        n.show_login("yodel", "t", "b")
    assert n.status()["last_error"] == "RuntimeError"
