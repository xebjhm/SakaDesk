"""Tests for the sqlite-backed knowledge index store.

Covers the round-trip persistence contract: `Document` rows and vectors
written by one `SqliteKnowledgeStore` instance must be readable (and
searchable) by a fresh instance opened against the same db file.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from backend.services.knowledge_store import SqliteKnowledgeStore
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
