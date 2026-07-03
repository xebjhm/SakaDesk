"""Tests for the sqlite-backed knowledge index store.

Covers the round-trip persistence contract: `Document` rows and vectors
written by one `SqliteKnowledgeStore` instance must be readable (and
searchable) by a fresh instance opened against the same db file.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest

from backend.services.knowledge_store import (
    _LATEST_SCHEMA_VERSION,
    _MIGRATIONS,
    KnowledgeStoreVersionError,
    SqliteKnowledgeStore,
)
from pysaka.knowledge import VectorStore
from pysaka.knowledge.models import Document, SourceRef


def _doc(
    i: int, *, text: str | None = None, mentions: list[str] | None = None
) -> Document:
    return Document(
        doc_id=f"blog:hinatazaka46:{i}",
        source_ref=SourceRef(
            service="hinatazaka46", kind="blog", blog_id=str(i), member_id=12
        ),
        author_id="hinatazaka46:12",
        group="hinatazaka46",
        timestamp=datetime(2026, 3, 3, tzinfo=timezone.utc),
        type="blog",
        is_favorite=False,
        text=text if text is not None else f"焼肉{i}",
        has_text=True,
        mentions=mentions or [],
    )


def test_persist_and_reload(tmp_path: Path) -> None:
    p = tmp_path / "knowledge_index.db"
    s = SqliteKnowledgeStore(p)
    s.upsert_documents([_doc(1), _doc(2)])
    s.add(["blog:hinatazaka46:1", "blog:hinatazaka46:2"], [[1.0, 0.0], [0.0, 1.0]])
    s.close()

    s2 = SqliteKnowledgeStore(p)
    doc1 = s2.get_document("blog:hinatazaka46:1")
    assert doc1 is not None
    assert doc1.text == "焼肉1"
    assert s2.search([1.0, 0.0], k=1)[0][0] == "blog:hinatazaka46:1"
    s2.close()


def test_implements_vector_store_protocol(tmp_path: Path) -> None:
    s = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    assert isinstance(s, VectorStore)
    s.close()


def test_get_document_missing_returns_none(tmp_path: Path) -> None:
    s = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    assert s.get_document("does:not:exist") is None
    s.close()


def test_all_documents_returns_every_upserted_doc(tmp_path: Path) -> None:
    s = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    s.upsert_documents([_doc(1), _doc(2), _doc(3)])
    doc_ids = {d.doc_id for d in s.all_documents()}
    assert doc_ids == {
        "blog:hinatazaka46:1",
        "blog:hinatazaka46:2",
        "blog:hinatazaka46:3",
    }
    s.close()


def test_documents_for_service_filters_by_group(tmp_path: Path) -> None:
    other = Document(
        doc_id="blog:sakurazaka46:1",
        source_ref=SourceRef(
            service="sakurazaka46", kind="blog", blog_id="1", member_id=5
        ),
        author_id="sakurazaka46:5",
        group="sakurazaka46",
        timestamp=datetime(2026, 3, 3, tzinfo=timezone.utc),
        type="blog",
        is_favorite=False,
        text="桜",
        has_text=True,
    )
    s = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    s.upsert_documents([_doc(1), _doc(2), other])
    hina_ids = {d.doc_id for d in s.documents_for_service("hinatazaka46")}
    assert hina_ids == {"blog:hinatazaka46:1", "blog:hinatazaka46:2"}
    saku_ids = {d.doc_id for d in s.documents_for_service("sakurazaka46")}
    assert saku_ids == {"blog:sakurazaka46:1"}
    s.close()


def test_upsert_documents_content_hash_dedupe(tmp_path: Path) -> None:
    s = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    changed_first = s.upsert_documents([_doc(1, text="original")])
    assert changed_first == ["blog:hinatazaka46:1"]

    # Re-upserting identical content should report no changes.
    changed_same = s.upsert_documents([_doc(1, text="original")])
    assert changed_same == []

    # Re-upserting with different text should report the doc as changed.
    changed_edited = s.upsert_documents([_doc(1, text="edited")])
    assert changed_edited == ["blog:hinatazaka46:1"]
    assert s.get_document("blog:hinatazaka46:1").text == "edited"
    s.close()


def test_upsert_documents_persists_mentions(tmp_path: Path) -> None:
    s = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    s.upsert_documents([_doc(1, mentions=["hinatazaka46:7", "hinatazaka46:9"])])
    doc = s.get_document("blog:hinatazaka46:1")
    assert doc is not None
    assert sorted(doc.mentions) == ["hinatazaka46:7", "hinatazaka46:9"]
    s.close()


def test_all_documents_attaches_each_docs_own_mentions(tmp_path: Path) -> None:
    """`all_documents()` batches the mentions lookup; guard against the
    batched grouping cross-wiring mentions between documents."""
    s = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    s.upsert_documents(
        [
            _doc(1, mentions=["hinatazaka46:1"]),
            _doc(2, mentions=["hinatazaka46:2", "hinatazaka46:3"]),
            _doc(3, mentions=[]),
        ]
    )
    docs_by_id = {d.doc_id: d for d in s.all_documents()}
    assert sorted(docs_by_id["blog:hinatazaka46:1"].mentions) == ["hinatazaka46:1"]
    assert sorted(docs_by_id["blog:hinatazaka46:2"].mentions) == [
        "hinatazaka46:2",
        "hinatazaka46:3",
    ]
    assert docs_by_id["blog:hinatazaka46:3"].mentions == []
    s.close()


def test_documents_for_service_attaches_each_docs_own_mentions(
    tmp_path: Path,
) -> None:
    """`documents_for_service()` batches the mentions lookup; guard against
    the batched grouping cross-wiring mentions between documents."""
    other = Document(
        doc_id="blog:sakurazaka46:1",
        source_ref=SourceRef(
            service="sakurazaka46", kind="blog", blog_id="1", member_id=5
        ),
        author_id="sakurazaka46:5",
        group="sakurazaka46",
        timestamp=datetime(2026, 3, 3, tzinfo=timezone.utc),
        type="blog",
        is_favorite=False,
        text="桜",
        has_text=True,
        mentions=["sakurazaka46:99"],
    )
    s = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    s.upsert_documents(
        [
            _doc(1, mentions=["hinatazaka46:1"]),
            _doc(2, mentions=["hinatazaka46:2", "hinatazaka46:3"]),
            other,
        ]
    )
    docs_by_id = {d.doc_id: d for d in s.documents_for_service("hinatazaka46")}
    assert sorted(docs_by_id["blog:hinatazaka46:1"].mentions) == ["hinatazaka46:1"]
    assert sorted(docs_by_id["blog:hinatazaka46:2"].mentions) == [
        "hinatazaka46:2",
        "hinatazaka46:3",
    ]
    # The other-service doc's mentions must never leak into this result set.
    assert "blog:sakurazaka46:1" not in docs_by_id
    s.close()


def test_vector_remove(tmp_path: Path) -> None:
    s = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    s.upsert_documents([_doc(1), _doc(2)])
    s.add(["blog:hinatazaka46:1", "blog:hinatazaka46:2"], [[1.0, 0.0], [0.0, 1.0]])
    s.remove(["blog:hinatazaka46:1"])
    s.close()

    s2 = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    results = s2.search([1.0, 0.0], k=5)
    assert "blog:hinatazaka46:1" not in [id_ for id_, _ in results]
    assert "blog:hinatazaka46:2" in [id_ for id_, _ in results]
    s2.close()


def test_search_allowed_ids_filter(tmp_path: Path) -> None:
    s = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    s.upsert_documents([_doc(1), _doc(2)])
    s.add(["blog:hinatazaka46:1", "blog:hinatazaka46:2"], [[1.0, 0.0], [0.9, 0.1]])
    results = s.search([1.0, 0.0], k=5, allowed_ids={"blog:hinatazaka46:2"})
    assert [id_ for id_, _ in results] == ["blog:hinatazaka46:2"]
    s.close()


# ---------------------------------------------------------------------------
# Product-wave Task 4, fold-in: PRAGMA user_version migration runner + kb_meta
# ---------------------------------------------------------------------------


class TestMigrations:
    def test_fresh_db_initializes_straight_to_latest_version(
        self, tmp_path: Path
    ) -> None:
        db_path = tmp_path / "knowledge_index.db"
        s = SqliteKnowledgeStore(db_path)
        s.close()

        conn = sqlite3.connect(str(db_path))
        try:
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            assert version == _LATEST_SCHEMA_VERSION
            # kb_meta (migration 2) must exist on a totally fresh db too.
            conn.execute("SELECT key, value FROM kb_meta")
        finally:
            conn.close()

    def test_v0_db_with_existing_data_migrates_to_latest_intact(
        self, tmp_path: Path
    ) -> None:
        """A db created before the migration runner existed (`user_version`
        defaults to 0, tables already created via the old bare `CREATE TABLE
        IF NOT EXISTS` schema init) must migrate forward to the latest
        version -- as a no-op for the already-existing tables -- WITHOUT
        losing any previously-persisted document/vector data."""
        db_path = tmp_path / "knowledge_index.db"
        conn = sqlite3.connect(str(db_path))
        conn.executescript(
            """
            CREATE TABLE kb_documents (
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
            CREATE TABLE kb_mentions (
                doc_id TEXT NOT NULL,
                mentions_id TEXT NOT NULL,
                PRIMARY KEY (doc_id, mentions_id)
            );
            CREATE TABLE kb_vectors (
                id TEXT PRIMARY KEY,
                dim INTEGER NOT NULL,
                vec BLOB NOT NULL
            );
            """
        )
        conn.execute(
            "INSERT INTO kb_documents (doc_id, service, source_ref_json, author_id, "
            "timestamp, type, is_favorite, text, has_text, content_hash) "
            "VALUES ('blog:hinatazaka46:1', 'hinatazaka46', '{}', 'hinatazaka46:1', "
            "'2026-01-01T00:00:00+00:00', 'blog', 0, 'pre-migration text', 1, 'hash1')"
        )
        conn.commit()
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 0
        conn.close()

        s = SqliteKnowledgeStore(db_path)
        try:
            row = s._conn.execute(
                "SELECT text FROM kb_documents WHERE doc_id = ?",
                ("blog:hinatazaka46:1",),
            ).fetchone()
            assert row[0] == "pre-migration text"
            assert s._conn.execute("PRAGMA user_version").fetchone()[0] == (
                _LATEST_SCHEMA_VERSION
            )
            # kb_meta was created by migration 2 even though the db pre-dated it.
            s.set_meta("probe", "ok")
            assert s.get_meta("probe") == "ok"
        finally:
            s.close()

    def test_db_with_future_version_refuses_to_open(self, tmp_path: Path) -> None:
        db_path = tmp_path / "knowledge_index.db"
        conn = sqlite3.connect(str(db_path))
        conn.execute(f"PRAGMA user_version = {_LATEST_SCHEMA_VERSION + 1}")
        conn.commit()
        conn.close()

        with pytest.raises(KnowledgeStoreVersionError, match="newer"):
            SqliteKnowledgeStore(db_path)

    def test_migrations_list_length_matches_latest_version(self) -> None:
        assert len(_MIGRATIONS) == _LATEST_SCHEMA_VERSION

    def test_reopening_a_fully_migrated_db_is_a_clean_noop(
        self, tmp_path: Path
    ) -> None:
        db_path = tmp_path / "knowledge_index.db"
        s1 = SqliteKnowledgeStore(db_path)
        s1.upsert_documents([_doc(1)])
        s1.close()

        s2 = SqliteKnowledgeStore(db_path)
        try:
            assert s2._conn.execute("PRAGMA user_version").fetchone()[0] == (
                _LATEST_SCHEMA_VERSION
            )
            assert s2.get_document("blog:hinatazaka46:1") is not None
        finally:
            s2.close()

    def test_a_failing_migration_leaves_db_at_prior_version_with_no_partial_ddl(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Finding 3 (P-4 review): migrations must be REALLY atomic, not just
        documented as such -- `executescript()` was empirically found to
        issue an implicit `COMMIT` before running (bypassing the `with
        conn:` block `_run_migrations` used to wrap it in), so a
        mid-migration failure used to leave the DDL that ran before the
        failure (and even the `user_version` bump right after it) committed
        anyway. This injects ONE MORE migration (beyond however many real
        ones currently exist, via a monkeypatched `_MIGRATIONS`) that
        creates one table successfully and then hits an invalid statement --
        with the fix, NEITHER that table NOR the version bump may survive,
        and every real migration's data (already committed in its own,
        earlier, successful transaction) must be untouched. Reads the real
        migration count from `store_module._MIGRATIONS` rather than
        hardcoding it, so this stays correct as new migrations are appended
        (e.g. Task 5's `kb_usage`, migration 3).
        """
        import backend.services.knowledge_store as store_module

        real_migration_count = len(store_module._MIGRATIONS)

        def _broken_migration(conn: sqlite3.Connection) -> None:
            conn.execute("CREATE TABLE kb_partial_migration_marker (id INTEGER)")
            conn.execute("THIS IS NOT VALID SQL")

        monkeypatch.setattr(
            store_module,
            "_MIGRATIONS",
            [*store_module._MIGRATIONS, _broken_migration],
        )
        monkeypatch.setattr(
            store_module, "_LATEST_SCHEMA_VERSION", real_migration_count + 1
        )

        db_path = tmp_path / "knowledge_index.db"
        with pytest.raises(sqlite3.OperationalError):
            SqliteKnowledgeStore(db_path)

        # A fresh connection to the same file: every REAL migration must have
        # committed (each ran in ITS OWN, already-successful transaction,
        # before the broken one ever started), but its partial DDL and
        # version bump must both be gone.
        conn = sqlite3.connect(str(db_path))
        try:
            assert (
                conn.execute("PRAGMA user_version").fetchone()[0]
                == real_migration_count
            )
            conn.execute("SELECT key, value FROM kb_meta")  # migration 2 intact
            with pytest.raises(sqlite3.OperationalError, match="no such table"):
                conn.execute("SELECT * FROM kb_partial_migration_marker")
        finally:
            conn.close()

    def test_migration_runner_restores_isolation_level_after_running(
        self, tmp_path: Path
    ) -> None:
        """`_run_migrations` temporarily sets `conn.isolation_level = None`
        (true autocommit) so it has exclusive control of `BEGIN`/`COMMIT`/
        `ROLLBACK` for the migration steps -- it must restore whatever the
        connection's isolation level was before returning, so every OTHER
        store method (`upsert_documents`/`add`/`remove`/`set_meta`, which
        all rely on the `sqlite3` module's normal implicit-transaction
        handling plus their own explicit `commit()`) keeps behaving exactly
        as before."""
        db_path = tmp_path / "knowledge_index.db"
        s = SqliteKnowledgeStore(db_path)
        try:
            # `sqlite3.connect()`'s default isolation level (deferred implicit
            # transactions) -- restored, not left at the migration runner's
            # `None` (true autocommit).
            assert s._conn.isolation_level == ""
        finally:
            s.close()


class TestKbMeta:
    def test_get_meta_missing_key_returns_none(self, tmp_path: Path) -> None:
        s = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
        assert s.get_meta("does-not-exist") is None
        s.close()

    def test_set_then_get_meta_round_trips(self, tmp_path: Path) -> None:
        s = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
        s.set_meta("embedder_fingerprint", '{"model_name": "x"}')
        assert s.get_meta("embedder_fingerprint") == '{"model_name": "x"}'
        s.close()

    def test_set_meta_overwrites_existing_value(self, tmp_path: Path) -> None:
        s = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
        s.set_meta("k", "v1")
        s.set_meta("k", "v2")
        assert s.get_meta("k") == "v2"
        s.close()

    def test_meta_persists_across_reopen(self, tmp_path: Path) -> None:
        db_path = tmp_path / "knowledge_index.db"
        s1 = SqliteKnowledgeStore(db_path)
        s1.set_meta("k", "v")
        s1.close()

        s2 = SqliteKnowledgeStore(db_path)
        assert s2.get_meta("k") == "v"
        s2.close()


# ---------------------------------------------------------------------------
# Product-wave Task 5, item 3: migration 3 -- `kb_usage` (the LLM request
# ledger, see `backend.services.llm_usage`).
# ---------------------------------------------------------------------------


class TestKbUsageMigration:
    def test_fresh_db_creates_kb_usage_table(self, tmp_path: Path) -> None:
        db_path = tmp_path / "knowledge_index.db"
        s = SqliteKnowledgeStore(db_path)
        s.close()

        conn = sqlite3.connect(str(db_path))
        try:
            assert conn.execute("PRAGMA user_version").fetchone()[0] == (
                _LATEST_SCHEMA_VERSION
            )
            # No error -- the table exists with the expected columns.
            conn.execute("SELECT model, day, count FROM kb_usage")
        finally:
            conn.close()

    def test_v2_db_migrates_forward_to_v3_and_gains_kb_usage(
        self, tmp_path: Path
    ) -> None:
        """A db that already ran migrations 1+2 (pre-Task-5) must pick up
        migration 3 on next open, landing at the latest version with
        `kb_usage` present and everything else untouched."""
        db_path = tmp_path / "knowledge_index.db"
        s = SqliteKnowledgeStore(db_path)
        s.set_meta("probe", "still-here")
        # Force this file back to `user_version = 2` (as if it had been
        # created by a SakaDesk build before this migration existed).
        s._conn.execute("PRAGMA user_version = 2")
        s.close()

        conn = sqlite3.connect(str(db_path))
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 2
        conn.close()

        s2 = SqliteKnowledgeStore(db_path)
        try:
            assert s2._conn.execute("PRAGMA user_version").fetchone()[0] == (
                _LATEST_SCHEMA_VERSION
            )
            s2._conn.execute("SELECT model, day, count FROM kb_usage")
            assert s2.get_meta("probe") == "still-here"
        finally:
            s2.close()

    def test_migrations_list_now_has_three_entries(self) -> None:
        assert len(_MIGRATIONS) == 3
        assert _LATEST_SCHEMA_VERSION == 3


# NOTE: `TestWipeVectorsAndContentHashes` (covering the now-removed
# `wipe_vectors_and_content_hashes()`) was deleted here -- P-4 review,
# Finding 2 (ADJUDICATED): a fingerprint mismatch flag-gates instead of
# wiping now. See `test_knowledge_service.py`'s `TestFingerprint` for the
# replacement coverage (vectors preserved, vector arm disabled at retriever
# assembly, flag round-trips on a model flip-back) and
# `SqliteKnowledgeStore.set_meta`'s neighboring comment for the removal
# rationale.
