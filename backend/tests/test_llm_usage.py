"""Tests for `backend.services.llm_usage` -- the KB chatbot's per-(model, UTC
day) request ledger backing `GET /api/ai/usage`'s "~N questions left today"
meter (Product-wave Task 5, item 3).

**Locking note under test.** `record_request`/`requests_today` deliberately
open their OWN tiny sqlite connection to `knowledge_index.db` rather than
going through `backend.services.settings_store` (an `asyncio.Lock` + full
settings.json read-modify-write) or `KnowledgeService`'s shared
`_store_lock` -- because a usage write happens from INSIDE an ask that
already holds `_store_lock` for its whole duration, on a `to_thread` worker
running its own fresh event loop (see `KnowledgeService._run_ask_blocking`).
`TestNoDeadlockDuringHeldStoreLock` pins this down directly.
"""

from __future__ import annotations

import asyncio
import sqlite3
from pathlib import Path

import pytest
import time_machine

from backend.services.llm_usage import (
    daily_limit_for,
    estimate_questions_left,
    on_llm_request,
    record_request,
    requests_today,
    usage_db_path,
)


class TestRecordAndReadRequests:
    def test_no_requests_yet_is_zero(self, tmp_path: Path, monkeypatch) -> None:
        monkeypatch.setenv("SAKADESK_DATA_DIR", str(tmp_path))
        assert requests_today("gemini-2.5-flash") == 0

    def test_record_request_increments_todays_count(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        monkeypatch.setenv("SAKADESK_DATA_DIR", str(tmp_path))
        record_request("gemini-2.5-flash")
        record_request("gemini-2.5-flash")
        record_request("gemini-2.5-flash")
        assert requests_today("gemini-2.5-flash") == 3

    def test_different_models_are_counted_independently(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        monkeypatch.setenv("SAKADESK_DATA_DIR", str(tmp_path))
        record_request("gemini-2.5-flash")
        record_request("gemini-2.5-flash-lite")
        record_request("gemini-2.5-flash-lite")
        assert requests_today("gemini-2.5-flash") == 1
        assert requests_today("gemini-2.5-flash-lite") == 2

    def test_persists_across_separate_connections(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        """Every call opens its OWN connection (no shared long-lived state) --
        counts must still be durable across calls."""
        monkeypatch.setenv("SAKADESK_DATA_DIR", str(tmp_path))
        record_request("qwen3:30b")
        assert requests_today("qwen3:30b") == 1
        record_request("qwen3:30b")
        assert requests_today("qwen3:30b") == 2

    def test_creates_the_kb_usage_table_on_a_brand_new_db_file(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        """`GET /api/ai/usage` (or a very first ask) can be the very first
        thing to ever touch `knowledge_index.db` -- before
        `SqliteKnowledgeStore`/its migration runner has ever opened it."""
        monkeypatch.setenv("SAKADESK_DATA_DIR", str(tmp_path))
        assert not usage_db_path().exists()
        record_request("m")
        assert usage_db_path().exists()
        conn = sqlite3.connect(str(usage_db_path()))
        try:
            conn.execute("SELECT model, day, count FROM kb_usage")
        finally:
            conn.close()


class TestUtcDayRollover:
    def test_a_new_utc_day_starts_a_fresh_count(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        monkeypatch.setenv("SAKADESK_DATA_DIR", str(tmp_path))
        with time_machine.travel("2026-06-30T23:59:00+00:00", tick=False):
            record_request("gemini-2.5-flash")
            record_request("gemini-2.5-flash")
            assert requests_today("gemini-2.5-flash") == 2

        with time_machine.travel("2026-07-01T00:01:00+00:00", tick=False):
            assert requests_today("gemini-2.5-flash") == 0
            record_request("gemini-2.5-flash")
            assert requests_today("gemini-2.5-flash") == 1

        # Yesterday's row is untouched (a separate primary key), not merged
        # or reset -- verified by going back and reading it directly.
        with time_machine.travel("2026-06-30T23:59:00+00:00", tick=False):
            assert requests_today("gemini-2.5-flash") == 2

    def test_a_local_timezone_hour_that_crosses_midnight_still_uses_utc_day(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        """The ledger is UTC-day keyed (per the spec), independent of the
        server process's local timezone -- freeze a moment that's already
        "tomorrow" in UTC and confirm the count lands on the UTC day."""
        monkeypatch.setenv("SAKADESK_DATA_DIR", str(tmp_path))
        with time_machine.travel("2026-07-01T00:30:00+00:00", tick=False):
            record_request("m")
            assert requests_today("m") == 1
        with time_machine.travel("2026-06-30T12:00:00+00:00", tick=False):
            assert requests_today("m") == 0


class TestDailyLimitFor:
    def test_known_cloud_model_defaults(self) -> None:
        assert daily_limit_for("gemini-2.5-flash", "cloud") == 20
        assert daily_limit_for("gemini-2.5-flash-lite", "cloud") == 1000

    def test_local_backend_is_always_unlimited(self) -> None:
        assert daily_limit_for("qwen3:30b", "local") is None
        assert daily_limit_for("anything", "local") is None

    def test_unknown_cloud_model_is_unlimited(self) -> None:
        assert daily_limit_for("some-unlisted-model", "cloud") is None

    def test_settings_override_wins_over_the_builtin_default(self) -> None:
        assert daily_limit_for("gemini-2.5-flash", "cloud", override=5) == 5

    def test_override_applies_even_to_local(self) -> None:
        """A user-set override is explicit intent -- honored regardless of
        backend, even though local has no built-in default."""
        assert daily_limit_for("qwen3:30b", "local", override=50) == 50


class TestEstimateQuestionsLeft:
    def test_unlimited_is_none(self) -> None:
        assert estimate_questions_left(0, None) is None
        assert estimate_questions_left(999, None) is None

    def test_floor_division_by_four(self) -> None:
        assert estimate_questions_left(0, 20) == 5
        assert estimate_questions_left(2, 20) == 4  # 18 // 4 == 4 (floor)
        assert estimate_questions_left(16, 20) == 1
        assert estimate_questions_left(17, 20) == 0  # 3 // 4 == 0

    def test_never_goes_negative_once_over_the_limit(self) -> None:
        assert estimate_questions_left(25, 20) == 0


class TestOnLlmRequestCallback:
    """`on_llm_request(model, outcome)` -- the shape `OpenAICompatLLMClient`
    calls, wired in by `KnowledgeService`'s `build_llm_client_from_settings`
    call sites. Both a normal success and a 429 must record identically."""

    def test_success_outcome_records_a_request(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        monkeypatch.setenv("SAKADESK_DATA_DIR", str(tmp_path))
        on_llm_request("gemini-2.5-flash", "success")
        assert requests_today("gemini-2.5-flash") == 1

    def test_quota_exceeded_outcome_also_records_a_request(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        monkeypatch.setenv("SAKADESK_DATA_DIR", str(tmp_path))
        on_llm_request("gemini-2.5-flash", "quota_exceeded")
        assert requests_today("gemini-2.5-flash") == 1

    def test_both_outcomes_accumulate_in_the_same_counter(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        monkeypatch.setenv("SAKADESK_DATA_DIR", str(tmp_path))
        on_llm_request("gemini-2.5-flash", "success")
        on_llm_request("gemini-2.5-flash", "quota_exceeded")
        on_llm_request("gemini-2.5-flash", "success")
        assert requests_today("gemini-2.5-flash") == 3


class TestNoDeadlockDuringHeldStoreLock:
    """Proves the design choice documented in the module docstring: a usage
    write/read must complete promptly even while a `KnowledgeService`-style
    `asyncio.Lock` ("`_store_lock`") is held for the duration of a
    `to_thread`-offloaded blocking call -- exactly the shape a real ask
    takes (`KnowledgeService.ask` holds `_store_lock` across
    `asyncio.to_thread(self._run_ask_blocking, ...)`, and the usage write
    happens from INSIDE that worker thread's own fresh event loop). Bounded
    by `asyncio.wait_for` so a real deadlock fails the test instead of
    hanging the suite forever.
    """

    @pytest.mark.asyncio
    async def test_write_from_inside_a_held_lock_plus_concurrent_read_both_complete(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        monkeypatch.setenv("SAKADESK_DATA_DIR", str(tmp_path))
        store_lock = asyncio.Lock()
        read_started = asyncio.Event()

        def blocking_ask_like_call() -> None:
            # Mirrors `_run_ask_blocking`: plain sync code on a `to_thread`
            # worker, while the caller holds `store_lock`. Must not touch
            # any asyncio primitive to complete.
            record_request("qwen3:30b")

        async def held_ask() -> None:
            async with store_lock:
                assert store_lock.locked()
                # Give the concurrent reader a chance to actually contend.
                await asyncio.sleep(0)
                read_started.set()
                await asyncio.to_thread(blocking_ask_like_call)

        async def concurrent_read() -> int:
            await read_started.wait()
            # `store_lock` is still held by `held_ask` at this point -- a
            # read routed through it (or through `settings_store`'s shared
            # lock) would hang until `held_ask` finishes. This must return
            # immediately regardless.
            return await asyncio.to_thread(requests_today, "qwen3:30b")

        _, read_result = await asyncio.wait_for(
            asyncio.gather(held_ask(), concurrent_read()), timeout=2.0
        )
        assert isinstance(read_result, int)
        assert requests_today("qwen3:30b") == 1
