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

import asyncio
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from zoneinfo import ZoneInfo

import pytest

from backend.services.knowledge_store import SqliteKnowledgeStore
from backend.services.settings_store import load_config
from pysaka.knowledge.llm import FakeLLMClient, LLMResponse, ToolCall
from pysaka.knowledge.models import Answer, Chunk, Document, Scope, SourceRef

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
async def test_ask_raises_llm_backend_error_model_incompatible_after_repeated_invalid_tool_calls(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A model that keeps emitting unparseable tool-call arguments must abort the
    ask with a typed `LLMBackendError(kind="model_incompatible")` -- not let
    pysaka's `ToolCallingUnreliableError` (a pure/UI-agnostic engine exception)
    leak past this SakaDesk integration boundary unchanged."""
    from backend.services.llm_client import LLMBackendError

    script = [
        LLMResponse(
            tool_calls=[
                ToolCall("search", {}, id=f"call_{i}", invalid_reason="bad json")
            ]
        )
        for i in range(5)
    ]
    svc, _store = await _build_indexed_service(
        tmp_path, monkeypatch, FakeLLMClient(script)
    )

    with pytest.raises(LLMBackendError) as exc_info:
        await svc.ask(
            "model that can't drive tools", Scope(service=_SERVICE), timezone.utc
        )

    assert exc_info.value.kind == "model_incompatible"


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
async def test_ask_threads_tz_into_agent_system_prompt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Fix 2 (pwave-2): `ask()`'s validated `tz` param must reach the
    `KnowledgeAgent`'s system prompt (the "Current date/time: ... (<zone>)"
    anchor line pysaka's agent injects) instead of being accepted and silently
    dropped -- previously the docstring literally said "it is not consulted
    here yet"."""
    script = [LLMResponse(text=json.dumps({"no_evidence": True}))]
    fake_llm = FakeLLMClient(script)
    svc, _store = await _build_indexed_service(tmp_path, monkeypatch, fake_llm)

    await svc.ask(
        "what did she do last month", Scope(service=_SERVICE), ZoneInfo("Asia/Tokyo")
    )

    system_content = fake_llm.calls[0][0][0]["content"]
    assert "Current date/time:" in system_content
    assert "Asia/Tokyo" in system_content


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


# ---------------------------------------------------------------------------
# get_knowledge_service() singleton: race + event-loop stall (Fix 3, pwave-2)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_knowledge_service_concurrent_calls_build_exactly_one_instance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two callers racing the FIRST `get_knowledge_service()` call (e.g. a
    sync-completion hook firing while the settings panel polls
    `/index/status` at app start -- a real startup pattern) must not both
    build a full stack: two sqlite connections + two ONNX sessions, with the
    loser leaked forever (`close()` never called). A double-checked
    `asyncio.Lock` must serialize the build so exactly ONE instance is ever
    constructed and every caller gets that same instance back.
    """
    from backend.services import knowledge_service as ks

    monkeypatch.setattr(ks, "_knowledge_service", None)
    monkeypatch.setattr(ks, "_knowledge_service_lock", asyncio.Lock())

    build_count = {"store": 0, "embedder": 0, "llm": 0}
    entered_build = threading.Event()
    release_build = threading.Event()

    class FakeStore:
        def __init__(self, path) -> None:
            build_count["store"] += 1
            entered_build.set()
            # Blocks the WORKER THREAD (`asyncio.to_thread`) the real
            # SqliteKnowledgeStore build now runs on, giving a concurrent
            # second caller a real window to race in while this "build" is
            # still in flight -- if the lock weren't held for the whole
            # check-then-build section, the second caller would sail past its
            # own `is None` check and start a second build right here.
            assert release_build.wait(timeout=5), (
                "test deadlock: release_build never set"
            )

    async def fake_build_embedder() -> object:
        build_count["embedder"] += 1
        return object()

    async def fake_build_llm() -> None:
        build_count["llm"] += 1
        return None

    monkeypatch.setattr(ks, "SqliteKnowledgeStore", FakeStore)
    monkeypatch.setattr(ks, "_build_embedder", fake_build_embedder)
    monkeypatch.setattr(ks, "build_llm_client_from_settings", fake_build_llm)

    task1 = asyncio.create_task(ks.get_knowledge_service())
    # Wait until task1 is inside FakeStore.__init__ -- it now holds the lock.
    assert await asyncio.to_thread(entered_build.wait, 5)
    task2 = asyncio.create_task(ks.get_knowledge_service())
    # Give task2 a real chance to race past an unlocked check (it must not).
    await asyncio.sleep(0.05)
    release_build.set()

    svc1 = await task1
    svc2 = await task2

    assert svc1 is svc2
    assert build_count == {"store": 1, "embedder": 1, "llm": 1}


@pytest.mark.asyncio
async def test_get_knowledge_service_returns_cached_instance_without_rebuilding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Once built, a subsequent call takes the fast, lock-free early-return
    path and must not touch the (expensive) builders again."""
    from backend.services import knowledge_service as ks

    sentinel = object()
    monkeypatch.setattr(ks, "_knowledge_service", sentinel)

    def _must_not_be_called(*args, **kwargs):
        raise AssertionError("must not rebuild once already cached")

    monkeypatch.setattr(ks, "SqliteKnowledgeStore", _must_not_be_called)
    monkeypatch.setattr(ks, "_build_embedder", _must_not_be_called)
    monkeypatch.setattr(ks, "build_llm_client_from_settings", _must_not_be_called)

    result = await ks.get_knowledge_service()

    assert result is sentinel


# ---------------------------------------------------------------------------
# P-wave Task 3: kb_enabled(), no-op fast path, lock fairness, retriever
# cache, indexing progress, initial-build discovery/scheduling, last_built.
# ---------------------------------------------------------------------------


def _isolate_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    settings_path = tmp_path / "settings.json"
    monkeypatch.setattr(
        "backend.services.settings_store.get_settings_path", lambda: settings_path
    )
    return settings_path


class TestKbEnabled:
    @pytest.mark.asyncio
    async def test_defaults_to_false(self, tmp_path, monkeypatch):
        from backend.services import knowledge_service as ks

        _isolate_settings(tmp_path, monkeypatch)
        assert await ks.kb_enabled() is False

    @pytest.mark.asyncio
    async def test_true_when_set_in_settings(self, tmp_path, monkeypatch):
        from backend.services import knowledge_service as ks

        settings_path = _isolate_settings(tmp_path, monkeypatch)
        settings_path.write_text(
            json.dumps({"knowledge_base": {"enabled": True}}), encoding="utf-8"
        )
        assert await ks.kb_enabled() is True


class SpyMentionDetector:
    """Wraps a real `MentionDetector`, counting `detect()` calls."""

    def __init__(self, inner) -> None:
        self._inner = inner
        self.calls = 0

    def detect(self, text: str, author_id: str):
        self.calls += 1
        return self._inner.detect(text, author_id)


class CountingEmbedder:
    """Wraps `FakeEmbedder`, counting `embed()` calls."""

    def __init__(self, inner) -> None:
        self._inner = inner
        self.dim = inner.dim
        self.calls = 0

    def embed(self, texts, kind="passage"):
        self.calls += 1
        return self._inner.embed(texts, kind)


@pytest.mark.asyncio
async def test_second_index_pass_with_unchanged_docs_skips_mention_detection_and_embedding(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No-op fast path (item 5): a sync/backup with zero actually-changed docs
    must do ZERO mention detection and ZERO embedding -- `changed_document_ids`
    is computed BEFORE either runs, so an unchanged corpus never reaches them."""
    svc, store = await _build_indexed_service(tmp_path, monkeypatch, llm=None)

    # Swap in counting wrappers around the ALREADY-BUILT reference's detector
    # and the service's embedder, after the first (real) index pass.
    reference = svc._reference_for(_SERVICE)
    spy_detector = SpyMentionDetector(reference.detector)
    reference.detector = spy_detector
    spy_embedder = CountingEmbedder(svc._embedder)
    svc._embedder = spy_embedder

    group = {"id": 94, "name": "日向坂46"}
    member = {"id": 145, "name": "佐藤 花"}
    changed = await svc.index_members([(group, member)], _SERVICE)

    assert changed == 0
    assert spy_detector.calls == 0
    assert spy_embedder.calls == 0


@pytest.mark.asyncio
async def test_ask_completes_between_index_batches_not_after_whole_index(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Lock fairness (item 4): with a multi-batch index in flight (a slow fake
    embedder + `_EMBED_BATCH_SIZE` overridden to 1 so 2 docs -> 2 batches), a
    queued `ask()` must complete BETWEEN batches, not wait for the whole index.
    Choreographed deterministically with `threading.Event`s (the embedder runs
    on a `to_thread` worker thread) and `asyncio.Lock`'s documented FIFO
    fairness (a waiter queued before a release is served before a later
    acquire attempt from the same task that just released it).
    """
    from backend.services import knowledge_service as ks

    monkeypatch.setattr(ks, "_EMBED_BATCH_SIZE", 1)

    data_dir = tmp_path / "data"
    _write_reference_data(data_dir)
    messages_file = tmp_path / "messages.json"
    messages_file.parent.mkdir(parents=True, exist_ok=True)
    messages_file.write_text(
        json.dumps(
            {
                "member": {"id": 145, "name": "佐藤 花", "group_id": 94},
                "messages": [
                    {
                        "id": 500001,
                        "timestamp": "2026-06-15T09:30:00Z",
                        "type": "text",
                        "is_favorite": False,
                        "content": "first message",
                    },
                    {
                        "id": 500002,
                        "timestamp": "2026-06-15T09:31:00Z",
                        "type": "text",
                        "is_favorite": False,
                        "content": "second message",
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        ks, "resolve_messages_file", lambda service, group_id, member_id: messages_file
    )

    order: list[str] = []
    batch1_started = threading.Event()
    release_batch1 = threading.Event()

    class SlowEmbedder:
        dim = 2

        def __init__(self) -> None:
            self.call_count = 0

        def embed(self, texts, kind="passage"):
            self.call_count += 1
            if self.call_count == 1:
                batch1_started.set()
                assert release_batch1.wait(timeout=5), (
                    "test deadlock: release_batch1 never set"
                )
                order.append("batch1_embedded")
            else:
                order.append(f"batch{self.call_count}_embedded")
            return [[1.0, 0.0] for _ in texts]

    script = [LLMResponse(text=json.dumps({"no_evidence": True}))]
    llm = FakeLLMClient(script)

    store = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    svc = ks.KnowledgeService(
        store=store, embedder=SlowEmbedder(), llm=llm, data_dir=data_dir
    )

    group = {"id": 94, "name": "日向坂46"}
    member = {"id": 145, "name": "佐藤 花"}
    index_task = asyncio.create_task(svc.index_members([(group, member)], _SERVICE))

    # Wait until the indexer is inside batch 1's embed call -- it holds
    # `_store_lock` right now.
    assert await asyncio.to_thread(batch1_started.wait, 5)

    async def _run_ask():
        answer = await svc.ask("anything", Scope(service=_SERVICE), timezone.utc)
        order.append("ask_done")
        return answer

    ask_task = asyncio.create_task(_run_ask())
    # Give the ask a real chance to queue on `_store_lock` BEFORE batch 1
    # releases it -- same idiom as the singleton-race test above.
    await asyncio.sleep(0.05)

    release_batch1.set()

    changed = await index_task
    answer = await ask_task

    assert changed == 2
    assert answer.no_evidence is True
    # The ask completed strictly BETWEEN the two embed batches -- proof the
    # lock was released (and fairly handed to the queued ask) after batch 1
    # instead of being held for the whole multi-batch index.
    assert order == ["batch1_embedded", "ask_done", "batch2_embedded"]


@pytest.mark.asyncio
async def test_ask_reuses_cached_retriever_until_store_generation_changes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Retriever cache (item 6): two asks with no index write in between must
    build the `HybridRetriever` exactly ONCE; an index write between them
    (bumping `SqliteKnowledgeStore.generation`) must invalidate the cache and
    rebuild it on the next ask."""
    from backend.services import knowledge_service as ks

    build_count = {"n": 0}
    real_hybrid_retriever = ks.HybridRetriever

    class CountingHybridRetriever(real_hybrid_retriever):  # type: ignore[misc, valid-type]
        def __init__(self, *args, **kwargs) -> None:
            build_count["n"] += 1
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(ks, "HybridRetriever", CountingHybridRetriever)

    script = [LLMResponse(text=json.dumps({"no_evidence": True})) for _ in range(3)]
    llm = FakeLLMClient(script)
    svc, store = await _build_indexed_service(tmp_path, monkeypatch, llm)

    await svc.ask("q1", Scope(service=_SERVICE), timezone.utc)
    assert build_count["n"] == 1

    await svc.ask("q2", Scope(service=_SERVICE), timezone.utc)
    assert build_count["n"] == 1, "second ask must reuse the cached retriever"

    # An index write (new message) bumps the store's generation.
    messages_file = tmp_path / "messages.json"
    payload = json.loads(messages_file.read_text(encoding="utf-8"))
    payload["messages"].append(
        {
            "id": 500002,
            "timestamp": "2026-06-16T09:30:00Z",
            "type": "text",
            "is_favorite": False,
            "content": "a brand new message",
        }
    )
    messages_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    from backend.services import knowledge_service as ks_mod

    real_embedder = svc._embedder
    monkeypatch.setattr(
        real_embedder,
        "embed",
        lambda texts, kind="passage": [[1.0, 0.0] for _ in texts],
        raising=False,
    )
    group = {"id": 94, "name": "日向坂46"}
    member = {"id": 145, "name": "佐藤 花"}
    changed = await svc.index_members([(group, member)], _SERVICE)
    assert changed == 1
    del ks_mod  # only imported for readability above; no further use

    await svc.ask("q3", Scope(service=_SERVICE), timezone.utc)
    assert build_count["n"] == 2, "an index write must invalidate the cache"


@pytest.mark.asyncio
async def test_index_progress_reports_embedding_phase_with_growing_done_then_idle(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Real progress (item 3): `status()`'s `progress` shows `phase="embedding"`
    with `done` growing per batch while an index is running, and `phase="idle"`
    once it completes."""
    from backend.services import knowledge_service as ks

    monkeypatch.setattr(ks, "_EMBED_BATCH_SIZE", 1)

    data_dir = tmp_path / "data"
    _write_reference_data(data_dir)
    messages_file = tmp_path / "messages.json"
    messages_file.write_text(
        json.dumps(
            {
                "member": {"id": 145, "name": "佐藤 花", "group_id": 94},
                "messages": [
                    {
                        "id": 500001,
                        "timestamp": "2026-06-15T09:30:00Z",
                        "type": "text",
                        "is_favorite": False,
                        "content": "first message",
                    },
                    {
                        "id": 500002,
                        "timestamp": "2026-06-15T09:31:00Z",
                        "type": "text",
                        "is_favorite": False,
                        "content": "second message",
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        ks, "resolve_messages_file", lambda service, group_id, member_id: messages_file
    )

    batch1_started = threading.Event()
    release_batch1 = threading.Event()

    class SlowEmbedder:
        dim = 2

        def __init__(self) -> None:
            self.call_count = 0

        def embed(self, texts, kind="passage"):
            self.call_count += 1
            if self.call_count == 1:
                batch1_started.set()
                assert release_batch1.wait(timeout=5)
            return [[1.0, 0.0] for _ in texts]

    store = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    svc = ks.KnowledgeService(
        store=store, embedder=SlowEmbedder(), llm=None, data_dir=data_dir
    )

    assert svc.status(_SERVICE)["progress"]["phase"] == "idle"

    group = {"id": 94, "name": "日向坂46"}
    member = {"id": 145, "name": "佐藤 花"}
    index_task = asyncio.create_task(svc.index_members([(group, member)], _SERVICE))
    assert await asyncio.to_thread(batch1_started.wait, 5)

    mid_progress = svc.status(_SERVICE)["progress"]
    assert mid_progress["phase"] == "embedding"
    assert mid_progress["total"] == 2
    assert mid_progress["done"] == 0
    assert mid_progress["service"] == _SERVICE

    release_batch1.set()
    changed = await index_task
    assert changed == 2

    final_progress = svc.status(_SERVICE)["progress"]
    assert final_progress["phase"] == "idle"


class TestKbInitialBuild:
    """Enable-toggle / app-startup initial-build discovery and scheduling."""

    def test_discover_synced_services_finds_only_services_with_on_disk_data(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from backend.services import knowledge_service as ks

        output_dir = tmp_path / "output"
        (output_dir / "日向坂46").mkdir(parents=True)
        monkeypatch.setattr(
            "backend.services.path_resolver.get_output_dir", lambda: output_dir
        )

        services = ks.discover_synced_services()

        assert "hinatazaka46" in services
        assert "sakurazaka46" not in services

    @pytest.mark.asyncio
    async def test_schedule_initial_build_runs_rebuild_via_tracked_background_task(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from backend.services import background_tasks as bt
        from backend.services import knowledge_service as ks

        fake_svc = MagicMock()
        fake_svc.rebuild = AsyncMock(return_value=5)
        monkeypatch.setattr(
            ks, "get_knowledge_service", AsyncMock(return_value=fake_svc)
        )

        await ks.schedule_initial_build("hinatazaka46")
        pending = {t for t in bt._background_tasks if not t.done()}
        assert len(pending) == 1
        await asyncio.gather(*pending)
        await asyncio.sleep(0)

        fake_svc.rebuild.assert_awaited_once_with("hinatazaka46")

    @pytest.mark.asyncio
    async def test_schedule_initial_build_swallows_misconfigured(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A missing embedding model must not crash the enable-toggle response
        or the startup sweep -- it's swallowed with a log, same as any other
        "not configured yet" state elsewhere."""
        from backend.services import knowledge_service as ks

        monkeypatch.setattr(
            ks,
            "get_knowledge_service",
            AsyncMock(side_effect=ks.KnowledgeMisconfigured("no model")),
        )

        await ks.schedule_initial_build("hinatazaka46")
        await asyncio.sleep(0)  # let the retained background task run

    @pytest.mark.asyncio
    async def test_schedule_initial_build_all_fans_out_over_discovered_services(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from backend.services import knowledge_service as ks

        monkeypatch.setattr(
            ks, "discover_synced_services", lambda: ["hinatazaka46", "sakurazaka46"]
        )
        scheduled: list[str] = []

        async def fake_schedule(service: str) -> None:
            scheduled.append(service)

        monkeypatch.setattr(ks, "schedule_initial_build", fake_schedule)

        await ks.schedule_initial_build_all()

        assert scheduled == ["hinatazaka46", "sakurazaka46"]


@pytest.mark.asyncio
async def test_rebuild_records_last_built_in_settings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from backend.services import knowledge_service as ks

    _isolate_settings(tmp_path, monkeypatch)

    data_dir = tmp_path / "data"
    _write_reference_data(data_dir)
    monkeypatch.setattr(
        ks,
        "resolve_service_path",
        lambda service: tmp_path / "no-such-service-dir",
    )

    store = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    svc = ks.KnowledgeService(
        store=store, embedder=_embedder(), llm=None, data_dir=data_dir
    )

    config_before = await load_config()
    assert config_before["knowledge_base"]["last_built"] is None

    await svc.rebuild(_SERVICE)

    config_after = await load_config()
    assert config_after["knowledge_base"]["last_built"] is not None


# ---------------------------------------------------------------------------
# KB review Finding 1: per-service in-flight registry (index-level mutex)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_concurrent_index_runs_same_service_second_entry_point_skips(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two concurrent index runs for the SAME service -- e.g. a live
    sync-completion hook racing the startup sweep -- must not both run. The
    per-service in-flight registry makes the second entry point (the "hook
    path") SKIP immediately (returning 0, picked up by the next content-hash
    pass) instead of racing the first and clobbering its `_index_progress`."""
    from backend.services import knowledge_service as ks

    data_dir = tmp_path / "data"
    _write_reference_data(data_dir)
    messages_file = tmp_path / "messages.json"
    _write_messages_file(messages_file)
    monkeypatch.setattr(
        ks, "resolve_messages_file", lambda service, group_id, member_id: messages_file
    )

    batch_started = threading.Event()
    release_batch = threading.Event()

    class SlowEmbedder:
        dim = 2

        def __init__(self) -> None:
            self.calls = 0

        def embed(self, texts, kind="passage"):
            self.calls += 1
            batch_started.set()
            assert release_batch.wait(timeout=5), (
                "test deadlock: release_batch never set"
            )
            return [[1.0, 0.0] for _ in texts]

    store = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    embedder = SlowEmbedder()
    svc = ks.KnowledgeService(
        store=store, embedder=embedder, llm=None, data_dir=data_dir
    )

    # Spy on `_mark_idle` (instance-level override) to assert the run reaches
    # "idle" exactly once -- a skip must never call it at all.
    mark_idle_calls: list[str] = []
    real_mark_idle = svc._mark_idle

    def _spy_mark_idle(service: str) -> None:
        mark_idle_calls.append(service)
        real_mark_idle(service)

    monkeypatch.setattr(svc, "_mark_idle", _spy_mark_idle)

    group = {"id": 94, "name": "日向坂46"}
    member = {"id": 145, "name": "佐藤 花"}

    first_task = asyncio.create_task(svc.index_members([(group, member)], _SERVICE))
    assert await asyncio.to_thread(batch_started.wait, 5)

    # The FIRST run holds `_SERVICE`'s in-flight slot right now (blocked inside
    # its embed call, which also holds `_store_lock`) -- a concurrent second
    # call must skip immediately without waiting for the embed to unblock.
    second_result = await asyncio.wait_for(
        svc.index_members([(group, member)], _SERVICE), timeout=2
    )
    assert second_result == 0

    release_batch.set()
    first_result = await first_task

    assert first_result == 1
    assert embedder.calls == 1, "the skipped second run must never call embed"
    assert svc.index_progress(_SERVICE)["phase"] == "idle"
    assert mark_idle_calls == [_SERVICE], "exactly one real run reached _mark_idle"


@pytest.mark.asyncio
async def test_rebuild_skips_when_service_already_in_flight(tmp_path: Path) -> None:
    """`rebuild()` -- the entry point behind both `/index/rebuild` and the
    app-startup catch-up sweep -- must respect the same in-flight registry as
    `index_members`/`index_blogs_for_service`: a rebuild racing an already
    in-flight run for its service skips (returns 0) instead of racing it."""
    from backend.services import knowledge_service as ks

    store = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    svc = ks.KnowledgeService(store=store, embedder=_embedder(), llm=None)

    claimed = await svc._try_acquire_inflight(_SERVICE)
    assert claimed is True
    try:
        assert svc.is_indexing(_SERVICE) is True
        result = await svc.rebuild(_SERVICE)
        assert result == 0
    finally:
        await svc._release_inflight(_SERVICE)


@pytest.mark.asyncio
async def test_concurrent_index_runs_different_services_progress_isolated(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`_index_progress` is per-service (a dict keyed by service id): two
    services with index runs in flight at once -- A mid-embed (holding
    `_store_lock`) while B is registered and queued behind it -- each keep
    their own independent progress entry. B merely being in flight (or later
    completing and calling its OWN `_mark_idle`) must never touch A's entry.
    (The shared `_store_lock` still serializes the two runs' actual store
    writes -- this asserts the *progress bookkeeping* stays isolated
    regardless, which is what Finding 1 flagged as broken.)
    """
    from backend.services import knowledge_service as ks

    data_dir = tmp_path / "data"
    _write_reference_data(data_dir)
    # Service B gets its own roster (same fixture content, different filename
    # -- `_roster_short_name` strips "46").
    (data_dir / "members" / "sakurazaka.json").write_text(
        (data_dir / "members" / "hinatazaka.json").read_text(encoding="utf-8"),
        encoding="utf-8",
    )

    service_a = _SERVICE
    service_b = "sakurazaka46"
    messages_file = tmp_path / "messages.json"
    _write_messages_file(messages_file)
    monkeypatch.setattr(
        ks, "resolve_messages_file", lambda service, group_id, member_id: messages_file
    )

    a_embed_started = threading.Event()
    release_a_embed = threading.Event()

    class SlowEmbedder:
        dim = 2

        def __init__(self) -> None:
            self.calls = 0

        def embed(self, texts, kind="passage"):
            self.calls += 1
            if self.calls == 1:
                a_embed_started.set()
                assert release_a_embed.wait(timeout=5), (
                    "test deadlock: release_a_embed never set"
                )
            return [[1.0, 0.0] for _ in texts]

    store = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    svc = ks.KnowledgeService(
        store=store, embedder=SlowEmbedder(), llm=None, data_dir=data_dir
    )

    group = {"id": 94, "name": "日向坂46"}
    member = {"id": 145, "name": "佐藤 花"}

    task_a = asyncio.create_task(svc.index_members([(group, member)], service_a))
    assert await asyncio.to_thread(a_embed_started.wait, 5)
    assert svc.index_progress(service_a)["phase"] == "embedding"

    # B is started concurrently: it's registered in-flight under its OWN slot
    # (a different service -- allowed) and will queue on the shared
    # `_store_lock` behind A's still-open embed batch.
    task_b = asyncio.create_task(svc.index_members([(group, member)], service_b))
    await asyncio.sleep(0.05)  # give B a real chance to start and queue

    assert svc.is_indexing(service_a) is True
    assert svc.is_indexing(service_b) is True
    # A's own entry must be completely unaffected by B merely being in flight.
    mid_progress_a = svc.index_progress(service_a)
    assert mid_progress_a["phase"] == "embedding"
    assert mid_progress_a["service"] == service_a

    release_a_embed.set()
    changed_a = await task_a
    changed_b = await task_b

    assert changed_a == 1
    assert changed_b == 1
    assert svc.index_progress(service_a) == {
        "service": service_a,
        "phase": "idle",
        "done": 0,
        "total": 0,
        "started_at": None,
    }
    assert svc.index_progress(service_b) == {
        "service": service_b,
        "phase": "idle",
        "done": 0,
        "total": 0,
        "started_at": None,
    }


# ---------------------------------------------------------------------------
# KB review Finding 2: embed batches packed on doc boundaries
# ---------------------------------------------------------------------------


class TestPackBatchesByDoc:
    """`_pack_batches_by_doc` must never split one doc's chunks across two
    batches -- a multi-chunk BLOG doc straddling a batch boundary was the bug
    (a queued ask could see some-but-not-all of its chunks re-embedded while
    its row/lexical text was still old)."""

    @staticmethod
    def _chunk(doc_id: str, n: int) -> Chunk:
        chunk_id = f"{doc_id}#{n}"
        return Chunk(
            chunk_id=chunk_id, doc_id=doc_id, text=chunk_id, context_text=chunk_id
        )

    def test_multi_chunk_doc_never_split_across_batches(self) -> None:
        from backend.services.knowledge_service import _pack_batches_by_doc

        blog_doc_id = "blog:svc:1"
        single_doc_ids = [f"msg:svc:a:{i}" for i in range(1, 5)]
        chunks = [self._chunk(blog_doc_id, n) for n in range(3)] + [
            self._chunk(doc_id, 0) for doc_id in single_doc_ids
        ]

        batches = _pack_batches_by_doc(chunks, batch_size=2)

        blog_chunk_ids = {c.chunk_id for c in chunks if c.doc_id == blog_doc_id}
        for batch in batches:
            batch_blog_ids = {c.chunk_id for c in batch if c.doc_id == blog_doc_id}
            assert batch_blog_ids in (set(), blog_chunk_ids), (
                "the 3-chunk blog doc must never be split across batches: "
                f"got {[[c.chunk_id for c in b] for b in batches]}"
            )
        # Every chunk appears exactly once, across all batches, doc-contiguous.
        assert [c.chunk_id for batch in batches for c in batch] == [
            c.chunk_id for c in chunks
        ]
        # 3 > batch_size=2, so the blog doc gets its own oversized batch.
        blog_batch = next(b for b in batches if b[0].doc_id == blog_doc_id)
        assert len(blog_batch) == 3

    def test_docs_pack_up_to_batch_size_without_unnecessary_splitting(self) -> None:
        from backend.services.knowledge_service import _pack_batches_by_doc

        chunks = [self._chunk(f"msg:svc:a:{i}", 0) for i in range(1, 5)]

        batches = _pack_batches_by_doc(chunks, batch_size=2)

        assert [len(b) for b in batches] == [2, 2]


@pytest.mark.asyncio
async def test_persist_batched_never_splits_a_multi_chunk_doc_across_embed_calls(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Integration-level version of the packing guarantee: driving the REAL
    `_persist_batched` (not just the pure packer) with a fake corpus of one
    3-chunk blog doc + four 1-chunk docs and `_EMBED_BATCH_SIZE` forced small
    -- inspects the fake embedder's per-call chunk batches directly."""
    from backend.services import knowledge_service as ks

    def _doc(doc_id: str) -> Document:
        return Document(
            doc_id=doc_id,
            source_ref=SourceRef(
                service=_SERVICE, kind="blog", blog_id="1", member_id=1
            ),
            author_id=f"{_SERVICE}:1",
            group=_SERVICE,  # `Document.group` is the "service" column (see `documents_for_service`)
            timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc),
            type="blog",
            is_favorite=False,
            text="x",
            has_text=True,
        )

    def _chunk(doc_id: str, n: int) -> Chunk:
        chunk_id = f"{doc_id}#{n}"
        return Chunk(
            chunk_id=chunk_id, doc_id=doc_id, text=chunk_id, context_text=chunk_id
        )

    blog_doc_id = f"blog:{_SERVICE}:1"
    single_doc_ids = [f"blog:{_SERVICE}:{i}" for i in range(2, 6)]
    changed_docs = [_doc(blog_doc_id)] + [_doc(d) for d in single_doc_ids]
    chunks = [_chunk(blog_doc_id, n) for n in range(3)] + [
        _chunk(doc_id, 0) for doc_id in single_doc_ids
    ]

    class RecordingEmbedder:
        dim = 2

        def __init__(self) -> None:
            self.batches: list[list[str]] = []

        def embed(self, texts, kind="passage"):
            self.batches.append(list(texts))
            return [[1.0, 0.0] for _ in texts]

    monkeypatch.setattr(ks, "_EMBED_BATCH_SIZE", 2)
    store = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    embedder = RecordingEmbedder()
    svc = ks.KnowledgeService(store=store, embedder=embedder, llm=None)
    changed = await svc._persist_batched(changed_docs, chunks, _SERVICE)

    assert changed == len(changed_docs)
    blog_chunk_ids = {c.chunk_id for c in chunks if c.doc_id == blog_doc_id}
    for batch in embedder.batches:
        batch_blog_ids = blog_chunk_ids & set(batch)
        assert batch_blog_ids in (set(), blog_chunk_ids), (
            "the 3-chunk blog doc's chunk_ids must all land in ONE embed call, "
            f"not split -- got batches {embedder.batches}"
        )
    # The 3-chunk blog doc (> batch_size=2) gets its own oversized batch; the
    # four 1-chunk docs pack 2-per-batch.
    assert [len(b) for b in embedder.batches] == [3, 2, 2]
    # Every doc's row was persisted (crash-safe upsert-when-fully-embedded).
    persisted = store.documents_for_service(_SERVICE)
    assert {d.doc_id for d in persisted} == {blog_doc_id, *single_doc_ids}
