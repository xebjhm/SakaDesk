"""`KnowledgeService` — assembles the pure `pysaka.knowledge` engine over SakaDesk.

This is the integration seam between the UI-agnostic pysaka knowledge engine and
SakaDesk's concrete paths / settings / persistence. It owns two flows:

**Index** (`index_members` / `index_blogs_for_service` / `rebuild`): read synced
source files via `path_resolver`, `ingest_*` them into `Document`s, run
`MentionDetector` per doc, `chunk_documents`, embed *only new/changed* chunks with
the injected `Embedder`, and persist docs + vectors + mentions to the durable
`SqliteKnowledgeStore`. Idempotent via `Document` content-hash: an unchanged doc is
neither rewritten nor re-embedded, so re-indexing is cheap.

**Query** (`ask`): assemble a `HybridRetriever` over the ALREADY-PERSISTED state
without re-embedding the corpus. Persisted docs are loaded into an in-memory pysaka
`DocumentStore`; they are deterministically re-chunked and fed to
`HybridRetriever.index_lexical(...)` (lexical index + doc/chunk bookkeeping, NO
embedding); the `SqliteKnowledgeStore` already holds those same chunk_ids' vectors
(rehydrated from blobs on open) and serves as the `VectorStore`. Only the query is
embedded at ask-time, inside `HybridRetriever.search`. `ask` then runs the bounded
`KnowledgeAgent` and returns its grounding-VALIDATED `Answer`.

All blocking work (file reads, ONNX embedding, LLM tool-calling, sqlite) is
offloaded via `asyncio.to_thread` to keep the event loop responsive — including,
for `ask`, the `KnowledgeAgent` run itself: retriever assembly AND the agent loop
both happen inside a single `to_thread` call, with `_store_lock` held for the
whole thing, so a concurrent index write can never mutate the shared store mid-ask.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from datetime import tzinfo
from pathlib import Path

import structlog

from pysaka.knowledge import (
    AliasTable,
    Answer,
    CallNameTable,
    Document,
    DocumentStore,
    HybridRetriever,
    KnowledgeAgent,
    MemberRegistry,
    MentionDetector,
    PureLexicalIndex,
    Scope,
    ToolRunner,
    chunk_documents,
    ingest_blog,
    ingest_messages,
)
from pysaka.knowledge.llm import LLMClient
from pysaka.knowledge.protocols import Embedder

from backend.services.knowledge_store import SqliteKnowledgeStore
from backend.services.llm_client import build_llm_client_from_settings
from backend.services.path_resolver import resolve_messages_file, resolve_service_path
from backend.services.platform import get_app_data_dir
from backend.services.settings_store import load_config

logger = structlog.get_logger(__name__)

# Reference data lives in the repo's data/ dir (roster + curated knowledge),
# distinct from the synced blogs/messages the bot answers *from*.
_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"

# Default ONNX embedding model name (settings.knowledge_base.embedding_model may
# override). The model *assets* are fetched out of band (Task 12 / manual); a
# clear error is raised if the resolved dir is absent — see `_build_embedder`.
_DEFAULT_EMBEDDING_MODEL = "granite-embedding-278m-multilingual"


def _roster_short_name(service: str) -> str:
    """`data/members/<short>.json` stem for `service` (the id with "46" stripped)."""
    return service.replace("46", "")


class KnowledgeMisconfigured(RuntimeError):
    """Raised when the knowledge engine can't be assembled (e.g. no LLM configured)."""


class KnowledgeService:
    """Wires the pysaka knowledge engine over SakaDesk paths/settings/persistence.

    The constructor takes the three injectable collaborators so tests can supply a
    `FakeEmbedder` + scripted `FakeLLMClient` + tmp `SqliteKnowledgeStore`;
    `get_knowledge_service()` builds the real ones. `data_dir` is overridable so
    tests can point roster/knowledge loading at a fixture.
    """

    def __init__(
        self,
        store: SqliteKnowledgeStore,
        embedder: Embedder,
        llm: LLMClient | None,
        *,
        data_dir: Path | None = None,
    ) -> None:
        self._store = store
        self._embedder = embedder
        self._llm = llm
        self._data_dir = data_dir if data_dir is not None else _DATA_DIR
        # Per-service reference data (registry / aliases / mention detector), built
        # lazily on first use and cached — loading + alias-seeding is pure and stable.
        self._reference: dict[str, _Reference] = {}
        # Serializes every access to the single shared sqlite connection (index writes
        # and asks, both of which run on `asyncio.to_thread` worker threads): one
        # `sqlite3.Connection` must not be read/written from two threads at once (the
        # store opens with check_same_thread=False, which only lifts sqlite's
        # same-thread check — it doesn't make concurrent use of the connection safe).
        # `status()` deliberately does NOT take this lock: it never touches the shared
        # connection, instead opening its own independent short-lived connection — see
        # `status()`.
        self._store_lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Reference data (roster + curated aliases / call-names)
    # ------------------------------------------------------------------

    def _load_reference(self, service: str) -> _Reference:
        """Build (registry, alias table, mention detector) for `service` from `data/`."""
        registry = self._load_registry(service)
        aliases = AliasTable.seed_from_registry(registry)
        knowledge_dir = self._data_dir / "knowledge" / service
        curated = knowledge_dir / "aliases.json"
        if curated.exists():
            aliases.load_curated(json.loads(curated.read_text(encoding="utf-8")))
        call_names_path = knowledge_dir / "call_names.json"
        call_names = None
        if call_names_path.exists():
            call_names = CallNameTable.from_json(
                json.loads(call_names_path.read_text(encoding="utf-8"))
            )
        detector = MentionDetector(aliases.entries(service), call_names)
        return _Reference(registry=registry, aliases=aliases, detector=detector)

    def _load_registry(self, service: str) -> MemberRegistry:
        roster = self._data_dir / "members" / f"{_roster_short_name(service)}.json"
        if not roster.exists():
            raise KnowledgeMisconfigured(f"roster file not found: {roster}")
        data = json.loads(roster.read_text(encoding="utf-8"))
        return MemberRegistry.from_members_json(data, service)

    def _reference_for(self, service: str) -> _Reference:
        if service not in self._reference:
            self._reference[service] = self._load_reference(service)
        return self._reference[service]

    # ------------------------------------------------------------------
    # Index
    # ------------------------------------------------------------------

    async def index_members(
        self, members: list[tuple[dict, dict]], service: str
    ) -> int:
        """Index changed members' messages; returns the count of new/changed docs.

        `members` is a list of `(group_dict, member_dict)` pairs (same shape as
        `SearchService.index_members`): each dict's `id` locates the on-disk
        `messages.json` via `path_resolver`.
        """
        async with self._store_lock:
            return await asyncio.to_thread(self._index_members_sync, members, service)

    def _index_members_sync(
        self, members: list[tuple[dict, dict]], service: str
    ) -> int:
        reference = self._reference_for(service)
        docs: list[Document] = []
        for group, member in members:
            try:
                messages_file = resolve_messages_file(
                    service, group["id"], member["id"]
                )
            except FileNotFoundError:
                # The member/group folder isn't synced to disk yet (e.g. rebuild()
                # discovered it from an in-progress sync, or a caller passed a
                # stale roster entry). Skip it rather than aborting the whole
                # batch — the rest of `members` still gets indexed.
                logger.info(
                    "knowledge_service.index_members.skipped_unsynced_member",
                    service=service,
                    group_id=group["id"],
                    member_id=member["id"],
                )
                continue
            payload = self._read_json(messages_file)
            if payload is None:
                continue
            docs.extend(
                ingest_messages(payload, service, reference.registry.resolve_author)
            )
        return self._persist(docs, reference)

    async def index_blogs_for_service(self, service: str) -> int:
        """Index every `blogs/**/blog.json` under `service`; returns new/changed docs."""
        async with self._store_lock:
            return await asyncio.to_thread(self._index_blogs_sync, service)

    def _index_blogs_sync(self, service: str) -> int:
        reference = self._reference_for(service)
        blogs_dir = resolve_service_path(service) / "blogs"
        if not blogs_dir.exists():
            return 0
        docs: list[Document] = []
        for blog_path in sorted(blogs_dir.glob("**/blog.json")):
            payload = self._read_json(blog_path)
            if payload is None:
                continue
            docs.append(
                ingest_blog(payload, service, reference.registry.resolve_author)
            )
        return self._persist(docs, reference)

    def _persist(self, docs: list[Document], reference: _Reference) -> int:
        """Mention-detect, hash-dedupe-persist, then embed ONLY changed docs' chunks."""
        if not docs:
            return 0
        for doc in docs:
            doc.mentions = reference.detector.detect(doc.text, doc.author_id)
        changed_ids = set(self._store.upsert_documents(docs))
        if not changed_ids:
            return 0
        changed_docs = [doc for doc in docs if doc.doc_id in changed_ids]
        chunks = chunk_documents(changed_docs)
        for chunk in chunks:
            vector = self._embedder.embed([chunk.context_text], kind="passage")[0]
            self._store.add([chunk.chunk_id], [vector])
        logger.info(
            "knowledge_service.indexed",
            changed=len(changed_ids),
            chunks=len(chunks),
        )
        return len(changed_ids)

    @staticmethod
    def _read_json(path: Path) -> dict | None:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning(
                "knowledge_service.read_failed", path=str(path), error=str(exc)
            )
            return None
        return data if isinstance(data, dict) else None

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------

    async def ask(
        self,
        question: str,
        scope: Scope,
        tz: tzinfo,
        history: list[dict] | None = None,
    ) -> Answer:
        """Answer `question` over `scope`'s persisted corpus; returns a VALIDATED `Answer`.

        Assembles the retriever without re-embedding the corpus (see module
        docstring), runs the bounded `KnowledgeAgent`, and returns its
        grounding-validated answer. `tz` is accepted for relative-date resolution
        (Task 5); it is not consulted here yet.
        """
        if self._llm is None:
            raise KnowledgeMisconfigured(
                "no LLM client configured for the knowledge chatbot"
            )
        llm = self._llm
        logger.debug("knowledge_service.ask", service=scope.service, tz=str(tz))
        # Hold `_store_lock` for the WHOLE ask (retriever assembly AND the agent's
        # tool-calling loop, which reads the shared NumpyVectorStore via
        # HybridRetriever.search), and run all of it in ONE `to_thread` call:
        #   - Correctness: a concurrent index write mutates the store's
        #     NumpyVectorStore non-atomically (`_ids.append` then
        #     `_matrix = vstack`); holding the lock for the full ask prevents that
        #     write from interleaving with this ask's reads (a torn read).
        #   - Responsiveness: `agent.answer()` synchronously runs ONNX embedding
        #     inference (via ToolRunner -> HybridRetriever.search -> OnnxEmbedder)
        #     and blocking LLM HTTP calls; offloading the entire thing keeps the
        #     event loop free rather than just the retriever build.
        # Trade-off: an ask now pauses background indexing (and other asks) for
        # its full duration. Acceptable for a single-user desktop app.
        async with self._store_lock:
            return await asyncio.to_thread(
                self._run_ask_blocking, question, scope, llm, history
            )

    def _run_ask_blocking(
        self,
        question: str,
        scope: Scope,
        llm: LLMClient,
        history: list[dict] | None,
    ) -> Answer:
        """Build the retriever+agent over the persisted store and run the agent, synchronously.

        Runs entirely on a `to_thread` worker thread while the caller holds
        `_store_lock`. `agent.answer(...)` is a coroutine, but this method must be
        plain sync to be handed to `asyncio.to_thread` as a whole — so it drives
        that coroutine to completion with its OWN fresh event loop via
        `asyncio.run`. That's safe here: this method only ever runs on a
        `to_thread` worker thread, which never has an existing event loop of its
        own (so `asyncio.run` cannot collide with one), and neither
        `KnowledgeAgent`/`ToolRunner`/`HybridRetriever` nor
        `OpenAICompatLLMClient` retain any loop-bound resources across `await`s —
        the LLM client opens and closes a fresh `httpx.AsyncClient` inside each
        `chat()` call, so nothing is pinned to the event loop that creates it.
        """
        agent = self._build_agent(scope.service, llm)
        return asyncio.run(agent.answer(question, scope, history))

    def reload_llm(self, llm: LLMClient | None) -> None:
        """Swap in a freshly-built LLM client (e.g. after `settings.knowledge_base.llm` changes).

        The next `ask()` call picks up `llm`; an ask already in flight keeps running
        with whichever client it captured at call time (no cross-call interruption).
        """
        self._llm = llm

    def _build_agent(self, service: str, llm: LLMClient) -> KnowledgeAgent:
        """Rehydrate a retriever over persisted state (zero corpus re-embedding)."""
        reference = self._reference_for(service)
        docs = self._store.documents_for_service(service)
        doc_store = DocumentStore()
        doc_store.upsert(docs)
        # Re-chunk deterministically (same params as index-time) so regenerated
        # chunk_ids match the vectors the SqliteKnowledgeStore already holds; then
        # populate the lexical index + bookkeeping WITHOUT embedding.
        retriever = HybridRetriever(
            doc_store, PureLexicalIndex(), self._store, self._embedder
        )
        retriever.index_lexical(chunk_documents(docs))
        tools = ToolRunner(reference.aliases, reference.registry, retriever, doc_store)
        return KnowledgeAgent(llm, tools)

    # ------------------------------------------------------------------
    # Status / rebuild
    # ------------------------------------------------------------------

    def status(self, service: str | None = None) -> dict:
        """Indexed-document counts, overall or for one `service`, bucketed by type.

        Deliberately does NOT read via `self._store` (which owns the single
        shared `check_same_thread=False` connection that index writes run
        against on a worker thread): `status()` is sync and called straight from
        the event-loop thread, so reading the shared connection here could
        interleave mid-write with a concurrently `to_thread`-running index. Instead
        this opens its OWN short-lived, read-only connection to the same db file
        and closes it before returning — safe to do concurrently with an
        in-flight writer because the store enables WAL mode on open, and WAL
        readers never block on (or are blocked by) writers.
        """
        by_type = self._read_status_by_type(service)
        return {
            "service": service,
            "document_count": sum(by_type.values()),
            "by_type": by_type,
        }

    def _read_status_by_type(self, service: str | None) -> dict[str, int]:
        conn = sqlite3.connect(str(self._store.db_path))
        try:
            conn.execute("PRAGMA query_only = ON")
            if service is not None:
                rows = conn.execute(
                    "SELECT type, COUNT(*) FROM kb_documents "
                    "WHERE service = ? GROUP BY type",
                    (service,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT type, COUNT(*) FROM kb_documents GROUP BY type"
                ).fetchall()
        finally:
            conn.close()
        return {type_: count for type_, count in rows}

    async def rebuild(self, service: str) -> int:
        """Re-index `service` from disk (blogs + all message members); returns changed docs.

        Relies on content-hash dedupe for idempotency, so this picks up new/changed
        source files cheaply. (It does not delete docs whose source files were
        removed — a hard purge would need a store `delete_service`, out of scope for
        v1.)
        """
        members = await asyncio.to_thread(self._discover_message_members, service)
        changed = await self.index_members(members, service)
        changed += await self.index_blogs_for_service(service)
        return changed

    @staticmethod
    def _discover_message_members(service: str) -> list[tuple[dict, dict]]:
        """Walk `messages/<gid name>/<mid name>` folders into `(group, member)` pairs."""
        messages_dir = resolve_service_path(service) / "messages"
        if not messages_dir.exists():
            return []
        members: list[tuple[dict, dict]] = []
        for group_dir in sorted(messages_dir.iterdir()):
            if not group_dir.is_dir():
                continue
            gid = _leading_id(group_dir.name)
            if gid is None:
                continue
            g_name = group_dir.name.split(" ", 1)[1] if " " in group_dir.name else ""
            for member_dir in sorted(group_dir.iterdir()):
                if not member_dir.is_dir():
                    continue
                mid = _leading_id(member_dir.name)
                if mid is None:
                    continue
                m_name = (
                    member_dir.name.split(" ", 1)[1] if " " in member_dir.name else ""
                )
                members.append(
                    ({"id": gid, "name": g_name}, {"id": mid, "name": m_name})
                )
        return members


class _Reference:
    """Cached per-service reference data assembled from `data/`."""

    __slots__ = ("registry", "aliases", "detector")

    def __init__(
        self, registry: MemberRegistry, aliases: AliasTable, detector: MentionDetector
    ) -> None:
        self.registry = registry
        self.aliases = aliases
        self.detector = detector


def _leading_id(folder_name: str) -> int | None:
    """Parse the leading integer id from a `"<id> <name>"` folder name, or `None`."""
    head = folder_name.split(" ", 1)[0]
    try:
        return int(head)
    except ValueError:
        return None


# ------------------------------------------------------------------
# Singleton (mirrors search_service.get_search_service)
# ------------------------------------------------------------------

_knowledge_service: KnowledgeService | None = None


async def get_knowledge_service() -> KnowledgeService:
    """Return the process-wide `KnowledgeService`, building the real collaborators once.

    Builds an `OnnxEmbedder` (model dir under app-data), a `SqliteKnowledgeStore`
    (`knowledge_index.db`, alongside `search_index.db`), and the LLM client from
    settings. Async because the LLM client is built from settings + OS keyring.
    """
    global _knowledge_service
    if _knowledge_service is None:
        store = SqliteKnowledgeStore(get_app_data_dir() / "knowledge_index.db")
        embedder = await _build_embedder()
        llm = await build_llm_client_from_settings()
        _knowledge_service = KnowledgeService(store=store, embedder=embedder, llm=llm)
    return _knowledge_service


async def invalidate_llm_client() -> None:
    """Force the process-wide `KnowledgeService`'s LLM client to be rebuilt from settings.

    Called by `PUT /api/ai/config` after persisting a new `knowledge_base.llm`
    backend/base_url/model, so the very next `ask()` uses it instead of a stale
    cached client. No-op if the singleton hasn't been built yet -- in that case
    the next `get_knowledge_service()` call reads the (already-saved) new config
    itself, so there is nothing to invalidate.
    """
    if _knowledge_service is None:
        return
    llm = await build_llm_client_from_settings()
    _knowledge_service.reload_llm(llm)


async def _build_embedder() -> Embedder:
    """Construct the real `OnnxEmbedder` from the settings-selected model dir."""
    config = await load_config()
    kb_config = config.get("knowledge_base") or {}
    model_name = kb_config.get("embedding_model") or _DEFAULT_EMBEDDING_MODEL
    model_dir = get_app_data_dir() / "models" / model_name
    if not model_dir.exists():
        raise KnowledgeMisconfigured(
            f"embedding model dir not found: {model_dir} "
            "(fetch the ONNX model assets first)"
        )
    from pysaka.knowledge.backends.onnx_embedder import OnnxEmbedder

    return OnnxEmbedder(model_dir)
