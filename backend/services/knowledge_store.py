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
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

import numpy as np
import structlog

from pysaka.knowledge import DocumentStore
from pysaka.knowledge.backends.numpy_store import NumpyVectorStore
from pysaka.knowledge.models import Document, SourceRef

logger = structlog.get_logger(__name__)

_SCHEMA_SQL = """
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
        self._conn.executescript(_SCHEMA_SQL)
        self._conn.commit()
        self._vector_store = NumpyVectorStore()
        self._load_vectors()
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

    def remove(self, ids: list[str]) -> None:
        """Remove vectors, both in-memory and from `kb_vectors`."""
        self._vector_store.remove(ids)
        self._conn.executemany(
            "DELETE FROM kb_vectors WHERE id = ?", [(id_,) for id_ in ids]
        )
        self._conn.commit()

    def search(
        self, vector: list[float], k: int, allowed_ids: set[str] | None = None
    ) -> list[tuple[str, float]]:
        """Delegate nearest-neighbor search to the in-memory `NumpyVectorStore`."""
        results: list[tuple[str, float]] = self._vector_store.search(
            vector, k, allowed_ids
        )
        return results
