"""Remote blog and member codes never leave the blogs folder (security audit 2026-11-13,
backend/services/blog_service.py:remote-blog-identifiers-as-path-segments).

pysaka passes the Nogizaka46 JSON ``code`` and member names through unchanged;
the blog writers joined them into folder names, so a code like
``y/../../../../../escape_target/v3blogdir`` wrote blog.json and images outside
the archive. Codes must now be safe ids and names plain segments, at the sync
that receives them and again wherever a folder is built from the index.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app
from backend.services.blog_service import BlogService, _blog_folder, _safe_blog_members
from backend.services.safe_paths import UnsafePath

client = TestClient(app)

ESCAPE_BLOG = "y/../../../../../escape_target/v3blogdir"
ESCAPE_MEMBER = "../../../../escape_target/v3thumb"


def _events(logs, name):
    return [e for e in logs if e["event"] == name]


class TestBlogFolder:
    def test_a_normal_blog_folder(self, tmp_path):
        assert _blog_folder(tmp_path, " 金村 美玖 ", "102345", "20260101") == (
            tmp_path / "金村 美玖" / "20260101_102345"
        )

    def test_a_slash_in_a_name_still_becomes_an_underscore(self, tmp_path):
        assert _blog_folder(tmp_path, "a/b", "1", "20260101").parent.name == "a_b"

    @pytest.mark.parametrize(
        "blog_id", [ESCAPE_BLOG, "..", "C:x", "a\\b", "CON", "", 7]
    )
    def test_an_unsafe_blog_id_is_refused(self, tmp_path, blog_id):
        with pytest.raises(UnsafePath) as exc:
            _blog_folder(tmp_path, "金村 美玖", blog_id, "20260101")
        assert exc.value.reason == "blog_id"

    @pytest.mark.parametrize(
        "name", ["..", "..\\..\\AppData\\Roaming\\x", "C:\\x", "CON", "", None, "a."]
    )
    def test_an_unsafe_member_name_is_refused(self, tmp_path, name):
        with pytest.raises(UnsafePath) as exc:
            _blog_folder(tmp_path, name, "1", "20260101")
        assert exc.value.reason == "segment"

    def test_a_date_that_leaves_is_refused(self, tmp_path):
        with pytest.raises(UnsafePath):
            _blog_folder(tmp_path, "金村 美玖", "1", "../../x")

    @pytest.mark.parametrize(
        "name", ["長濱 ねる", "ゆっかー・みくにん", "ポカ：ねる", "ＫＡＮＡ　ＭＩＫＵ"]
    )
    def test_real_member_name_forms_are_kept_as_folders(self, tmp_path, name):
        assert _blog_folder(tmp_path, name, "1", "20260101") == (
            tmp_path / name / "20260101_1"
        )


class TestSafeBlogMembers:
    @pytest.mark.parametrize("members", [None, [], "x", [("1", "a")], 7])
    def test_a_value_that_is_not_a_mapping_gives_nothing_and_logs_the_reason(
        self, members
    ):
        with capture_logs() as logs:
            assert _safe_blog_members("nogizaka46", members) == {}
        assert _events(logs, "blog_remote_rejected") == [
            {
                "event": "blog_remote_rejected",
                "log_level": "warning",
                "service": "nogizaka46",
                "kind": "member",
                "reason": "not_mapping",
            }
        ]

    def test_real_member_name_forms_are_kept_without_a_log(self):
        members = {"1": "長濱 ねる", "2": "ゆっかー・みくにん", "3": "ポカ：ねる"}
        with capture_logs() as logs:
            assert _safe_blog_members("nogizaka46", members) == members
        assert not _events(logs, "blog_remote_rejected")


async def _metadata(member_id, since_date=None, max_pages=None, member_name=None):
    for code in ("102345", ESCAPE_BLOG):
        yield SimpleNamespace(
            id=code,
            title="t",
            published_at="2026-01-09T10:00:00+09:00",
            url="https://www.nogizaka46.com/s/n46/diary/detail/1",
            images=["https://img.nogizaka46.com/main.jpg"],
        )


@pytest.mark.asyncio
async def test_metadata_sync_stores_only_safe_members_and_blogs():
    svc = BlogService()
    scraper = MagicMock()
    scraper.get_members = AsyncMock(
        return_value={
            "55401": "金村 美玖",
            ESCAPE_MEMBER: "Evil Member",
            "55402": "..\\..\\AppData\\Roaming\\x",
            "55403": "CON",
        }
    )
    scraper.get_blogs_metadata = _metadata
    scraper.get_blog_detail_metadata = AsyncMock(return_value=(None, None, None))
    saved = {}

    async def fake_save(service, index, *, merge=True):
        saved["index"] = index

    with (
        patch.object(
            svc, "load_blog_index", new_callable=AsyncMock, return_value={"members": {}}
        ),
        patch.object(svc, "save_blog_index", new=fake_save),
        patch("backend.services.blog_service.get_scraper", return_value=scraper),
        capture_logs() as logs,
    ):
        result = await svc.sync_blog_metadata("nogizaka46")

    assert list(result["members"]) == ["55401"]
    assert [b["id"] for b in result["members"]["55401"]["blogs"]] == ["102345"]
    rejected = {e["kind"]: e["count"] for e in _events(logs, "blog_remote_rejected")}
    assert rejected == {"member": 3, "blog": 1}
    assert "escape_target" not in str(logs) and "Evil" not in str(logs)


def _index():
    return {
        "members": {
            "58": {
                "name": "金村 美玖",
                "blogs": [
                    {
                        "id": "1",
                        "title": "ok",
                        "published_at": "2026-01-01T00:00:00+09:00",
                        "url": "u1",
                    },
                    {
                        "id": ESCAPE_BLOG,
                        "title": "bad",
                        "published_at": "2026-01-02T00:00:00+09:00",
                        "url": "u2",
                    },
                ],
            },
            "59": {
                "name": "..\\..\\AppData\\x",
                "blogs": [
                    {
                        "id": "2",
                        "title": "bad name",
                        "published_at": "2026-01-03T00:00:00+09:00",
                        "url": "u3",
                    }
                ],
            },
        }
    }


def test_download_queue_skips_unsafe_entries_and_logs_a_count(tmp_path):
    svc = BlogService()
    with (
        patch.object(svc, "get_blogs_base_path", return_value=tmp_path),
        capture_logs() as logs,
    ):
        queue = svc.build_download_queue("nogizaka46", _index())
    assert [i.blog_id for i in queue] == ["1"]
    assert queue[0].cache_path == tmp_path / "金村 美玖" / "20260101_1"
    (event,) = _events(logs, "blog_path_rejected")
    assert (event["where"], event["count"]) == ("download_queue", 2)


def test_blog_list_and_stats_count_unsafe_entries_as_not_cached(tmp_path):
    svc = BlogService()
    index = _index()
    with (
        patch.object(svc, "get_blogs_base_path", return_value=tmp_path),
        patch.object(
            svc, "load_blog_index", new_callable=AsyncMock, return_value=index
        ),
        capture_logs() as logs,
    ):
        listing = asyncio.run(svc.get_blog_list("nogizaka46", "58"))
        stats = asyncio.run(svc.get_cache_stats("nogizaka46"))
    assert {b["id"]: b["cached"] for b in listing["blogs"]} == {
        "1": False,
        ESCAPE_BLOG: False,
    }
    assert stats["cached_blogs"] == 0
    assert sorted(e["where"] for e in _events(logs, "blog_path_rejected")) == [
        "list",
        "stats",
    ]
    assert list(tmp_path.iterdir()) == []


def test_an_unsafe_blog_is_never_fetched_or_written(tmp_path):
    svc = BlogService()
    with (
        patch.object(svc, "get_blogs_base_path", return_value=tmp_path),
        patch.object(
            svc, "load_blog_index", new_callable=AsyncMock, return_value=_index()
        ),
        patch("backend.services.blog_service.get_scraper") as get_scraper,
        capture_logs() as logs,
    ):
        with pytest.raises(UnsafePath):
            asyncio.run(svc.get_blog_content("nogizaka46", ESCAPE_BLOG))
    get_scraper.assert_not_called()
    assert list(tmp_path.iterdir()) == []
    (event,) = _events(logs, "blog_path_rejected")
    assert (event["where"], event["reason"]) == ("content", "blog_id")


@pytest.mark.parametrize("route", ["content", "image"])
def test_the_blog_routes_answer_404_for_an_unsafe_blog(tmp_path, route):
    from backend.api import blogs

    params = {"service": "nogizaka46", "blog_id": ESCAPE_BLOG}
    if route == "image":
        params["filename"] = "img_0.jpg"
    with (
        patch.object(blogs.blog_service, "get_blogs_base_path", return_value=tmp_path),
        patch.object(
            blogs.blog_service,
            "load_blog_index",
            new_callable=AsyncMock,
            return_value=_index(),
        ),
        patch("backend.services.blog_service.get_scraper") as get_scraper,
    ):
        response = client.get(f"/api/blogs/{route}", params=params)
    assert response.status_code == 404
    get_scraper.assert_not_called()
    assert list(tmp_path.iterdir()) == []
