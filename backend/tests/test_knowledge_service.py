"""Tests for `KnowledgeService` — the wiring of the pysaka knowledge engine.

Injects a deterministic `FakeEmbedder` + a scripted `FakeLLMClient` + a tmp
`SqliteKnowledgeStore` through the constructor, indexes a tiny in-memory members
set plus one on-disk messages file, then drives `ask()` end-to-end. The reference
data dir (`data/members`, `data/knowledge`) is patched to a tmp fixture, and the
message-file path resolver is patched to the tmp messages file — so the test never
touches the real user output dir or roster.

The happy-path ask deliberately routes through `sort="relevant"`, which exercises
the zero-re-embed rehydration: at ask-time the persisted docs are re-chunked and
fed to `HybridRetriever.index_lexical(...)` (no corpus embedding), and the vector
arm of `search()` runs against the vectors the `SqliteKnowledgeStore` persisted at
index-time. Only the query is embedded at ask-time.
"""

from __future__ import annotations

import json
from datetime import timezone
from pathlib import Path

import pytest

from backend.services.knowledge_store import SqliteKnowledgeStore
from pysaka.knowledge.llm import FakeLLMClient, LLMResponse, ToolCall
from pysaka.knowledge.models import Answer, Scope

_SERVICE = "hinatazaka46"
_MSG_ID = 500001
# Author canonical id == f"{service}:{blogId}" for member A (佐藤 花, blogId 10);
# doc_id == f"msg:{service}:{author}:{message_id}" (see pysaka ingest_messages).
_AUTHOR_ID = f"{_SERVICE}:10"
_DOC_ID = f"msg:{_SERVICE}:{_AUTHOR_ID}:{_MSG_ID}"
_MSG_TEXT = "鈴木 愛とライブに行きました"


class FakeEmbedder:
    """Deterministic embedder: fixed vector per exact input string (dim=2)."""

    dim = 2

    def __init__(self, vectors: dict[str, list[float]]) -> None:
        self._vectors = vectors

    def embed(self, texts: list[str], kind: str = "passage") -> list[list[float]]:
        return [self._vectors[text] for text in texts]


def _embedder() -> FakeEmbedder:
    # index-time embeds the passage (chunk context_text == the message text);
    # ask-time embeds the query "ライブ". Same vector -> cosine 1.
    return FakeEmbedder({_MSG_TEXT: [1.0, 0.0], "ライブ": [1.0, 0.0]})


def _write_reference_data(data_dir: Path) -> None:
    """Write a tiny 2-member roster fixture (A mentions B in her message)."""
    members = {
        "meta": {"group": "hinatazaka"},
        "members": [
            {
                "blogId": "10",
                "nameKanji": "佐藤 花",
                "nameHiragana": "さとう はな",
                "nameRomaji": "Sato Hana",
                "generation": 5,
                "status": "active",
            },
            {
                "blogId": "20",
                "nameKanji": "鈴木 愛",
                "nameHiragana": "すずき あい",
                "nameRomaji": "Suzuki Ai",
                "generation": 5,
                "status": "active",
            },
        ],
    }
    members_dir = data_dir / "members"
    members_dir.mkdir(parents=True, exist_ok=True)
    # Roster file is data/members/<service-with-46-stripped>.json.
    (members_dir / "hinatazaka.json").write_text(
        json.dumps(members, ensure_ascii=False), encoding="utf-8"
    )


def _write_messages_file(path: Path) -> None:
    payload = {
        "member": {"id": 145, "name": "佐藤 花", "group_id": 94},
        "messages": [
            {
                "id": _MSG_ID,
                "timestamp": "2026-06-15T09:30:00Z",
                "type": "text",
                "is_favorite": False,
                "content": _MSG_TEXT,
            }
        ],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


async def _build_indexed_service(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    llm: FakeLLMClient | None,
):
    """Build a KnowledgeService over a tmp store/data-dir, index one member's messages."""
    from backend.services import knowledge_service as ks

    data_dir = tmp_path / "data"
    _write_reference_data(data_dir)

    messages_file = tmp_path / "messages.json"
    _write_messages_file(messages_file)
    monkeypatch.setattr(
        ks, "resolve_messages_file", lambda service, group_id, member_id: messages_file
    )

    store = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    svc = ks.KnowledgeService(
        store=store, embedder=_embedder(), llm=llm, data_dir=data_dir
    )

    group = {"id": 94, "name": "日向坂46"}
    member = {"id": 145, "name": "佐藤 花"}
    await svc.index_members([(group, member)], _SERVICE)
    return svc, store


@pytest.mark.asyncio
async def test_ask_returns_validated_answer_with_surfaced_citation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Scripted agent: search (relevant, mentions B) -> final answer citing the doc.
    script = [
        LLMResponse(
            tool_calls=[
                ToolCall(
                    "search",
                    {
                        "mentions": "鈴木 愛",
                        "query": "ライブ",
                        "sort": "relevant",
                        "limit": 5,
                    },
                    id="call_1",
                )
            ]
        ),
        LLMResponse(
            text=json.dumps(
                {"sentences": [{"text": _MSG_TEXT, "citation_ids": [_DOC_ID]}]}
            )
        ),
    ]
    svc, _store = await _build_indexed_service(
        tmp_path, monkeypatch, FakeLLMClient(script)
    )

    answer = await svc.ask(
        "when did 佐藤 花 mention 鈴木 愛", Scope(service=_SERVICE), timezone.utc
    )

    assert isinstance(answer, Answer)
    assert answer.no_evidence is False
    assert len(answer.sentences) == 1
    # The citation the model returned must be the doc_id the retriever surfaced.
    assert _DOC_ID in answer.sentences[0].citation_ids
    assert [c.doc_id for c in answer.citations] == [_DOC_ID]


@pytest.mark.asyncio
async def test_ask_no_match_returns_no_evidence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    script = [LLMResponse(text=json.dumps({"no_evidence": True}))]
    svc, _store = await _build_indexed_service(
        tmp_path, monkeypatch, FakeLLMClient(script)
    )

    answer = await svc.ask(
        "who mentioned nobody at all", Scope(service=_SERVICE), timezone.utc
    )

    assert answer.no_evidence is True
    assert answer.sentences == []
    assert answer.citations == []


@pytest.mark.asyncio
async def test_index_members_is_idempotent_via_content_hash(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    svc, store = await _build_indexed_service(tmp_path, monkeypatch, None)

    # Re-indexing the unchanged messages file must persist zero new/changed docs.
    group = {"id": 94, "name": "日向坂46"}
    member = {"id": 145, "name": "佐藤 花"}
    changed = await svc.index_members([(group, member)], _SERVICE)
    assert changed == 0

    docs = store.documents_for_service(_SERVICE)
    assert len(docs) == 1
    # Mention detection ran at index time and was persisted.
    assert f"{_SERVICE}:20" in docs[0].mentions
    # `group_name` must be enriched onto the persisted MESSAGE source_ref (the
    # deep-link citation regression guard): pysaka's `ingest_messages` never
    # sees the `group` dict, so `_index_members_sync` fills it in from
    # `group["name"]` before persisting.
    assert docs[0].source_ref.group_name == group["name"]


@pytest.mark.asyncio
async def test_status_reports_indexed_document_count(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    svc, _store = await _build_indexed_service(tmp_path, monkeypatch, None)

    status = svc.status(_SERVICE)
    assert status["document_count"] == 1
    assert status["by_type"].get("text_msg") == 1


@pytest.mark.asyncio
async def test_status_reads_via_independent_connection_while_data_exists(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`status()` must no longer touch the shared store connection (see module docs
    on the ask-vs-status race). It now opens its own short-lived connection to the
    same db file; this asserts that still works and returns correct counts, both
    scoped to a service and overall.
    """
    svc, _store = await _build_indexed_service(tmp_path, monkeypatch, None)

    scoped = svc.status(_SERVICE)
    assert scoped["service"] == _SERVICE
    assert scoped["document_count"] == 1
    assert scoped["by_type"] == {"text_msg": 1}

    overall = svc.status()
    assert overall["service"] is None
    assert overall["document_count"] == 1


@pytest.mark.asyncio
async def test_index_members_skips_member_with_missing_messages_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """One member whose messages file/folder isn't synced yet (`resolve_messages_file`
    raises `FileNotFoundError`) must be skipped, not abort the whole batch — the
    other member(s) in the same call still get indexed.
    """
    from backend.services import knowledge_service as ks

    data_dir = tmp_path / "data"
    _write_reference_data(data_dir)

    messages_file = tmp_path / "messages.json"
    _write_messages_file(messages_file)

    def fake_resolve(service: str, group_id: int, member_id: int) -> Path:
        if member_id == 999:
            raise FileNotFoundError(f"no synced folder for member {member_id}")
        return messages_file

    monkeypatch.setattr(ks, "resolve_messages_file", fake_resolve)

    store = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    svc = ks.KnowledgeService(
        store=store, embedder=_embedder(), llm=None, data_dir=data_dir
    )

    group = {"id": 94, "name": "日向坂46"}
    unsynced_member = {"id": 999, "name": "unsynced"}
    synced_member = {"id": 145, "name": "佐藤 花"}

    # The unsynced member must not raise and must not block the synced member.
    changed = await svc.index_members(
        [(group, unsynced_member), (group, synced_member)], _SERVICE
    )
    assert changed == 1

    docs = store.documents_for_service(_SERVICE)
    assert len(docs) == 1


class ExplodingThenWorkingEmbedder:
    """Embedder that raises on the first call, then delegates — simulates a crash mid-index."""

    dim = 2

    def __init__(self, inner: FakeEmbedder) -> None:
        self._inner = inner
        self.calls = 0

    def embed(self, texts: list[str], kind: str = "passage") -> list[list[float]]:
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("simulated crash mid-embedding")
        return self._inner.embed(texts, kind)


@pytest.mark.asyncio
async def test_interrupted_embedding_does_not_strand_docs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Vectors are persisted BEFORE doc rows are marked done: an index pass that
    dies mid-embed leaves the docs "changed", so the next pass retries and fully
    indexes them (no permanently vector-less documents)."""
    from backend.services import knowledge_service as ks

    data_dir = tmp_path / "data"
    _write_reference_data(data_dir)
    messages_file = tmp_path / "messages.json"
    _write_messages_file(messages_file)
    monkeypatch.setattr(
        ks, "resolve_messages_file", lambda service, group_id, member_id: messages_file
    )

    store = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    embedder = ExplodingThenWorkingEmbedder(_embedder())
    svc = ks.KnowledgeService(
        store=store, embedder=embedder, llm=None, data_dir=data_dir
    )
    group = {"id": 94, "name": "日向坂46"}
    member = {"id": 145, "name": "佐藤 花"}

    with pytest.raises(RuntimeError, match="simulated crash"):
        await svc.index_members([(group, member)], _SERVICE)
    # The doc must NOT have been marked done by the failed pass...
    assert store.documents_for_service(_SERVICE) == []

    # ...so a retry picks it up and completes doc + vector persistence.
    indexed = await svc.index_members([(group, member)], _SERVICE)
    assert indexed == 1
    docs = store.documents_for_service(_SERVICE)
    assert len(docs) == 1
    assert store.search([1.0, 0.0], k=1)[0][0].startswith(docs[0].doc_id)


@pytest.mark.asyncio
async def test_ask_lazily_rebuilds_llm_client_when_none(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A service whose LLM client is None (key unavailable at startup — e.g. a
    transient keyring failure, or the user configures the key after app start)
    retries `build_llm_client_from_settings()` on ask instead of staying
    permanently misconfigured until restart."""
    from backend.services import knowledge_service as ks

    script = [LLMResponse(text=json.dumps({"no_evidence": True}))]

    async def _fake_build() -> FakeLLMClient:
        return FakeLLMClient(script)

    monkeypatch.setattr(ks, "build_llm_client_from_settings", _fake_build)
    svc, _store = await _build_indexed_service(tmp_path, monkeypatch, llm=None)

    answer = await svc.ask("anything", Scope(service=_SERVICE), timezone.utc)

    assert answer.no_evidence is True  # the lazily-built client answered


@pytest.mark.asyncio
async def test_ask_raises_misconfigured_when_llm_still_unbuildable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from backend.services import knowledge_service as ks

    async def _fake_build() -> None:
        return None

    monkeypatch.setattr(ks, "build_llm_client_from_settings", _fake_build)
    svc, _store = await _build_indexed_service(tmp_path, monkeypatch, llm=None)

    with pytest.raises(ks.KnowledgeMisconfigured):
        await svc.ask("anything", Scope(service=_SERVICE), timezone.utc)
