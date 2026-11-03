"""Room roster + one-time history scan in SyncService (spec §4, §7)."""

import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from structlog.testing import capture_logs

from backend.services.sync_service import SyncService
from backend.tests.test_sync_service_core import (
    _make_message,
    _make_metadata,
    _member_info,
    _run_start_sync,
)

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


GROUP_B = {**GROUP, "id": 44, "name": "櫻坂46"}


def _synced_group_ids(m) -> list[int]:
    return [c.args[1]["id"] for c in m.sync_member.await_args_list]


async def test_scanned_room_extra_failure_fails_group_only(tmp_path, caplog):
    """Already-scanned room: a non-auth extra_room_members failure must fail the
    whole group before any sync_member advances a cursor (the next sync
    retries the same window); sibling groups still sync."""
    m = _manager(scanned=True, extra=[])
    m.client.get_groups = AsyncMock(return_value=[GROUP, GROUP_B])

    async def _extras(session, group, api_members, messages, name_hints=None):
        if group["id"] == 43:
            raise RuntimeError("boom")
        return []

    m.extra_room_members = AsyncMock(side_effect=_extras)
    with caplog.at_level(logging.WARNING):
        await _run_start_sync(
            SyncService(),
            tmp_path,
            groups=[GROUP, GROUP_B],
            members=API_MEMBERS,
            mock_manager=m,
        )
    assert _synced_group_ids(m) == [44]
    assert all(c.args[1]["id"] != 43 for c in m.backfill_past_messages.await_args_list)
    m.mark_history_scanned.assert_not_called()
    assert "room_extra_members_failed" in caplog.text
    assert "group_sync_failed" in caplog.text


async def test_scanning_room_extra_failure_logged_and_continues(tmp_path, caplog):
    m = _manager(scanned=False)
    m.extra_room_members = AsyncMock(side_effect=RuntimeError("boom"))
    with caplog.at_level(logging.WARNING):
        await _run_start_sync(
            SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
        )
    assert _synced_group_ids(m) == [43]
    assert "room_extra_members_failed" in caplog.text
    assert "group_sync_failed" not in caplog.text


async def test_scanning_room_ignores_initial_limit(tmp_path):
    m = _manager(scanned=False, extra=[])
    rows = [_make_message(i, 79, f"2022-04-0{i}T00:00:00Z") for i in range(1, 6)]
    m.client.get_messages = AsyncMock(return_value=rows)
    m.get_last_ts = MagicMock(return_value=None)
    await _run_start_sync(
        SyncService(),
        tmp_path,
        groups=[GROUP],
        members=API_MEMBERS,
        mock_manager=m,
        initial_limit=2,
    )
    (call,) = m.sync_member.await_args_list
    assert call.kwargs["prefetched_messages"] == rows


async def test_scanned_room_initial_limit_still_caps(tmp_path):
    """Control: the first-sync cap is unchanged for rooms already scanned."""
    m = _manager(scanned=True, extra=[])
    rows = [_make_message(i, 79, f"2022-04-0{i}T00:00:00Z") for i in range(1, 6)]
    m.client.get_messages = AsyncMock(return_value=rows)
    m.get_last_ts = MagicMock(return_value=None)
    await _run_start_sync(
        SyncService(),
        tmp_path,
        groups=[GROUP],
        members=API_MEMBERS,
        mock_manager=m,
        initial_limit=2,
    )
    (call,) = m.sync_member.await_args_list
    assert [r["id"] for r in call.kwargs["prefetched_messages"]] == [4, 5]


async def test_scanning_room_metadata_cursors_still_updated(tmp_path):
    """Counts of a scanned room are excluded from totals, but the API members'
    metadata cursors are still recorded."""
    saved: dict = {}
    notify = AsyncMock()
    m = _manager(scanned=False)
    m.get_last_id = MagicMock(side_effect=lambda gid, mid: 1 if mid == 79 else None)
    seed = _make_metadata(groups={"43_79": _member_info(43, 79, "日向坂46")})
    assert "last_sync_ts" not in seed["groups"]["43_79"]
    await _run_start_sync(
        SyncService(),
        tmp_path,
        groups=[GROUP],
        members=API_MEMBERS,
        mock_manager=m,
        metadata=seed,
        saved=saved,
        notify_mock=notify,
    )
    entry = saved["groups"]["43_79"]
    assert entry["last_message_id"] == 1
    assert entry["last_sync_ts"] == "2026-10-01T00:00:00Z"
    notify.assert_not_awaited()


async def test_recovered_members_get_full_search_scan(tmp_path):
    m = _manager(scanned=False)
    search = MagicMock()
    search.index_members = AsyncMock(return_value=3)
    bg: list = []

    def _track(coro, name=None):
        bg.append(coro)

    with (
        patch(
            "backend.services.search_service.get_search_service",
            return_value=search,
        ),
        patch("backend.services.sync_service.track_background_task", _track),
    ):
        await _run_start_sync(
            SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
        )
        for coro in bg:
            await coro
    search.index_members.assert_awaited_once()
    args, kw = search.index_members.await_args
    indexed = {(g["id"], mem["id"]) for g, mem in args[0]}
    assert indexed == {(43, 79), (43, 22), (43, 0)}
    assert set(kw["full_member_scan"]) == {(43, 79), (43, 22), (43, 0)}


async def test_rate_limited_scan_leaves_room_unmarked(tmp_path):
    from pysaka import RateLimitedError

    m = _manager(scanned=False, extra=[])
    m.client.get_groups = AsyncMock(return_value=[GROUP, GROUP_B])
    rows = [_make_message(1, 79, "2022-04-01T03:05:10Z")]

    async def _fetch(session, gid, **kw):
        if gid == 43:
            raise RateLimitedError("429", retry_after=30)
        return rows

    m.client.get_messages = AsyncMock(side_effect=_fetch)
    await _run_start_sync(
        SyncService(),
        tmp_path,
        groups=[GROUP, GROUP_B],
        members=API_MEMBERS,
        mock_manager=m,
    )
    assert _synced_group_ids(m) == [44]
    m.mark_history_scanned.assert_called_once_with(44)


def _events(logs, name):
    return [e for e in logs if e["event"] == name]


async def test_scan_breadcrumbs_logged(tmp_path):
    m = _manager(scanned=False)
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
        )
    (started,) = _events(logs, "room_history_scan_started")
    assert started["group_id"] == 43
    (found,) = _events(logs, "room_extra_members_found")
    assert found["group_id"] == 43 and found["member_ids"] == [22, 0]
    assert found["count"] == 2
    (finished,) = _events(logs, "room_history_scan_finished")
    assert finished["group_id"] == 43 and finished["marked"] is True
    assert finished["fetched_msgs"] == 3 and finished["extra_members"] == 2
    assert "elapsed" in finished
    assert not _events(logs, "room_history_scan_incomplete")
    (phase2,) = _events(logs, "phase2_complete")
    assert phase2["recovered_members"] == 3
    assert phase2["excluded_new_messages"] == 54  # 1 + 50 + 3
    # Breadcrumbs carry ids/counts only, never message text.
    assert "Message 1" not in repr(logs)


async def test_incomplete_scan_breadcrumbs(tmp_path):
    m = _manager(scanned=False, complete=False)
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
        )
    (incomplete,) = _events(logs, "room_history_scan_incomplete")
    assert incomplete["group_id"] == 43
    (finished,) = _events(logs, "room_history_scan_finished")
    assert finished["marked"] is False


@pytest.mark.parametrize(
    ("scanned", "action", "synced"),
    [(True, "fail_room", []), (False, "continue", [43])],
)
async def test_extra_failure_breadcrumb_fields(tmp_path, scanned, action, synced):
    m = _manager(scanned=scanned, extra=[])
    m.extra_room_members = AsyncMock(side_effect=RuntimeError("boom"))
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
        )
    (failed,) = _events(logs, "room_extra_members_failed")
    assert failed == {
        "event": "room_extra_members_failed",
        "log_level": "warning",
        "group_id": 43,
        "error_type": "RuntimeError",
        "scanned": scanned,
        "action": action,
    }
    assert _synced_group_ids(m) == synced


async def test_scan_fetch_failure_breadcrumb(tmp_path):
    from pysaka import RateLimitedError

    m = _manager(scanned=False)
    m.client.get_messages = AsyncMock(side_effect=RateLimitedError("429"))
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
        )
    (failed,) = _events(logs, "room_history_scan_fetch_failed")
    assert failed["group_id"] == 43 and failed["error_type"] == "RateLimitedError"
    assert not _events(logs, "room_history_scan_finished")
    m.mark_history_scanned.assert_not_called()
