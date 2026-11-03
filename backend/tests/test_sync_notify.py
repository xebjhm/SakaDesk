"""Sync-side wiring of the notification planner and sender."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import structlog

from backend.services.new_message_collector import NewMessageCollector
from backend.services.notification_planner import UiState
from backend.services.sync_service import SyncService

SERVICE = "hinatazaka46"
DISPLAY = "日向坂46"
IDLE = UiState(service=None, group_id=None, member_id=None, focused=False)


def _member_dir(root: Path, gid: int, mid: int, name: str) -> Path:
    d = root / DISPLAY / "messages" / f"{gid} {name}" / f"{mid} {name}"
    d.mkdir(parents=True, exist_ok=True)
    (d / "messages.json").write_text("{}", encoding="utf-8")
    return d


def _collector(root: Path) -> NewMessageCollector:
    c = NewMessageCollector(SERVICE)
    for gid, mid, name in ((34, 58, "金村 美玖"), (35, 59, "小坂 菜緒")):
        c.on_new_messages(
            {
                "group_id": gid,
                "group_name": name,
                "member_id": mid,
                "member_name": name,
                "member_dir": _member_dir(root, gid, mid, name),
            },
            [
                {
                    "id": 1,
                    "timestamp": "2026-11-04T10:00:00Z",
                    "type": "text",
                    "content": "hi",
                    "state": "published",
                }
            ],
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
) -> AsyncMock:
    send = send or AsyncMock(return_value=2)
    app_settings = {
        "notifications_enabled": True,
        "notifications_hide_content": False,
        "language": "en",
        **(settings or {}),
    }
    with (
        patch("backend.services.sync_service.send_planned", send),
        patch("backend.services.sync_service.get_ui_state", return_value=ui),
    ):
        asyncio.run(svc._notify_new_messages(collector, app_settings))
    return send


def test_two_members_produce_two_plans(tmp_path: Path) -> None:
    send = _run(_service(tmp_path), _collector(tmp_path))
    send.assert_awaited_once()
    plans = send.await_args.args[0]
    assert len(plans) == 2
    assert {p.group_id for p in plans} == {"34", "35"}
    assert plans[0].target.path.startswith(f"{DISPLAY}/messages/")


def test_focused_viewed_chat_is_skipped(tmp_path: Path) -> None:
    ui = UiState(service=SERVICE, group_id="34", member_id="58", focused=True)
    send = _run(_service(tmp_path), _collector(tmp_path), ui=ui)
    plans = send.await_args.args[0]
    assert [p.group_id for p in plans] == ["35"]


def test_disabled_sends_nothing(tmp_path: Path) -> None:
    send = _run(
        _service(tmp_path),
        _collector(tmp_path),
        settings={"notifications_enabled": False},
    )
    plans = send.await_args.args[0] if send.await_args else []
    assert plans == []


def test_hide_content_uses_hidden_body(tmp_path: Path) -> None:
    send = _run(
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
    send = _run(_service(tmp_path), NewMessageCollector(SERVICE))
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
    send = _run(_service(tmp_path), c)
    plans = send.await_args.args[0]
    assert len(plans) == 1 and plans[0].target.is_group_chat
