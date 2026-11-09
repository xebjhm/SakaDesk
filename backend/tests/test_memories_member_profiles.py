import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from structlog.testing import capture_logs

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
async def test_failure_keeps_old_birthdays(tmp_path):
    (tmp_path / "memories").mkdir()
    p = tmp_path / "memories" / "member_profiles.json"
    updated = (NOW - timedelta(days=9)).isoformat()
    p.write_text(
        json.dumps({"updated_at": updated, "birthdays": {"a": "2000-01-01"}}),
        encoding="utf-8",
    )
    scraper = AsyncMock()
    scraper.get_member_birthdays = AsyncMock(side_effect=RuntimeError("boom"))
    with patch.object(mp, "_scraper_for", return_value=scraper):
        assert (
            await mp.refresh_member_profiles("hinatazaka46", tmp_path, now=NOW) is False
        )
    data = json.loads(p.read_text(encoding="utf-8"))
    assert data["birthdays"] == {"a": "2000-01-01"}
    assert data["updated_at"] == updated  # still stale
    assert data["last_attempt_at"] == NOW.isoformat()


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


@pytest.mark.asyncio
async def test_empty_scrape_keeps_old_data_and_backs_off_24h(tmp_path):
    p = tmp_path / "memories" / "member_profiles.json"
    p.parent.mkdir()
    updated = (NOW - timedelta(days=9)).isoformat()
    p.write_text(
        json.dumps({"updated_at": updated, "birthdays": {"a": "2000-01-01"}}),
        encoding="utf-8",
    )
    scraper = AsyncMock()
    scraper.get_member_birthdays = AsyncMock(return_value={})
    with (
        patch.object(mp, "_scraper_for", return_value=scraper),
        capture_logs() as logs,
    ):
        assert (
            await mp.refresh_member_profiles("hinatazaka46", tmp_path, now=NOW) is False
        )
        # Within 24 h of the last attempt: no scrape.
        later = NOW + timedelta(hours=23)
        assert (
            await mp.refresh_member_profiles("hinatazaka46", tmp_path, now=later)
            is False
        )
        assert scraper.get_member_birthdays.await_count == 1
        # After 24 h: retried.
        after = NOW + timedelta(hours=24)
        await mp.refresh_member_profiles("hinatazaka46", tmp_path, now=after)
        assert scraper.get_member_birthdays.await_count == 2
    data = json.loads(p.read_text(encoding="utf-8"))
    assert data["birthdays"] == {"a": "2000-01-01"} and data["updated_at"] == updated
    reasons = [e["reason"] for e in logs if e["event"] == "member_profiles_skipped"]
    assert reasons == ["empty", "backoff", "empty"]


@pytest.mark.asyncio
async def test_force_ignores_backoff(tmp_path):
    p = tmp_path / "memories" / "member_profiles.json"
    p.parent.mkdir()
    p.write_text(
        json.dumps({"last_attempt_at": NOW.isoformat(), "birthdays": {}}),
        encoding="utf-8",
    )
    scraper = AsyncMock()
    scraper.get_member_birthdays = AsyncMock(return_value={"A": "2000-01-01"})
    with patch.object(mp, "_scraper_for", return_value=scraper):
        assert (
            await mp.refresh_member_profiles("hinatazaka46", tmp_path, now=NOW) is False
        )
        assert (
            await mp.refresh_member_profiles(
                "hinatazaka46", tmp_path, now=NOW, force=True
            )
            is True
        )


@pytest.mark.asyncio
async def test_partial_scrape_merges_into_previous(tmp_path):
    p = tmp_path / "memories" / "member_profiles.json"
    p.parent.mkdir()
    p.write_text(
        json.dumps(
            {
                "updated_at": (NOW - timedelta(days=8)).isoformat(),
                "birthdays": {"金村美玖": "2002-09-10", "小坂菜緒": "2002-09-07"},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    scraper = AsyncMock()
    # Partial: one member missing, one corrected, one new.
    scraper.get_member_birthdays = AsyncMock(
        return_value={"金村 美玖": "2002-09-11", "正源司 陽子": "2007-02-14"}
    )
    with (
        patch.object(mp, "_scraper_for", return_value=scraper),
        capture_logs() as logs,
    ):
        assert (
            await mp.refresh_member_profiles("hinatazaka46", tmp_path, now=NOW) is True
        )
    assert mp.load_birthdays(tmp_path) == {
        "金村美玖": "2002-09-11",  # new value wins
        "小坂菜緒": "2002-09-07",  # kept
        "正源司陽子": "2007-02-14",
    }
    (ev,) = [e for e in logs if e["event"] == "member_profiles_refreshed"]
    assert ev["count"] == 3 and ev["scraped"] == 2 and ev["kept"] == 1
    assert "金村" not in str(ev)


def test_load_missing_logs_debug(tmp_path):
    with capture_logs() as logs:
        assert mp.load_birthdays(tmp_path) == {}
    assert [e["event"] for e in logs] == ["member_profiles_missing"]
    assert logs[0]["log_level"] == "debug"
