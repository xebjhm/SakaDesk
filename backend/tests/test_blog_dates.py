"""One bad remote blog date must not stop a whole group's blog sync (security audit 2026-11-13).

blog_service.sync_blog_metadata:null-published_at-poisons-service-sync: pysaka
yields published_at=None for a date it cannot parse; SakaDesk stored the null,
then every later sync (max() / fromisoformat) and every reader ([:10], sort)
raised TypeError for the whole group, and the index was never saved again.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app
from backend.services.blog_service import BlogService, _parse_published

client = TestClient(app)
JST_POST = datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _fresh_row_skip_budget():
    """``blog_rows_skipped`` is throttled process-wide; each test starts with a full budget."""
    from backend.services import blog_service

    blog_service._row_skip_logs.reset()


def _entry(blog_id, published_at, thumb="https://cdn.hinatazaka46.com/t.jpg"):
    return SimpleNamespace(
        id=blog_id,
        title=f"title {blog_id}",
        published_at=published_at,
        url=f"https://www.hinatazaka46.com/s/official/diary/detail/{blog_id}",
        images=[thumb] if thumb else [],
    )


def _scraper(entries_by_member, detail=(None, None, None), members=None):
    scraper = MagicMock()
    scraper.get_members = AsyncMock(
        return_value=members or {m: f"name {m}" for m in entries_by_member}
    )

    async def metadata(member_id, since_date=None, max_pages=None, member_name=None):
        value = entries_by_member[member_id]
        if isinstance(value, Exception):
            raise value
        for entry in value:
            yield entry

    scraper.get_blogs_metadata = metadata
    scraper.get_blog_detail_metadata = AsyncMock(return_value=detail)
    return scraper


async def _sync(index, scraper):
    svc = BlogService()
    saved = {}

    async def fake_save(service, idx, *, merge=True):
        saved["index"] = idx

    with (
        patch.object(
            svc, "load_blog_index", new_callable=AsyncMock, return_value=index
        ),
        patch.object(svc, "save_blog_index", new=fake_save),
        patch("backend.services.blog_service.get_scraper", return_value=scraper),
    ):
        await svc.sync_blog_metadata("hinatazaka46")
    return saved.get("index")


@pytest.mark.parametrize(
    "value,expected",
    [
        (
            "2026-11-01T12:00:00+09:00",
            datetime.fromisoformat("2026-11-01T12:00:00+09:00"),
        ),
        ("2026-11-01T03:00:00Z", datetime(2026, 11, 1, 3, tzinfo=timezone.utc)),
        ("2026-11-01T03:00:00", datetime(2026, 11, 1, 3, tzinfo=timezone.utc)),
        (None, None),
        ("", None),
        ("2026.11.1", None),
        (20261101, None),
    ],
)
def test_parse_published(value, expected):
    assert _parse_published(value) == expected


@pytest.mark.asyncio
async def test_an_unknown_date_is_not_stored_and_the_other_members_are():
    scraper = _scraper({"1": [_entry("b1", None)], "2": [_entry("b2", JST_POST)]})
    with capture_logs() as logs:
        index = await _sync({"members": {}}, scraper)
    assert index["members"]["1"]["blogs"] == []
    assert [b["id"] for b in index["members"]["2"]["blogs"]] == ["b2"]
    assert index["members"]["2"]["blogs"][0]["published_at"] == JST_POST.isoformat()
    skipped = [e for e in logs if e["event"] == "blog_entry_skipped"]
    assert skipped == [
        {
            "event": "blog_entry_skipped",
            "service": "hinatazaka46",
            "reason": "unparsed_date",
            "count": 1,
            "log_level": "warning",
        }
    ]
    scraper.get_blog_detail_metadata.assert_awaited_once_with("b1")


@pytest.mark.asyncio
async def test_an_unknown_list_date_is_taken_from_the_detail_page():
    scraper = _scraper({"1": [_entry("b1", None)]}, detail=(None, JST_POST, None))
    index = await _sync({"members": {}}, scraper)
    assert index["members"]["1"]["blogs"][0]["published_at"] == JST_POST.isoformat()


@pytest.mark.asyncio
async def test_a_stored_null_no_longer_breaks_the_incremental_sync():
    legacy = {
        "members": {
            "1": {
                "name": "name 1",
                "blogs": [
                    {
                        "id": "b0",
                        "title": "t",
                        "published_at": None,
                        "url": "u",
                        "thumbnail": None,
                    }
                ],
            },
            "2": {
                "name": "name 2",
                "blogs": [
                    {
                        "id": "b9",
                        "title": "t",
                        "published_at": "2026-10-01T00:00:00+09:00",
                        "url": "u",
                        "thumbnail": None,
                    }
                ],
            },
        }
    }
    scraper = _scraper({"1": [_entry("b1", JST_POST)], "2": [_entry("b10", JST_POST)]})
    with capture_logs() as logs:
        index = await _sync(legacy, scraper)
    assert [b["id"] for b in index["members"]["2"]["blogs"]] == ["b9", "b10"]
    assert [b["id"] for b in index["members"]["1"]["blogs"]] == ["b0", "b1"]
    assert not [e for e in logs if e["event"] == "blog_member_sync_failed"]


@pytest.mark.asyncio
async def test_one_failing_member_does_not_abort_the_others():
    scraper = _scraper(
        {"1": RuntimeError("C:\\Users\\victim"), "2": [_entry("b2", JST_POST)]}
    )
    with capture_logs() as logs:
        index = await _sync({"members": {}}, scraper)
    assert [b["id"] for b in index["members"]["2"]["blogs"]] == ["b2"]
    failed = [e for e in logs if e["event"] == "blog_member_sync_failed"]
    assert [e["error_type"] for e in failed] == ["RuntimeError"]
    assert "victim" not in repr(logs)


@pytest.mark.asyncio
async def test_titles_urls_and_thumbnails_are_stored_as_text():
    entry = SimpleNamespace(
        id="b1", title=None, published_at=JST_POST, url=7, images=[42]
    )
    index = await _sync({"members": {}}, _scraper({"1": [entry]}))
    row = index["members"]["1"]["blogs"][0]
    assert (row["title"], row["url"], row["thumbnail"]) == ("", "", None)


LEGACY_INDEX = {
    "members": {
        "1": {
            "name": "金村 美玖",
            "blogs": [
                {
                    "id": "good",
                    "title": "春🌸",
                    "published_at": "2026-11-01T12:00:00+09:00",
                    "url": "u",
                    "thumbnail": None,
                },
                {
                    "id": "null",
                    "title": "t",
                    "published_at": None,
                    "url": "u",
                    "thumbnail": None,
                },
                {
                    "id": "notitle",
                    "title": None,
                    "published_at": "2026-10-01T12:00:00+09:00",
                    "url": None,
                    "thumbnail": 5,
                },
                {
                    "id": "../x",
                    "title": "t",
                    "published_at": "2026-09-01T12:00:00+09:00",
                    "url": "u",
                    "thumbnail": None,
                },
                "not a row",
            ],
        }
    }
}


@pytest.fixture
def legacy_svc(tmp_path):
    svc = BlogService()
    with (
        patch.object(
            svc, "load_blog_index", new_callable=AsyncMock, return_value=LEGACY_INDEX
        ),
        patch.object(svc, "get_blogs_base_path", return_value=tmp_path),
    ):
        yield svc


@pytest.mark.asyncio
async def test_readers_skip_unreadable_rows(legacy_svc):
    with capture_logs() as logs:
        recent = await legacy_svc.get_recent_posts("hinatazaka46")
        listing = await legacy_svc.get_blog_list("hinatazaka46", "1")
        stats = await legacy_svc.get_cache_stats("hinatazaka46")
        queue = legacy_svc.build_download_queue("hinatazaka46", LEGACY_INDEX)
    assert [p["id"] for p in recent] == ["good", "notitle", "../x"]
    assert (
        recent[1]["title"] == ""
        and recent[1]["url"] == ""
        and recent[1]["thumbnail"] is None
    )
    assert [b["id"] for b in listing["blogs"]] == ["good", "notitle", "../x"]
    assert listing["blogs"][2]["cached"] is False  # unsafe id: listed, never a folder
    assert stats["total_blogs"] == 3
    assert [item.blog_id for item in queue] == ["good", "notitle"]
    assert any(e["event"] == "blog_rows_skipped" and e["count"] == 2 for e in logs)
    assert "金村" not in repr(logs)


def test_the_blog_routes_answer_200_for_an_index_with_a_null_date():
    with patch(
        "backend.api.blogs.blog_service.load_blog_index",
        new_callable=AsyncMock,
        return_value=LEGACY_INDEX,
    ):
        recent = client.get("/api/blogs/recent?service=hinatazaka46")
        image = client.get(
            "/api/blogs/image?service=hinatazaka46&blog_id=null&filename=img_0.jpg"
        )
    assert recent.status_code == 200
    assert [p["id"] for p in recent.json()["posts"]] == ["good", "notitle", "../x"]
    assert image.status_code == 404


def test_the_image_route_refuses_a_file_name_with_a_trailing_newline():
    resp = client.get(
        "/api/blogs/image?service=hinatazaka46&blog_id=good&filename=img_0.jpg%0A"
    )
    assert resp.status_code == 400


# --- Task 2: the incremental cursor ----------------------------------------

from backend.services.blog_service import (  # noqa: E402
    _incremental_cursor,
    _merge_blog_index,
)

NOW = datetime(2026, 11, 13, 0, 0, tzinfo=timezone.utc)


def test_the_cursor_ignores_future_and_unparseable_rows():
    rows = [
        {"published_at": "2099-01-24T16:03:00+09:00"},
        {"published_at": None},
        {"published_at": "2026-11-10T08:00:00+09:00"},
        {"published_at": "2026-11-13T20:00:00+00:00"},  # within the one-day skew
        "junk",
    ]
    cursor, ignored = _incremental_cursor(rows, NOW)
    assert cursor == datetime(2026, 11, 13, 20, tzinfo=timezone.utc)
    assert ignored == 3


def test_no_usable_row_means_no_cursor():
    assert _incremental_cursor([{"published_at": "2099-01-01T00:00:00Z"}], NOW) == (
        None,
        1,
    )
    assert _incremental_cursor([], NOW) == (None, 0)


@pytest.mark.asyncio
async def test_a_future_dated_row_does_not_stop_new_posts():
    stored = {
        "members": {
            "1": {
                "name": "name 1",
                "blogs": [
                    {
                        "id": "b-future",
                        "title": "t",
                        "published_at": "2099-01-24T16:03:00+09:00",
                        "url": "u",
                        "thumbnail": None,
                    },
                    {
                        "id": "b-old",
                        "title": "t",
                        "published_at": "2026-10-01T00:00:00+09:00",
                        "url": "u",
                        "thumbnail": None,
                    },
                ],
            }
        }
    }
    seen = {}
    scraper = _scraper({"1": [_entry("b-new", JST_POST)]})
    original = scraper.get_blogs_metadata

    async def spy(member_id, since_date=None, max_pages=None, member_name=None):
        seen["since"] = since_date
        async for entry in original(member_id, since_date, max_pages, member_name):
            yield entry

    scraper.get_blogs_metadata = spy
    with capture_logs() as logs:
        index = await _sync(stored, scraper)
    assert seen["since"] == datetime.fromisoformat("2026-10-01T00:00:00+09:00")
    assert [b["id"] for b in index["members"]["1"]["blogs"]][-1] == "b-new"
    assert {
        "event": "blog_cursor_rows_ignored",
        "service": "hinatazaka46",
        "count": 1,
        "log_level": "info",
    } in logs


# --- Task 2: posts skipped for an unknown date are retried -------------------


def _row(blog_id, published_at):
    return {
        "id": blog_id,
        "title": "t",
        "published_at": published_at,
        "url": "u",
        "thumbnail": None,
    }


def _by_id_detail(table):
    async def detail(blog_id):
        return table.get(blog_id, (None, None, None))

    return detail


@pytest.mark.asyncio
async def test_a_skipped_post_is_retried_after_a_newer_post_moved_the_cursor():
    stored = {
        "members": {
            "1": {"name": "name 1", "blogs": [_row("b9", "2026-10-01T00:00:00+09:00")]}
        }
    }
    scraper = _scraper({"1": [_entry("b-skip", None), _entry("b-new", JST_POST)]})
    first = await _sync(stored, scraper)
    member = first["members"]["1"]
    assert [b["id"] for b in member["blogs"]] == ["b9", "b-new"]
    assert [p["id"] for p in member["pending_dates"]] == ["b-skip"]

    later = _scraper({"1": []})  # the list no longer reaches b-skip
    later.get_blog_detail_metadata = AsyncMock(
        side_effect=_by_id_detail({"b-skip": (None, JST_POST, "dated")})
    )
    with capture_logs() as logs:
        second = await _sync(first, later)
    member = second["members"]["1"]
    assert [b["id"] for b in member["blogs"]] == ["b9", "b-new", "b-skip"]
    assert member["blogs"][-1]["published_at"] == JST_POST.isoformat()
    assert member["blogs"][-1]["title"] == "dated"
    assert member["pending_dates"] == []
    assert "b-skip" not in repr(logs)


@pytest.mark.asyncio
async def test_a_still_undated_pending_post_counts_an_attempt():
    stored = {
        "members": {
            "1": {"name": "name 1", "blogs": [_row("b9", "2026-10-01T00:00:00+09:00")]}
        }
    }
    scraper = _scraper({"1": [_entry("b-skip", None)]})
    first = await _sync(stored, scraper)
    assert first["members"]["1"]["pending_dates"][0]["attempts"] == 0
    second = await _sync(first, _scraper({"1": []}))
    assert second["members"]["1"]["pending_dates"][0]["attempts"] == 1


def _pending(blog_id, attempts=0, age_days=0):
    seen = datetime.now(timezone.utc) - timedelta(days=age_days)
    return {
        "id": blog_id,
        "first_seen": seen.isoformat(),
        "attempts": attempts,
        "title": "t",
        "url": "u",
        "thumbnail": None,
    }


def _with_pending(pending):
    return {
        "members": {
            "1": {
                "name": "name 1",
                "blogs": [_row("b9", "2026-10-01T00:00:00+09:00")],
                "pending_dates": pending,
            }
        }
    }


@pytest.mark.asyncio
async def test_pending_retries_are_bounded_and_rotate():
    scraper = _scraper({"1": []})
    index = await _sync(_with_pending([_pending(f"p{i}") for i in range(25)]), scraper)
    assert scraper.get_blog_detail_metadata.await_count == 10
    pending = index["members"]["1"]["pending_dates"]
    assert [p["id"] for p in pending][:15] == [f"p{i}" for i in range(10, 25)]
    assert [p["attempts"] for p in pending] == [0] * 15 + [1] * 10


@pytest.mark.asyncio
async def test_a_failed_pending_retry_leaves_a_breadcrumb_and_costs_no_attempt():
    """A network error says nothing about the post's date, so it is not one of
    the five tries; the log names the error class only (no URL, no text)."""
    scraper = _scraper({"1": []})
    scraper.get_blog_detail_metadata = AsyncMock(
        side_effect=ConnectionError("https://example.invalid/secret-path")
    )
    with capture_logs() as logs:
        index = await _sync(_with_pending([_pending("p1", attempts=2)]), scraper)
    pending = index["members"]["1"]["pending_dates"]
    assert [(p["id"], p["attempts"]) for p in pending] == [("p1", 2)]
    failed = [e for e in logs if e["event"] == "blog_pending_retry_failed"]
    assert len(failed) == 1
    assert failed[0]["error_type"] == "ConnectionError"
    assert "secret-path" not in repr(logs) and "p1" not in repr(failed)


@pytest.mark.asyncio
async def test_an_answered_but_undated_pending_retry_still_counts():
    scraper = _scraper({"1": []})
    index = await _sync(_with_pending([_pending("p1", attempts=2)]), scraper)
    assert index["members"]["1"]["pending_dates"][0]["attempts"] == 3


@pytest.mark.asyncio
async def test_a_failed_detail_fetch_logs_the_error_class_only():
    """aiohttp error text carries URLs, so only the class goes to the log."""
    scraper = _scraper(
        {"1": [_entry("b-new", "2026-11-01T00:00:00+09:00", thumb=None)]}
    )
    scraper.get_blog_detail_metadata = AsyncMock(
        side_effect=ConnectionError("https://example.invalid/secret-path")
    )
    with capture_logs() as logs:
        await _sync(_with_pending([]), scraper)
    failed = [e for e in logs if e["event"] == "detail_metadata_failed"]
    assert len(failed) == 1
    assert failed[0]["error_type"] == "ConnectionError"
    assert "error" not in failed[0]
    assert "secret-path" not in repr(logs)


@pytest.mark.asyncio
async def test_pending_entries_expire_by_attempts_and_age():
    scraper = _scraper({"1": []})
    pending = [
        _pending("tired", attempts=4),
        _pending("old", age_days=31),
        _pending("ok"),
    ]
    with capture_logs() as logs:
        index = await _sync(_with_pending(pending), scraper)
    assert [p["id"] for p in index["members"]["1"]["pending_dates"]] == ["ok"]
    dropped = {
        e["reason"]: e["count"] for e in logs if e["event"] == "blog_pending_dropped"
    }
    assert dropped == {"attempts": 1, "expired": 1}
    assert "tired" not in repr(logs) and "old" not in repr(logs)


@pytest.mark.asyncio
async def test_pending_list_is_capped_and_unsafe_ids_dropped():
    entries = [_entry(f"s{i}", None) for i in range(60)]
    scraper = _scraper({"1": entries})
    with capture_logs() as logs:
        index = await _sync(_with_pending([_pending("../evil")]), scraper)
    pending = index["members"]["1"]["pending_dates"]
    assert len(pending) == 50
    assert "../evil" not in [p["id"] for p in pending]
    assert pending[-1]["id"] == "s59"  # the oldest were dropped
    dropped = {
        e["reason"]: e["count"] for e in logs if e["event"] == "blog_pending_dropped"
    }
    assert dropped == {"invalid": 1, "cap": 10}


def test_merge_keeps_pending_dates_and_drops_stored_ids():
    current = {"members": {"1": {"blogs": [], "pending_dates": [_pending("p1")]}}}
    incoming = {"members": {"1": {"blogs": [_row("p2", "2026-11-01T00:00:00Z")]}}}
    merged = _merge_blog_index(current, incoming)
    assert [p["id"] for p in merged["members"]["1"]["pending_dates"]] == ["p1"]
    incoming = {"members": {"1": {"blogs": [_row("p1", "2026-11-01T00:00:00Z")]}}}
    merged = _merge_blog_index(current, incoming)
    assert merged["members"]["1"]["pending_dates"] == []


@pytest.mark.asyncio
async def test_readers_ignore_pending_dates(legacy_svc):
    member = LEGACY_INDEX["members"]["1"]
    member["pending_dates"] = [_pending("p1")]
    try:
        listing = await legacy_svc.get_blog_list("hinatazaka46", "1")
        stats = await legacy_svc.get_cache_stats("hinatazaka46")
    finally:
        del member["pending_dates"]
    assert [b["id"] for b in listing["blogs"]] == ["good", "notitle", "../x"]
    assert stats["total_blogs"] == 3


# --- Task 2: failed members are counted --------------------------------------


@pytest.mark.asyncio
async def test_failed_members_are_counted_once():
    scraper = _scraper({"1": RuntimeError("x"), "2": [_entry("b2", JST_POST)]})
    progress = []

    async def on_progress(text):
        progress.append(text)

    svc = BlogService()
    saved = {}

    async def fake_save(service, idx, *, merge=True):
        saved["index"] = idx

    with (
        capture_logs() as logs,
        patch.object(
            svc, "load_blog_index", new_callable=AsyncMock, return_value={"members": {}}
        ),
        patch.object(svc, "save_blog_index", new=fake_save),
        patch("backend.services.blog_service.get_scraper", return_value=scraper),
    ):
        result = await svc.sync_blog_metadata("hinatazaka46", on_progress)
    assert {
        "event": "blog_sync_members_failed",
        "service": "hinatazaka46",
        "count": 1,
        "log_level": "warning",
    } in logs
    assert result["last_sync"] is not None and "sync_failed" not in result
    assert saved["index"] is result
    assert sorted(p.split("(")[1] for p in progress) == ["1/2)", "2/2)"]


@pytest.mark.asyncio
async def test_when_every_member_fails_last_sync_is_not_stamped():
    scraper = _scraper({"1": RuntimeError("x"), "2": ValueError("y")})
    svc = BlogService()
    save = AsyncMock()
    with (
        capture_logs() as logs,
        patch.object(
            svc,
            "load_blog_index",
            new_callable=AsyncMock,
            return_value={"members": {}, "last_sync": None},
        ),
        patch.object(svc, "save_blog_index", new=save),
        patch("backend.services.blog_service.get_scraper", return_value=scraper),
    ):
        result = await svc.sync_blog_metadata("hinatazaka46")
    assert result["sync_failed"] is True
    assert result.get("last_sync") is None
    save.assert_not_awaited()
    assert any(
        e["event"] == "blog_sync_members_failed" and e["count"] == 2 for e in logs
    )


@pytest.mark.asyncio
async def test_the_sync_route_reports_a_failed_sync():
    with patch(
        "backend.api.blogs.blog_service.sync_blog_metadata",
        new=AsyncMock(return_value={"members": {}, "sync_failed": True}),
    ):
        response = client.post("/api/blogs/sync?service=hinatazaka46")
    assert response.status_code == 502


@pytest.mark.asyncio
async def test_a_failed_sync_stops_the_full_backup_before_stage_two():
    svc = BlogService()
    with (
        patch.object(
            svc,
            "sync_blog_metadata",
            new=AsyncMock(return_value={"members": {}, "sync_failed": True}),
        ),
        patch.object(svc, "download_blog_content", new=AsyncMock()) as stage2,
    ):
        result = await svc.sync_full_backup("hinatazaka46")
    assert result == {"sync_failed": True}
    stage2.assert_not_awaited()


# --- Task 2: cancelling the whole sync ----------------------------------------


@pytest.mark.asyncio
async def test_a_cancel_event_skips_the_index_save():
    import threading

    cancel = threading.Event()
    scraper = _scraper({"1": [_entry("b1", JST_POST)]})
    original = scraper.get_blogs_metadata

    async def metadata(*args, **kwargs):
        cancel.set()
        async for entry in original(*args, **kwargs):
            yield entry

    scraper.get_blogs_metadata = metadata
    svc = BlogService()
    save = AsyncMock()
    with (
        patch.object(
            svc, "load_blog_index", new_callable=AsyncMock, return_value={"members": {}}
        ),
        patch.object(svc, "save_blog_index", new=save),
        patch("backend.services.blog_service.get_scraper", return_value=scraper),
    ):
        await svc.sync_blog_metadata("hinatazaka46", cancel_event=cancel)
    save.assert_not_awaited()


@pytest.mark.asyncio
async def test_cancelling_the_task_propagates_and_skips_the_save():
    import asyncio

    started = asyncio.Event()
    scraper = _scraper({"1": []})

    async def hang(*args, **kwargs):
        started.set()
        await asyncio.sleep(60)
        yield  # pragma: no cover

    scraper.get_blogs_metadata = hang
    svc = BlogService()
    save = AsyncMock()
    with (
        patch.object(
            svc, "load_blog_index", new_callable=AsyncMock, return_value={"members": {}}
        ),
        patch.object(svc, "save_blog_index", new=save),
        patch("backend.services.blog_service.get_scraper", return_value=scraper),
    ):
        task = asyncio.create_task(svc.sync_blog_metadata("hinatazaka46"))
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    save.assert_not_awaited()
