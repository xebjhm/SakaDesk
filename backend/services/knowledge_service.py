"""`KnowledgeService` — assembles the pure `pysaka.knowledge` engine over SakaDesk.

This is the integration seam between the UI-agnostic pysaka knowledge engine and
SakaDesk's concrete paths / settings / persistence. It owns two flows:

**Index** (`index_members` / `index_blogs_for_service` / `rebuild`): read synced
source files via `path_resolver`, `ingest_*` them into `Document`s, run
`MentionDetector` per doc, `chunk_documents`, embed *only new/changed* chunks with
the injected `Embedder`, and persist docs + vectors + mentions to the durable
`SqliteKnowledgeStore`. Idempotent via `Document` content-hash: an unchanged doc is
neither rewritten nor re-embedded, so re-indexing is cheap. Each of these three
entry points is guarded by a per-service in-flight registry (`_index_inflight`,
see the constructor) so two concurrent runs for the SAME service can never race
each other -- the second one skips instead of clobbering the first's progress.

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
from collections import Counter
from datetime import datetime, timezone, tzinfo
from pathlib import Path
from typing import cast

import structlog

from pysaka.knowledge import (
    AliasTable,
    Answer,
    CallNameTable,
    Chunk,
    Document,
    DocumentStore,
    HybridRetriever,
    KnowledgeAgent,
    MemberRegistry,
    MentionDetector,
    PureLexicalIndex,
    Scope,
    ToolCallingUnreliableError,
    ToolRunner,
    chunk_documents,
    ingest_blog,
    ingest_messages,
)
from pysaka.knowledge.llm import LLMClient
from pysaka.knowledge.protocols import Embedder

from backend.services.background_tasks import track_background_task
from backend.services.knowledge_store import SqliteKnowledgeStore
from backend.services.llm_client import LLMBackendError, build_llm_client_from_settings
from backend.services.path_resolver import resolve_messages_file, resolve_service_path
from backend.services.platform import get_app_data_dir
from backend.services.settings_store import load_config, update_config

logger = structlog.get_logger(__name__)

# Reference data lives in the repo's data/ dir (roster + curated knowledge),
# distinct from the synced blogs/messages the bot answers *from*.
_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"

# Default ONNX embedding model name (settings.knowledge_base.embedding_model may
# override). The model *assets* are fetched out of band (Task 12 / manual); a
# clear error is raised if the resolved dir is absent — see `_build_embedder`.
_DEFAULT_EMBEDDING_MODEL = "granite-embedding-278m-multilingual"

# Chunks embedded per `Embedder.embed` call during indexing — batching amortizes
# ONNX tokenization/inference overhead vs per-chunk calls (see `_persist`).
_EMBED_BATCH_SIZE = 32


def _roster_short_name(service: str) -> str:
    """`data/members/<short>.json` stem for `service` (the id with "46" stripped)."""
    return service.replace("46", "")


def _pack_batches_by_doc(chunks: list[Chunk], batch_size: int) -> list[list[Chunk]]:
    """Group `chunks` into batches that never split one doc's chunks across two
    batches (Finding 2, KB review) -- see `KnowledgeService._persist_batched`'s
    docstring for the consistency guarantee this restores.

    Docs are packed whole, up to `batch_size` chunks per batch, in first-seen
    order; a single doc with MORE than `batch_size` chunks gets its own
    oversized batch (its chunks stay contiguous -- never split -- just over
    budget) rather than being treated as an error. Chunk order within each doc,
    and doc order within each batch, is preserved.
    """
    chunks_by_doc: dict[str, list[Chunk]] = {}
    for chunk in chunks:
        chunks_by_doc.setdefault(chunk.doc_id, []).append(chunk)

    batches: list[list[Chunk]] = []
    current: list[Chunk] = []
    for doc_chunks in chunks_by_doc.values():
        if current and len(current) + len(doc_chunks) > batch_size:
            batches.append(current)
            current = []
        current.extend(doc_chunks)
        if len(current) >= batch_size:
            batches.append(current)
            current = []
    if current:
        batches.append(current)
    return batches


class KnowledgeMisconfigured(RuntimeError):
    """Raised when the knowledge engine can't be assembled (e.g. no LLM configured)."""


class KnowledgeDisabled(RuntimeError):
    """Raised (by `backend/api/ai.py`'s `/ask`) when `settings.knowledge_base.enabled`
    is false. Deliberately NOT a subclass of `KnowledgeMisconfigured`: that one means
    "the KB is wanted but can't be built yet" (e.g. no LLM/embedding model
    configured); this one means "the user hasn't turned it on" -- the two need
    distinct SSE error codes (`misconfigured` vs `kb_disabled`) so the UI can point
    the user at the right fix (configure vs enable).
    """


async def kb_enabled() -> bool:
    """Whether `settings.knowledge_base.enabled` is true.

    The single shared guard every index hook (`sync_service`/`blog_service`/
    `transcription_service`'s `_bg_index_knowledge`) plus `/ask` and
    `/index/rebuild` check BEFORE doing any KB work -- previously this flag lived
    in `_SETTINGS_DEFAULTS` with zero readers anywhere in the backend (see
    `pwave-confirmed-bugs.md`: ONNX embedding ran unconditionally on every sync for
    users who never opted in). Hooks call this before `get_knowledge_service()` so
    a disabled KB never even builds the embedder/store/LLM client.
    """
    config = await load_config()
    kb_config = config.get("knowledge_base") or {}
    return bool(kb_config.get("enabled", False))


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
        # Live indexing progress, PER SERVICE (a dict keyed by service id), read
        # by `status()`/`index_progress()` and by ask heartbeat ("indexing" vs
        # "thinking"). Deliberately per-service, not one process-wide dict
        # (Finding 1, KB review): concurrent index runs for DIFFERENT services
        # are allowed (see `_index_inflight` below), so a single shared dict
        # would let one service's `_mark_idle` clobber another's still-running
        # progress mid-write. `/index/rebuild`'s 409 `alreadyRunning` reads
        # `_index_inflight`/`is_indexing()` instead of this dict -- this is
        # display-only and was never actually exclusive. Per-entry writes are
        # updated per embed batch from `_persist_batched` -- readers never take
        # `_store_lock` for this (a dict read, and MUST stay lock-free so a
        # queued ask's heartbeat and `/index/status` can observe progress WHILE
        # an index holds the lock for an embed batch). `_index_inflight`
        # guarantees at most one run per service, so plain dict-entry
        # assignment (not further locking) is safe on the writer side too.
        self._index_progress: dict[str, dict] = {}
        # Per-service in-flight registry (Finding 1, KB review): the set of
        # services with an index run (`index_members`/`index_blogs_for_service`/
        # `rebuild`) CURRENTLY running. Without this, two concurrent runs for
        # the SAME service -- e.g. the app-startup catch-up sweep racing a live
        # sync-completion hook, a routine occurrence before this fix since the
        # startup sweep fired with zero delay (see `backend/main.py`'s
        # `_deferred_kb_initial_build`) -- interleave their `_index_progress`
        # writes and stray `_mark_idle` calls, and made `/index/rebuild`'s
        # dedupe unreliable. Every index entry point acquires this (via
        # `_try_acquire_inflight`/`_release_inflight`, always try/finally)
        # around its ENTIRE run; a caller that finds its service already
        # claimed SKIPS (logged, not an error) rather than racing -- the
        # skipped work is picked up by the next pass's content-hash diff
        # regardless. Different services may run concurrently, each with its
        # own slot; `_inflight_lock` only guards the brief add/discard on this
        # set, never held for a run's duration.
        self._index_inflight: set[str] = set()
        self._inflight_lock = asyncio.Lock()
        # `service -> (store_generation, DocumentStore, HybridRetriever)`. Rebuilt
        # only when `self._store.generation` (bumped on `add`/`upsert_documents`/
        # `remove` -- see `SqliteKnowledgeStore`) no longer matches the cached
        # entry's generation, i.e. the persisted corpus changed since the
        # retriever was assembled. Reused across asks otherwise, removing the
        # ~1s-and-growing per-ask corpus rehydration (re-chunk + lexical index)
        # `_build_agent` used to pay on every single call. Access is safe without
        # its own lock: every reader/writer runs inside `ask()`'s or an index
        # method's `_store_lock`-held section (see `_ensure_retriever_cached`).
        self._retriever_cache: dict[
            str, tuple[int, DocumentStore, HybridRetriever]
        ] = {}

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

        Guarded by the per-service in-flight registry (Finding 1, KB review):
        if `service` already has an index run in progress (another hook, a
        rebuild, or the startup sweep), this call SKIPS immediately and returns
        0 instead of racing it -- the skipped members are picked up by the next
        pass via content-hash diffing regardless. See `_index_members_impl` for
        the actual indexing work.
        """
        if not await self._try_acquire_inflight(service):
            logger.info(
                "knowledge_service.index_members.skipped_inflight", service=service
            )
            return 0
        try:
            return await self._index_members_impl(members, service)
        finally:
            await self._release_inflight(service)

    async def _index_members_impl(
        self, members: list[tuple[dict, dict]], service: str
    ) -> int:
        """The actual `index_members` work -- see that method's docstring for
        the in-flight guard wrapping this. Also called directly by
        `_rebuild_impl` (which already holds `service`'s in-flight claim for
        the whole rebuild), bypassing the `index_members` wrapper so it doesn't
        see that same claim as "already taken" and self-skip.

        `members` is a list of `(group_dict, member_dict)` pairs (same shape as
        `SearchService.index_members`): each dict's `id` locates the on-disk
        `messages.json` via `path_resolver`. File reads + ingest happen OFF
        `_store_lock` (via `to_thread`, see `_ingest_members_sync`); only
        `_persist`'s per-batch store access takes the lock -- see `_persist` for
        the fairness rationale.
        """
        reference = self._reference_for(service)
        self._index_progress[service] = {
            "service": service,
            "phase": "discovering",
            "done": 0,
            "total": 0,
            "started_at": _utcnow_iso(),
        }
        docs = await asyncio.to_thread(
            self._ingest_members_sync, members, service, reference
        )
        return await self._persist(docs, reference, service)

    def _ingest_members_sync(
        self, members: list[tuple[dict, dict]], service: str, reference: _Reference
    ) -> list[Document]:
        """Read + ingest `members`' `messages.json` files into `Document`s.

        Pure file I/O + parsing, no store access -- deliberately kept separate
        from `_persist` so it can run entirely off `_store_lock` (see
        `index_members`).
        """
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
            member_docs = ingest_messages(
                payload, service, reference.registry.resolve_author
            )
            # `ingest_messages` (pysaka, source-agnostic) leaves
            # `SourceRef.group_name` unset — it never sees the `group` dict, only
            # `messages_file`'s payload. We hold `group["name"]` right here, so
            # enrich each message doc's ref with it before persisting: the SSE
            # citation's `ref.groupName` feeds the frontend's
            # `navigateToSource` path (`"<groupId> <groupName>/..."`), which must
            # match the on-disk sync folder name or `messages_by_path` 404s.
            # `Document`/`SourceRef` are plain (non-frozen) dataclasses, so this
            # mutates in place — no `dataclasses.replace` needed.
            group_name = group["name"]
            for doc in member_docs:
                if doc.source_ref.kind == "message":
                    doc.source_ref.group_name = group_name
            docs.extend(member_docs)
        return docs

    async def index_blogs_for_service(self, service: str) -> int:
        """Index every `blogs/**/blog.json` under `service`; returns new/changed docs.

        Guarded the same way as `index_members` -- see its docstring for the
        in-flight-registry skip semantics (Finding 1, KB review).
        """
        if not await self._try_acquire_inflight(service):
            logger.info(
                "knowledge_service.index_blogs_for_service.skipped_inflight",
                service=service,
            )
            return 0
        try:
            return await self._index_blogs_impl(service)
        finally:
            await self._release_inflight(service)

    async def _index_blogs_impl(self, service: str) -> int:
        """The actual `index_blogs_for_service` work; also called directly by
        `_rebuild_impl` (which already holds the in-flight claim) -- see
        `_index_members_impl`'s docstring for why. Same off-lock-then-
        batched-persist split as `index_members` -- see `_persist`.
        """
        reference = self._reference_for(service)
        self._index_progress[service] = {
            "service": service,
            "phase": "discovering",
            "done": 0,
            "total": 0,
            "started_at": _utcnow_iso(),
        }
        docs = await asyncio.to_thread(self._ingest_blogs_sync, service, reference)
        return await self._persist(docs, reference, service)

    def _ingest_blogs_sync(self, service: str, reference: _Reference) -> list[Document]:
        blogs_dir = resolve_service_path(service) / "blogs"
        if not blogs_dir.exists():
            return []
        docs: list[Document] = []
        for blog_path in sorted(blogs_dir.glob("**/blog.json")):
            payload = self._read_json(blog_path)
            if payload is None:
                continue
            docs.append(
                ingest_blog(payload, service, reference.registry.resolve_author)
            )
        return docs

    async def _persist(
        self, docs: list[Document], reference: _Reference, service: str
    ) -> int:
        """Hash-diff, mention-detect + chunk OFF the lock, then embed+persist in
        batches, each batch under its own short `_store_lock` acquisition.

        **No-op fast path.** `changed_document_ids` is a pure content-hash
        comparison of `(doc_id, text)` (see `DocumentStore.content_hash`) -- it
        does NOT depend on mentions or chunking, so computing it FIRST (before
        mention detection/chunking run at all) is semantics-identical to the old
        "detect mentions on everything, then hash-diff" order, but a sync/backup
        with zero actually-changed docs now does zero mention detection and zero
        chunking, not just zero embedding. This read touches the shared sqlite
        connection, so it still needs `_store_lock` (brief) even though it's off
        the *embedding* critical path.

        **Lock fairness.** Mention detection and chunking are pure computation
        (no store access) and run OFF the lock, via `to_thread`. Only the
        embed-and-persist loop (`_persist_batched`) takes `_store_lock`, and only
        for the duration of ONE batch at a time -- a queued `ask()` (which also
        acquires `_store_lock`, for its whole run) can then interleave BETWEEN
        batches instead of waiting for the entire multi-minute index to finish.
        """
        if not docs:
            self._mark_idle(service)
            return 0

        async with self._store_lock:
            changed_ids = set(
                await asyncio.to_thread(self._store.changed_document_ids, docs)
            )
        if not changed_ids:
            self._mark_idle(service)
            return 0

        changed_docs = [doc for doc in docs if doc.doc_id in changed_ids]

        def _detect_and_chunk() -> list[Chunk]:
            for doc in changed_docs:
                doc.mentions = reference.detector.detect(doc.text, doc.author_id)
            # `chunk_documents` is a `pysaka` call -- untyped from mypy's view
            # (no `py.typed` marker, `ignore_missing_imports`), so it resolves to
            # `Any`; `cast` documents the real, fully-typed pysaka signature
            # instead of silently loosening this function's own return type.
            return cast("list[Chunk]", chunk_documents(changed_docs))

        chunks = await asyncio.to_thread(_detect_and_chunk)
        changed = await self._persist_batched(changed_docs, chunks, service)
        logger.info("knowledge_service.indexed", changed=changed, chunks=len(chunks))
        return changed

    async def _persist_batched(
        self, changed_docs: list[Document], chunks: list[Chunk], service: str
    ) -> int:
        """Embed `chunks` in ~`_EMBED_BATCH_SIZE`-chunk, DOC-ALIGNED batches
        (see `_pack_batches_by_doc`), each batch under its own `_store_lock`
        acquisition; upsert a doc's row only once EVERY one of its chunks has a
        persisted vector (crash-safe: an interruption mid-batch leaves that
        doc's content-hash unchanged, so the next pass retries it — marking it
        done first would strand any not-yet-embedded chunk permanently). A doc
        with no chunks at all (empty/caption-less text) has nothing to embed,
        so it's upserted immediately instead of never being marked done.

        **Consistency guarantee (Finding 2, KB review).** Batches are packed on
        DOCUMENT boundaries and never split one doc's chunks across two batches
        -- a doc with more chunks than `_EMBED_BATCH_SIZE` gets its own
        oversized batch instead, so its chunks stay contiguous within a single
        `_store_lock` acquisition. Combined with the crash-safety rule above (a
        doc's row is upserted only once ALL its chunks are embedded, in that
        SAME batch), this guarantees a queued `ask()` that interleaves BETWEEN
        batches (see `_persist`'s Lock fairness note) never observes one doc in
        a torn state: for any given doc, either ALL of its chunk vectors AND
        its row reflect the new version, or NONE of them do -- never
        some-but-not-all of one doc's chunks re-embedded while its row/lexical
        text is still the old version.
        """
        chunked_doc_ids = {chunk.doc_id for chunk in chunks}
        no_chunk_docs = [
            doc for doc in changed_docs if doc.doc_id not in chunked_doc_ids
        ]
        docs_by_id = {doc.doc_id: doc for doc in changed_docs}

        self._index_progress[service] = {
            "service": service,
            "phase": "embedding",
            "done": 0,
            "total": len(chunks),
            "started_at": _utcnow_iso(),
        }
        try:
            if no_chunk_docs:
                async with self._store_lock:
                    await asyncio.to_thread(self._store.upsert_documents, no_chunk_docs)

            remaining = Counter(chunk.doc_id for chunk in chunks)
            for batch in _pack_batches_by_doc(chunks, _EMBED_BATCH_SIZE):
                async with self._store_lock:
                    vectors = await asyncio.to_thread(
                        self._embedder.embed,
                        [chunk.context_text for chunk in batch],
                        "passage",
                    )
                    await asyncio.to_thread(
                        self._store.add,
                        [chunk.chunk_id for chunk in batch],
                        vectors,
                    )
                    ready_docs = []
                    for chunk in batch:
                        remaining[chunk.doc_id] -= 1
                        if remaining[chunk.doc_id] == 0:
                            ready_docs.append(docs_by_id[chunk.doc_id])
                    if ready_docs:
                        await asyncio.to_thread(
                            self._store.upsert_documents, ready_docs
                        )
                self._index_progress[service]["done"] += len(batch)
        finally:
            self._mark_idle(service)
        return len(changed_docs)

    def _mark_idle(self, service: str) -> None:
        self._index_progress[service] = _idle_progress(service)

    def index_progress(self, service: str) -> dict:
        """A snapshot of `service`'s live indexing progress -- see
        `_index_progress`. Idle-shaped if `service` has never indexed, or has
        no run in flight right now.
        """
        return dict(self._index_progress.get(service) or _idle_progress(service))

    async def _try_acquire_inflight(self, service: str) -> bool:
        """Atomically claim `service`'s in-flight slot; `False` if another
        index run already holds it -- see `_index_inflight`'s constructor
        comment (Finding 1, KB review)."""
        async with self._inflight_lock:
            if service in self._index_inflight:
                return False
            self._index_inflight.add(service)
            return True

    async def _release_inflight(self, service: str) -> None:
        """Release `service`'s in-flight slot -- always paired with
        `_try_acquire_inflight` via try/finally."""
        async with self._inflight_lock:
            self._index_inflight.discard(service)

    def is_indexing(self, service: str) -> bool:
        """Whether `service` currently has an index run in flight.

        The SOURCE OF TRUTH for `/index/rebuild`'s 409 `alreadyRunning`
        (Finding 1, KB review) -- deliberately NOT `_index_progress`/
        `index_progress()`, which is display-only and was never actually
        exclusive. A plain set-membership read, safe without `_inflight_lock`
        (which only serializes the brief add/discard, see
        `_try_acquire_inflight`): this is inherently advisory anyway -- a run
        can start the instant after this returns `False`, same as any
        check-then-act race of this kind (acceptable for a single-user desktop
        app; `rebuild()`'s own guard is still the real enforcement).
        """
        return service in self._index_inflight

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
        grounding-validated answer. `tz` is threaded all the way into the
        `KnowledgeAgent`/`ToolRunner` pysaka builds for this ask (see
        `_build_agent`): the agent injects a "Current date/time: ... (<zone>)"
        line into its system prompt so relative-date questions ("last month")
        resolve against the real clock in the user's zone, and the tool runner
        localizes naive `date_from`/`date_to` tool-call args to it instead of
        UTC.
        """
        if self._llm is None:
            # Lazy retry, not a permanent verdict: the client can be absent because
            # the key/config wasn't available when the singleton was built (user
            # configures the key after app start, or the OS keyring hiccups during
            # startup — observed on WSL, where the DBus keyring fails once before
            # the plaintext fallback engages). Rebuilding here is cheap (a settings
            # read + keyring load), so a transient failure never bricks the chatbot
            # until restart.
            self._llm = await build_llm_client_from_settings()
            if self._llm is not None:
                logger.info("knowledge_service.llm_client_recovered")
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
                self._run_ask_blocking, question, scope, llm, tz, history
            )

    def _run_ask_blocking(
        self,
        question: str,
        scope: Scope,
        llm: LLMClient,
        tz: tzinfo,
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

        `pysaka.knowledge.ToolCallingUnreliableError` (raised when the model
        repeatedly emits unparseable tool-call arguments — see `agent.py`) is
        pysaka's own pure/UI-agnostic exception; it's caught right at this
        integration boundary and re-raised as a typed `LLMBackendError(kind=
        "model_incompatible")` so `backend/api/ai.py` has exactly ONE exception
        type to handle for every LLM-taxonomy failure, regardless of whether it
        originated in the HTTP client or the agent's tool-calling loop.
        """
        agent = self._build_agent(scope.service, llm, tz)
        try:
            return asyncio.run(agent.answer(question, scope, history))
        except ToolCallingUnreliableError as exc:
            raise LLMBackendError(str(exc), kind="model_incompatible") from exc

    def reload_llm(self, llm: LLMClient | None) -> None:
        """Swap in a freshly-built LLM client (e.g. after `settings.knowledge_base.llm` changes).

        The next `ask()` call picks up `llm`; an ask already in flight keeps running
        with whichever client it captured at call time (no cross-call interruption).
        """
        self._llm = llm

    def _build_agent(self, service: str, llm: LLMClient, tz: tzinfo) -> KnowledgeAgent:
        """Rehydrate a retriever over persisted state (zero corpus re-embedding).

        `ToolRunner`/`KnowledgeAgent` are built fresh every call (they carry the
        per-request `tz`), but the (`DocumentStore`, `HybridRetriever`) pair
        behind them is reused across asks via `_ensure_retriever_cached` -- see
        that method for the cache-invalidation rule. This runs on a `to_thread`
        worker thread from inside `ask()`'s `_store_lock`-held section (see
        `ask`'s docstring), so the cache read/write here is already serialized
        against concurrent index writes and other asks -- no lock of its own.
        """
        reference = self._reference_for(service)
        doc_store, retriever = self._ensure_retriever_cached(service)
        tools = ToolRunner(
            reference.aliases, reference.registry, retriever, doc_store, tz=tz
        )
        return KnowledgeAgent(llm, tools, tz=tz)

    def _ensure_retriever_cached(
        self, service: str
    ) -> tuple[DocumentStore, HybridRetriever]:
        """The cached `(DocumentStore, HybridRetriever)` for `service`, rebuilding
        it only if the store's `generation` has moved on since it was cached.

        `SqliteKnowledgeStore.generation` is bumped by `add`/`upsert_documents`/
        `remove` -- any persisted write. A generation mismatch means the corpus
        changed since this pair was assembled (an index write happened), so the
        cache is invalidated and rebuilt: re-chunk deterministically (same params
        as index-time, so regenerated chunk_ids match the vectors the
        `SqliteKnowledgeStore` already holds) and populate the lexical index +
        bookkeeping WITHOUT re-embedding (the vectors are already persisted).
        Called both from `_build_agent` (lazily, at ask-time) and from
        `rebuild()` (eagerly, at rebuild-end, to warm the cache so the very next
        ask doesn't pay this cost).
        """
        generation = self._store.generation
        cached = self._retriever_cache.get(service)
        if cached is not None and cached[0] == generation:
            return cached[1], cached[2]
        docs = self._store.documents_for_service(service)
        doc_store = DocumentStore()
        doc_store.upsert(docs)
        retriever = HybridRetriever(
            doc_store, PureLexicalIndex(), self._store, self._embedder
        )
        retriever.index_lexical(chunk_documents(docs))
        self._retriever_cache[service] = (generation, doc_store, retriever)
        return doc_store, retriever

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

        `progress` is `service`'s OWN `_index_progress` entry (Finding 1, KB
        review: per-service, not one process-wide dict -- concurrent index runs
        for DIFFERENT services no longer clobber each other's displayed
        progress). Idle-shaped when `service is None` (no single service was
        asked about, so there's nothing meaningful to report) or when `service`
        has no run in flight right now.
        """
        by_type = self._read_status_by_type(service)
        progress = (
            self.index_progress(service)
            if service is not None
            else _idle_progress(None)
        )
        return {
            "service": service,
            "document_count": sum(by_type.values()),
            "by_type": by_type,
            "progress": progress,
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

        Guarded by the per-service in-flight registry (Finding 1, KB review):
        if `service` already has a run in progress (another rebuild, or a hook
        indexing it right now), this call SKIPS immediately and returns 0
        instead of racing it -- see `_index_members_impl`'s docstring. Both the
        manual `/index/rebuild` endpoint AND the app-startup catch-up sweep
        (`schedule_initial_build_all`, via `backend/main.py`'s
        `_deferred_kb_initial_build`) go through this -- exactly the pair the
        review flagged as racing routinely (the startup sweep used to fire with
        zero delay; see that function's docstring for the fix).
        """
        if not await self._try_acquire_inflight(service):
            logger.info("knowledge_service.rebuild.skipped_inflight", service=service)
            return 0
        try:
            return await self._rebuild_impl(service)
        finally:
            await self._release_inflight(service)

    async def _rebuild_impl(self, service: str) -> int:
        """The actual `rebuild` work -- see that method's docstring for the
        in-flight guard wrapping this.

        Relies on content-hash dedupe for idempotency, so this picks up new/changed
        source files cheaply -- including the case where NOTHING changed, thanks
        to the no-op fast path in `_persist` (a pure hash-diff pass, no
        embedding). (It does not delete docs whose source files were removed — a
        hard purge would need a store `delete_service`, out of scope for v1.)

        Calls `_index_members_impl`/`_index_blogs_impl` directly (NOT the
        guarded `index_members`/`index_blogs_for_service` wrappers): `rebuild`
        already holds `service`'s in-flight claim for this whole call, so going
        through the wrappers would see that same claim as "already taken" and
        skip, breaking rebuild entirely.

        On completion: warms the retriever cache for `service` (see
        `_ensure_retriever_cached`) so the very next `ask()` doesn't pay the
        corpus-rehydration cost, and records `settings.knowledge_base.last_built`
        so `KnowledgeBaseStatus` can render "Last indexed: …".
        """
        self._index_progress[service] = {
            "service": service,
            "phase": "discovering",
            "done": 0,
            "total": 0,
            "started_at": _utcnow_iso(),
        }
        members = await asyncio.to_thread(self._discover_message_members, service)
        changed = await self._index_members_impl(members, service)
        changed += await self._index_blogs_impl(service)
        async with self._store_lock:
            await asyncio.to_thread(self._ensure_retriever_cached, service)
        await self._record_last_built()
        return changed

    async def _record_last_built(self) -> None:
        """Persist `settings.knowledge_base.last_built = <UTC ISO now>`.

        Called at the end of every `rebuild()` (manual `/index/rebuild`, the
        enable-toggle's initial build, and the app-startup catch-up sweep all go
        through `rebuild()`) -- the field has existed in `_SETTINGS_DEFAULTS`
        since Task 4 but was never written anywhere until now.
        """

        def _update(config: dict) -> None:
            # Copy rather than mutate `config["knowledge_base"]` in place -- see
            # `backend/api/ai.py`'s `put_ai_config` for why aliasing the shared
            # `_SETTINGS_DEFAULTS["knowledge_base"]` dict would corrupt it.
            kb_config = dict(config.get("knowledge_base") or {})
            kb_config["last_built"] = _utcnow_iso()
            config["knowledge_base"] = kb_config

        await update_config(_update)

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


def _utcnow_iso() -> str:
    """Current UTC instant as an ISO-8601 string -- for `_index_progress`'s
    `started_at` and `settings.knowledge_base.last_built`."""
    return datetime.now(timezone.utc).isoformat()


def _idle_progress(service: str | None) -> dict:
    """The idle-shaped `_index_progress` entry for `service` -- or the generic
    fallback (`service=None`) when `status()` was asked about no service in
    particular. See `KnowledgeService._index_progress`."""
    return {
        "service": service,
        "phase": "idle",
        "done": 0,
        "total": 0,
        "started_at": None,
    }


# ------------------------------------------------------------------
# Singleton (mirrors search_service.get_search_service)
# ------------------------------------------------------------------

_knowledge_service: KnowledgeService | None = None
# Guards the check-then-build below: without it, two callers racing the FIRST
# `get_knowledge_service()` (e.g. a sync-completion hook firing while the
# settings panel polls `/index/status` at app start -- a common real pattern)
# both see `_knowledge_service is None`, interleave at the `await`s, and BOTH
# build a full stack -- two sqlite connections to `knowledge_index.db` and two
# ONNX sessions, with the loser's `SqliteKnowledgeStore.close()` never called
# (leaked forever). Double-checked locking: re-check `is None` INSIDE the lock
# so only the first caller through actually builds anything; every other
# caller (racing or sequential) just awaits the lock and returns the same
# instance.
_knowledge_service_lock = asyncio.Lock()


async def get_knowledge_service() -> KnowledgeService:
    """Return the process-wide `KnowledgeService`, building the real collaborators once.

    Builds an `OnnxEmbedder` (model dir under app-data), a `SqliteKnowledgeStore`
    (`knowledge_index.db`, alongside `search_index.db`), and the LLM client from
    settings. Async because the LLM client is built from settings + OS keyring.

    Both heavy, blocking constructors -- `SqliteKnowledgeStore.__init__`
    (rehydrates every persisted vector blob, ~80MB+ at 26k docs) and
    `OnnxEmbedder.__init__` (loads a ~1GB ONNX `InferenceSession`, inside
    `_build_embedder`) -- run via `asyncio.to_thread` so the first touch never
    stalls the event loop (and therefore the whole UI/API) for seconds.
    """
    global _knowledge_service
    if _knowledge_service is not None:
        return _knowledge_service
    async with _knowledge_service_lock:
        if _knowledge_service is None:
            store = await asyncio.to_thread(
                SqliteKnowledgeStore, get_app_data_dir() / "knowledge_index.db"
            )
            embedder = await _build_embedder()
            llm = await build_llm_client_from_settings()
            _knowledge_service = KnowledgeService(
                store=store, embedder=embedder, llm=llm
            )
    return _knowledge_service


def discover_synced_services() -> list[str]:
    """Service ids with any synced content already on disk.

    A service "has synced content" if `resolve_service_path(service)` resolves
    to an existing directory -- i.e. the user has synced/backed-up SOMETHING for
    it, regardless of whether they're currently logged in (a login session can
    expire or be logged out while the synced folders remain). Used to fan the
    enable-toggle's initial build and the app-startup catch-up sweep out over
    every service that actually has data, instead of hardcoding the app's
    service list or depending on a live session.
    """
    from backend.services.service_utils import get_all_services

    services: list[str] = []
    for service in get_all_services():
        try:
            path = resolve_service_path(service)
        except ValueError:
            continue
        if path.exists():
            services.append(service)
    return services


async def schedule_initial_build(service: str) -> None:
    """Schedule a retained background `rebuild()` of `service`'s KB index.

    Used both by the enable-toggle's false->true transition
    (`PUT /api/ai/enabled`) and by the app-startup catch-up sweep
    (`schedule_initial_build_all`, called from `backend/main.py`'s lifespan) --
    the fix for "blogs/messages never index until a manual Rebuild" (see
    `pwave-confirmed-bugs.md`). Scheduled via `track_background_task` (see that
    module) so a multi-minute first index can't be silently garbage-collected.

    Swallows `KnowledgeMisconfigured` (e.g. the embedding model isn't installed
    yet): there is nothing buildable without it, and the resulting empty index
    is exactly the "not configured" state `/index/status`/`KnowledgeBaseStatus`
    already render elsewhere -- this must never crash startup or the
    enable-toggle response.
    """

    async def _run() -> None:
        try:
            svc = await get_knowledge_service()
        except KnowledgeMisconfigured:
            logger.info(
                "knowledge_service.initial_build_skipped_misconfigured",
                service=service,
            )
            return
        try:
            changed = await svc.rebuild(service)
            logger.info(
                "knowledge_service.initial_build_done",
                service=service,
                changed=changed,
            )
        except Exception:
            logger.error(
                "knowledge_service.initial_build_failed",
                service=service,
                exc_info=True,
            )

    track_background_task(_run(), name=f"kb_initial_build_{service}")


async def schedule_initial_build_all() -> None:
    """`schedule_initial_build` for every service with synced content on disk."""
    services = await asyncio.to_thread(discover_synced_services)
    for service in services:
        await schedule_initial_build(service)


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

    # OnnxEmbedder.__init__ loads a ~1GB ONNX InferenceSession synchronously --
    # off the event loop thread, same reasoning as SqliteKnowledgeStore above.
    return await asyncio.to_thread(OnnxEmbedder, model_dir)
