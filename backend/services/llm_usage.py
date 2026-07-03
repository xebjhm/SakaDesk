"""Per-(model, UTC day) LLM request ledger for the KB chatbot (Product-wave
Task 5, item 3) -- backs `GET /api/ai/usage`'s "~N questions left today"
composer meter, and the extra numbers a quota-exhausted `event: error`
carries.

**Locking / concurrency design (read this before touching this module).**
`KnowledgeService.ask()` holds `_store_lock` (an `asyncio.Lock`) for the
WHOLE ask, and the `OpenAICompatLLMClient.chat()` call that triggers a usage
write happens INSIDE that lock's critical section -- specifically inside
`asyncio.to_thread(self._run_ask_blocking, ...)`, which drives the agent's
async code to completion via its OWN fresh `asyncio.run()` loop on the
worker thread (see that method's docstring). Two things follow from that:

1. This module must NEVER go through `backend.services.settings_store`
   (a module-level `asyncio.Lock` guarding a full settings.json
   read-modify-write) for its writes: awaiting a second, unrelated
   `asyncio.Lock` from inside `_run_ask_blocking`'s own fresh event loop,
   while the CALLING loop is parked waiting for that `to_thread` call to
   return, is exactly the shape of an event-loop deadlock/lock-reuse bug.
2. A `GET /api/ai/usage` read can legitimately arrive WHILE an ask is
   in-flight (and holding `_store_lock`) -- it must not have to wait for
   that ask to finish just to report today's count.

The fix -- mirroring `KnowledgeService.status()`'s `_read_status_by_type`
and `compute_readiness()`'s `_probe_index_document_count`, both of which
have the identical "sync code on the event-loop thread, concurrent with an
in-flight `to_thread` writer" shape -- is to make this module **plain
synchronous, with zero `asyncio` primitives of its own**: every read/write
opens its own short-lived `sqlite3` connection straight to the SAME
`knowledge_index.db` file (WAL mode, already enabled by
`SqliteKnowledgeStore.__init__`, means WAL readers never block on writers;
`busy_timeout` covers the rare writer-vs-writer race). A plain function is
safe to call from ANY thread or event loop -- including from inside
`_run_ask_blocking`'s worker-thread-local loop -- with no risk of reusing an
`asyncio.Lock`/`Future` created on a different loop.

`record_request`/`requests_today` also independently `CREATE TABLE IF NOT
EXISTS kb_usage` on every connect (idempotent, matching the DDL in
`knowledge_store.py`'s migration 3) so this module works standalone even if
`GET /api/ai/usage` is the very first thing to ever touch
`knowledge_index.db` -- before `SqliteKnowledgeStore`'s migration runner has
had a chance to.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import structlog

from backend.services.platform import get_app_data_dir

logger = structlog.get_logger(__name__)

_BUSY_TIMEOUT_MS = 5000

# ~4 `chat()` round-trips (agent tool-calling steps) per user question --
# used to translate a raw request-count budget into a user-facing "~N
# questions left" estimate. A rough constant, not a measured average; see
# `GET /api/ai/usage`'s docstring in `backend/api/ai.py`.
_QUESTIONS_PER_REQUEST = 4

# Known free-tier DAILY request limits, keyed by exact model id. Absent from
# this map (or `backend == "local"`) means unlimited (`None`) unless the user
# sets `settings.knowledge_base.llm.daily_limit` explicitly. These are the
# same curated cloud ids as `backend.services.llm_models` -- kept as a plain
# dict here (rather than folded into that registry) since a daily-limit
# number is a distinct, independently-changing fact from a tool-calling
# tier verdict.
_DAILY_LIMITS: dict[str, int] = {
    "gemini-2.5-flash": 20,
    "gemini-2.5-flash-lite": 1000,
}

RequestOutcome = Literal["success", "quota_exceeded"]


def usage_db_path() -> Path:
    """`knowledge_index.db` -- the SAME sqlite file `SqliteKnowledgeStore`
    persists documents/vectors to (see `kb_usage`, migration 3,
    `knowledge_store.py`); this module just never opens it through that
    class's shared connection (see module docstring)."""
    return get_app_data_dir() / "knowledge_index.db"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(usage_db_path()))
    conn.execute(f"PRAGMA busy_timeout = {_BUSY_TIMEOUT_MS}")
    conn.execute(
        "CREATE TABLE IF NOT EXISTS kb_usage ("
        "model TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, "
        "PRIMARY KEY (model, day))"
    )
    return conn


def _today() -> str:
    """Today's date in UTC, `YYYY-MM-DD` -- the ledger's day key. Always UTC
    (never the server process's local timezone), per the spec: usage
    tracking is a provider-quota concept, and providers reset quotas on
    their own UTC-anchored clocks."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def record_request(model: str) -> None:
    """Increment `model`'s request count for today (UTC). Best-effort: a
    sqlite failure here must never break the ask that triggered it, so
    errors are logged and swallowed rather than raised."""
    try:
        conn = _connect()
        try:
            conn.execute(
                "INSERT INTO kb_usage (model, day, count) VALUES (?, ?, 1) "
                "ON CONFLICT(model, day) DO UPDATE SET count = count + 1",
                (model, _today()),
            )
            conn.commit()
        finally:
            conn.close()
    except sqlite3.Error:
        logger.warning("llm_usage.record_failed", model=model, exc_info=True)


def requests_today(model: str) -> int:
    """`model`'s recorded request count for today (UTC), or 0 if none yet
    (including when the db/table doesn't exist at all)."""
    try:
        conn = _connect()
        try:
            conn.execute("PRAGMA query_only = ON")
            row = conn.execute(
                "SELECT count FROM kb_usage WHERE model = ? AND day = ?",
                (model, _today()),
            ).fetchone()
            return row[0] if row is not None else 0
        finally:
            conn.close()
    except sqlite3.Error:
        logger.warning("llm_usage.read_failed", model=model, exc_info=True)
        return 0


def daily_limit_for(
    model: str, backend: str, override: int | None = None
) -> int | None:
    """The daily request limit for `(model, backend)`, or `None` (unlimited).

    `override` (`settings.knowledge_base.llm.daily_limit`, when the user has
    set one) always wins, for either backend -- an explicit user setting is
    never second-guessed. Otherwise: `local` is always unlimited (there's no
    provider-side quota to model), `cloud` falls back to the curated
    `_DAILY_LIMITS` map, defaulting to unlimited for an unrecognized model
    (nothing known to warn about).
    """
    if override is not None:
        return override
    if backend == "local":
        return None
    return _DAILY_LIMITS.get(model)


def estimate_questions_left(
    requests_today_count: int, daily_limit: int | None
) -> int | None:
    """`~N questions left today`, or `None` when `daily_limit` is unlimited.

    A "question" costs roughly `_QUESTIONS_PER_REQUEST` `chat()` round-trips
    (the agent's tool-calling loop), floor-divided so the estimate never
    rounds up past what's actually left.
    """
    if daily_limit is None:
        return None
    remaining_requests = max(0, daily_limit - requests_today_count)
    return remaining_requests // _QUESTIONS_PER_REQUEST


def usage_snapshot(model: str, backend: str, override: int | None = None) -> dict:
    """`{model, requestsToday, dailyLimit, estQuestionsLeft}` -- the shape
    `GET /api/ai/usage` returns verbatim, and the extra fields a
    quota-exhausted SSE `event: error` is enriched with."""
    today = requests_today(model)
    limit = daily_limit_for(model, backend, override)
    return {
        "model": model,
        "requestsToday": today,
        "dailyLimit": limit,
        "estQuestionsLeft": estimate_questions_left(today, limit),
    }


def on_llm_request(model: str, outcome: str) -> None:
    """The `on_request(model, outcome)` callback shape
    `OpenAICompatLLMClient` calls (see `backend/services/llm_client.py`) --
    `outcome` is typed `str` here (not the narrower `RequestOutcome` Literal)
    so this matches `OpenAICompatLLMClient`'s `on_request: Callable[[str,
    str], None]` contravariantly -- a callback accepting the wider type is
    assignable wherever the narrower one would be, but not vice versa.
    wired in by `KnowledgeService`'s `build_llm_client_from_settings()` call
    sites, never by `POST /api/ai/config/test`'s draft-config probe client
    (a test round-trip is not a real user question and must not consume
    quota-meter budget).

    Both outcomes record identically -- `outcome` is log-only context here;
    a 429 still means the request was actually sent and counted against the
    provider's quota, so it must not be silently excluded from the ledger
    (that was the pre-Task-5 quota-blindness bug: a user could burn their
    entire daily quota on 429s and the meter would never move).
    """
    record_request(model)
    logger.debug("llm_usage.request_recorded", model=model, outcome=outcome)
