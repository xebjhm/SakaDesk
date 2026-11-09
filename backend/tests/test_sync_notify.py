"""Sync-side wiring of the notification planner and sender."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import structlog

from backend.services.call_popup import PendingCall
from backend.services.new_message_collector import NewMessageCollector
from backend.services.notification_planner import UiState
from backend.services.quiet_state import QuietState
from backend.services.sync_service import SyncService

SERVICE = "hinatazaka46"
DISPLAY = "日向坂46"
IDLE = UiState(service=None, group_id=None, member_id=None, focused=False)
NOT_QUIET = QuietState("accepts", False, 5, 0)
VOICE = {
    "id": 10,
    "timestamp": "2026-11-04T11:00:00Z",
    "type": "voice",
    "content": None,
    "state": "published",
}


class FakeController:
    busy = False

    def __init__(self, ok: bool = True):
        self.ok, self.reserved = ok, []
        self.abandon = MagicMock()

    def reserve(self, plan, candidate):
        self.reserved.append((plan, candidate))
        return PendingCall(1, plan, candidate) if self.ok else None


def _member_dir(root: Path, gid: int, mid: int, name: str) -> Path:
    d = root / DISPLAY / "messages" / f"{gid} {name}" / f"{mid} {name}"
    d.mkdir(parents=True, exist_ok=True)
    (d / "messages.json").write_text("{}", encoding="utf-8")
    return d


def _collector(root: Path, *, voice: bool = False) -> NewMessageCollector:
    c = NewMessageCollector(SERVICE)
    for gid, mid, name in ((34, 58, "金村 美玖"), (35, 59, "小坂 菜緒")):
        rows = [
            {
                "id": 1,
                "timestamp": "2026-11-04T10:00:00Z",
                "type": "text",
                "content": "hi",
                "state": "published",
            }
        ]
        if voice and mid == 58:
            rows.append(VOICE)
        c.on_new_messages(
            {
                "group_id": gid,
                "group_name": name,
                "member_id": mid,
                "member_name": name,
                "member_dir": _member_dir(root, gid, mid, name),
            },
            rows,
        )
    return c


def _service(root: Path) -> SyncService:
    svc = SyncService(SERVICE)
    svc.output_dir = root
    svc.service_data_dir = root / DISPLAY
    return svc


def _run(
    svc: SyncService,
    collector: NewMessageCollector,
    *,
    settings: dict[str, Any] | None = None,
    ui: UiState = IDLE,
    send: Any = None,
    controller: Any = None,
    available: bool = True,
    quiet: QuietState | Any = NOT_QUIET,
) -> tuple[AsyncMock, PendingCall | None]:
    send = send or AsyncMock(return_value=2)
    app_settings = {
        "notifications_enabled": True,
        "notifications_hide_content": False,
        "language": "en",
        **(settings or {}),
    }
    controller = controller if controller is not None else FakeController()
    query = quiet if isinstance(quiet, MagicMock) else MagicMock(return_value=quiet)
    with (
        patch("backend.services.sync_service.send_planned", send),
        patch("backend.services.sync_service.get_ui_state", return_value=ui),
        patch(
            "backend.services.sync_service.get_call_popup_controller",
            return_value=controller,
        ),
        patch(
            "backend.services.sync_service.desktop_bridge.call_popup_available",
            return_value=available,
        ),
        patch("backend.services.sync_service.query_quiet_state", query),
    ):
        result = asyncio.run(svc._notify_new_messages(collector, app_settings))
    return send, result


def test_two_members_produce_two_plans(tmp_path: Path) -> None:
    send, _ = _run(_service(tmp_path), _collector(tmp_path))
    send.assert_awaited_once()
    plans = send.await_args.args[0]
    assert len(plans) == 2
    assert {p.group_id for p in plans} == {"34", "35"}
    assert plans[0].target.path.startswith(f"{DISPLAY}/messages/")


def test_focused_viewed_chat_is_skipped(tmp_path: Path) -> None:
    ui = UiState(service=SERVICE, group_id="34", member_id="58", focused=True)
    send, _ = _run(_service(tmp_path), _collector(tmp_path), ui=ui)
    plans = send.await_args.args[0]
    assert [p.group_id for p in plans] == ["35"]


def test_disabled_sends_nothing(tmp_path: Path) -> None:
    with structlog.testing.capture_logs() as logs:
        send, _ = _run(
            _service(tmp_path),
            _collector(tmp_path),
            settings={"notifications_enabled": False},
        )
    send.assert_not_awaited()
    skips = [e for e in logs if e["event"] == "notify_skip"]
    assert {e["reason"] for e in skips} == {"disabled"} and len(skips) == 2


def test_toast_language_is_the_settings_choice(tmp_path: Path) -> None:
    """app_state prefs ``language`` (Settings) beats settings.json ``language``."""
    with patch("backend.services.app_state.get_prefs", return_value={"language": "ja"}):
        send, _ = _run(
            _service(tmp_path),
            _collector(tmp_path),
            settings={"notifications_hide_content": True, "language": "en"},
        )
    assert {p.body for p in send.await_args.args[0]} == {"新しいメッセージがあります"}


def test_hide_content_uses_hidden_body(tmp_path: Path) -> None:
    send, _ = _run(
        _service(tmp_path),
        _collector(tmp_path),
        settings={"notifications_hide_content": True},
    )
    assert all("hi" not in p.body for p in send.await_args.args[0])


def test_notifier_exception_does_not_fail_sync(tmp_path: Path) -> None:
    send = AsyncMock(side_effect=RuntimeError("boom"))
    with structlog.testing.capture_logs() as logs:
        _run(_service(tmp_path), _collector(tmp_path), send=send)
    failed = [e for e in logs if e["event"] == "notify_failed"]
    assert failed and failed[0]["error_type"] == "RuntimeError"
    assert "boom" not in str(failed)


def test_summary_and_skip_logged(tmp_path: Path) -> None:
    ui = UiState(service=SERVICE, group_id="34", member_id="58", focused=True)
    with structlog.testing.capture_logs() as logs:
        _run(_service(tmp_path), _collector(tmp_path), ui=ui)
    skips = [e for e in logs if e["event"] == "notify_skip"]
    assert [(s["reason"], s["group_id"], s["member_id"]) for s in skips] == [
        ("viewing", "34", "58")
    ]
    summary = [e for e in logs if e["event"] == "notify_summary"]
    assert len(summary) == 1
    assert (summary[0]["planned"], summary[0]["sent"], summary[0]["skipped"]) == (
        1,
        2,
        1,
    )


def test_no_new_messages_does_nothing(tmp_path: Path) -> None:
    send, _ = _run(_service(tmp_path), NewMessageCollector(SERVICE))
    send.assert_not_awaited()


def test_member_count_counts_member_folders(tmp_path: Path) -> None:
    """A group folder with two member folders is a room (one toast)."""
    c = NewMessageCollector(SERVICE)
    for mid, name in ((58, "A"), (59, "B")):
        c.on_new_messages(
            {
                "group_id": 79,
                "group_name": "room",
                "member_id": mid,
                "member_name": name,
                "member_dir": _member_dir(tmp_path, 79, mid, name),
            },
            [
                {
                    "id": mid,
                    "timestamp": "2026-11-04T10:00:00Z",
                    "type": "text",
                    "content": "x",
                    "state": "published",
                }
            ],
        )
    send, _ = _run(_service(tmp_path), c)
    plans = send.await_args.args[0]
    assert len(plans) == 1 and plans[0].target.is_group_chat


def _events(logs: list[dict[str, Any]], name: str) -> list[dict[str, Any]]:
    return [e for e in logs if e["event"] == name]


def test_voice_chat_is_diverted_to_the_popup(tmp_path: Path) -> None:
    ctl = FakeController()
    with structlog.testing.capture_logs() as logs:
        send, result = _run(
            _service(tmp_path), _collector(tmp_path, voice=True), controller=ctl
        )
    assert [p.group_id for p in send.await_args.args[0]] == ["35"]
    assert result is not None and result.candidate.message_id == "10"
    assert len(ctl.reserved) == 1
    skips = _events(logs, "notify_skip")
    assert [(s["reason"], s["group_id"]) for s in skips] == [("diverted", "34")]


def test_popup_disabled_setting_sends_both_toasts(tmp_path: Path) -> None:
    ctl = FakeController()
    with structlog.testing.capture_logs() as logs:
        send, result = _run(
            _service(tmp_path),
            _collector(tmp_path, voice=True),
            controller=ctl,
            settings={"call_popup_enabled": False},
        )
    assert len(send.await_args.args[0]) == 2 and result is None
    assert ctl.reserved == []
    assert [e["reason"] for e in _events(logs, "call_popup_skip")] == ["popup_disabled"]


def test_host_unavailable_is_logged(tmp_path: Path) -> None:
    with structlog.testing.capture_logs() as logs:
        send, result = _run(
            _service(tmp_path), _collector(tmp_path, voice=True), available=False
        )
    assert len(send.await_args.args[0]) == 2 and result is None
    assert [e["reason"] for e in _events(logs, "call_popup_skip")] == ["unavailable"]


def test_foreground_elsewhere_is_logged(tmp_path: Path) -> None:
    ui = UiState(service=SERVICE, group_id="35", member_id="59", focused=True)
    with structlog.testing.capture_logs() as logs:
        _, result = _run(_service(tmp_path), _collector(tmp_path, voice=True), ui=ui)
    assert result is None
    assert [e["reason"] for e in _events(logs, "call_popup_skip")] == ["foreground"]


def test_busy_controller_is_logged(tmp_path: Path) -> None:
    ctl = FakeController()
    ctl.busy = True
    with structlog.testing.capture_logs() as logs:
        send, result = _run(
            _service(tmp_path), _collector(tmp_path, voice=True), controller=ctl
        )
    assert result is None and len(send.await_args.args[0]) == 2
    assert [e["reason"] for e in _events(logs, "call_popup_skip")] == ["busy"]


def test_quiet_state_blocks_the_popup(tmp_path: Path) -> None:
    with structlog.testing.capture_logs() as logs:
        _, result = _run(
            _service(tmp_path),
            _collector(tmp_path, voice=True),
            quiet=QuietState("fullscreen", True, 2, -1),
        )
    assert result is None
    skip = _events(logs, "call_popup_skip")[0]
    assert skip["reason"] == "quiet" and skip["quiet_state"] == "fullscreen"


def test_quiet_not_queried_when_an_earlier_gate_fails(tmp_path: Path) -> None:
    query = MagicMock()
    _run(
        _service(tmp_path),
        _collector(tmp_path, voice=True),
        available=False,
        quiet=query,
    )
    query.assert_not_called()


def test_notifications_off_still_reserves_the_popup(tmp_path: Path) -> None:
    ctl = FakeController()
    with structlog.testing.capture_logs() as logs:
        send, result = _run(
            _service(tmp_path),
            _collector(tmp_path, voice=True),
            controller=ctl,
            settings={"notifications_enabled": False},
        )
    send.assert_not_awaited()
    assert result is not None and len(ctl.reserved) == 1
    skips = {(s["group_id"], s["reason"]) for s in _events(logs, "notify_skip")}
    assert skips == {("34", "diverted"), ("35", "disabled")}


def test_send_failure_after_reserving_still_returns_the_call(tmp_path: Path) -> None:
    send = AsyncMock(side_effect=RuntimeError("boom"))
    with structlog.testing.capture_logs() as logs:
        _, result = _run(
            _service(tmp_path), _collector(tmp_path, voice=True), send=send
        )
    assert _events(logs, "notify_failed")
    assert result is not None and result.candidate.message_id == "10"


def test_no_voice_means_no_candidate(tmp_path: Path) -> None:
    with structlog.testing.capture_logs() as logs:
        _, result = _run(_service(tmp_path), _collector(tmp_path))
    assert result is None
    assert [e["reason"] for e in _events(logs, "call_popup_skip")] == ["no_candidate"]


def test_cancel_during_toast_send_abandons_the_reservation(tmp_path: Path) -> None:
    ctl = FakeController()
    send = AsyncMock(side_effect=asyncio.CancelledError)
    with pytest.raises(asyncio.CancelledError):
        _run(
            _service(tmp_path),
            _collector(tmp_path, voice=True),
            send=send,
            controller=ctl,
        )
    assert len(ctl.reserved) == 1
    ctl.abandon.assert_called_once_with(1, reason="cancelled")


def test_cancel_without_a_reservation_just_propagates(tmp_path: Path) -> None:
    ctl = FakeController()
    send = AsyncMock(side_effect=asyncio.CancelledError)
    with pytest.raises(asyncio.CancelledError):
        _run(_service(tmp_path), _collector(tmp_path), send=send, controller=ctl)
    ctl.abandon.assert_not_called()


def test_abandon_failure_on_cancel_does_not_mask_the_cancel(tmp_path: Path) -> None:
    ctl = FakeController()
    ctl.abandon.side_effect = RuntimeError("loop closed")
    send = AsyncMock(side_effect=asyncio.CancelledError)
    with structlog.testing.capture_logs() as logs:
        with pytest.raises(asyncio.CancelledError):
            _run(
                _service(tmp_path),
                _collector(tmp_path, voice=True),
                send=send,
                controller=ctl,
            )
    failed = _events(logs, "call_popup_abandon_failed")
    assert [e["error_type"] for e in failed] == ["RuntimeError"]


def test_toast_body_uses_the_services_cached_nickname(tmp_path: Path) -> None:
    """0.4.1: the sync wiring passes user_nicknames[service] to the planner."""
    c = NewMessageCollector(SERVICE)
    c.on_new_messages(
        {
            "group_id": 34,
            "group_name": "金村 美玖",
            "member_id": 58,
            "member_name": "金村 美玖",
            "member_dir": _member_dir(tmp_path, 34, 58, "金村 美玖"),
        },
        [
            {
                "id": 1,
                "timestamp": "2026-11-04T10:00:00Z",
                "type": "text",
                "content": "％％％、おやすみ🌙",
                "state": "published",
            }
        ],
    )
    send, _ = _run(
        _service(tmp_path),
        c,
        settings={"user_nicknames": {SERVICE: "ひな", "sakurazaka46": "さく"}},
    )
    (plan,) = send.await_args.args[0]
    assert plan.body == "ひな、おやすみ🌙"
