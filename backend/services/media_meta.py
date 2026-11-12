"""Placeholder store for media tiles (``media_meta.db``) and ``POST /api/media/meta``.

A gallery tile paints the source's mean colour and a 16 px blur at once, then
fades the thumbnail in. Those placeholders are computed by the background
pre-generation worker (``media_pregen``, via ``photo_thumb.make_set``) and
kept here, one row per archive file, keyed by the output-dir-relative POSIX
path from :func:`photo_thumb.archive_rel` (never logged).

- **A cache, never a source of truth.** The DB lives at
  ``<app data dir>/cache/media_meta.db`` (:func:`db_path`), in WAL mode with a
  5 s busy timeout. ``PRAGMA user_version`` holds :data:`SCHEMA_VERSION`; a
  mismatch drops and recreates the table, and a file that is not a database
  is deleted and recreated, both logging ``media_meta_reset`` (``reason``).
  Any other ``sqlite3.Error`` (or ``OSError`` opening it) logs
  ``media_meta_failed`` (``op``, ``error_type``): reads return empty and
  writes are dropped, so the store can never fail a request.
- **Bounded.** At most :data:`MAX_ROWS` rows: when a :func:`put` adds a row
  past it, :func:`prune` deletes the least recently written rows down to
  ``MAX_ROWS * PRUNE_SLACK``. The row count is measured once per DB path and
  then kept in memory.
- **Freshness.** A row stores the ``stat_key`` (``"size:mtime_ns"``) of the
  source it was computed from (the video, for a video). A row whose key no
  longer matches the file is stale and reported as unprocessed, and so is a
  ``failed`` row whose ``reason`` is in :data:`PLACEHOLDER_PENDING_REASONS`
  (a poster recorded before the placeholder was computed).
- **Video posters.** ``poster`` is ``ready|failed|pending|none``.
  :func:`mark_poster_pending` commits *before* the Windows Shell call, so a
  crash inside Shell leaves a ``pending`` row that :func:`recover_pending`
  (run at worker start) turns into ``failed`` with
  ``reason=shell_crash_suspect``: the worker never retries Shell on it.
  :func:`mark_shell_suspect` leaves the same marker at once when a Shell
  call hangs.
- **The batch read.** :func:`meta_for_urls` resolves media-route URLs
  (:func:`archive_urls.media_route_target`), stats each file, reads the rows
  and builds the response items, all in one worker thread; it never decodes
  an image. Missing and stale rows are hinted to the worker
  (``media_pregen.hint``, via :func:`_hint`) so it processes them first; a
  video waiting for a client poster is not (:func:`waiting_for_poster`).

- **Key-value side table.** ``media_meta_kv(k, v)`` holds small worker
  state that must survive a restart (``media_pregen``'s blog listing
  signatures: :func:`kv_get_prefix`, :func:`kv_set`,
  :func:`kv_delete_prefix`). It is created on first use with ``CREATE TABLE
  IF NOT EXISTS`` (an existing DB gains it without a reset), emptied by
  :func:`clear` and dropped with the rows by a schema reset.

Logs carry counts and codes only: ``media_meta`` (``requested``, ``ready``,
``stale``, ``missing``, ``invalid``, ``hinted``), ``path_traversal_blocked``
(``view=media_meta``, ``count``; at most one per request), ``media_meta_reset``
(``reason``) and ``media_meta_failed`` (``op``, ``error_type``).
"""

from __future__ import annotations

import asyncio
import base64
import os
import sqlite3
import stat
import threading
import time
from collections.abc import Callable, Sequence
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeVar

import structlog

from backend.services import archive_urls, photo_thumb

logger = structlog.get_logger(__name__)

DB_NAME = "media_meta.db"
SCHEMA_VERSION = 1
MAX_ROWS = 300_000
"""About 400 B per row, so at most ~120 MB; see the plan's "Cache budget" table."""
PRUNE_SLACK = 0.9
"""A prune deletes down to this share of :data:`MAX_ROWS`, so it does not run on every put."""
META_BATCH_MAX = 500
"""Most URLs one ``POST /api/media/meta`` may ask about (the client sends 200)."""
PICTURE_SUFFIXES: frozenset[str] = photo_thumb.PICTURE_SUFFIXES
VIDEO_SUFFIXES: frozenset[str] = photo_thumb.VIDEO_SUFFIXES

BUSY_TIMEOUT_MS = 5000
_IN_CHUNK = 500
"""Keys per ``IN (...)`` query (well under SQLite's variable limit)."""
_BLUR_URI_PREFIX = "data:image/webp;base64,"
NO_PLACEHOLDER = "no_placeholder"
"""``reason`` of a row created by a poster update before any placeholder existed."""
SHELL_CRASH_SUSPECT = "shell_crash_suspect"
"""``reason`` set by :func:`recover_pending`: the process died inside a Shell poster call."""
PLACEHOLDER_PENDING_REASONS: frozenset[str] = frozenset(
    {NO_PLACEHOLDER, SHELL_CRASH_SUSPECT}
)
"""On a ``status='failed'`` row these codes mean "no placeholder computed yet", not
a terminal failure: such a row is hinted and not counted as failed."""

_DDL: tuple[str, ...] = (
    """CREATE TABLE IF NOT EXISTS media_meta (
  rel_path TEXT PRIMARY KEY,
  stat_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('picture','video')),
  width INTEGER, height INTEGER,
  rgb INTEGER,
  blur BLOB,
  status TEXT NOT NULL CHECK (status IN ('ready','failed')),
  reason TEXT,
  poster TEXT CHECK (poster IN ('ready','failed','pending','none')),
  poster_source TEXT CHECK (poster_source IN ('shell','client')),
  updated_at INTEGER NOT NULL
) WITHOUT ROWID""",
    "CREATE INDEX IF NOT EXISTS media_meta_by_updated ON media_meta(updated_at)",
)
_COLUMNS = (
    "rel_path, stat_key, kind, width, height, rgb, blur, status, reason, "
    "poster, poster_source, updated_at"
)

_T = TypeVar("_T")


@dataclass(frozen=True)
class MetaRow:
    """One ``media_meta`` row (see the schema in the module and the plan)."""

    rel_path: str
    stat_key: str
    kind: str
    width: int | None
    height: int | None
    rgb: int | None
    blur: bytes | None
    status: str
    reason: str | None
    poster: str | None
    poster_source: str | None
    updated_at: int = 0


# --- the connection --------------------------------------------------------------------

_db_override: Path | None = None
_row_counts: dict[Path, int] = {}
_lock = threading.Lock()


def db_path() -> Path:
    """``<app data dir>/cache/media_meta.db`` (beside ``photo_thumbs/``), or the test override."""
    if _db_override is not None:
        return _db_override
    return photo_thumb.cache_dir().parent / DB_NAME


def set_db_path(path: Path | None) -> None:
    """Point the store at ``path`` (tests); ``None`` restores the default. Forgets the row count."""
    global _db_override
    with _lock:
        _db_override = path
        _row_counts.clear()


def _forget_count(path: Path) -> None:
    with _lock:
        _row_counts.pop(path, None)


def _remove_db(path: Path) -> None:
    """Delete the DB file and its WAL / shared-memory files. Blocking."""
    for suffix in ("", "-wal", "-shm"):
        Path(f"{path}{suffix}").unlink(missing_ok=True)


def _ensure_wal(conn: sqlite3.Connection) -> None:
    """Switch the DB to WAL once (the mode is stored in the file).

    The switch needs every other connection out of the file and does not
    wait on the busy handler, so on a brand-new DB that several threads open
    at once it can fail with "database is locked". WAL is only an
    optimisation: the connection then works in the default journal mode and
    a later connection makes the switch (``media_meta_wal_deferred``).
    """
    if str(conn.execute("PRAGMA journal_mode").fetchone()[0]).lower() == "wal":
        return
    try:
        conn.execute("PRAGMA journal_mode=WAL")
    except sqlite3.OperationalError as e:
        logger.debug("media_meta_wal_deferred", error_type=type(e).__name__)


def _ensure_schema(conn: sqlite3.Connection, path: Path) -> None:
    conn.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    _ensure_wal(conn)
    if conn.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION:
        return
    # Create (or reset) under the write lock and re-check: another connection
    # may have created the schema between our read and the lock, and must not
    # see a half-made one (the DDL and user_version commit together).
    conn.execute("BEGIN IMMEDIATE")
    try:
        if conn.execute("PRAGMA user_version").fetchone()[0] != SCHEMA_VERSION:
            tables = conn.execute(
                "SELECT count(*) FROM sqlite_master WHERE type='table'"
            ).fetchone()[0]
            if tables:
                logger.info("media_meta_reset", reason="schema")
                conn.execute("DROP TABLE IF EXISTS media_meta")
                conn.execute("DROP TABLE IF EXISTS media_meta_kv")
                _forget_count(path)
            for statement in _DDL:
                conn.execute(statement)
            conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
        conn.commit()
    except BaseException:
        conn.rollback()
        raise


def _open(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=BUSY_TIMEOUT_MS / 1000)
    try:
        _ensure_schema(conn, path)
    except BaseException:
        conn.close()
        raise
    return conn


def _connect() -> sqlite3.Connection:
    """An open connection with the current schema. Blocking; raises ``sqlite3.Error`` / ``OSError``."""
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        return _open(path)
    except sqlite3.OperationalError:
        raise  # locked, read-only, ...: the file is fine
    except sqlite3.DatabaseError:
        # Not a database (or corrupt): it is only a cache, start over.
        logger.info("media_meta_reset", reason="corrupt")
        _remove_db(path)
        _forget_count(path)
        return _open(path)


def _run(op: str, fn: Callable[[sqlite3.Connection], _T], default: _T) -> _T:
    """Run ``fn`` in one transaction; on failure log ``media_meta_failed`` and return ``default``."""
    try:
        with closing(_connect()) as conn, conn:
            return fn(conn)
    except (sqlite3.Error, OSError) as e:
        logger.warning("media_meta_failed", op=op, error_type=type(e).__name__)
        return default


def _now() -> int:
    return int(time.time())


# --- the store ------------------------------------------------------------------------


def get_many(rel_paths: Sequence[str]) -> dict[str, MetaRow]:
    """The rows of ``rel_paths`` that exist (``rel_path`` -> row). Blocking; never raises."""
    keys = list(dict.fromkeys(rel_paths))
    if not keys:
        return {}

    def op(conn: sqlite3.Connection) -> dict[str, MetaRow]:
        rows: dict[str, MetaRow] = {}
        for i in range(0, len(keys), _IN_CHUNK):
            chunk = keys[i : i + _IN_CHUNK]
            marks = ",".join("?" * len(chunk))
            for r in conn.execute(
                f"SELECT {_COLUMNS} FROM media_meta WHERE rel_path IN ({marks})",
                chunk,
            ):
                rows[r[0]] = MetaRow(*r)
        return rows

    return _run("get_many", op, {})


def _stat_key_in_db(conn: sqlite3.Connection, rel_path: str) -> str | None:
    """The stored ``stat_key`` of ``rel_path``, or ``None`` when it has no row."""
    found = conn.execute(
        "SELECT stat_key FROM media_meta WHERE rel_path = ?", (rel_path,)
    ).fetchone()
    return None if found is None else str(found[0])


_SAME_VERSION = "media_meta.stat_key = excluded.stat_key"
_UPSERT = (
    f"INSERT INTO media_meta ({_COLUMNS}) "
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
    "ON CONFLICT(rel_path) DO UPDATE SET "
    "stat_key = excluded.stat_key, kind = excluded.kind, "
    "width = excluded.width, height = excluded.height, rgb = excluded.rgb, "
    "blur = excluded.blur, status = excluded.status, "
    "updated_at = excluded.updated_at, "
    # Same version: a row that names no poster keeps the stored poster state,
    # and a row that names no reason keeps the Shell crash marker.
    f"reason = CASE WHEN {_SAME_VERSION} AND excluded.reason IS NULL "
    f"AND media_meta.reason = '{SHELL_CRASH_SUSPECT}' "
    "THEN media_meta.reason ELSE excluded.reason END, "
    f"poster = CASE WHEN {_SAME_VERSION} AND excluded.poster IS NULL "
    "THEN media_meta.poster ELSE excluded.poster END, "
    f"poster_source = CASE WHEN {_SAME_VERSION} AND excluded.poster IS NULL "
    "THEN media_meta.poster_source ELSE excluded.poster_source END"
)


def _insert(conn: sqlite3.Connection, row: MetaRow) -> None:
    conn.execute(
        _UPSERT,
        (
            row.rel_path,
            row.stat_key,
            row.kind,
            row.width,
            row.height,
            row.rgb,
            row.blur,
            row.status,
            row.reason,
            row.poster,
            row.poster_source,
            _now(),
        ),
    )


def _count_added(conn: sqlite3.Connection, path: Path) -> int:
    """Account one new row of the DB at ``path``; the row count after it."""
    with _lock:
        count = _row_counts.get(path)
        if count is None:  # measured once; this already includes the new row
            count = conn.execute("SELECT count(*) FROM media_meta").fetchone()[0]
        else:
            count += 1
        _row_counts[path] = count
        return count


def _write(op: str, rel_path: str, write: Callable[[sqlite3.Connection], None]) -> None:
    """Run a row write; prune afterwards when it added a row past :data:`MAX_ROWS`."""
    path = db_path()

    def tx(conn: sqlite3.Connection) -> int:
        added = _stat_key_in_db(conn, rel_path) is None
        write(conn)
        return _count_added(conn, path) if added else 0

    if _run(op, tx, 0) > MAX_ROWS:
        prune()


def put(row: MetaRow) -> None:
    """Store ``row``, stamping ``updated_at`` with now. Blocking; never raises.

    A new path, or a new ``stat_key`` for a stored path, replaces the whole
    row. For the **same** ``stat_key`` every column is replaced except that a
    row with ``poster=None`` keeps the stored ``poster`` / ``poster_source``,
    and a row with ``reason=None`` keeps a stored ``shell_crash_suspect``
    marker. So the worker can store a video's placeholder without knowing
    its poster state, and the Shell crash guard survives it.
    """
    _write("put", row.rel_path, lambda conn: _insert(conn, row))


def _poster_row(rel_path: str, stat_key: str, state: str, source: str) -> MetaRow:
    return MetaRow(
        rel_path,
        stat_key,
        "video",
        None,
        None,
        None,
        None,
        "failed",
        NO_PLACEHOLDER,
        state,
        source,
    )


def set_poster(rel_path: str, stat_key: str, state: str, source: str) -> None:
    """Record the poster ``state`` (and ``source``) of a video. Blocking; never raises.

    A row of the same ``stat_key`` keeps its placeholder and only gets the
    poster fields. A missing or stale row is replaced by a video row with no
    placeholder yet (``status=failed``, ``reason=no_placeholder``): it counts
    as unprocessed (:func:`placeholder_pending`; hinted, not counted as
    failed), and a later :func:`put` of the placeholder (``poster=None``)
    fills it in while keeping this poster state.
    """

    def write(conn: sqlite3.Connection) -> None:
        if _stat_key_in_db(conn, rel_path) == stat_key:
            conn.execute(
                "UPDATE media_meta SET poster = ?, poster_source = ?, updated_at = ? "
                "WHERE rel_path = ?",
                (state, source, _now(), rel_path),
            )
        else:
            _insert(conn, _poster_row(rel_path, stat_key, state, source))

    _write("set_poster", rel_path, write)


def mark_poster_pending(rel_path: str, stat_key: str) -> None:
    """Mark a Shell poster attempt as started; committed before the call (crash guard)."""
    set_poster(rel_path, stat_key, "pending", "shell")


def recover_pending() -> int:
    """Turn every ``pending`` poster into ``failed``; the count.

    Run at worker start: a ``pending`` row means the process died inside the
    Shell call, so that file is never tried with Shell again (the guard is
    ``poster='failed'`` with ``poster_source='shell'``). ``reason`` becomes
    ``shell_crash_suspect`` unless it holds a terminal placeholder failure
    code (``too_large``, ``unreadable``, ...), which is kept. So on a video
    row ``reason`` may carry this poster marker even when ``status='ready'``;
    on a ``failed`` row it still reads as "placeholder not computed yet".
    Never raises.
    """

    def op(conn: sqlite3.Connection) -> int:
        cur = conn.execute(
            "UPDATE media_meta SET poster = 'failed', updated_at = ?, "
            "reason = CASE WHEN reason IS NULL OR reason = ? THEN ? ELSE reason END "
            "WHERE poster = 'pending'",
            (_now(), NO_PLACEHOLDER, SHELL_CRASH_SUSPECT),
        )
        return cur.rowcount

    return _run("recover_pending", op, 0)


def mark_shell_suspect(rel_path: str, stat_key: str) -> None:
    """A Shell poster call **hung** on this video version: mark it like a crash.

    The same marker :func:`recover_pending` leaves after a crash inside the
    Shell (``poster='failed'``, ``poster_source='shell'``, ``reason`` becomes
    ``shell_crash_suspect`` unless it holds a terminal placeholder code), so
    the worker never gives this file to the Shell again; the client capture
    covers it. Only a row of this ``stat_key`` is touched. Blocking; never
    raises.
    """

    def op(conn: sqlite3.Connection) -> None:
        conn.execute(
            "UPDATE media_meta SET poster = 'failed', poster_source = 'shell', "
            "updated_at = ?, "
            "reason = CASE WHEN reason IS NULL OR reason = ? THEN ? ELSE reason END "
            "WHERE rel_path = ? AND stat_key = ?",
            (_now(), NO_PLACEHOLDER, SHELL_CRASH_SUSPECT, rel_path, stat_key),
        )

    _run("mark_shell_suspect", op, None)


def prune() -> int:
    """Delete the oldest rows (by ``updated_at``) down to ``MAX_ROWS * PRUNE_SLACK``; the count.

    Nothing happens while the table holds at most :data:`MAX_ROWS` rows.
    Blocking; never raises.
    """
    path = db_path()

    def op(conn: sqlite3.Connection) -> int:
        count = conn.execute("SELECT count(*) FROM media_meta").fetchone()[0]
        excess = count - int(MAX_ROWS * PRUNE_SLACK) if count > MAX_ROWS else 0
        if excess > 0:
            conn.execute(
                "DELETE FROM media_meta WHERE rel_path IN ("
                "SELECT rel_path FROM media_meta ORDER BY updated_at, rel_path LIMIT ?)",
                (excess,),
            )
        with _lock:
            _row_counts[path] = count - excess
        return excess

    return _run("prune", op, 0)


def clear() -> None:
    """Delete every row, the key-value table's too. Blocking; never raises."""
    path = db_path()

    def op(conn: sqlite3.Connection) -> None:
        conn.execute("DELETE FROM media_meta")
        conn.execute(_KV_DDL)
        conn.execute("DELETE FROM media_meta_kv")
        with _lock:
            _row_counts[path] = 0

    _run("clear", op, None)


# --- the key-value side table ----------------------------------------------------------

_KV_DDL = (
    "CREATE TABLE IF NOT EXISTS media_meta_kv "
    "(k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID"
)


def _prefix_range(prefix: str) -> tuple[str, str]:
    """``k >= lo AND k < hi`` matches ``prefix`` literally (no ``LIKE`` wildcards)."""
    return prefix, prefix + "\U0010ffff"


def kv_get_prefix(prefix: str) -> dict[str, str]:
    """Every ``media_meta_kv`` entry whose key starts with ``prefix``. Blocking; never raises."""
    lo, hi = _prefix_range(prefix)

    def op(conn: sqlite3.Connection) -> dict[str, str]:
        conn.execute(_KV_DDL)
        rows = conn.execute(
            "SELECT k, v FROM media_meta_kv WHERE k >= ? AND k < ?", (lo, hi)
        ).fetchall()
        return {k: v for k, v in rows}

    return _run("kv_get", op, {})


def kv_set(key: str, value: str) -> None:
    """Store ``value`` under ``key`` (replacing it). Blocking; never raises."""

    def op(conn: sqlite3.Connection) -> None:
        conn.execute(_KV_DDL)
        conn.execute(
            "INSERT OR REPLACE INTO media_meta_kv(k, v) VALUES (?, ?)", (key, value)
        )

    _run("kv_set", op, None)


def kv_delete_prefix(prefix: str) -> None:
    """Delete every entry whose key starts with ``prefix``. Blocking; never raises."""
    lo, hi = _prefix_range(prefix)

    def op(conn: sqlite3.Connection) -> None:
        conn.execute(_KV_DDL)
        conn.execute("DELETE FROM media_meta_kv WHERE k >= ? AND k < ?", (lo, hi))

    _run("kv_delete", op, None)


def counts() -> dict[str, int]:
    """Row totals for the status endpoint (all zero when the DB cannot be read).

    ``failed`` counts terminal placeholder failures only (a ``failed`` row
    with no ``reason`` counts here too); rows still waiting for their
    placeholder (:data:`PLACEHOLDER_PENDING_REASONS`) are
    ``placeholder_pending``. ``poster_none`` counts videos whose poster is
    ``none`` (no Shell; waiting for a client capture or a retry).
    """
    empty = dict.fromkeys(
        (
            "rows",
            "ready",
            "failed",
            "placeholder_pending",
            "poster_ready",
            "poster_failed",
            "poster_pending",
            "poster_none",
        ),
        0,
    )
    # COALESCE: ``NULL IN (...)`` is NULL, and ``NOT (NULL)`` would drop a
    # failed row without a reason from every bucket.
    pending = "status = 'failed' AND COALESCE(reason, '') IN ({})".format(
        ",".join(f"'{r}'" for r in sorted(PLACEHOLDER_PENDING_REASONS))
    )

    def op(conn: sqlite3.Connection) -> dict[str, int]:
        r = conn.execute(
            "SELECT count(*), "
            "count(*) FILTER (WHERE status = 'ready'), "
            f"count(*) FILTER (WHERE status = 'failed' AND NOT ({pending})), "
            f"count(*) FILTER (WHERE {pending}), "
            "count(*) FILTER (WHERE poster = 'ready'), "
            "count(*) FILTER (WHERE poster = 'failed'), "
            "count(*) FILTER (WHERE poster = 'pending'), "
            "count(*) FILTER (WHERE poster = 'none') FROM media_meta"
        ).fetchone()
        return dict(zip(empty, r))

    return _run("counts", op, empty)


# --- the batch read -------------------------------------------------------------------


def kind_of(path: Path) -> str | None:
    """``picture`` or ``video`` by suffix (case-insensitive), else ``None``."""
    suffix = path.suffix.lower()
    if suffix in PICTURE_SUFFIXES:
        return "picture"
    if suffix in VIDEO_SUFFIXES:
        return "video"
    return None


def placeholder_pending(row: MetaRow) -> bool:
    """True when ``row`` has no placeholder yet but is not a terminal failure."""
    return row.status == "failed" and row.reason in PLACEHOLDER_PENDING_REASONS


def stat_key_of(st: os.stat_result) -> str:
    """The freshness key of a source: ``"size:mtime_ns"``."""
    return f"{st.st_size}:{st.st_mtime_ns}"


def waiting_for_poster(row: MetaRow) -> bool:
    """A video the worker cannot finish until a client capture lands.

    Its placeholder comes from its poster, and there is none: the Shell
    failed, crashed or hung on it (``poster='failed'``), or a Shell attempt
    is in flight (``pending``). Such a row is not hinted, or every meta
    request would re-queue it. ``poster='none'`` (no Shell, or a failed
    cache write) is still hinted: the worker retries it, rate-limited per
    item (``media_pregen.HINT_COOLDOWN_S``).
    """
    return (
        row.kind == "video"
        and placeholder_pending(row)
        and row.poster in ("failed", "pending")
    )


def _hint(service: str, rel_paths: list[str]) -> None:
    """Ask the pre-generation worker to process ``rel_paths`` first.

    ``media_pregen.hint`` (imported lazily: ``media_pregen`` imports this
    module). Runs on the event loop; the hint is cheap and never blocks.
    """
    from backend.services import media_pregen

    media_pregen.hint(service, rel_paths)


@dataclass(frozen=True)
class _Target:
    url: str
    service: str
    rel: str
    stat_key: str
    v: str
    kind: str


@dataclass
class _Batch:
    targets: list[_Target]
    rows: dict[str, MetaRow]
    invalid: int
    outside: int
    missing: int


def _output_dir() -> Path:
    from backend.api.content import get_output_dir

    return get_output_dir()


def _resolve(output_dir: Path, url: str) -> _Target | str:
    """The target of ``url``, or the code ``invalid`` / ``outside`` / ``missing``. Blocking."""
    found = archive_urls.classify_media_route(output_dir, url)
    if isinstance(found, str):
        return found
    service, path = found  # already resolved and confined to its service folder
    kind = kind_of(path)
    if kind is None:
        return "invalid"
    try:
        st = path.stat()
        if not stat.S_ISREG(st.st_mode):
            return "missing"
        rel = photo_thumb.archive_rel(output_dir, path)
    except (OSError, ValueError):
        return "missing"
    v = photo_thumb.version_token(st.st_size, st.st_mtime_ns)
    return _Target(url, service, rel, stat_key_of(st), v, kind)


def _load(urls: list[str]) -> _Batch:
    """Resolve and stat every URL, then read their rows. Blocking; never decodes."""
    output_dir = _output_dir()
    targets: list[_Target] = []
    codes = {"invalid": 0, "outside": 0, "missing": 0}
    for url in urls:
        res = _resolve(output_dir, url)
        if isinstance(res, str):
            codes[res] += 1
        else:
            targets.append(res)
    rows = get_many([t.rel for t in targets])
    return _Batch(targets, rows, codes["invalid"], codes["outside"], codes["missing"])


def _blur_uri(blur: bytes | None) -> str | None:
    return None if blur is None else _BLUR_URI_PREFIX + base64.b64encode(blur).decode()


def _item(t: _Target, row: MetaRow | None) -> dict[str, Any]:
    item: dict[str, Any] = {
        "kind": t.kind,
        "v": t.v,
        "color": None,
        "blur": None,
        "w": None,
        "h": None,
        "poster": False,
    }
    if row is None or row.stat_key != t.stat_key:
        return item
    if row.status == "ready":
        item["color"] = None if row.rgb is None else f"#{row.rgb:06x}"
        item["blur"] = _blur_uri(row.blur)
        item["w"] = row.width
        item["h"] = row.height
    if t.kind == "video":
        item["poster"] = row.poster == "ready"
    return item


async def meta_for_urls(urls: Sequence[str]) -> dict[str, dict[str, Any] | None]:
    """The meta item of each media-route URL (``None`` when it is not a usable file).

    Keys are exactly the URLs given (duplicates collapse). See the plan's
    ``/api/media/meta`` contract: ``v`` is always present for an existing
    picture or video; ``color``, ``blur``, ``w`` and ``h`` only for a fresh
    ``ready`` row; ``poster`` only for a video whose fresh row has a ready
    poster. Missing, stale and placeholder-pending rows
    (:func:`placeholder_pending`) are hinted to the worker, grouped per
    service, except videos waiting for a client poster
    (:func:`waiting_for_poster`). URLs that resolve outside their service folder count as
    ``invalid`` and add up to one ``path_traversal_blocked`` warning per
    request (``count``). The blocking part runs in one ``asyncio.to_thread`` hop.
    """
    unique = list(dict.fromkeys(urls))
    batch = await asyncio.to_thread(_load, unique)
    items: dict[str, dict[str, Any] | None] = dict.fromkeys(unique)
    hints: dict[str, list[str]] = {}
    ready = stale = 0
    for t in batch.targets:
        row = batch.rows.get(t.rel)
        items[t.url] = _item(t, row)
        if row is None or row.stat_key != t.stat_key:
            stale += row is not None
            hints.setdefault(t.service, []).append(t.rel)
        elif placeholder_pending(row) and not waiting_for_poster(row):
            hints.setdefault(t.service, []).append(t.rel)
        elif row.status == "ready":
            ready += 1
    for service, rels in hints.items():
        _hint(service, rels)
    if batch.outside:
        logger.warning("path_traversal_blocked", view="media_meta", count=batch.outside)
    logger.info(
        "media_meta",
        requested=len(urls),
        ready=ready,
        stale=stale,
        missing=batch.missing,
        invalid=batch.invalid + batch.outside,
        hinted=sum(len(r) for r in hints.values()),
    )
    return items
