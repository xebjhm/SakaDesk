"""Native toast notifier: launch args, Null/Windows notifiers, delivery."""

import asyncio
import sys
import types
import warnings
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse

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
    )


@pytest.fixture(autouse=True)
def _reset_state():
    ns.set_notifications_enabled(True)
    ns._reset_notifier_for_tests()
    yield
    ns.set_notifications_enabled(True)
    ns._reset_notifier_for_tests()


# ------------------------------------------------------------ launch arguments


@pytest.mark.parametrize("target", [CJK_TARGET, ROOM_TARGET])
def test_launch_args_round_trip(target: ChatTarget) -> None:
    args = ns.build_launch_args(target)
    assert args.startswith("action=open&service=hinatazaka46&")
    assert ns.parse_launch_args(args) == target


def test_launch_args_group_flag() -> None:
    assert ns.build_launch_args(CJK_TARGET).endswith("&group=0")
    assert ns.build_launch_args(ROOM_TARGET).endswith("&group=1")


@pytest.mark.parametrize(
    "garbage",
    [
        "",
        "garbage",
        "action=open",
        "action=close&service=a&path=b&name=c&group=0",
        "action=open&service=&path=b&name=c&group=0",
        "action=open&service=a&path=&name=c&group=0",
        "action=open&service=a&path=b&name=c&group=7",
        "action=open&service=a&path=b&name=c",
        "%%%\x00&&&===",
        None,
        123,
    ],
)
def test_parse_launch_args_garbage_returns_none(garbage) -> None:
    assert ns.parse_launch_args(garbage) is None


# --------------------------------------------------------------- NullNotifier


def test_null_notifier_returns_false_and_logs_once() -> None:
    n = ns.NullNotifier("not_windows")
    with capture_logs() as logs:
        assert n.show(make_plan()) is False
        assert n.show(make_plan()) is False
    events = [e for e in logs if e["event"] == "notify_unavailable"]
    assert len(events) == 1
    assert events[0]["reason"] == "not_windows"


def test_null_notifier_status() -> None:
    st = ns.NullNotifier("import_error").status()
    assert st["available"] is False
    assert st["backend"] == "none"
    assert st["aumid"] == "SakaDesk"
    assert st["last_error"] == "import_error"


def test_get_notifier_is_null_off_windows_and_a_singleton() -> None:
    with patch.object(ns, "_is_windows", lambda: False):
        a = ns.get_notifier()
        b = ns.get_notifier()
    assert isinstance(a, ns.NullNotifier)
    assert a is b
    assert a.status()["last_error"] == "not_windows"


def test_get_notifier_falls_back_on_import_error() -> None:
    with patch.object(ns, "_is_windows", lambda: True):
        with patch.dict(sys.modules, {"windows_toasts": None}):
            n = ns.get_notifier()
    assert isinstance(n, ns.NullNotifier)
    assert n.status()["last_error"] == "import_error"


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
        def __init__(self, text_fields=None, launch_action=None, **kw):
            self.text_fields = text_fields
            self.launch_action = launch_action  # goes through the setter
            self.images: list = []
            self.on_activated = None
            self.on_failed = None

        @property
        def launch_action(self):
            return self._launch_action

        @launch_action.setter
        def launch_action(self, value):
            # Like windows-toasts 1.3.1: warn (embedding the string) w/o a scheme.
            if value is not None and not urlparse(value).scheme:
                warnings.warn(
                    f"Ensure your launch action is a URL: {value}", UserWarning
                )
            self._launch_action = value

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
    assert ns.parse_launch_args(toast.launch_action) == plan.target
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


def test_windows_notifier_launch_action_does_not_warn(fake_wt) -> None:
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        # Built inside the block: the notifier installs its targeted filter
        # in front of "always", as it does once in the real process.
        n = ns.WindowsToastNotifier()
        assert n.show(make_plan()) is True
    assert [str(w.message) for w in caught] == []


def test_fake_toast_warns_without_the_filter(fake_wt) -> None:
    """Guards the guard: the fake really warns on a scheme-less launch string."""
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        fake_wt.Toast(launch_action="action=open&x=1")
    assert len(caught) == 1
    assert str(caught[0].message).startswith("Ensure your launch action")


def test_launch_warning_filter_is_narrow(fake_wt) -> None:
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        ns.WindowsToastNotifier()
        warnings.warn("something else", UserWarning)
        warnings.warn("Ensure your launch action", DeprecationWarning)
    assert sorted(str(w.message) for w in caught) == [
        "Ensure your launch action",
        "something else",
    ]


def test_windows_notifier_show_failure_sets_last_error(fake_wt) -> None:
    n = ns.WindowsToastNotifier()

    def boom(_t):
        raise RuntimeError("winrt 0x80070005 金村")

    n._toaster.show_toast = boom
    with pytest.raises(RuntimeError):
        n.show(make_plan())
    assert n.status()["last_error"] == "RuntimeError"


def test_on_activated_opens_the_chat_and_logs_ids(fake_wt) -> None:
    n = ns.WindowsToastNotifier()
    n.show(make_plan())
    toast = fake_wt.shown[0]
    opened: list[ChatTarget] = []
    with patch.object(ns.desktop_bridge, "open_chat", opened.append):
        with capture_logs() as logs:
            toast.on_activated(types.SimpleNamespace(arguments=toast.launch_action))
    assert opened == [CJK_TARGET]
    (clicked,) = [e for e in logs if e["event"] == "notify_clicked"]
    assert clicked["service"] == "hinatazaka46"
    assert clicked["group_id"] == "34"
    assert clicked["member_id"] == "58"
    assert "金村" not in repr(logs)


def test_on_activated_room_has_member_zero(fake_wt) -> None:
    n = ns.WindowsToastNotifier()
    n.show(make_plan(ROOM_TARGET))
    toast = fake_wt.shown[0]
    with patch.object(ns.desktop_bridge, "open_chat", lambda _t: None):
        with capture_logs() as logs:
            toast.on_activated(types.SimpleNamespace(arguments=toast.launch_action))
    (clicked,) = [e for e in logs if e["event"] == "notify_clicked"]
    assert clicked["group_id"] == "79"
    assert clicked["member_id"] == "0"


def test_on_activated_with_bad_arguments_is_unhandled(fake_wt) -> None:
    n = ns.WindowsToastNotifier()
    n.show(make_plan())
    toast = fake_wt.shown[0]
    opened: list = []
    with patch.object(ns.desktop_bridge, "open_chat", opened.append):
        with capture_logs() as logs:
            toast.on_activated(types.SimpleNamespace(arguments="junk"))
            toast.on_activated(types.SimpleNamespace(arguments=None))
    assert opened == []
    unhandled = [e for e in logs if e["event"] == "notify_click_unhandled"]
    assert len(unhandled) == 2
    assert unhandled[0]["reason"] == "bad_arguments"


def test_on_activated_never_raises(fake_wt) -> None:
    n = ns.WindowsToastNotifier()
    n.show(make_plan())
    toast = fake_wt.shown[0]

    def boom(_t):
        raise RuntimeError("x")

    with patch.object(ns.desktop_bridge, "open_chat", boom):
        toast.on_activated(types.SimpleNamespace(arguments=toast.launch_action))


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
    def __init__(self, results=None, exc=None):
        self.shown: list[ToastPlan] = []
        self._results = results
        self._exc = exc

    def show(self, plan):
        self.shown.append(plan)
        if self._exc is not None and plan.group_id in self._exc:
            raise self._exc[plan.group_id]
        if self._results is not None:
            return self._results[len(self.shown) - 1]
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


def test_ids_from_path_uses_the_last_messages_component() -> None:
    t = ChatTarget("s", "messages/x/messages/34 n/58 m", "n", False)
    assert ns._ids_from_path(t) == ("34", "58")
    assert ns._ids_from_path(ChatTarget("s", "no-marker/34 n", "n", False)) == ("", "")


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
