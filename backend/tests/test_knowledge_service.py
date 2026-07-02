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


@pytest.mark.asyncio
async def test_status_reports_indexed_document_count(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    svc, _store = await _build_indexed_service(tmp_path, monkeypatch, None)

    status = svc.status(_SERVICE)
    assert status["document_count"] == 1
    assert status["by_type"].get("text_msg") == 1
