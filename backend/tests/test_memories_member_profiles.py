import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from backend.services.memories import member_profiles as mp

NOW = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_refresh_writes_normalized(tmp_path):
    scraper = AsyncMock()
    scraper.get_member_birthdays = AsyncMock(return_value={"金村 美玖": "2002-09-10"})
    with patch.object(mp, "_scraper_for", return_value=scraper):
        assert (
            await mp.refresh_member_profiles("hinatazaka46", tmp_path, now=NOW) is True
        )
    data = json.loads(
        (tmp_path / "memories" / "member_profiles.json").read_text(encoding="utf-8")
    )
    assert data["birthdays"] == {"金村美玖": "2002-09-10"}
    assert mp.load_birthdays(tmp_path) == {"金村美玖": "2002-09-10"}


@pytest.mark.asyncio
async def test_refresh_skips_when_fresh(tmp_path):
    (tmp_path / "memories").mkdir()
    (tmp_path / "memories" / "member_profiles.json").write_text(
        json.dumps(
            {"updated_at": (NOW - timedelta(days=2)).isoformat(), "birthdays": {}}
        ),
        encoding="utf-8",
    )
    with patch.object(mp, "_scraper_for") as factory:
        assert (
            await mp.refresh_member_profiles("hinatazaka46", tmp_path, now=NOW) is False
        )
    factory.assert_not_called()


@pytest.mark.asyncio
async def test_unsupported_service_writes_nothing(tmp_path):
    assert await mp.refresh_member_profiles("yodel", tmp_path, now=NOW) is False
    assert not (tmp_path / "memories" / "member_profiles.json").exists()


def test_load_corrupt_is_empty(tmp_path):
    (tmp_path / "memories").mkdir()
    (tmp_path / "memories" / "member_profiles.json").write_text(
        "{not json", encoding="utf-8"
    )
    assert mp.load_birthdays(tmp_path) == {}


@pytest.mark.asyncio
async def test_failure_keeps_old_file(tmp_path):
    (tmp_path / "memories").mkdir()
    p = tmp_path / "memories" / "member_profiles.json"
    old = json.dumps(
        {
            "updated_at": (NOW - timedelta(days=9)).isoformat(),
            "birthdays": {"a": "2000-01-01"},
        }
    )
    p.write_text(old, encoding="utf-8")
    scraper = AsyncMock()
    scraper.get_member_birthdays = AsyncMock(side_effect=RuntimeError("boom"))
    with patch.object(mp, "_scraper_for", return_value=scraper):
        assert (
            await mp.refresh_member_profiles("hinatazaka46", tmp_path, now=NOW) is False
        )
    assert p.read_text(encoding="utf-8") == old


@pytest.mark.asyncio
async def test_stale_and_force_refresh(tmp_path):
    scraper = AsyncMock()
    scraper.get_member_birthdays = AsyncMock(return_value={"A": "2000-01-01"})
    with patch.object(mp, "_scraper_for", return_value=scraper):
        assert (
            await mp.refresh_member_profiles("sakurazaka46", tmp_path, now=NOW) is True
        )
        assert (
            await mp.refresh_member_profiles("sakurazaka46", tmp_path, now=NOW) is False
        )
        assert (
            await mp.refresh_member_profiles(
                "sakurazaka46", tmp_path, now=NOW, force=True
            )
            is True
        )
