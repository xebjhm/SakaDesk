"""Sqlite-backed persistence for the KB-chatbot knowledge index.

`SqliteKnowledgeStore` is the durable counterpart to pysaka's in-memory
`DocumentStore` and `NumpyVectorStore`: it persists `Document` rows (with
their `SourceRef` and `mentions`) plus embedding vectors to a dedicated
sqlite file (``knowledge_index.db``, decoupled from ``search_index.db``),
and structurally satisfies the pysaka `VectorStore` protocol (`add`/
`remove`/`search`) by delegating to an in-memory `NumpyVectorStore` that is
rehydrated from the persisted vector blobs on open.

All access here is synchronous — the service layer (Task 3) is responsible
for offloading calls onto a thread via `asyncio.to_thread`.

**Schema migrations (Product-wave Task 4 fold-in).** The db's `PRAGMA
user_version` (sqlite's built-in per-file integer, 0 on a brand-new file)
tracks how far this file's schema has progressed. `_MIGRATIONS` is an
ordered list of plain functions, each taking the schema from version `i` to
`i + 1`; `_run_migrations` replays whichever suffix of that list a given
file hasn't run yet, each migration in its OWN transaction immediately
followed by the version bump (so a mid-migration crash never leaves
`user_version` claiming a migration completed that didn't). A file at
`user_version` 0 (created before this runner existed, back when schema init
was a bare `CREATE TABLE IF NOT EXISTS` block) migrates forward with
migration 1 being a NO-OP for its already-existing tables (same idempotent
`CREATE TABLE IF NOT EXISTS` SQL) -- no data is touched, only the version
counter advances. A brand-new file runs every migration in sequence,
landing directly on the latest version. Opening a file whose
`user_version` is NEWER than `_LATEST_SCHEMA_VERSION` (a newer SakaDesk
version already touched it) refuses to open with a clear
`KnowledgeStoreVersionError` rather than silently misreading a schema this
version doesn't understand.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

import numpy as np
import structlog

from pysaka.knowledge import DocumentStore
from pysaka.knowledge.backends.numpy_store import NumpyVectorStore
from pysaka.knowledge.models import Document, SourceRef

logger = structlog.get_logger(__name__)

# Migration 1: the original (pre-migration-runner) schema -- kb_documents,
# kb_mentions, kb_vectors. `CREATE TABLE IF NOT EXISTS` makes this a genuine
# no-op replay for a v0 db that already has these tables (see module
# docstring), and the normal path for a brand-new file.
_SCHEMA_V1_SQL = """
CREATE TABLE IF NOT EXISTS kb_documents (
    doc_id TEXT PRIMARY KEY,
    service TEXT NOT NULL,
    source_ref_json TEXT NOT NULL,
    author_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    type TEXT NOT NULL,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL,
    has_text INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kb_documents_service ON kb_documents(service);

CREATE TABLE IF NOT EXISTS kb_mentions (
    doc_id TEXT NOT NULL,
    mentions_id TEXT NOT NULL,
    PRIMARY KEY (doc_id, mentions_id)
);

CREATE INDEX IF NOT EXISTS idx_kb_mentions_id ON kb_mentions(mentions_id);

CREATE TABLE IF NOT EXISTS kb_vectors (
    id TEXT PRIMARY KEY,
    dim INTEGER NOT NULL,
    vec BLOB NOT NULL
);
"""

# Migration 2: `kb_meta`, a generic key/value table -- currently holds the
# embedder fingerprint (`embedder_fingerprint`) and the reindex-required
# sentinel (`reindex_required`), see `KnowledgeService._check_fingerprint`.
_SCHEMA_V2_SQL = """
CREATE TABLE IF NOT EXISTS kb_meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""


def _migrate_to_v1(conn: sqlite3.Connection) -> None:
    conn.executescript(_SCHEMA_V1_SQL)


def _migrate_to_v2(conn: sqlite3.Connection) -> None:
    conn.executescript(_SCHEMA_V2_SQL)


# Index `i` migrates a db from version `i` to version `i + 1`. Append here,
# never edit/remove a past entry -- a released migration is a historical
# fact for every db file that already ran it.
_MIGRATIONS: list[Callable[[sqlite3.Connection], None]] = [
    _migrate_to_v1,
    _migrate_to_v2,
]
_LATEST_SCHEMA_VERSION = len(_MIGRATIONS)


class KnowledgeStoreVersionError(RuntimeError):
    """`knowledge_index.db`'s `PRAGMA user_version` is newer than this
    SakaDesk version's `_LATEST_SCHEMA_VERSION` -- i.e. a newer SakaDesk
    release already migrated this file forward, and opening it here would
    mean reading/writing a schema this version doesn't fully understand.
    Refuses to open rather than risk silent corruption; the fix is
    upgrading SakaDesk, not touching the db file.
    """


def _run_migrations(conn: sqlite3.Connection) -> None:
    """Bring `conn`'s db forward to `_LATEST_SCHEMA_VERSION`, or raise
    `KnowledgeStoreVersionError` if it's already newer than that.

    Each migration runs in its own transaction, immediately followed by its
    version bump in the SAME transaction (`PRAGMA user_version` can't take a
    bound parameter, but the value here is always this module's own
    trusted integer, never external input) -- a crash mid-migration leaves
    `user_version` at the last successfully-completed step, so the next open
    resumes from exactly there instead of re-running (or skipping) a step.
    """
    current_version = conn.execute("PRAGMA user_version").fetchone()[0]
    if current_version > _LATEST_SCHEMA_VERSION:
        raise KnowledgeStoreVersionError(
            f"knowledge_index.db is at schema version {current_version}, "
            f"newer than the {_LATEST_SCHEMA_VERSION} this SakaDesk version "
            "supports. Upgrade SakaDesk to open it."
        )
    for version in range(current_version, _LATEST_SCHEMA_VERSION):
        migrate = _MIGRATIONS[version]
        with conn:
            migrate(conn)
            conn.execute(f"PRAGMA user_version = {version + 1}")
        logger.info(
            "knowledge_store.migrated", from_version=version, to_version=version + 1
        )


_DOCUMENT_COLUMNS = (
    "doc_id, source_ref_json, author_id, timestamp, type, is_favorite, text, has_text"
)

# Sqlite's default SQLITE_MAX_VARIABLE_NUMBER; IN (...) queries must be
# chunked below this to avoid "too many SQL variables" on large corpora.
_SQLITE_MAX_VARIABLES = 999


class SqliteKnowledgeStore:
    """Durable `Document` + vector store for one knowledge index.

    `service` (as used by `documents_for_service`) mirrors the app-wide
    "service" concept (e.g. ``"hinatazaka46"``), which corresponds to
    `Document.group` — see `pysaka.knowledge.store.DocumentStore.filter`,
    where `SearchFilters.scope.service` is compared against `doc.group`.
    The full `SourceRef` (including its own `service` field) is preserved
    verbatim in `source_ref_json` for exact round-tripping.
    """

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        # `check_same_thread=False`: the service layer (Task 3) offloads store calls
        # onto `asyncio.to_thread` worker threads (never the thread that opened the
        # connection), so the connection must not be pinned to its creating thread.
        # The service serializes access (an `asyncio.Lock`), so only one thread ever
        # touches the connection at a time — safe despite the relaxed check.
        self._conn = sqlite3.connect(str(self._db_path), check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA busy_timeout=30000")
        _run_migrations(self._conn)
        self._vector_store = NumpyVectorStore()
        self._load_vectors()
        # Bumped by every persisted write (`add`/`upsert_documents`/`remove`) that
        # actually changes something. `KnowledgeService._ensure_retriever_cached`
        # keys its per-service `(DocumentStore, HybridRetriever)` cache on this
        # value: a mismatch means the corpus changed since the retriever was
        # assembled, so the cache is invalidated and rebuilt. Not persisted
        # in-db -- it only needs to be unique WITHIN this process's lifetime
        # (rebuilt from vector blobs at every fresh open anyway).
        self.generation = 0
        logger.debug("knowledge_store.opened", path=str(self._db_path))

    def close(self) -> None:
        """Close the underlying sqlite connection."""
        self._conn.close()

    @property
    def db_path(self) -> Path:
        """The sqlite file this store persists to.

        Exposed so callers (e.g. `KnowledgeService.status`) can open their OWN
        independent connection to the same file for read-only access, rather than
        touching the shared `self._conn` (which is not safe to read concurrently
        with an in-flight write from another thread despite
        `check_same_thread=False` — that flag only lifts sqlite's same-thread
        check, it doesn't make the connection itself concurrency-safe).
        """
        return self._db_path

    # ------------------------------------------------------------------
    # Document persistence
    # ------------------------------------------------------------------

    def changed_document_ids(self, docs: list[Document]) -> list[str]:
        """The `doc_id`s in `docs` that are new or whose content changed — READ-ONLY.

        Same content-hash comparison as `upsert_documents`, but without writing,
        so callers can embed a changed doc's chunks FIRST and only then upsert
        (mark it done). If the process dies mid-embed, the doc stays "changed"
        and the next index pass retries it — vectors are INSERT OR REPLACE, so
        the retry is idempotent. Persisting the doc row first would strand its
        unembedded chunks permanently (the content-hash skip would never
        revisit them).

        Batches the existing-hash lookup into chunked `WHERE doc_id IN (...)`
        selects (`_SQLITE_MAX_VARIABLES` per query) instead of one `SELECT` per
        doc -- this is the hot path a hook-triggered sync/backup runs on EVERY
        doc regardless of whether anything changed, so an O(n) query count here
        directly costs a large corpus (e.g. 26k docs -> 26k queries) real
        wall-clock time even when the answer is "nothing changed".
        """
        existing_hashes = self._fetch_content_hashes([doc.doc_id for doc in docs])
        changed: list[str] = []
        for doc in docs:
            new_hash = DocumentStore.content_hash(doc)
            if existing_hashes.get(doc.doc_id) != new_hash:
                changed.append(doc.doc_id)
        return changed

    def _fetch_content_hashes(self, doc_ids: list[str]) -> dict[str, str]:
        """`doc_id -> content_hash` for every id in `doc_ids` currently persisted."""
        hashes: dict[str, str] = {}
        for start in range(0, len(doc_ids), _SQLITE_MAX_VARIABLES):
            chunk = doc_ids[start : start + _SQLITE_MAX_VARIABLES]
            placeholders = ",".join("?" * len(chunk))
            rows = self._conn.execute(
                "SELECT doc_id, content_hash FROM kb_documents "
                f"WHERE doc_id IN ({placeholders})",
                chunk,
            ).fetchall()
            hashes.update(rows)
        return hashes

    def upsert_documents(self, docs: list[Document]) -> list[str]:
        """Insert or update `docs`, keyed by `doc_id`.

        A doc whose `content_hash` (see `DocumentStore.content_hash`) matches
        the already-stored row is left untouched. Returns the `doc_id`s that
        were newly inserted or whose content changed — the set of documents
        that need (re-)embedding downstream.
        """
        changed: list[str] = []
        for doc in docs:
            new_hash = DocumentStore.content_hash(doc)
            existing = self._conn.execute(
                "SELECT content_hash FROM kb_documents WHERE doc_id = ?",
                (doc.doc_id,),
            ).fetchone()
            if existing is not None and existing[0] == new_hash:
                continue
            changed.append(doc.doc_id)
            self._conn.execute(
                "INSERT OR REPLACE INTO kb_documents "
                "(doc_id, service, source_ref_json, author_id, timestamp, type, "
                "is_favorite, text, has_text, content_hash) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    doc.doc_id,
                    doc.group,
                    json.dumps(asdict(doc.source_ref), ensure_ascii=False),
                    doc.author_id,
                    doc.timestamp.isoformat(),
                    doc.type,
                    int(doc.is_favorite),
                    doc.text,
                    int(doc.has_text),
                    new_hash,
                ),
            )
            self._conn.execute(
                "DELETE FROM kb_mentions WHERE doc_id = ?", (doc.doc_id,)
            )
            if doc.mentions:
                self._conn.executemany(
                    "INSERT INTO kb_mentions (doc_id, mentions_id) VALUES (?, ?)",
                    [(doc.doc_id, mention_id) for mention_id in doc.mentions],
                )
        self._conn.commit()
        if changed:
            self.generation += 1
        logger.debug("knowledge_store.upserted", total=len(docs), changed=len(changed))
        return changed

    def get_document(self, doc_id: str) -> Document | None:
        """The document stored under `doc_id`, or `None` if absent."""
        row = self._conn.execute(
            f"SELECT {_DOCUMENT_COLUMNS} FROM kb_documents WHERE doc_id = ?",
            (doc_id,),
        ).fetchone()
        if row is None:
            return None
        mentions_map = self._fetch_mentions_map([doc_id])
        return self._row_to_document(row, mentions_map[doc_id])

    def all_documents(self) -> list[Document]:
        """Every stored document, ordered by `doc_id`."""
        rows = self._conn.execute(
            f"SELECT {_DOCUMENT_COLUMNS} FROM kb_documents ORDER BY doc_id"
        ).fetchall()
        mentions_map = self._fetch_mentions_map([row[0] for row in rows])
        return [self._row_to_document(row, mentions_map[row[0]]) for row in rows]

    def documents_for_service(self, service: str) -> list[Document]:
        """Documents whose `group` equals `service`, ordered by `doc_id`."""
        rows = self._conn.execute(
            f"SELECT {_DOCUMENT_COLUMNS} FROM kb_documents "
            "WHERE service = ? ORDER BY doc_id",
            (service,),
        ).fetchall()
        mentions_map = self._fetch_mentions_map([row[0] for row in rows])
        return [self._row_to_document(row, mentions_map[row[0]]) for row in rows]

    def _fetch_mentions_map(self, doc_ids: list[str]) -> dict[str, list[str]]:
        """`doc_id -> mentions` (each sorted) for every id in `doc_ids`.

        Batches the lookup into `SELECT ... WHERE doc_id IN (...)` queries
        instead of issuing one query per document, chunking at
        `_SQLITE_MAX_VARIABLES` to respect sqlite's host-parameter limit.
        """
        mentions_map: dict[str, list[str]] = {doc_id: [] for doc_id in doc_ids}
        for start in range(0, len(doc_ids), _SQLITE_MAX_VARIABLES):
            chunk = doc_ids[start : start + _SQLITE_MAX_VARIABLES]
            placeholders = ",".join("?" * len(chunk))
            rows = self._conn.execute(
                "SELECT doc_id, mentions_id FROM kb_mentions "
                f"WHERE doc_id IN ({placeholders}) ORDER BY doc_id, mentions_id",
                chunk,
            ).fetchall()
            for doc_id, mentions_id in rows:
                mentions_map[doc_id].append(mentions_id)
        return mentions_map

    def _row_to_document(self, row: tuple, mentions: list[str]) -> Document:
        (
            doc_id,
            source_ref_json,
            author_id,
            timestamp,
            type_,
            is_favorite,
            text,
            has_text,
        ) = row
        source_ref = SourceRef(**json.loads(source_ref_json))
        return Document(
            doc_id=doc_id,
            source_ref=source_ref,
            author_id=author_id,
            group=source_ref.service,
            timestamp=datetime.fromisoformat(timestamp),
            type=type_,
            is_favorite=bool(is_favorite),
            text=text,
            has_text=bool(has_text),
            mentions=mentions,
        )

    # ------------------------------------------------------------------
    # VectorStore protocol (add/remove/search) — structural conformance,
    # delegates to an in-memory NumpyVectorStore backed by kb_vectors.
    # ------------------------------------------------------------------

    def _load_vectors(self) -> None:
        rows = self._conn.execute("SELECT id, vec FROM kb_vectors").fetchall()
        if not rows:
            return
        ids = [row[0] for row in rows]
        vectors = [np.frombuffer(row[1], dtype=np.float32).tolist() for row in rows]
        self._vector_store.add(ids, vectors)
        logger.debug("knowledge_store.vectors_loaded", count=len(ids))

    def add(self, ids: list[str], vectors: list[list[float]]) -> None:
        """Add or update vectors, both in-memory and persisted to `kb_vectors`."""
        if not ids:
            return
        self._vector_store.add(ids, vectors)
        rows = [
            (id_, len(vector), np.asarray(vector, dtype=np.float32).tobytes())
            for id_, vector in zip(ids, vectors)
        ]
        self._conn.executemany(
            "INSERT OR REPLACE INTO kb_vectors (id, dim, vec) VALUES (?, ?, ?)",
            rows,
        )
        self._conn.commit()
        self.generation += 1

    def remove(self, ids: list[str]) -> None:
        """Remove vectors, both in-memory and from `kb_vectors`."""
        if not ids:
            return
        self._vector_store.remove(ids)
        self._conn.executemany(
            "DELETE FROM kb_vectors WHERE id = ?", [(id_,) for id_ in ids]
        )
        self._conn.commit()
        self.generation += 1

    def search(
        self, vector: list[float], k: int, allowed_ids: set[str] | None = None
    ) -> list[tuple[str, float]]:
        """Delegate nearest-neighbor search to the in-memory `NumpyVectorStore`."""
        results: list[tuple[str, float]] = self._vector_store.search(
            vector, k, allowed_ids
        )
        return results

    # ------------------------------------------------------------------
    # kb_meta (Product-wave Task 4 fold-in) — generic key/value metadata.
    # Interpretation (what a key MEANS) belongs to `KnowledgeService`, e.g.
    # the `embedder_fingerprint` / `reindex_required` keys -- see
    # `KnowledgeService._check_fingerprint`. This store only persists bytes.
    # ------------------------------------------------------------------

    def get_meta(self, key: str) -> str | None:
        """The stored value for `key`, or `None` if never set."""
        row = self._conn.execute(
            "SELECT value FROM kb_meta WHERE key = ?", (key,)
        ).fetchone()
        return row[0] if row is not None else None

    def set_meta(self, key: str, value: str) -> None:
        """Insert or overwrite `key`'s stored value."""
        self._conn.execute(
            "INSERT OR REPLACE INTO kb_meta (key, value) VALUES (?, ?)", (key, value)
        )
        self._conn.commit()

    def wipe_vectors_and_content_hashes(self) -> None:
        """Global vector-space reset for an embedder fingerprint mismatch (see
        `KnowledgeService._check_fingerprint`): deletes every persisted vector
        (`kb_vectors`, plus the in-memory `NumpyVectorStore` mirror -- leaving
        the latter stale would let searches keep returning vectors from the
        OLD embedding model even after the table is cleared) and blanks every
        document's `content_hash` so the next index/rebuild pass treats the
        ENTIRE corpus (every service) as changed and re-embeds it. Document
        rows themselves (text/mentions/source_ref) are left intact -- only
        the vectors and the hash gating re-embedding are cleared. This is the
        "do NOT silently mix vector spaces" guard: safer to make search
        temporarily return nothing for not-yet-rebuilt services than to let
        two different embedding models' vectors coexist in one search.
        """
        self._conn.execute("DELETE FROM kb_vectors")
        self._conn.execute("UPDATE kb_documents SET content_hash = ''")
        self._conn.commit()
        self._vector_store = NumpyVectorStore()
        self.generation += 1
        logger.warning("knowledge_store.vectors_wiped")
