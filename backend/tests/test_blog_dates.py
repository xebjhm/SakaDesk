"""One bad remote blog date must not stop a whole group's blog sync (security audit 2026-11-13).

blog_service.sync_blog_metadata:null-published_at-poisons-service-sync: pysaka
yields published_at=None for a date it cannot parse; SakaDesk stored the null,
then every later sync (max() / fromisoformat) and every reader ([:10], sort)
raised TypeError for the whole group, and the index was never saved again.
"""

from __future__ import annotations

from datetime import datetime, timezone
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
    scraper = _scraper({"1": [], "2": [_entry("b10", JST_POST)]})
    index = await _sync(legacy, scraper)
    assert [b["id"] for b in index["members"]["2"]["blogs"]] == ["b9", "b10"]


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
