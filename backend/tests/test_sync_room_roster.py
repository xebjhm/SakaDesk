"""Room roster + one-time history scan in SyncService (spec §4, §7)."""

import asyncio
from pathlib import Path
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

    def _sync_member(s, g, member, q, **kw):
        n = counts.get(member["id"], 0)
        cb = kw.get("on_new_messages")
        if cb is not None and n > 0:
            # Like pysaka: fired for incremental calls only (never with
            # ignore_cursor), flagged initial_sync when the member had no
            # messages.json yet (modelled by "no cursor").
            cb(
                {
                    "group_id": g["id"],
                    "group_name": g["name"],
                    "member_id": member["id"],
                    "member_name": member["name"],
                    "member_dir": Path("m"),
                    "phone_image": None,
                    "initial_sync": m.get_last_ts(g["id"], member["id"]) is None,
                },
                [
                    {"id": i, "timestamp": "2026-10-02T00:00:00Z", "type": "text"}
                    for i in range(n)
                ],
            )
        return n

    m.sync_member = AsyncMock(side_effect=_sync_member)
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
    # Paced by the client's timeline interval instead (see the pacing tests).
    assert kw.get("since_ts") is None and kw.get("page_delay") == 0
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
    messages; one seen for the first time (no cursor: pysaka flags the call
    initial_sync) is recovered history."""
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
    notify.assert_awaited_once()
    (plans,) = notify.await_args.args
    assert [p.count for p in plans] == [51]  # one room toast
    m.mark_history_scanned.assert_not_called()


GROUP_B = {**GROUP, "id": 44, "name": "櫻坂46"}


def _synced_group_ids(m) -> list[int]:
    return [c.args[1]["id"] for c in m.sync_member.await_args_list]


async def test_scanned_room_extra_failure_fails_group_only(tmp_path):
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
    with capture_logs() as logs:
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
    (extra_failed,) = _events(logs, "room_extra_members_failed")
    assert extra_failed["group_id"] == 43
    assert extra_failed["already_scanned"] is True
    assert extra_failed["action"] == "fail_room"
    (group_failed,) = _events(logs, "group_sync_failed")
    assert group_failed["group_id"] == 43


async def test_scanning_room_extra_failure_logged_and_continues(tmp_path):
    m = _manager(scanned=False)
    m.extra_room_members = AsyncMock(side_effect=RuntimeError("boom"))
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
        )
    assert _synced_group_ids(m) == [43]
    (extra_failed,) = _events(logs, "room_extra_members_failed")
    assert extra_failed["group_id"] == 43
    assert extra_failed["already_scanned"] is False
    assert extra_failed["action"] == "continue"
    assert _events(logs, "group_sync_failed") == []


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
    assert finished["group_id"] == 43 and finished["complete"] is True
    assert finished["fetched_msgs"] == 3 and finished["extra_members"] == 2
    assert "elapsed" in finished
    assert not _events(logs, "room_history_scan_incomplete")
    (phase2,) = _events(logs, "phase2_complete")
    assert phase2["recovered_members"] == 3
    assert phase2["recovered_rows_excluded"] == 54  # 1 + 50 + 3
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
    assert finished["complete"] is False


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
        "already_scanned": scanned,
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


# --- Final review item 1: mark a scan only after the media phase ------------


def _scan_with_media(m):
    """Make sync_member queue one media item, so phase 3 has work to do."""
    counts = {79: 1, 22: 50, 0: 3}

    async def _sync(s, g, member, q, **kw):
        q.append({"url": "u", "path": "p", "timestamp": "t"})
        return counts.get(member["id"], 0)

    m.sync_member = AsyncMock(side_effect=_sync)
    return m


async def test_scan_marked_only_after_media_phase(tmp_path):
    order: list[str] = []
    m = _scan_with_media(_manager(scanned=False))

    async def _media(session, chunk, item_callback=None):
        order.append("media")
        return {}

    m.process_media_queue = AsyncMock(side_effect=_media)
    m.mark_history_scanned = MagicMock(side_effect=lambda gid: order.append("mark"))
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
        )
    assert order == ["media", "mark"]
    (marked,) = _events(logs, "room_history_scan_marked")
    assert marked["group_id"] == 43
    assert not _events(logs, "room_history_scan_mark_deferred")


async def test_scan_not_marked_when_media_phase_raises(tmp_path):
    m = _scan_with_media(_manager(scanned=False))
    m.process_media_queue = AsyncMock(side_effect=OSError("disk full"))
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
        )
    m.mark_history_scanned.assert_not_called()
    (deferred,) = _events(logs, "room_history_scan_mark_deferred")
    assert deferred["group_ids"] == [43] and deferred["reason"] == "OSError"


async def test_scan_not_marked_when_media_phase_cancelled(tmp_path):
    m = _scan_with_media(_manager(scanned=False))
    m.process_media_queue = AsyncMock(side_effect=asyncio.CancelledError())
    with capture_logs() as logs:
        with pytest.raises(asyncio.CancelledError):
            await _run_start_sync(
                SyncService(),
                tmp_path,
                groups=[GROUP],
                members=API_MEMBERS,
                mock_manager=m,
            )
    m.mark_history_scanned.assert_not_called()
    (deferred,) = _events(logs, "room_history_scan_mark_deferred")
    assert deferred["group_ids"] == [43] and deferred["reason"] == "cancelled"


async def test_scan_marked_despite_failed_downloads(tmp_path):
    """A download that fails inside process_media_queue (it reports fewer
    successes, never raises) must not keep the room rescanning forever:
    Verify & Fix covers the missing file."""
    m = _scan_with_media(_manager(scanned=False))

    async def _media(session, chunk, item_callback=None):
        if item_callback:
            for _ in chunk:
                await item_callback(False)  # nothing downloaded
        return {}

    m.process_media_queue = AsyncMock(side_effect=_media)
    await _run_start_sync(
        SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
    )
    m.mark_history_scanned.assert_called_once_with(43)


async def test_scan_not_marked_when_other_room_session_expires(tmp_path):
    """A sibling room's auth failure aborts the sync before phase 3: the
    completed scan is deferred, not marked."""
    from pysaka import SessionExpiredError

    m = _manager(scanned=False, extra=[])
    m.client.get_groups = AsyncMock(return_value=[GROUP, GROUP_B])

    async def _extras(session, group, api_members, messages, name_hints=None):
        if group["id"] == 44:
            await asyncio.sleep(0)
            raise SessionExpiredError("expired")
        return []

    m.extra_room_members = AsyncMock(side_effect=_extras)
    with capture_logs() as logs:
        with pytest.raises(SessionExpiredError):
            await _run_start_sync(
                SyncService(),
                tmp_path,
                groups=[GROUP, GROUP_B],
                members=API_MEMBERS,
                mock_manager=m,
            )
    m.mark_history_scanned.assert_not_called()
    (deferred,) = _events(logs, "room_history_scan_mark_deferred")
    assert deferred["group_ids"] == [43]
    assert deferred["reason"] == "SessionExpiredError"


async def test_scan_mark_failure_logged_and_sync_completes(tmp_path):
    m = _manager(scanned=False, extra=[])
    m.mark_history_scanned = MagicMock(side_effect=OSError("locked"))
    saved: dict = {}
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(),
            tmp_path,
            groups=[GROUP],
            members=API_MEMBERS,
            mock_manager=m,
            saved=saved,
        )
    (failed,) = _events(logs, "room_history_scan_mark_failed")
    assert failed["group_id"] == 43 and failed["error_type"] == "OSError"
    assert "last_sync" in saved


async def test_scan_mark_returning_false_logged_and_not_marked(tmp_path):
    m = _manager(scanned=False, extra=[])
    m.mark_history_scanned = MagicMock(return_value=False)
    saved: dict = {}
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(),
            tmp_path,
            groups=[GROUP],
            members=API_MEMBERS,
            mock_manager=m,
            saved=saved,
        )
    m.mark_history_scanned.assert_called_once_with(43)
    (failed,) = _events(logs, "room_history_scan_mark_failed")
    assert failed["group_id"] == 43 and failed["log_level"] == "warning"
    assert not _events(logs, "room_history_scan_marked")
    assert "last_sync" in saved


async def test_scan_mark_returning_true_or_none_counts_as_marked(tmp_path):
    for ret in (True, None):
        m = _manager(scanned=False, extra=[])
        m.mark_history_scanned = MagicMock(return_value=ret)
        with capture_logs() as logs:
            await _run_start_sync(
                SyncService(),
                tmp_path,
                groups=[GROUP],
                members=API_MEMBERS,
                mock_manager=m,
            )
        assert [e["group_id"] for e in _events(logs, "room_history_scan_marked")] == [
            43
        ]
        assert not _events(logs, "room_history_scan_mark_failed")


# --- Final review item 2: genuinely new messages in a scanned room ----------


def _scan_rows_with_new():
    return [
        _make_message(1, 79, "2022-04-01T03:05:10Z"),  # older than 79's cursor
        _make_message(4, 79, "2026-10-02T09:00:00Z"),  # new since 79's cursor
        _make_message(2, 22, "2021-09-16T06:37:53Z"),
        _make_message(5, 22, "2026-10-03T09:00:00Z"),  # 22 has no cursor
        {"id": 3, "published_at": "2022-04-01T03:00:10Z", "text": "x"},
        {"id": 6, "published_at": "2026-10-04T00:00:00Z", "text": "y"},  # member 0
    ]


async def test_scanning_room_reports_no_new_messages(tmp_path):
    """The upgrade sync scans every room with ignore_cursor, for which pysaka
    never fires on_new_messages, so the collector (the only source of the
    totals) sees nothing: a scanned room reports 0 new, even a post newer
    than an author's cursor. The scan bookkeeping is unchanged."""
    notify = AsyncMock()
    m = _manager(scanned=False, sync_counts={79: 2, 22: 2, 0: 2})
    m.client.get_messages = AsyncMock(return_value=_scan_rows_with_new())
    m.get_last_ts = MagicMock(
        side_effect=lambda gid, mid: {
            79: "2026-10-01T00:00:00Z",
            0: "2026-10-04T00:00:00Z",  # cursor == newest member-0 row: not new
        }.get(mid)
    )
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(),
            tmp_path,
            groups=[GROUP],
            members=API_MEMBERS,
            mock_manager=m,
            notify_mock=notify,
        )
    notify.assert_not_awaited()
    assert all(c.kwargs.get("ignore_cursor") for c in m.sync_member.await_args_list)
    assert all("on_new_messages" not in c.kwargs for c in m.sync_member.await_args_list)
    (phase2,) = _events(logs, "phase2_complete")
    assert phase2["new_messages"] == 0
    assert phase2["recovered_members"] == 3
    assert phase2["recovered_rows_excluded"] == 5  # 6 written - 1 newer than cursor
    (finished,) = _events(logs, "room_history_scan_finished")
    assert finished["rows_newer_than_cursor"] == 1


async def test_scanning_room_new_count_capped_by_written(tmp_path):
    """sync_member wrote nothing (e.g. a folder rename failed): nothing is new."""
    notify = AsyncMock()
    m = _manager(scanned=False, extra=[], sync_counts={79: 0})
    m.client.get_messages = AsyncMock(return_value=_scan_rows_with_new())
    await _run_start_sync(
        SyncService(),
        tmp_path,
        groups=[GROUP],
        members=API_MEMBERS,
        mock_manager=m,
        notify_mock=notify,
    )
    notify.assert_not_awaited()


async def test_scanning_room_still_fully_indexed_with_new(tmp_path):
    m = _manager(scanned=False, sync_counts={79: 2, 22: 2, 0: 2})
    m.client.get_messages = AsyncMock(return_value=_scan_rows_with_new())
    search = MagicMock()
    search.index_members = AsyncMock(return_value=3)
    bg: list = []
    with (
        patch(
            "backend.services.search_service.get_search_service",
            return_value=search,
        ),
        patch(
            "backend.services.sync_service.track_background_task",
            lambda coro, name=None: bg.append(coro),
        ),
    ):
        await _run_start_sync(
            SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
        )
        for coro in bg:
            await coro
    _, kw = search.index_members.await_args
    assert set(kw["full_member_scan"]) == {(43, 79), (43, 22), (43, 0)}


# --- Rate-limit addendum: timeline pacing during scan syncs ------------------

GROUP_C = {**GROUP, "id": 45, "name": "乃木坂46"}


def _record_interval(m, rows=None):
    """Make get_messages record the client's timeline interval at call time."""
    seen: list[tuple[int, float]] = []
    m.client.timeline_min_interval = 0.0

    async def _fetch(session, gid, **kw):
        seen.append((gid, m.client.timeline_min_interval))
        return rows if rows is not None else []

    m.client.get_messages = AsyncMock(side_effect=_fetch)
    return seen


async def test_scan_sync_paces_timeline_and_resets(tmp_path):
    m = _manager(scanned=False, extra=[])
    seen = _record_interval(m)
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
        )
    assert seen == [(43, 3.0)]
    assert m.client.timeline_min_interval == 0.0
    _, kw = m.client.get_messages.await_args
    assert kw["page_delay"] == 0
    (paced,) = _events(logs, "sync_timeline_pacing")
    assert paced["scan_rooms"] == 1 and paced["interval"] == 3.0


async def test_mixed_sync_paces_incremental_rooms_too(tmp_path):
    """Pacing is per client: once any room scans, every timeline request of
    the sync is paced (the incremental fetch keeps its own arguments)."""
    m = _manager(scanned=False, extra=[])
    m.client.get_groups = AsyncMock(return_value=[GROUP, GROUP_B])
    m.history_scanned = MagicMock(side_effect=lambda gid: gid == 44)
    seen = _record_interval(m)
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(),
            tmp_path,
            groups=[GROUP, GROUP_B],
            members=API_MEMBERS,
            mock_manager=m,
        )
    assert sorted(seen) == [(43, 3.0), (44, 3.0)]
    (paced,) = _events(logs, "sync_timeline_pacing")
    assert paced["scan_rooms"] == 1
    assert m.client.timeline_min_interval == 0.0
    incremental = [
        c.kwargs for c in m.client.get_messages.await_args_list if c.args[1] == 44
    ]
    assert incremental and "page_delay" not in incremental[0]


async def test_pacing_reset_when_sync_raises(tmp_path):
    from pysaka import SessionExpiredError

    m = _manager(scanned=False, extra=[])
    _record_interval(m)
    m.extra_room_members = AsyncMock(side_effect=SessionExpiredError("expired"))
    with pytest.raises(SessionExpiredError):
        await _run_start_sync(
            SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
        )
    assert m.client.timeline_min_interval == 0.0


async def test_pacing_reset_when_every_room_fails(tmp_path):
    m = _manager(scanned=False, extra=[])
    m.client.timeline_min_interval = 0.0
    m.client.get_messages = AsyncMock(side_effect=RuntimeError("boom"))
    await _run_start_sync(
        SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
    )
    assert m.client.timeline_min_interval == 0.0


async def test_incremental_sync_never_touches_interval(tmp_path):
    m = _manager(scanned=True, extra=[])
    m.client.timeline_min_interval = 1.25  # sentinel: must stay untouched
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
        )
    assert m.client.timeline_min_interval == 1.25
    assert not _events(logs, "sync_timeline_pacing")


# --- Rate-limit addendum: per-sync 429 circuit breaker -----------------------


def _fetched_gids(m) -> list[int]:
    return [c.args[1] for c in m.client.get_messages.await_args_list]


@pytest.mark.parametrize("yield_first", [False, True])
async def test_rate_limited_scan_defers_later_rooms(tmp_path, yield_first):
    """A 429 in a scan room: later rooms make no timeline call, log
    room_sync_deferred, move no cursors and get no mark; the sync completes.
    ``yield_first`` lets the later room queue on the scan semaphore before
    the 429, so the check after acquiring it is the one that defers."""
    from pysaka import RateLimitedError

    m = _manager(scanned=False, extra=[])
    m.client.get_groups = AsyncMock(return_value=[GROUP, GROUP_B])
    rows = [_make_message(1, 79, "2022-04-01T03:05:10Z")]

    async def _fetch(session, gid, **kw):
        if gid == 43:
            if yield_first:
                await asyncio.sleep(0)
            raise RateLimitedError("429", retry_after=30)
        return rows

    m.client.get_messages = AsyncMock(side_effect=_fetch)
    key_b = "44_79"
    metadata = _make_metadata(
        groups={key_b: _member_info(44, 79, last_message_id=7, last_sync_ts="T")}
    )
    saved: dict = {}
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(),
            tmp_path,
            groups=[GROUP, GROUP_B],
            members=API_MEMBERS,
            mock_manager=m,
            metadata=metadata,
            saved=saved,
        )
    assert _fetched_gids(m) == [43]
    m.sync_member.assert_not_awaited()
    m.backfill_past_messages.assert_not_awaited()
    m.sync_letters.assert_not_awaited()
    m.mark_history_scanned.assert_not_called()
    assert saved["groups"][key_b]["last_message_id"] == 7
    assert saved["groups"][key_b]["last_sync_ts"] == "T"
    (limited,) = _events(logs, "sync_rate_limited")
    assert limited["group_id"] == 43 and limited["retry_after"] == 30
    (deferred,) = _events(logs, "room_sync_deferred")
    assert deferred == {
        "event": "room_sync_deferred",
        "log_level": "warning",
        "group_id": 44,
        "reason": "rate_limited",
        "scan": True,
    }
    assert [e["group_id"] for e in _events(logs, "group_sync_failed")] == [43]
    (summary,) = _events(logs, "sync_rate_limit_summary")
    assert summary["deferred_rooms"] == 1 and summary["group_ids"] == [44]
    assert _events(logs, "sync_complete")


async def test_started_incremental_rooms_fail_without_cursor_moves(tmp_path):
    """Incremental rooms fetch concurrently, so all have started before the
    first 429 lands: none is deferred. Each fails on its own (pysaka fails
    timeline requests fast after a 429) before any cursor moves."""
    from pysaka import RateLimitedError

    m = _manager(scanned=True, extra=[])
    m.client.get_groups = AsyncMock(return_value=[GROUP, GROUP_B, GROUP_C])

    async def _fetch(session, gid, **kw):
        await asyncio.sleep(0)
        raise RateLimitedError("429")

    m.client.get_messages = AsyncMock(side_effect=_fetch)
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(),
            tmp_path,
            groups=[GROUP, GROUP_B, GROUP_C],
            members=API_MEMBERS,
            mock_manager=m,
        )
    assert sorted(_fetched_gids(m)) == [43, 44, 45]
    m.sync_member.assert_not_awaited()
    m.backfill_past_messages.assert_not_awaited()
    m.sync_letters.assert_not_awaited()
    assert not _events(logs, "room_sync_deferred")
    failed = sorted(e["group_id"] for e in _events(logs, "group_sync_failed"))
    assert failed == [43, 44, 45]
    (limited,) = _events(logs, "sync_rate_limited")
    assert limited["group_id"] == 43 and limited["retry_after"] is None
    (summary,) = _events(logs, "sync_rate_limit_summary")
    assert summary["deferred_rooms"] == 0 and summary["group_ids"] == []


async def test_rate_limited_incremental_room_defers_waiting_scan_rooms(tmp_path):
    """A 429 in an incremental room defers the scan rooms still queued on the
    scan semaphore; the scan already fetching finishes normally."""
    from pysaka import RateLimitedError

    m = _manager(scanned=False, extra=[])
    m.client.get_groups = AsyncMock(return_value=[GROUP, GROUP_B, GROUP_C])
    m.history_scanned = MagicMock(side_effect=lambda gid: gid == 43)
    rows = [_make_message(1, 79, "2022-04-01T03:05:10Z")]

    async def _fetch(session, gid, **kw):
        if gid == 43:
            await asyncio.sleep(0)
            raise RateLimitedError("429", retry_after=60)
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        return rows

    m.client.get_messages = AsyncMock(side_effect=_fetch)
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(),
            tmp_path,
            groups=[GROUP, GROUP_B, GROUP_C],
            members=API_MEMBERS,
            mock_manager=m,
        )
    assert sorted(_fetched_gids(m)) == [43, 44]
    assert _synced_group_ids(m) == [44]
    m.mark_history_scanned.assert_called_once_with(44)
    (deferred,) = _events(logs, "room_sync_deferred")
    assert deferred["group_id"] == 45 and deferred["scan"] is True
    assert [e["group_id"] for e in _events(logs, "group_sync_failed")] == [43]
    (limited,) = _events(logs, "sync_rate_limited")
    assert limited["group_id"] == 43 and limited["retry_after"] == 60
    (summary,) = _events(logs, "sync_rate_limit_summary")
    assert summary["deferred_rooms"] == 1 and summary["group_ids"] == [45]


async def test_room_past_fetch_completes_after_rate_limit(tmp_path):
    """A room whose timeline already arrived finishes normally (and its
    media is downloaded) even when a sibling hits 429 meanwhile."""
    from pysaka import RateLimitedError

    m = _scan_with_media(_manager(scanned=True, extra=[]))
    m.client.get_groups = AsyncMock(return_value=[GROUP, GROUP_B])
    rows = [_make_message(1, 79, "2026-10-02T00:00:00Z")]

    async def _fetch(session, gid, **kw):
        if gid == 43:
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            return rows
        raise RateLimitedError("429")

    m.client.get_messages = AsyncMock(side_effect=_fetch)
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(),
            tmp_path,
            groups=[GROUP, GROUP_B],
            members=API_MEMBERS,
            mock_manager=m,
        )
    assert _synced_group_ids(m) == [43]
    m.process_media_queue.assert_awaited()
    assert _events(logs, "sync_rate_limited")
    assert not _events(logs, "room_sync_deferred")
    (summary,) = _events(logs, "sync_rate_limit_summary")
    assert summary["deferred_rooms"] == 0 and summary["group_ids"] == []


@pytest.mark.parametrize("where", ["extras", "backfill", "letters"])
async def test_swallowed_rate_limit_still_trips_breaker(tmp_path, where):
    """A 429 from a step whose failure the room survives (extras in a scan
    room, backfill, letters) still defers the rooms not yet fetched."""
    from pysaka import RateLimitedError

    m = _manager(scanned=False, extra=[])
    m.client.get_groups = AsyncMock(return_value=[GROUP, GROUP_B])
    err = RateLimitedError("429", retry_after=5)
    if where == "extras":
        m.extra_room_members = AsyncMock(side_effect=err)
    elif where == "backfill":
        m.backfill_past_messages = AsyncMock(side_effect=err)
    else:
        m.sync_letters = AsyncMock(side_effect=err)
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(),
            tmp_path,
            groups=[GROUP, GROUP_B],
            members=API_MEMBERS,
            mock_manager=m,
        )
    assert _fetched_gids(m) == [43]
    assert _synced_group_ids(m) == [43]
    (limited,) = _events(logs, "sync_rate_limited")
    assert limited["group_id"] == 43 and limited["retry_after"] == 5
    (deferred,) = _events(logs, "room_sync_deferred")
    assert deferred["group_id"] == 44
    assert not _events(logs, "group_sync_failed")
    # Room 43 still completes its scan; 44 stays unscanned for next sync.
    if where == "extras":
        m.mark_history_scanned.assert_called_once_with(43)


async def test_no_rate_limit_summary_without_429(tmp_path):
    m = _manager(scanned=True, extra=[])
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
        )
    assert not _events(logs, "sync_rate_limit_summary")
    assert not _events(logs, "sync_rate_limited")


async def test_deferred_room_advances_member_progress(tmp_path):
    from pysaka import RateLimitedError

    m = _manager(scanned=False, extra=[])
    m.client.get_groups = AsyncMock(return_value=[GROUP, GROUP_B])

    async def _fetch(session, gid, **kw):
        raise RateLimitedError("429")

    m.client.get_messages = AsyncMock(side_effect=_fetch)
    progress = MagicMock()
    await _run_start_sync(
        SyncService(),
        tmp_path,
        groups=[GROUP, GROUP_B],
        members=API_MEMBERS,
        mock_manager=m,
        progress_mock=progress,
    )
    # Room 44 (one API member) is deferred and counted as handled. The first
    # two updates are the discovering phase (one per group, S2).
    calls = progress.update.call_args_list
    assert calls[:2] == [((1,), {}), ((1,), {})]
    assert calls[2:] == [((len(API_MEMBERS),), {})]


async def test_unreadable_scan_flag_scans_room(tmp_path):
    """A corrupt scan flag treats that room as needing a scan instead of
    failing the whole sync."""
    m = _manager(scanned=True, extra=[])
    m.client.get_groups = AsyncMock(return_value=[GROUP, GROUP_B])

    def _flag(gid):
        if gid == 43:
            raise ValueError("corrupt room_43")
        return True

    m.history_scanned = MagicMock(side_effect=_flag)
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(),
            tmp_path,
            groups=[GROUP, GROUP_B],
            members=API_MEMBERS,
            mock_manager=m,
        )
    (bad,) = _events(logs, "room_scan_flag_unreadable")
    assert bad == {
        "event": "room_scan_flag_unreadable",
        "log_level": "warning",
        "group_id": 43,
        "error_type": "ValueError",
    }
    by_gid = {c.args[1]: c.kwargs for c in m.client.get_messages.await_args_list}
    assert by_gid[43].get("page_delay") == 0 and by_gid[43].get("since_ts") is None
    assert "page_delay" not in by_gid[44]
    assert _synced_group_ids(m) == [43, 44]
    m.mark_history_scanned.assert_called_once_with(43)
    assert _events(logs, "sync_complete")


# --- S2 (spec 2026-11-10): honest progress in phases 1 and 2 -----------------


async def test_discovering_moves_once_per_group(tmp_path):
    closed = {**GROUP, "id": 99, "name": "卒業", "state": "closed"}
    m = _manager(scanned=True, extra=[])
    m.client.get_groups = AsyncMock(return_value=[GROUP, closed])
    progress = MagicMock()
    await _run_start_sync(
        SyncService(),
        tmp_path,
        groups=[GROUP, closed],
        members=API_MEMBERS,
        mock_manager=m,
        progress_mock=progress,
    )
    names = [c[0] for c in progress.mock_calls]
    start = names.index("start_phase", names.index("start_phase") + 1)  # discovering
    end = names.index("start_phase", start + 1)  # syncing
    discovering = progress.mock_calls[start + 1 : end]
    assert [c for c in discovering if c[0] == "update"] == [
        ("update", (1,), {}),
        ("update", (1,), {}),
    ]


async def test_scan_room_owns_the_detail_line(tmp_path):
    """While a room's history scan holds the slot, members finishing in other
    rooms move the counter without overwriting the scanning room's detail."""
    scan_room = {**GROUP, "id": 44, "name": "櫻坂46"}
    m = _manager(scanned=True, extra=[])
    m.history_scanned = MagicMock(side_effect=lambda gid: gid != 44)
    m.client.get_groups = AsyncMock(return_value=[scan_room, GROUP])
    other_room_done = asyncio.Event()

    async def _fetch(session, gid, **kw):
        if gid == 44:
            await asyncio.wait_for(other_room_done.wait(), timeout=5)
        return []

    m.client.get_messages = AsyncMock(side_effect=_fetch)
    base = m.sync_member.side_effect

    async def _after_member(group_id):
        # Let the room loop report progress, then release the scan.
        await asyncio.sleep(0)
        other_room_done.set()

    async def _sync_member(s, g, member, q, **kw):
        n = base(s, g, member, q, **kw)
        if g["id"] == GROUP["id"]:
            asyncio.get_running_loop().create_task(_after_member(g["id"]))
        return n

    m.sync_member = AsyncMock(side_effect=_sync_member)
    progress = MagicMock()
    await _run_start_sync(
        SyncService(),
        tmp_path,
        groups=[scan_room, GROUP],
        members=API_MEMBERS,
        mock_manager=m,
        progress_mock=progress,
    )
    updates = [c for c in progress.mock_calls if c[0] == "update"]
    with_detail = [c for c in updates if c[2].get("detail")]
    bare = [c for c in updates if not c[2]]
    # 2 discovering moves + the incremental room's member during the scan.
    assert len(bare) == 3
    # After the scan released the slot, its own member set the detail.
    assert len(with_detail) == 1


# --- S3 (spec 2026-11-10): deferred backfill / letter media -------------------


def _deferring_manager():
    m = _manager(scanned=True, extra=[])

    async def _backfill(session, group, member, media_queue=None):
        media_queue.append(
            {"url": "u", "path": Path("b.jpg"), "timestamp": None, "message_id": 7}
        )
        return 0

    async def _letters(session, group, member, media_queue=None):
        media_queue.append(
            {"url": "u", "path": Path("l.jpg"), "timestamp": None, "kind": "letter"}
        )
        return 0

    m.backfill_past_messages = AsyncMock(side_effect=_backfill)
    m.sync_letters = AsyncMock(side_effect=_letters)
    m.finalize_deferred_media = MagicMock(
        return_value={
            "backfill_marked": 1,
            "letters_marked": 1,
            "still_pending": 0,
            "saved": True,
        }
    )
    return m


async def test_backfill_and_letter_media_join_phase_3_then_finalize(tmp_path):
    m = _deferring_manager()
    order: list[str] = []
    downloaded: list[list] = []

    async def _media(session, chunk, item_callback=None):
        order.append("download")
        downloaded.append(list(chunk))
        for _ in chunk:
            await item_callback(True)
        return {}

    m.process_media_queue = AsyncMock(side_effect=_media)
    m.finalize_deferred_media.side_effect = lambda: order.append("finalize") or {
        "backfill_marked": 1,
        "letters_marked": 1,
        "still_pending": 0,
        "saved": True,
    }
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
        )

    # Phase 2 only queued them (media_queue passed); phase 3 downloaded them.
    assert m.backfill_past_messages.await_args.kwargs["media_queue"] is not None
    assert m.sync_letters.await_args.kwargs["media_queue"] is not None
    assert [i["path"].name for i in downloaded[0]] == ["b.jpg", "l.jpg"]
    assert order == ["download", "finalize"]
    (p2,) = _events(logs, "phase2_complete")
    assert p2["deferred_media_items"] == 2
    (fin,) = _events(logs, "deferred_media_finalized")
    assert (fin["items"], fin["backfill_marked"], fin["saved"]) == (2, 1, True)


async def test_failed_downloads_count_as_processed(tmp_path):
    m = _deferring_manager()

    async def _media(session, chunk, item_callback=None):
        await item_callback(True)
        await item_callback(False)
        return {}

    m.process_media_queue = AsyncMock(side_effect=_media)
    progress = MagicMock()
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(),
            tmp_path,
            groups=[GROUP],
            members=API_MEMBERS,
            mock_manager=m,
            progress_mock=progress,
        )

    progress.add_failed.assert_called_once_with()
    assert progress.set_completed.call_args_list[-1].args == (2,)
    (p3,) = _events(logs, "phase3_complete")
    assert (p3["downloaded"], p3["failed"]) == (1, 1)


async def test_cancelled_media_phase_skips_finalize_with_a_breadcrumb(tmp_path):
    m = _deferring_manager()
    m.process_media_queue = AsyncMock(side_effect=asyncio.CancelledError())
    with capture_logs() as logs:
        with pytest.raises(asyncio.CancelledError):
            await _run_start_sync(
                SyncService(),
                tmp_path,
                groups=[GROUP],
                members=API_MEMBERS,
                mock_manager=m,
            )
    m.finalize_deferred_media.assert_not_called()
    (skip,) = _events(logs, "deferred_media_finalize_skipped")
    assert (skip["items"], skip["reason"]) == (2, "cancelled")


async def test_failing_finalize_never_fails_the_sync(tmp_path):
    m = _deferring_manager()
    m.process_media_queue = AsyncMock(return_value={})
    m.finalize_deferred_media.side_effect = OSError("disk")
    with capture_logs() as logs:
        result = await _run_start_sync(
            SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m
        )
    assert result is True
    (warn,) = _events(logs, "deferred_media_finalize_failed")
    assert warn["error_type"] == "OSError"


async def test_stale_running_flag_ends_the_run_visibly(tmp_path):
    """A stale running flag (the coordinator runs one job at a time) must not
    leave the tracker at "Starting" forever."""
    from backend.api.progress import progress_manager

    svc = SyncService(service="yodel")
    svc.running = True
    with capture_logs() as logs:
        assert await svc.start_sync() is False
    assert progress_manager.get("yodel").get_status()["error_code"] == "already_running"
    assert _events(logs, "sync_skipped")[0]["reason"] == "already_running"
    with capture_logs() as logs:
        await svc.verify_and_fix_media()
    assert _events(logs, "verify_skipped")[0]["reason"] == "already_running"
