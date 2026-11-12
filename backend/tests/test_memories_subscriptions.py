import json
from datetime import date
from unittest.mock import AsyncMock

import pytest
from structlog.testing import capture_logs

from pysaka import RateLimitedError, SessionExpiredError

from backend.services.memories.subscriptions import (
    archive_subscription_starts,
    load_subscription_starts,
)


@pytest.mark.asyncio
async def test_keeps_earliest_and_checks_once_a_day(tmp_path):
    client = AsyncMock()
    client.get_subscription_streak = AsyncMock(
        return_value={"current_start_at_date": "2025-03-01"}
    )
    n = await archive_subscription_starts(
        client, None, [34], tmp_path, today=date(2026, 11, 10)
    )
    assert n == 1 and load_subscription_starts(tmp_path) == {"34": "2025-03-01"}
    # A later streak (after a lapse) does not move the start forward.
    client.get_subscription_streak = AsyncMock(
        return_value={"current_start_at_date": "2026-01-05"}
    )
    assert (
        await archive_subscription_starts(
            client, None, [34], tmp_path, today=date(2026, 11, 11)
        )
        == 1
    )
    assert load_subscription_starts(tmp_path) == {"34": "2025-03-01"}
    # Same day again: skipped, no request.
    client.get_subscription_streak.reset_mock()
    assert (
        await archive_subscription_starts(
            client, None, [34], tmp_path, today=date(2026, 11, 11)
        )
        == 0
    )
    client.get_subscription_streak.assert_not_called()


@pytest.mark.asyncio
async def test_earlier_start_replaces_later(tmp_path):
    client = AsyncMock()
    client.get_subscription_streak = AsyncMock(
        return_value={"current_start_at_date": "2026-01-05"}
    )
    await archive_subscription_starts(
        client, None, [7], tmp_path, today=date(2026, 11, 10)
    )
    client.get_subscription_streak = AsyncMock(
        return_value={"current_start_at_date": "2024-01-05"}
    )
    await archive_subscription_starts(
        client, None, [7], tmp_path, today=date(2026, 11, 11)
    )
    assert load_subscription_starts(tmp_path) == {"7": "2024-01-05"}


@pytest.mark.asyncio
async def test_failure_continues_and_counts_as_todays_attempt(tmp_path):
    client = AsyncMock()
    client.get_subscription_streak = AsyncMock(
        side_effect=[RuntimeError("x"), {"current_start_at_date": "2024-02-02"}]
    )
    today = date(2026, 11, 10)
    assert (
        await archive_subscription_starts(client, None, [1, 2], tmp_path, today=today)
        == 2
    )
    assert load_subscription_starts(tmp_path) == {"2": "2024-02-02"}
    # The failed group is not retried the same day (one attempt per day).
    client.get_subscription_streak = AsyncMock(return_value=None)
    assert (
        await archive_subscription_starts(client, None, [1, 2], tmp_path, today=today)
        == 0
    )
    client.get_subscription_streak.assert_not_called()


@pytest.mark.asyncio
async def test_failure_keeps_previous_earliest(tmp_path):
    client = AsyncMock()
    client.get_subscription_streak = AsyncMock(
        return_value={"current_start_at_date": "2024-02-02"}
    )
    await archive_subscription_starts(
        client, None, [1], tmp_path, today=date(2026, 11, 10)
    )
    client.get_subscription_streak = AsyncMock(side_effect=RuntimeError("x"))
    await archive_subscription_starts(
        client, None, [1], tmp_path, today=date(2026, 11, 11)
    )
    data = json.loads(
        (tmp_path / "memories" / "subscriptions.json").read_text(encoding="utf-8")
    )
    assert data["groups"]["1"] == {
        "earliest_start": "2024-02-02",
        "last_checked": "2026-11-11",
    }


@pytest.mark.asyncio
async def test_auth_error_is_logged_and_stops(tmp_path):
    client = AsyncMock()
    client.get_subscription_streak = AsyncMock(side_effect=SessionExpiredError("x"))
    with capture_logs() as logs:
        n = await archive_subscription_starts(
            client, None, [1, 2], tmp_path, today=date(2026, 11, 10)
        )
    assert n == 0 and client.get_subscription_streak.await_count == 1
    (ev,) = [e for e in logs if e["event"] == "subscription_start_stopped"]
    assert ev["reason"] == "auth" and ev["error_type"] == "SessionExpiredError"
    # Not marked: the next sync tries again.
    assert not (tmp_path / "memories" / "subscriptions.json").exists()


@pytest.mark.asyncio
async def test_rate_limit_stops_the_loop(tmp_path):
    client = AsyncMock()
    client.get_subscription_streak = AsyncMock(
        side_effect=[
            {"current_start_at_date": "2024-02-02"},
            RateLimitedError("slow down"),
            {"current_start_at_date": "2024-03-03"},
        ]
    )
    with capture_logs() as logs:
        n = await archive_subscription_starts(
            client, None, [1, 2, 3], tmp_path, today=date(2026, 11, 10)
        )
    assert n == 1 and client.get_subscription_streak.await_count == 2
    assert load_subscription_starts(tmp_path) == {"1": "2024-02-02"}
    assert any(
        e["event"] == "subscription_start_stopped" and e["reason"] == "rate_limited"
        for e in logs
    )


@pytest.mark.asyncio
async def test_missing_field_is_ignored_but_marked_checked(tmp_path):
    client = AsyncMock()
    client.get_subscription_streak = AsyncMock(return_value=None)
    await archive_subscription_starts(
        client, None, [5], tmp_path, today=date(2026, 11, 10)
    )
    assert load_subscription_starts(tmp_path) == {}
    data = json.loads(
        (tmp_path / "memories" / "subscriptions.json").read_text(encoding="utf-8")
    )
    assert data["groups"]["5"] == {"last_checked": "2026-11-10"}


@pytest.mark.asyncio
async def test_corrupt_file_is_rebuilt(tmp_path):
    (tmp_path / "memories").mkdir()
    (tmp_path / "memories" / "subscriptions.json").write_text("{bad", encoding="utf-8")
    assert load_subscription_starts(tmp_path) == {}
    client = AsyncMock()
    client.get_subscription_streak = AsyncMock(
        return_value={"current_start_at_date": "2025-03-01"}
    )
    await archive_subscription_starts(
        client, None, [3], tmp_path, today=date(2026, 11, 10)
    )
    data = json.loads(
        (tmp_path / "memories" / "subscriptions.json").read_text(encoding="utf-8")
    )
    assert data["groups"]["3"]["earliest_start"] == "2025-03-01"


@pytest.mark.asyncio
async def test_file_not_rewritten_when_nothing_checked(tmp_path):
    client = AsyncMock()
    client.get_subscription_streak = AsyncMock(
        return_value={"current_start_at_date": "2025-03-01"}
    )
    today = date(2026, 11, 10)
    await archive_subscription_starts(client, None, [34], tmp_path, today=today)
    path = tmp_path / "memories" / "subscriptions.json"
    before = path.stat().st_mtime_ns
    path.write_text(path.read_text(encoding="utf-8") + " ", encoding="utf-8")
    marker = path.read_text(encoding="utf-8")
    assert (
        await archive_subscription_starts(client, None, [34], tmp_path, today=today)
        == 0
    )
    assert path.read_text(encoding="utf-8") == marker  # untouched
    assert before <= path.stat().st_mtime_ns
