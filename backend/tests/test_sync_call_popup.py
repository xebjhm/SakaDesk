"""Full-run sync wiring of the call popup: voice first, dispatch or abandon."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import structlog
from pysaka import SessionExpiredError

from backend.services.call_popup import PendingCall
from backend.services.quiet_state import QuietState
from backend.services.sync_service import SyncService
from backend.tests.test_sync_service_core import _mock_sync_manager, _run_start_sync

GROUPS = [
    {
        "id": 100,
        "name": "G",
        "state": "open",
        "subscription": {"state": "active"},
    }
]
MEMBERS = {100: [{"id": 101, "name": "M"}]}


class FakeController:
    busy = False

    def __init__(self) -> None:
        self.reserve = MagicMock(
            side_effect=lambda plan, cand: PendingCall(7, plan, cand)
        )
        self.dispatch = AsyncMock()
        self.abandon = MagicMock()


def _item(md: Path, mid: int, kind: str) -> dict[str, Any]:
    return {
        "message_id": mid,
        "member_dir": md,
        "media_type": kind,
        "url": f"u{mid}",
        "path": md / kind / f"{mid}.bin",
        "timestamp": "2026-11-04T11:00:00Z",
    }


def _manager(
    md: Path, *, items: list[tuple[int, str]], process: Any = None
) -> tuple[MagicMock, list[list[int]]]:
    seen: list[list[int]] = []

    async def sync_member(_s, group, member, queue, **kw):
        for mid, kind in items:
            queue.append(_item(md, mid, kind))
        kw["on_new_messages"](
            {
                "group_id": group["id"],
                "group_name": "G",
                "member_id": member["id"],
                "member_name": "M",
                "member_dir": md,
            },
            [
                {
                    "id": 10,
                    "timestamp": "2026-11-04T11:00:00Z",
                    "type": "voice",
                    "content": None,
                    "state": "published",
                }
            ],
        )
        return 2

    async def default_process(_s, queue, item_callback=None):
        seen.append([int(i["message_id"]) for i in queue])
        if item_callback is not None:
            for _ in queue:
                await item_callback(True)
        return {md: {int(i["message_id"]): {"duration": 1} for i in queue}}

    async def process_media_queue(s, queue, item_callback=None):
        if process is not None:
            seen.append([int(i["message_id"]) for i in queue])
            return await process(s, queue, item_callback)
        return await default_process(s, queue, item_callback)

    mgr = _mock_sync_manager()
    client = MagicMock()
    client.access_token = "tok"
    client.refresh_if_needed = AsyncMock()
    client.get_groups = AsyncMock(return_value=GROUPS)
    client.get_members = AsyncMock(return_value=MEMBERS[100])
    client.get_messages = AsyncMock(return_value=[])
    mgr.client = client
    mgr.get_last_ts = MagicMock(return_value="2026-11-04T11:00:00Z")
    mgr.get_last_id = MagicMock(return_value=10)
    mgr.sync_member = AsyncMock(side_effect=sync_member)
    mgr.process_media_queue = AsyncMock(side_effect=process_media_queue)
    mgr.update_message_metadata = AsyncMock()
    return mgr, seen


async def _run(
    tmp_path: Path,
    mgr: MagicMock,
    ctl: FakeController | None = None,
    tasks: list[tuple[Any, str]] | None = None,
) -> tuple[FakeController, list[tuple[Any, str]]]:
    ctl = ctl or FakeController()
    tasks = tasks if tasks is not None else []

    def capture(coro, name=None):
        tasks.append((coro, name))

    try:
        with (
            patch(
                "backend.services.sync_service.get_call_popup_controller",
                return_value=ctl,
            ),
            patch(
                "backend.services.sync_service.desktop_bridge.call_popup_available",
                return_value=True,
            ),
            patch(
                "backend.services.sync_service.query_quiet_state",
                return_value=QuietState("accepts", False, 5, 0),
            ),
            patch(
                "backend.services.sync_service.track_background_task",
                side_effect=capture,
            ),
            patch(
                "backend.services.sync_service.get_ui_state",
                return_value=MagicMock(focused=False),
            ),
        ):
            await _run_start_sync(
                SyncService(), tmp_path, groups=GROUPS, members=None, mock_manager=mgr
            )
    finally:
        for coro, name in tasks:
            if name != "call_popup_dispatch":
                coro.close()
    return ctl, tasks


def _dispatches(tasks: list[tuple[Any, str]]) -> list[Any]:
    return [c for c, n in tasks if n == "call_popup_dispatch"]


async def _close(tasks: list[tuple[Any, str]]) -> None:
    for c in _dispatches(tasks):
        await c


@pytest.mark.asyncio
async def test_voice_is_downloaded_first_then_dispatched(tmp_path: Path) -> None:
    md = tmp_path / "m"
    mgr, seen = _manager(md, items=[(10, "voice"), (11, "picture")])
    with structlog.testing.capture_logs() as logs:
        ctl, tasks = await _run(tmp_path, mgr)
    await _close(tasks)
    assert seen == [[10], [11]]
    updates = [c.args[1] for c in mgr.update_message_metadata.await_args_list]
    merged: dict[int, Any] = {}
    for u in updates:
        merged.update(u)
    assert set(merged) == {10, 11}
    vf = [e for e in logs if e["event"] == "call_popup_voice_first"]
    assert vf and vf[0]["call_id"] == 7 and vf[0]["items"] == 1
    assert vf[0]["downloaded"] == 1
    assert [n for _, n in tasks].count("call_popup_dispatch") == 1
    ctl.dispatch.assert_awaited_once_with(7)
    ctl.abandon.assert_not_called()


@pytest.mark.asyncio
async def test_no_matching_voice_item_still_dispatches(tmp_path: Path) -> None:
    md = tmp_path / "m"
    mgr, seen = _manager(md, items=[(11, "picture")])
    with structlog.testing.capture_logs() as logs:
        ctl, tasks = await _run(tmp_path, mgr)
    await _close(tasks)
    vf = [e for e in logs if e["event"] == "call_popup_voice_first"]
    assert vf[0]["items"] == 0 and vf[0]["downloaded"] == 0
    assert seen == [[11]]
    ctl.dispatch.assert_awaited_once_with(7)
    ctl.abandon.assert_not_called()


@pytest.mark.asyncio
async def test_empty_media_queue_still_dispatches(tmp_path: Path) -> None:
    md = tmp_path / "m"
    mgr, seen = _manager(md, items=[])
    ctl, tasks = await _run(tmp_path, mgr)
    await _close(tasks)
    assert seen == []
    ctl.dispatch.assert_awaited_once_with(7)
    ctl.abandon.assert_not_called()


@pytest.mark.asyncio
async def test_failure_before_dispatch_abandons(tmp_path: Path) -> None:
    md = tmp_path / "m"

    async def boom(*_a):
        raise RuntimeError("x")

    mgr, _ = _manager(md, items=[(10, "voice")], process=boom)
    ctl, tasks = await _run(tmp_path, mgr)
    assert _dispatches(tasks) == []
    ctl.abandon.assert_called_once_with(7, reason="sync_failed")
    ctl.dispatch.assert_not_called()


@pytest.mark.asyncio
async def test_cancel_before_dispatch_abandons_as_cancelled(tmp_path: Path) -> None:
    md = tmp_path / "m"

    async def cancel(*_a):
        raise asyncio.CancelledError

    mgr, _ = _manager(md, items=[(10, "voice")], process=cancel)
    ctl = FakeController()
    with pytest.raises(asyncio.CancelledError):
        await _run(tmp_path, mgr, ctl)
    ctl.abandon.assert_called_once_with(7, reason="cancelled")
    ctl.dispatch.assert_not_called()


@pytest.mark.asyncio
async def test_session_expiry_before_dispatch_abandons(tmp_path: Path) -> None:
    md = tmp_path / "m"

    async def expired(*_a):
        raise SessionExpiredError("expired")

    mgr, _ = _manager(md, items=[(10, "voice")], process=expired)
    ctl = FakeController()
    with pytest.raises(SessionExpiredError):
        await _run(tmp_path, mgr, ctl)
    ctl.abandon.assert_called_once_with(7, reason="sync_failed")
    ctl.dispatch.assert_not_called()


@pytest.mark.asyncio
async def test_failure_after_dispatch_does_not_abandon(tmp_path: Path) -> None:
    md = tmp_path / "m"
    calls = 0

    async def second_fails(_s, queue, item_callback=None):
        nonlocal calls
        calls += 1
        if calls > 1:
            raise RuntimeError("chunk failed")
        return {md: {int(i["message_id"]): {"duration": 1} for i in queue}}

    mgr, seen = _manager(
        md, items=[(10, "voice"), (11, "picture")], process=second_fails
    )
    ctl, tasks = await _run(tmp_path, mgr)
    await _close(tasks)
    assert seen == [[10], [11]]
    ctl.abandon.assert_not_called()
    assert [n for _, n in tasks].count("call_popup_dispatch") == 1
    ctl.dispatch.assert_awaited_once_with(7)


@pytest.mark.asyncio
async def test_abandon_failure_does_not_wedge_the_service(tmp_path: Path) -> None:
    md = tmp_path / "m"

    async def boom(*_a):
        raise RuntimeError("x")

    mgr, _ = _manager(md, items=[(10, "voice")], process=boom)
    ctl = FakeController()
    ctl.abandon.side_effect = RuntimeError("teardown")
    svc = SyncService()
    with structlog.testing.capture_logs() as logs:
        with (
            patch(
                "backend.services.sync_service.get_call_popup_controller",
                return_value=ctl,
            ),
            patch(
                "backend.services.sync_service.desktop_bridge.call_popup_available",
                return_value=True,
            ),
            patch(
                "backend.services.sync_service.query_quiet_state",
                return_value=QuietState("accepts", False, 5, 0),
            ),
            patch(
                "backend.services.sync_service.get_ui_state",
                return_value=MagicMock(focused=False),
            ),
        ):
            await _run_start_sync(
                svc, tmp_path, groups=GROUPS, members=None, mock_manager=mgr
            )
    failed = [e for e in logs if e["event"] == "call_popup_abandon_failed"]
    assert [e["error_type"] for e in failed] == ["RuntimeError"]
    assert svc.running is False and svc._task is None
