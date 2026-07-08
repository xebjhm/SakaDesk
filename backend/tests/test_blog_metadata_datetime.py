"""Regression: sync_blog_metadata must not raise UnboundLocalError on first sync.

The inner sync_member() referenced `datetime` unconditionally (isinstance check)
while only importing it inside an `if not is_first_sync` branch. A local import
makes `datetime` a function-local for the whole scope, so a first sync (branch
skipped) hit an unbound local -> "cannot access local variable 'datetime'".
That crashed blog metadata sync for every service, so blogs never loaded.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.services.blog_service import BlogService


async def _one_entry_metadata(
    member_id, since_date=None, max_pages=None, member_name=None
):
    # A single NEW blog with a thumbnail so the needs_detail path is skipped.
    yield SimpleNamespace(
        id="b1",
        title="First Post",
        published_at="2026-07-01T00:00:00",
        url="https://example.test/b1",
        images=["https://example.test/thumb.jpg"],
    )


@pytest.mark.asyncio
async def test_sync_blog_metadata_first_sync_no_unbound_datetime(tmp_path):
    svc = BlogService()

    scraper = MagicMock()
    scraper.get_members = AsyncMock(return_value={"1": "Member One"})
    scraper.get_blogs_metadata = _one_entry_metadata
    scraper.get_blog_detail_metadata = AsyncMock(return_value=(None, None, None))

    saved = {}

    async def fake_save(service, index, *, merge=True):
        saved["index"] = index

    with (
        # Empty members -> is_first_sync=True -> the buggy branch is skipped.
        patch.object(
            svc, "load_blog_index", new_callable=AsyncMock, return_value={"members": {}}
        ),
        patch.object(svc, "save_blog_index", new=fake_save),
        patch("backend.services.blog_service.get_scraper", return_value=scraper),
    ):
        result = await svc.sync_blog_metadata("hinatazaka46")

    # Must have completed and recorded the new blog (no UnboundLocalError).
    blogs = result["members"]["1"]["blogs"]
    assert [b["id"] for b in blogs] == ["b1"]
    assert result["members"]["1"]["blogs"][0]["published_at"] == "2026-07-01T00:00:00"
    assert "last_sync" in result
