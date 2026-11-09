import json
from datetime import date
from unittest.mock import AsyncMock

import pytest

from pysaka import SessionExpiredError

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
async def test_failure_continues(tmp_path):
    client = AsyncMock()
    client.get_subscription_streak = AsyncMock(
        side_effect=[RuntimeError("x"), {"current_start_at_date": "2024-02-02"}]
    )
    assert (
        await archive_subscription_starts(
            client, None, [1, 2], tmp_path, today=date(2026, 11, 10)
        )
        == 2
    )
    assert load_subscription_starts(tmp_path) == {"2": "2024-02-02"}


@pytest.mark.asyncio
async def test_auth_error_propagates(tmp_path):
    client = AsyncMock()
    client.get_subscription_streak = AsyncMock(side_effect=SessionExpiredError("x"))
    with pytest.raises(SessionExpiredError):
        await archive_subscription_starts(
            client, None, [1], tmp_path, today=date(2026, 11, 10)
        )


@pytest.mark.asyncio
async def test_missing_field_is_ignored(tmp_path):
    client = AsyncMock()
    client.get_subscription_streak = AsyncMock(return_value=None)
    await archive_subscription_starts(
        client, None, [5], tmp_path, today=date(2026, 11, 10)
    )
    assert load_subscription_starts(tmp_path) == {}


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
