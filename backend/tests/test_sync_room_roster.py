"""Room roster + one-time history scan in SyncService (spec §4, §7)."""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.services.sync_service import SyncService
from backend.tests.test_sync_service_core import _make_message, _run_start_sync

pytestmark = pytest.mark.asyncio

GROUP = {
    "id": 43,
    "name": "日向坂46",
    "state": "open",
    "subscription": {"state": "active"},
}
API_MEMBERS = [{"id": 79, "name": "日向坂46", "thumbnail": None, "portrait": None}]
EXTRA = [
    {"id": 22, "name": "潮 紗理菜"},
    {"id": 0, "name": "日向坂46", "thumbnail": None},
]


def _manager(*, scanned: bool, complete: bool = True, extra=EXTRA, sync_counts=None):
    client = MagicMock()
    client.access_token = "tok"
    client.refresh_if_needed = AsyncMock()
    client.get_groups = AsyncMock(return_value=[GROUP])
    client.get_members = AsyncMock(return_value=API_MEMBERS)
    client.get_messages = AsyncMock(
        return_value=[
            _make_message(1, 79, "2022-04-01T03:05:10Z"),
            _make_message(2, 22, "2021-09-16T06:37:53Z"),
            {"id": 3, "published_at": "2022-04-01T03:00:10Z", "text": "x"},
        ]
    )
    m = MagicMock()
    m.client = client
    m.get_last_ts = MagicMock(
        side_effect=lambda gid, mid: "2026-10-01T00:00:00Z" if mid == 79 else None
    )
    m.get_last_id = MagicMock(return_value=None)
    counts = sync_counts or {79: 1, 22: 50, 0: 3}
    m.sync_member = AsyncMock(
        side_effect=lambda s, g, member, q, **kw: counts.get(member["id"], 0)
    )
    m.process_media_queue = AsyncMock(return_value={})
    m.backfill_past_messages = AsyncMock(return_value=0)
    m.sync_letters = AsyncMock(return_value=0)
    m.history_scanned = MagicMock(return_value=scanned)
    m.mark_history_scanned = MagicMock()
    m.room_archive_complete = AsyncMock(return_value=complete)
    m.extra_room_members = AsyncMock(return_value=extra)
    return m


async def test_unscanned_room_full_fetch_paced_and_marked(tmp_path):
    m = _manager(scanned=False)
    await _run_start_sync(
        SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
    )

    _, kw = m.client.get_messages.await_args
    assert kw.get("since_ts") is None and kw.get("page_delay") == 1.0
    synced = [c.args[2]["id"] for c in m.sync_member.await_args_list]
    assert synced == [79, 22, 0]
    assert all(
        c.kwargs.get("ignore_cursor") is True for c in m.sync_member.await_args_list
    )
    m.mark_history_scanned.assert_called_once_with(43)


async def test_incomplete_scan_not_marked(tmp_path):
    m = _manager(scanned=False, complete=False)
    await _run_start_sync(
        SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
    )
    assert m.sync_member.await_count == 3
    m.mark_history_scanned.assert_not_called()


async def test_scanned_room_incremental_without_new_kwargs(tmp_path):
    m = _manager(scanned=True, extra=[])
    await _run_start_sync(
        SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
    )
    _, kw = m.client.get_messages.await_args
    assert kw.get("since_ts") is not None and "page_delay" not in kw
    assert m.sync_member.await_count == 1
    assert all("ignore_cursor" not in c.kwargs for c in m.sync_member.await_args_list)
    m.mark_history_scanned.assert_not_called()


async def test_recovered_counts_excluded_from_notification(tmp_path):
    notify = AsyncMock()
    m = _manager(scanned=False)
    await _run_start_sync(
        SyncService(),
        tmp_path,
        groups=[GROUP],
        members=API_MEMBERS,
        mock_manager=m,
        notify_mock=notify,
    )
    assert m.sync_member.await_count == 3
    notify.assert_not_awaited()  # everything in a scanned room is recovered, not new


async def test_extra_members_not_written_to_metadata(tmp_path):
    saved: dict = {}
    m = _manager(scanned=False)
    await _run_start_sync(
        SyncService(),
        tmp_path,
        groups=[GROUP],
        members=API_MEMBERS,
        mock_manager=m,
        saved=saved,
    )
    assert m.sync_member.await_count == 3
    keys = set(saved["groups"])
    assert "43_79" in keys and "43_22" not in keys and "43_0" not in keys


async def test_extra_member_failure_is_isolated(tmp_path):
    m = _manager(scanned=False)
    m.extra_room_members = AsyncMock(side_effect=RuntimeError("boom"))
    await _run_start_sync(
        SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
    )
    assert [c.args[2]["id"] for c in m.sync_member.await_args_list] == [79]
    m.mark_history_scanned.assert_called_once_with(
        43
    )  # room_archive_complete mocked True here


async def test_extra_member_auth_error_propagates(tmp_path):
    from pysaka import SessionExpiredError

    m = _manager(scanned=False)
    m.extra_room_members = AsyncMock(side_effect=SessionExpiredError("expired"))
    with pytest.raises(SessionExpiredError):
        await _run_start_sync(
            SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
        )
    m.sync_member.assert_not_awaited()
    m.mark_history_scanned.assert_not_called()


async def test_scans_run_one_room_at_a_time(tmp_path):
    group_b = {**GROUP, "id": 44, "name": "櫻坂46"}
    m = _manager(scanned=False, extra=[])
    m.client.get_groups = AsyncMock(return_value=[GROUP, group_b])
    events: list[tuple[str, int]] = []

    async def _fetch(session, gid, **kw):
        events.append(("start", gid))
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        events.append(("end", gid))
        return []

    m.client.get_messages = AsyncMock(side_effect=_fetch)
    await _run_start_sync(
        SyncService(),
        tmp_path,
        groups=[GROUP, group_b],
        members=API_MEMBERS,
        mock_manager=m,
    )
    assert len(events) == 4
    kinds = [k for k, _ in events]
    assert kinds == ["start", "end", "start", "end"], events


async def test_scanned_room_extra_totals_follow_cursor(tmp_path):
    """In an already-scanned room, an extra author with a cursor reports new
    messages; one seen for the first time (no cursor) is recovered history."""
    notify = AsyncMock()
    extras = [{"id": 22, "name": "潮 紗理菜"}, {"id": 0, "name": "日向坂46"}]
    m = _manager(scanned=True, extra=extras)
    m.get_last_ts = MagicMock(
        side_effect=lambda gid, mid: None if mid == 0 else "2026-10-01T00:00:00Z"
    )
    await _run_start_sync(
        SyncService(),
        tmp_path,
        groups=[GROUP],
        members=API_MEMBERS,
        mock_manager=m,
        notify_mock=notify,
    )
    assert [c.args[2]["id"] for c in m.sync_member.await_args_list] == [79, 22, 0]
    assert all("ignore_cursor" not in c.kwargs for c in m.sync_member.await_args_list)
    # 79 (1) + 22 (50) are new; 0 (3, no prior cursor) is recovered.
    notify.assert_awaited_once_with(51, 2)
    m.mark_history_scanned.assert_not_called()
