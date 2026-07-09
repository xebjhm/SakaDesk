"""`KnowledgeService` — assembles the pure `pysaka.knowledge` engine over SakaDesk.

This is the integration seam between the UI-agnostic pysaka knowledge engine and
SakaDesk's concrete paths / settings / persistence. It owns two flows:

**Index** (`index_members` / `index_blogs_for_service` / `rebuild`): read synced
source files via `path_resolver`, `ingest_*` them into `Document`s, run
`MentionDetector` per doc, `chunk_documents`, embed *only new/changed* chunks with
the injected `Embedder`, and persist docs + vectors + mentions to the durable
`SqliteKnowledgeStore`. Idempotent via `Document` content-hash: an unchanged doc is
neither rewritten nor re-embedded, so re-indexing is cheap -- UNLESS `rebuild()`
is force-re-embedding everything because `kb_meta['reindex_required']` is set
(an embedder-fingerprint mismatch, see `_check_fingerprint`), in which case the
hash-diff is bypassed entirely for that one rebuild (`_persist`'s `force` param).
Each of these three entry points is guarded by a per-service in-flight registry
(`_index_inflight`, see the constructor) so two concurrent runs for the SAME
service can never race each other -- the second one skips instead of clobbering
the first's progress.

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
import threading
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
from pysaka.knowledge.protocols import Embedder, VectorStore

from backend.services.background_tasks import track_background_task
from backend.services.knowledge_store import (
    KnowledgeStoreVersionError,
    SqliteKnowledgeStore,
)
from backend.services.llm_client import LLMBackendError, build_llm_client_from_settings
from backend.services.llm_usage import on_llm_request
from backend.services.onnx_runtime_loader import ensure_onnxruntime_importable
from backend.services.onnx_runtime_manifest import select_runtime_host_class
from backend.services.onnx_runtime_provision import get_runtime_provisioner
from backend.services.path_resolver import resolve_messages_file, resolve_service_path
from backend.services.platform import get_app_data_dir
from backend.services.settings_store import load_config, update_config

logger = structlog.get_logger(__name__)

# Reference data lives in the repo's data/ dir (roster + curated knowledge),
# distinct from the synced blogs/messages the bot answers *from*.
_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"

# Default ONNX embedding model name (settings.knowledge_base.embedding_model may
# override). The model assets can be fetched in-app (`backend/services/model_assets.py`,
# Product-wave Task 4) or placed manually; either way, a missing model dir is a
# STATE (`configured: false`), never a crash -- see `_build_embedder`.
_DEFAULT_EMBEDDING_MODEL = "granite-embedding-278m-multilingual"

# Chunks embedded per `Embedder.embed` call during indexing — batching amortizes
# ONNX tokenization/inference overhead vs per-chunk calls (see `_persist`).
_EMBED_BATCH_SIZE = 32

# Embedder fingerprint (Product-wave Task 4 fold-in) — bumped only when the
# semantics of an already-embedded chunk's vector would change for a reason
# OTHER than the embedding model itself (e.g. a normalization or chunking
# algorithm change that alters what a chunk's `context_text` even is). Baked
# into `_current_fingerprint` alongside model_name/dim -- see
# `KnowledgeService._check_fingerprint`.
_NORMALIZER_VERSION = 1
_CHUNKER_VERSION = 1


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


class EmbeddingModelMissing(KnowledgeMisconfigured):
    """Raised by `ask()` when the embedding model still isn't installed after a
    lazy-rebuild attempt (see `KnowledgeService._ensure_embedder`).

    A subclass of `KnowledgeMisconfigured` (so any caller that only handles the
    generic case still degrades safely), but `backend/api/ai.py` catches this
    FIRST to emit the distinct, actionable SSE code `embedding_model_missing`
    (new in Product-wave Task 4) instead of the generic `misconfigured` -- the
    UI can point straight at the in-app model download instead of a vague
    "check AI settings".
    """

    def __init__(self, model: str, expected_path: Path) -> None:
        self.model = model
        self.expected_path = expected_path
        super().__init__(f"embedding model not installed: {expected_path}")


class RuntimeMissing(KnowledgeMisconfigured):
    """Raised by `_ensure_embedder()` when the ONNX runtime itself (not the
    embedding model -- see `EmbeddingModelMissing`) hasn't been downloaded yet.

    Windows packaged builds ship WITHOUT onnxruntime (Task 7 excludes it from
    the PyInstaller bundle); it's fetched on demand the first time the KB
    needs an embedder (`ensure_onnxruntime_importable`, Task 3). Raising this
    from `_ensure_embedder()` ALSO fires the download as a tracked background
    task (see that method) -- by the time a caller sees this exception,
    provisioning is already under way, so a retry a few seconds/minutes later
    (once `GET /api/ai/runtime/status` reports `state: "done"`) just works,
    same "state, not a crash" shape as `EmbeddingModelMissing`.

    A subclass of `KnowledgeMisconfigured` for the same reason
    `EmbeddingModelMissing` is (any caller that only handles the generic case
    still degrades safely), but `backend/api/ai.py`'s `/ask` SSE stream
    catches this FIRST (same position as `EmbeddingModelMissing`, since both
    are siblings under `KnowledgeMisconfigured`) to emit the distinct,
    actionable SSE code `runtime_missing` instead of the generic
    `misconfigured` -- the UI can show "setting up the AI engine..." instead
    of a vague "check AI settings".

    In dev/tests onnxruntime always lives in the venv, so
    `ensure_onnxruntime_importable()` returns `"bundled"` and this is never
    raised there -- see `_ensure_embedder`'s runtime-gate check.
    """

    def __init__(self, host_class: str) -> None:
        self.host_class = host_class
        super().__init__(f"onnx runtime provisioning started for host={host_class}")


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


async def resolve_embedding_model_name() -> str:
    """`settings.knowledge_base.embedding_model`, or `_DEFAULT_EMBEDDING_MODEL`."""
    config = await load_config()
    kb_config = config.get("knowledge_base") or {}
    name = kb_config.get("embedding_model") or _DEFAULT_EMBEDDING_MODEL
    return cast("str", name)


def embedding_model_dir(model_name: str) -> Path:
    """Where `model_name`'s ONNX assets (`model.onnx` + `tokenizer.json`) live,
    whether placed manually or by `backend/services/model_assets.py`'s in-app
    download. Shared by `_build_embedder`, the readiness probe, and
    `model_assets.py` so all three agree on the install target."""
    return get_app_data_dir() / "models" / model_name


def embedding_model_files_present(model_dir: Path) -> bool:
    """Whether `model_dir` has both files `OnnxEmbedder` requires."""
    return (model_dir / "model.onnx").exists() and (
        model_dir / "tokenizer.json"
    ).exists()


async def _current_fingerprint(embedder: Embedder) -> dict:
    """The fingerprint dict for `embedder`'s ACTIVE config -- compared against
    `kb_meta['embedder_fingerprint']` by `KnowledgeService._check_fingerprint`.

    Deliberately excludes the execution PROVIDER (CUDA vs CPU vs DirectML):
    they run the SAME model weights through the SAME math, producing
    numerically-close vectors of the SAME embedding space (floating-point
    kernel differences, not a different space) -- so switching GPUs, or
    falling back to CPU because a driver hiccuped, must never trigger a
    reindex. Only a genuinely different MODEL, output dimensionality, or a
    normalizer/chunker version bump changes what a vector even means.
    `quantization` is reserved for a future non-fp32 embedder variant.
    """
    return {
        "model_name": await resolve_embedding_model_name(),
        "dim": embedder.dim,
        "quantization": None,
        "normalizer_version": _NORMALIZER_VERSION,
        "chunker_version": _CHUNKER_VERSION,
    }


class _NullVectorStore:
    """A `VectorStore` (structural, see `pysaka.knowledge.protocols`) whose
    `search` always returns no hits -- the "vector arm disabled" half of the
    fingerprint-mismatch flag-gate (P-4 review, Finding 2, ADJUDICATED
    decision: non-destructive flag-gating replaces the old eager vector
    WIPE).

    Handed to `HybridRetriever` in place of the real `SqliteKnowledgeStore`
    by `KnowledgeService._ensure_retriever_cached` for as long as
    `kb_meta['reindex_required']` is set: the persisted vectors are still
    fully intact on disk (nothing was ever deleted, see `_check_fingerprint`)
    but they were embedded under the OLD model, and comparing them against a
    query embedded under the CURRENTLY active (different) model would mix
    two unrelated vector spaces -- garbage rankings that would look plausible
    enough not to be noticed. Rather than let that happen, this makes
    `HybridRetriever.search`'s RRF fusion degrade cleanly to lexical +
    structured-filters ranking only (still grounded, just without semantic
    matching) until a Rebuild clears the flag.

    `add`/`remove` are no-ops -- retriever assembly only ever calls
    `index_lexical(...)` (see `_ensure_retriever_cached`), which never
    touches the vector store at all, so these two are never actually invoked
    in practice; they exist only to satisfy the `VectorStore` protocol.
    """

    def add(self, ids: list[str], vectors: list[list[float]]) -> None:
        pass

    def remove(self, ids: list[str]) -> None:
        pass

    def search(
        self, vector: list[float], k: int, allowed_ids: set[str] | None = None
    ) -> list[tuple[str, float]]:
        return []


class KnowledgeService:
    """Wires the pysaka knowledge engine over SakaDesk paths/settings/persistence.

    The constructor takes the three injectable collaborators so tests can supply a
    `FakeEmbedder` + scripted `FakeLLMClient` + tmp `SqliteKnowledgeStore`;
    `get_knowledge_service()` builds the real ones. `data_dir` is overridable so
    tests can point roster/knowledge loading at a fixture.

    `embedder` may be `None` -- a missing embedding model is a STATE (Product-wave
    Task 4), not a construction-time crash: `get_knowledge_service()` always
    succeeds even when the model isn't installed yet, and `status()` reports
    `configured: false` instead of every KB endpoint 500ing. `_ensure_embedder()`
    (mirroring `ask()`'s pre-existing lazy `_llm` retry) is called before every
    index/ask attempt, so a model that gets installed mid-session (the in-app
    download, or a manual drop-in) is picked up on the very next attempt with no
    restart required.
    """

    def __init__(
        self,
        store: SqliteKnowledgeStore,
        embedder: Embedder | None,
        llm: LLMClient | None,
        *,
        data_dir: Path | None = None,
    ) -> None:
        self._store = store
        self._embedder = embedder
        self._llm = llm
        self._data_dir = data_dir if data_dir is not None else _DATA_DIR
        # Set once `_check_fingerprint` has run for this process's lifetime (on
        # the first successful `_ensure_embedder()`) -- see that method.
        self._fingerprint_checked = False
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
        # `service -> (store_generation, DocumentStore, HybridRetriever,
        # reindex_required_at_build_time)`. Rebuilt when EITHER
        # `self._store.generation` (bumped on `add`/`upsert_documents`/
        # `remove` -- see `SqliteKnowledgeStore`) no longer matches the cached
        # entry's generation (the persisted corpus changed since the retriever
        # was assembled), OR `kb_meta['reindex_required']` has flipped since
        # then (Finding 2, P-4 review: that flag decides which `VectorStore`
        # the retriever gets -- the real store, or a `_NullVectorStore` that
        # disables the vector arm -- see `_ensure_retriever_cached`; flipping
        # it changes NOTHING about `generation`, so generation alone can't
        # detect that this cache entry is now stale). Reused across asks
        # otherwise, removing the ~1s-and-growing per-ask corpus rehydration
        # (re-chunk + lexical index) `_build_agent` used to pay on every
        # single call. Access is safe without its own lock: every
        # reader/writer runs inside `ask()`'s or an index method's
        # `_store_lock`-held section (see `_ensure_retriever_cached`).
        self._retriever_cache: dict[
            str, tuple[int, DocumentStore, HybridRetriever, bool]
        ] = {}

    # ------------------------------------------------------------------
    # Embedder: lazy retry + fingerprint (Product-wave Task 4)
    # ------------------------------------------------------------------

    @property
    def embedder_provider(self) -> str | None:
        """The ACTUAL onnxruntime execution provider the current embedder is
        running on (`OnnxEmbedder.active_provider`), or `None` if there is no
        embedder yet. `getattr`-guarded: test doubles (`FakeEmbedder`) don't
        carry this attribute, and that's a legitimate "unknown" rather than
        an error for anything reading this defensively."""
        if self._embedder is None:
            return None
        return getattr(self._embedder, "active_provider", None)

    async def _ensure_embedder(self) -> bool:
        """`True` once `self._embedder` is usable, lazily (re)building it from
        settings first if needed -- mirrors `ask()`'s pre-existing `_llm` lazy
        retry (see that method): the model dir can appear mid-session (in-app
        download completes, or a user drops files in manually) without a
        restart. Also runs the embedder-fingerprint check exactly once per
        process lifetime, the first time an embedder becomes available (see
        `_check_fingerprint`) -- "on service init or first index/ask" per the
        fold-in spec.

        Private (leading underscore) because it's meant to be called from
        WITHIN this module, right before something that actually needs the
        embedder -- `ensure_ready()` is the public seam for outside callers
        (e.g. `backend/api/ai.py`) that just need the lazy-pickup side effect.

        Runtime gate (on-demand ONNX runtime provisioning): BEFORE touching
        the embedder at all, confirm onnxruntime itself is importable
        (`ensure_onnxruntime_importable`, Task 3) -- a packaged Windows build
        ships without it (Task 7), so the very first embedder build attempt
        may find no runtime on disk yet. `"bundled"`/`"loaded"` (dev, or a
        packaged build that already downloaded it) fall straight through to
        the pre-existing embedder-build logic below, unchanged. `"missing"`
        kicks off the download as a tracked background task and raises
        `RuntimeMissing` -- caught explicitly by `ask()`'s only caller of this
        method that must not swallow it (mirrors `EmbeddingModelMissing`,
        translated to the SSE code `runtime_missing` in `backend/api/ai.py`);
        the other three callers (`_index_preflight_ok`, `rebuild`,
        `ensure_ready`) catch it themselves and fall back to their existing
        "skip quietly" `False` return -- exactly the embedder-missing state's
        shape, since a raised `RuntimeMissing` here carries no MORE actionable
        information than that `False` already did for those non-interactive
        callers (provisioning was already triggered either way).
        """
        loader_result = ensure_onnxruntime_importable()
        if loader_result == "missing":
            host = select_runtime_host_class()
            track_background_task(
                get_runtime_provisioner().ensure(host), name="runtime_provision"
            )
            raise RuntimeMissing(host)
        if self._embedder is None:
            embedder = await _build_embedder()
            if embedder is None:
                return False
            self._embedder = embedder
            logger.info("knowledge_service.embedder_recovered")
        if not self._fingerprint_checked:
            await self._check_fingerprint()
            self._fingerprint_checked = True
        return True

    async def ensure_ready(self) -> bool:
        """Public seam for callers OUTSIDE this module that need to trigger
        the lazy embedder pickup without reaching for the private
        `_ensure_embedder` (P-4 review, Finding 1, CRITICAL).

        `backend/api/ai.py`'s `POST /index/rebuild` pre-check used to read
        `status(service).get("configured")` directly, with nothing in that
        request ever calling `_ensure_embedder()` first -- so after an
        in-app model download completed, THAT endpoint kept 409ing
        `not_configured` forever (the process-wide `KnowledgeService`
        singleton's `self._embedder` stayed `None` from its point of view),
        even though `GET /readiness` already reported the model as installed
        (it probes the filesystem directly, see `compute_readiness`) and a
        direct `svc.rebuild()` call would have succeeded (`rebuild()` retries
        the embedder itself, see its docstring). Calling this first closes
        that gap: `status()`/`is_indexing()` afterward reflect reality.

        Returns the same `True`/`False` as `_ensure_embedder`: `True` once
        `self._embedder` is usable. `RuntimeMissing` (the runtime, not the
        model, isn't downloaded yet -- see `_ensure_embedder`) is caught here
        and folded into the same `False`: this seam is a bare `await` at its
        one call site (`POST /index/rebuild`), with nothing there to catch a
        raised exception, so letting it escape would turn an expected
        first-run "still provisioning" state into a raw 500 -- the one thing
        Task 6's global constraints forbid. Provisioning was already
        triggered inside `_ensure_embedder()` regardless of whether this
        catches it, so nothing is lost by degrading to `False` here.
        """
        try:
            return await self._ensure_embedder()
        except RuntimeMissing:
            return False

    async def _check_fingerprint(self) -> None:
        """Compare the ACTIVE embedder config's fingerprint against
        `kb_meta['embedder_fingerprint']`.

        - Empty db (key never set) -> write the current fingerprint; nothing
          persisted yet, nothing to mismatch against.
        - Match -> no-op, EXCEPT: if `kb_meta['reindex_required']` is
          currently set, CLEAR it right here, with no rebuild -- see the
          mismatch branch below for why this is safe and exactly what
          "flip the model back" should do.
        - Mismatch (e.g. `embedding_model` changed in settings, or a
          normalizer/chunker version bump) -> do NOT silently mix vector
          spaces, but also do NOT destroy anything (P-4 review, Finding 2,
          ADJUDICATED decision -- supersedes the earlier eager-wipe design):
          set `kb_meta['reindex_required'] = "1"` ONLY. Every persisted
          vector is left exactly as it was (nothing is deleted -- see
          `SqliteKnowledgeStore.set_meta`'s neighboring comment for what
          used to live here), and `embedder_fingerprint` is deliberately
          NEVER overwritten to `current` on a mismatch -- it keeps pointing
          at whatever config the persisted vectors actually match. That is
          what makes the MATCH branch above able to detect "the user flipped
          the model back to what it was" as a match again (not yet another
          mismatch) and clear the flag instantly, with the old (still
          intact, still valid for THAT config) vectors immediately usable
          again -- zero data ever moved for a round trip.

        While `reindex_required` is set: incremental embedding writes are
        blocked (`_index_preflight_ok`) and the vector arm is disabled at
        retriever-assembly time (`_ensure_retriever_cached` swaps in a
        `_NullVectorStore` in place of the real, still-populated store) so
        an ask degrades to lexical + structured-filters ranking only --
        still grounded, just not semantically ranked -- rather than ever
        comparing a query vector from the NEW model against a persisted
        vector from the OLD one. A Rebuild (`_rebuild_impl`) is the only
        thing that force-re-embeds the WHOLE corpus regardless of
        content-hash (`_persist`'s `force` param) and, ONLY on successful
        completion, clears the flag and rewrites the fingerprint to the new
        baseline (`_clear_reindex_required_and_rewrite_fingerprint`) -- so a
        crash mid-rebuild leaves the flag set and the OLD (still intact)
        vectors in place, never a half-migrated store.

        Runs at most once per process lifetime (`_fingerprint_checked`,
        `_ensure_embedder`) -- changing `embedding_model` at runtime isn't a
        supported flow today (same as `knowledge_base.llm`, which similarly
        needs `invalidate_llm_client()`); this only guards against a
        DIFFERENT SakaDesk install/profile's fingerprint already being on
        disk (a copied/synced app-data dir, or a downgrade-then-upgrade), or
        the user manually editing `embedding_model` in settings.json between
        restarts. The execution PROVIDER (CUDA vs CPU) is deliberately NOT
        part of the fingerprint -- see `_current_fingerprint`'s docstring.
        """
        assert self._embedder is not None
        current = await _current_fingerprint(self._embedder)
        async with self._store_lock:
            stored_json = await asyncio.to_thread(
                self._store.get_meta, "embedder_fingerprint"
            )
            if stored_json is None:
                await asyncio.to_thread(
                    self._store.set_meta,
                    "embedder_fingerprint",
                    json.dumps(current, sort_keys=True),
                )
                logger.info("knowledge_service.fingerprint_written", **current)
                return
            if json.loads(stored_json) == current:
                if await asyncio.to_thread(self._read_reindex_required):
                    # The active config flipped back to whatever the
                    # persisted vectors actually match -- restore full
                    # (vector + lexical) search with NO rebuild; nothing
                    # ever moved.
                    await asyncio.to_thread(
                        self._store.set_meta, "reindex_required", "0"
                    )
                    self._retriever_cache.clear()
                    logger.info(
                        "knowledge_service.fingerprint_flip_back_restored",
                        **current,
                    )
                return
            logger.warning(
                "knowledge_service.fingerprint_mismatch",
                stored=json.loads(stored_json),
                current=current,
            )
            await asyncio.to_thread(self._store.set_meta, "reindex_required", "1")
            self._retriever_cache.clear()

    def _read_reindex_required(self) -> bool:
        """Whether `kb_meta['reindex_required']` is set -- an independent,
        short-lived connection (same rationale as `status()`'s
        `_read_status_by_type`: never touch the shared connection from the
        event-loop thread while a worker thread might be writing it)."""
        conn = sqlite3.connect(str(self._store.db_path))
        try:
            conn.execute("PRAGMA query_only = ON")
            row = conn.execute(
                "SELECT value FROM kb_meta WHERE key = 'reindex_required'"
            ).fetchone()
        except sqlite3.OperationalError:
            # kb_meta always exists post-migration; defensive fallback only.
            return False
        finally:
            conn.close()
        return row is not None and row[0] == "1"

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

    async def _index_preflight_ok(self, service: str, *, action: str) -> bool:
        """Shared preflight for `index_members`/`index_blogs_for_service` --
        deliberately NOT used by `rebuild`, which bypasses both checks (fixing
        either state IS what a rebuild does; see `_rebuild_impl`). Returns
        `False` after logging exactly ONE `info` line (never a per-sync
        `warning` -- merges the "bricked first run" duplicate findings, see
        `pwave-4-brief.md` item 1) when:
        - there's no embedder to embed with yet (`_ensure_embedder` also
          lazily retries building it -- see that method), or
        - the ONNX runtime itself hasn't been downloaded yet
          (`RuntimeMissing` -- see `_ensure_embedder`'s runtime gate; already
          triggered as a background download by the time this is caught), or
        - an embedder-fingerprint mismatch has blocked incremental embedding
          writes until the user triggers Rebuild (`_check_fingerprint`).
        """
        try:
            embedder_ok = await self._ensure_embedder()
        except RuntimeMissing:
            embedder_ok = False
        if not embedder_ok:
            logger.info(
                "knowledge_service.index_skipped_embedding_model_missing",
                service=service,
                action=action,
            )
            return False
        if await asyncio.to_thread(self._read_reindex_required):
            logger.info(
                "knowledge_service.index_skipped_reindex_required",
                service=service,
                action=action,
            )
            return False
        return True

    async def index_members(
        self, members: list[tuple[dict, dict]], service: str
    ) -> int:
        """Index changed members' messages; returns the count of new/changed docs.

        Guarded by the per-service in-flight registry (Finding 1, KB review):
        if `service` already has an index run in progress (another hook, a
        rebuild, or the startup sweep), this call SKIPS immediately and returns
        0 instead of racing it -- the skipped members are picked up by the next
        pass via content-hash diffing regardless. See `_index_members_impl` for
        the actual indexing work. Also skips (see `_index_preflight_ok`) when
        there's no embedding model installed yet, or a fingerprint mismatch has
        blocked writes pending Rebuild.
        """
        if not await self._index_preflight_ok(service, action="index_members"):
            return 0
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
        self,
        members: list[tuple[dict, dict]],
        service: str,
        *,
        force: bool = False,
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

        `force` (only ever passed `True` by `_rebuild_impl`, when
        `reindex_required` was set -- Finding 2, P-4 review) is threaded
        straight through to `_persist`: see its docstring for what it does.
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
        return await self._persist(docs, reference, service, force=force)

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
        in-flight-registry skip semantics (Finding 1, KB review) and the
        embedder/fingerprint preflight (`_index_preflight_ok`).
        """
        if not await self._index_preflight_ok(
            service, action="index_blogs_for_service"
        ):
            return 0
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

    async def _index_blogs_impl(self, service: str, *, force: bool = False) -> int:
        """The actual `index_blogs_for_service` work; also called directly by
        `_rebuild_impl` (which already holds the in-flight claim) -- see
        `_index_members_impl`'s docstring for why. Same off-lock-then-
        batched-persist split as `index_members` -- see `_persist`. `force`
        has the same meaning as `_index_members_impl`'s -- see there.
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
        return await self._persist(docs, reference, service, force=force)

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
        self,
        docs: list[Document],
        reference: _Reference,
        service: str,
        *,
        force: bool = False,
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

        **`force=True` (P-4 review, Finding 2 -- used ONLY by `_rebuild_impl`
        when `kb_meta['reindex_required']` was set).** Skips the content-hash
        diff entirely and treats EVERY doc in `docs` as changed, so a Rebuild
        after a fingerprint mismatch re-embeds the whole corpus even though
        the TEXT never changed -- only the active embedding model did, and
        the old hash-diff fast path would otherwise wrongly treat those docs
        as already up to date and skip them, leaving their stale (wrong
        embedding-space) vectors in place forever. This is what makes the
        non-destructive flag-gate in `_check_fingerprint` work WITHOUT ever
        needing to pre-emptively blank `content_hash` the moment a mismatch
        is detected: the next Rebuild forces the re-embed on demand, right
        before `_persist_batched` overwrites each doc's vectors via
        `store.add` (`INSERT OR REPLACE`) -- the stale vectors stay valid and
        searchable in the meantime, right up until the instant they're
        actually replaced.

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

        if force:
            changed_ids = {doc.doc_id for doc in docs}
        else:
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
        # Every caller reaches this only via `_index_preflight_ok`/`_ensure_embedder`
        # (directly, or through `_rebuild_impl`, which calls `_ensure_embedder` in
        # `rebuild()` before it) -- narrows `Embedder | None` for mypy.
        assert self._embedder is not None
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
        *,
        cancel_event: threading.Event | None = None,
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

        `cancel_event` (final review, Finding 1 -- the dropped P6 brief item)
        is the cooperative-cancel seam: a `threading.Event` the CALLER sets
        from outside this worker thread (e.g. `backend/api/ai.py`'s
        `_ask_event_stream`, on client disconnect or its own ask-deadline
        expiry) to ask the in-flight `KnowledgeAgent` loop to stop at the next
        opportunity. Threaded through to `_run_ask_blocking` as
        `should_abort=cancel_event.is_set` -- `is_set` is a plain, thread-safe
        read, so polling it from the worker thread while the event-loop thread
        sets it needs no lock of its own. See `pysaka.knowledge.agent
        .AskCancelled` for exactly when it's checked and what raising it does
        to `_store_lock`.
        """
        if self._llm is None:
            # Lazy retry, not a permanent verdict: the client can be absent because
            # the key/config wasn't available when the singleton was built (user
            # configures the key after app start, or the OS keyring hiccups during
            # startup — observed on WSL, where the DBus keyring fails once before
            # the plaintext fallback engages). Rebuilding here is cheap (a settings
            # read + keyring load), so a transient failure never bricks the chatbot
            # until restart.
            self._llm = await build_llm_client_from_settings(on_request=on_llm_request)
            if self._llm is not None:
                logger.info("knowledge_service.llm_client_recovered")
        if self._llm is None:
            raise KnowledgeMisconfigured(
                "no LLM client configured for the knowledge chatbot"
            )
        llm = self._llm
        if not await self._ensure_embedder():
            # Same "state, not a crash" treatment as the index hooks
            # (`_index_preflight_ok`), but `ask()` can't just skip quietly --
            # the user is waiting on an answer, so this surfaces as the typed
            # `embedding_model_missing` SSE error (`backend/api/ai.py`)
            # instead of a raw `AttributeError` from calling `.embed()` on
            # `None` deep inside the agent's tool-calling loop.
            model_name = await resolve_embedding_model_name()
            raise EmbeddingModelMissing(model_name, embedding_model_dir(model_name))
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
        # its full duration -- bounded, since the P6 cooperative-cancel seam
        # (`cancel_event`/`AskCancelled`, above), to roughly the CURRENT step
        # of the agent loop rather than the whole thing. Acceptable for a
        # single-user desktop app.
        async with self._store_lock:
            return await asyncio.to_thread(
                self._run_ask_blocking, question, scope, llm, tz, history, cancel_event
            )

    def _run_ask_blocking(
        self,
        question: str,
        scope: Scope,
        llm: LLMClient,
        tz: tzinfo,
        history: list[dict] | None,
        cancel_event: threading.Event | None = None,
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

        `cancel_event` becomes `should_abort=cancel_event.is_set` for
        `agent.answer()` -- `None` when no cancel event was given, which
        `KnowledgeAgent` treats as "never abort" (see `ask`'s docstring for
        the full seam). A resulting `pysaka.knowledge.AskCancelled` is
        deliberately NOT caught here -- unlike `ToolCallingUnreliableError`,
        it isn't a backend failure to translate into `LLMBackendError`; it
        propagates as-is so the caller (`ask()`, then `backend/api/ai.py`)
        can tell "the model failed" apart from "we asked it to stop."
        """
        agent = self._build_agent(scope.service, llm, tz)
        should_abort = cancel_event.is_set if cancel_event is not None else None
        try:
            return asyncio.run(
                agent.answer(question, scope, history, should_abort=should_abort)
            )
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
        it if EITHER the store's `generation` has moved on since it was cached,
        OR `kb_meta['reindex_required']` has flipped since then.

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

        **Vector-arm gating (P-4 review, Finding 2).** `reindex_required` is
        checked on EVERY call (not cached in `self`) and included in the cache
        key: it decides which `VectorStore` the freshly-built `HybridRetriever`
        gets -- the real, persisted `self._store` normally, or a
        `_NullVectorStore` (search always empty) while `reindex_required` is
        set, so a query embedded under a NEW model can never be compared
        against OLD-model vectors still sitting in `self._store` (never wiped
        -- see `_check_fingerprint`). Flipping that flag changes nothing about
        `generation`, so generation alone can't detect this cache entry needs
        rebuilding.
        """
        generation = self._store.generation
        reindex_required = self._read_reindex_required()
        cached = self._retriever_cache.get(service)
        if (
            cached is not None
            and cached[0] == generation
            and cached[3] == reindex_required
        ):
            return cached[1], cached[2]
        docs = self._store.documents_for_service(service)
        doc_store = DocumentStore()
        doc_store.upsert(docs)
        vectors: VectorStore = self._store
        if reindex_required:
            # Degrade to lexical + structured-filters ranking only -- still
            # grounded, just without semantic matching -- until a Rebuild
            # clears the flag. See `_NullVectorStore`'s docstring.
            vectors = _NullVectorStore()
            logger.info(
                "knowledge_service.retriever_vector_arm_disabled_reindex_required",
                service=service,
            )
        # Invariant: both callers (`_build_agent` via `ask`, and `rebuild`)
        # have already run `_ensure_embedder()` successfully, so `None` here
        # is a programming error, not a user-configuration state.
        assert self._embedder is not None
        retriever = HybridRetriever(
            doc_store, PureLexicalIndex(), vectors, self._embedder
        )
        retriever.index_lexical(chunk_documents(docs))
        self._retriever_cache[service] = (
            generation,
            doc_store,
            retriever,
            reindex_required,
        )
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

        **Never 500s on a missing embedding model (Product-wave Task 4).** When
        `self._embedder is None`, returns the reduced `{configured: false,
        reason: "embedding_model_missing", ...}` shape instead of touching the
        db at all -- there's nothing indexed that could have been embedded.
        `backend/api/ai.py`'s endpoint layer enriches this further with
        `model`/`expected_path` (which need an async settings read `status()`
        deliberately can't do here -- same pattern as its `last_built`
        enrichment). When configured, also reports `provider` (the ACTUAL
        onnxruntime execution provider in use), `reindex_required` (an
        embedder-fingerprint mismatch blocking incremental writes -- see
        `_check_fingerprint`), and `degraded` (P-4 review, Finding 2 -- the
        SAME condition as `reindex_required`, surfaced under the name a
        search-quality UI banner reads naturally as: while true, the vector
        arm is disabled at retriever-assembly time, see
        `_ensure_retriever_cached`, so search runs lexical + structured-
        filters only until a Rebuild clears it).
        """
        if self._embedder is None:
            return {
                "configured": False,
                "reason": "embedding_model_missing",
                "service": service,
                "document_count": 0,
                "by_type": {},
                "progress": (
                    self.index_progress(service)
                    if service is not None
                    else _idle_progress(None)
                ),
            }
        by_type = self._read_status_by_type(service)
        progress = (
            self.index_progress(service)
            if service is not None
            else _idle_progress(None)
        )
        reindex_required = self._read_reindex_required()
        return {
            "configured": True,
            "service": service,
            "document_count": sum(by_type.values()),
            "by_type": by_type,
            "progress": progress,
            "provider": self.embedder_provider,
            "reindex_required": reindex_required,
            "degraded": reindex_required,
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

        Unlike `index_members`/`index_blogs_for_service`, this does NOT check
        `reindex_required` -- a rebuild is exactly what CLEARS that state (see
        `_rebuild_impl`). It still needs an embedder to embed with, though: if
        none is installed (and the lazy retry in `_ensure_embedder` can't
        build one either), this skips quietly with one info log, same
        "state, not a crash" treatment as everywhere else -- including when
        the ONNX runtime itself isn't downloaded yet (`RuntimeMissing`, see
        `_ensure_embedder`'s runtime gate): `POST /index/rebuild` calls
        `ensure_ready()` (which already folds `RuntimeMissing` into `False`)
        before ever reaching this method, but `rebuild()` is also called
        directly by the startup catch-up sweep
        (`schedule_initial_build_all`) with no such pre-check, so this catches
        it too rather than relying on every caller doing so upstream.
        """
        try:
            embedder_ok = await self._ensure_embedder()
        except RuntimeMissing:
            embedder_ok = False
        if not embedder_ok:
            logger.info(
                "knowledge_service.rebuild_skipped_embedding_model_missing",
                service=service,
            )
            return 0
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
        embedding) -- UNLESS `kb_meta['reindex_required']` is set (an
        embedder-fingerprint mismatch, see `_check_fingerprint`), in which case
        `force=True` bypasses that fast path and re-embeds EVERY doc regardless
        of content-hash (P-4 review, Finding 2: this is what actually replaces
        the old, now-removed eager vector wipe -- see `_persist`'s `force`
        docstring). The flag is read ONCE, right here, before either
        `_index_*_impl` call runs, so this whole rebuild uses one consistent
        decision. (It does not delete docs whose source files were removed — a
        hard purge would need a store `delete_service`, out of scope for v1.)

        Calls `_index_members_impl`/`_index_blogs_impl` directly (NOT the
        guarded `index_members`/`index_blogs_for_service` wrappers): `rebuild`
        already holds `service`'s in-flight claim for this whole call, so going
        through the wrappers would see that same claim as "already taken" and
        skip, breaking rebuild entirely.

        On completion: clears `reindex_required`/rewrites the fingerprint
        (`_clear_reindex_required_and_rewrite_fingerprint`) BEFORE warming the
        retriever cache -- ordering matters, see that method's docstring --
        then records `settings.knowledge_base.last_built` so
        `KnowledgeBaseStatus` can render "Last indexed: …".
        """
        self._index_progress[service] = {
            "service": service,
            "phase": "discovering",
            "done": 0,
            "total": 0,
            "started_at": _utcnow_iso(),
        }
        force_reembed = await asyncio.to_thread(self._read_reindex_required)
        members = await asyncio.to_thread(self._discover_message_members, service)
        changed = await self._index_members_impl(members, service, force=force_reembed)
        changed += await self._index_blogs_impl(service, force=force_reembed)
        await self._clear_reindex_required_and_rewrite_fingerprint()
        async with self._store_lock:
            await asyncio.to_thread(self._ensure_retriever_cached, service)
        await self._record_last_built()
        return changed

    async def _clear_reindex_required_and_rewrite_fingerprint(self) -> None:
        """Called at the end of every successful `_rebuild_impl`, AFTER
        `service`'s whole corpus has actually been force-re-embedded (see
        `_persist`'s `force` param): clears the `reindex_required` flag and
        (re)writes `kb_meta['embedder_fingerprint']` to the current active
        config -- the new baseline `service`'s just-rewritten vectors now
        match.

        **Ordering is crash-safety-critical (P-4 review, Finding 2).** If the
        process dies mid-rebuild, this line never runs, so `reindex_required`
        stays set and `embedder_fingerprint` keeps pointing at whatever
        baseline the STILL-INTACT persisted vectors actually match (nothing
        was ever wiped up front -- see `_check_fingerprint`); the vector arm
        stays disabled and incremental writes stay blocked until the next
        Rebuild retries. A retry always force-re-embeds the WHOLE corpus
        again regardless of content-hash, so there is no partial-progress
        state to resume from -- a rebuild either fully completes and reaches
        this line, or it doesn't and the flag/fingerprint are left exactly as
        they were. `_rebuild_impl` also calls this BEFORE warming the
        retriever cache (not after, as the old wipe-based design did): the
        cache-warm reads `reindex_required` to decide which `VectorStore` to
        hand the retriever (`_ensure_retriever_cached`), so clearing the flag
        first ensures the freshly warmed cache gets the REAL vector store,
        not a `_NullVectorStore` built one step too early.

        KNOWN v1 LIMITATION (inherited from before this fix, just a different
        failure mode now that vectors are never wiped): with multiple synced
        services sharing this one db and ONE GLOBAL `reindex_required`/
        `embedder_fingerprint` pair, this clears the flag for EVERY service
        the instant the FIRST one's rebuild completes -- which re-enables the
        vector arm globally (`_ensure_retriever_cached`) even for sibling
        services that haven't rebuilt yet. Those siblings' OLD-model vectors
        are still on disk (never wiped) and would be compared against
        NEW-model query vectors until their own Rebuild catches up. Making
        `reindex_required`/`embedder_fingerprint` PER-SERVICE would close
        this, but is out of scope here -- the flag was already global before
        this change; only its wipe-vs-preserve semantics changed.

        A mismatch that also changes the vector DIMENSIONALITY (a genuinely
        different model, not just a normalizer/chunker bump) compounds the
        above into a harder failure than "wrong rankings": `NumpyVectorStore`
        keeps one dense matrix and requires every row to be the same width,
        so a not-yet-rebuilt sibling service's OLD-dimension vectors sitting
        in `kb_vectors` alongside a rebuilt service's NEW-dimension ones can
        raise at the NEXT store open (`_load_vectors` stacks every persisted
        row into one matrix, regardless of service). `SqliteKnowledgeStore
        .add`'s remove-then-add (see its docstring) only protects the exact
        ids being replaced within ONE write; it cannot make two DIFFERENT
        services' vectors coexist at different widths. A real dimension
        change across a multi-service install should be followed by
        rebuilding every synced service, not just the one the user happened
        to touch first -- not automated here, same v1 scope boundary as above.
        """
        assert self._embedder is not None
        current = await _current_fingerprint(self._embedder)
        async with self._store_lock:
            await asyncio.to_thread(
                self._store.set_meta,
                "embedder_fingerprint",
                json.dumps(current, sort_keys=True),
            )
            await asyncio.to_thread(self._store.set_meta, "reindex_required", "0")
        self._retriever_cache.clear()

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

    Builds a `SqliteKnowledgeStore` (`knowledge_index.db`, alongside
    `search_index.db`), an `OnnxEmbedder` if the model is installed (`None`
    otherwise -- see `_build_embedder`; a missing model is a STATE, not a
    construction-time failure, Product-wave Task 4), and the LLM client from
    settings. Async because the LLM client is built from settings + OS keyring.

    Both heavy, blocking constructors -- `SqliteKnowledgeStore.__init__`
    (rehydrates every persisted vector blob, ~80MB+ at 26k docs) and
    `OnnxEmbedder.__init__` (loads a ~1GB ONNX `InferenceSession`, inside
    `_build_embedder`) -- run via `asyncio.to_thread` so the first touch never
    stalls the event loop (and therefore the whole UI/API) for seconds.

    Still raises `KnowledgeMisconfigured` for a genuinely unrecoverable case:
    `knowledge_index.db`'s `PRAGMA user_version` is newer than this SakaDesk
    build understands (`KnowledgeStoreVersionError`, see `knowledge_store.py`)
    -- that one really can't be papered over into a `configured: false` state,
    since there's no safe way to read the file at all.
    """
    global _knowledge_service
    if _knowledge_service is not None:
        return _knowledge_service
    async with _knowledge_service_lock:
        if _knowledge_service is None:
            try:
                store = await asyncio.to_thread(
                    SqliteKnowledgeStore, get_app_data_dir() / "knowledge_index.db"
                )
            except KnowledgeStoreVersionError as exc:
                raise KnowledgeMisconfigured(str(exc)) from exc
            embedder = await _build_embedder()
            llm = await build_llm_client_from_settings(on_request=on_llm_request)
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
    llm = await build_llm_client_from_settings(on_request=on_llm_request)
    _knowledge_service.reload_llm(llm)


async def _build_embedder() -> Embedder | None:
    """Construct the real `OnnxEmbedder` from the settings-selected model dir,
    or `None` if it isn't installed yet.

    Product-wave Task 4: a missing model is a STATE (`configured: false`
    everywhere it's surfaced), never a raised exception here -- callers
    (`get_knowledge_service`, `KnowledgeService._ensure_embedder`) both treat
    `None` as "not configured yet, retry later" rather than a hard failure.
    Also honors `settings.knowledge_base.embedding_provider` (`None` = auto;
    an explicit onnxruntime provider name to force it) -- logged either way
    so it's visible in the log breadcrumb which provider actually won.
    """
    config = await load_config()
    kb_config = config.get("knowledge_base") or {}
    model_name = kb_config.get("embedding_model") or _DEFAULT_EMBEDDING_MODEL
    model_dir = embedding_model_dir(model_name)
    if not embedding_model_files_present(model_dir):
        logger.info(
            "knowledge_service.embedder_not_configured",
            model=model_name,
            expected_path=str(model_dir),
        )
        return None
    from pysaka.knowledge.backends.onnx_embedder import OnnxEmbedder

    provider_override = kb_config.get("embedding_provider")
    providers = [provider_override] if provider_override else None

    # OnnxEmbedder.__init__ loads a ~1GB ONNX InferenceSession synchronously --
    # off the event loop thread, same reasoning as SqliteKnowledgeStore above.
    embedder = await asyncio.to_thread(OnnxEmbedder, model_dir, providers)
    logger.info(
        "knowledge_service.embedder_built",
        model=model_name,
        provider=embedder.active_provider,
    )
    return cast("Embedder", embedder)


# ------------------------------------------------------------------
# Readiness (Product-wave Task 4, item 2) -- GET /api/ai/readiness
# ------------------------------------------------------------------


async def compute_readiness() -> dict:
    """Independent readiness checks for `GET /api/ai/readiness`.

    Deliberately does NOT call `get_knowledge_service()`: building the real
    embedder alone loads a ~1GB ONNX `InferenceSession`, which this endpoint
    must never pay just to answer "is it configured?". Instead this reads
    settings + the filesystem directly, and (for the LLM check) the OS
    keyring via `build_llm_client_from_settings()` -- which itself never
    makes a network call, only constructs a client object (see
    `llm_client.py`). The document count and `degraded` flag each open their
    OWN short-lived sqlite connection (mirrors `KnowledgeService.status`'s
    `_read_status_by_type`).

    Every individual probe is wrapped so a single failing check degrades to
    `ok: false` instead of raising -- this endpoint must never 500.

    `degraded` (P-4 review, Finding 2) mirrors `KnowledgeService.status()`'s
    same-named field: `True` while `kb_meta['reindex_required']` is set (an
    embedder-fingerprint mismatch flag-gated the vector arm, see
    `_check_fingerprint`/`_ensure_retriever_cached`) -- surfaced here too so
    `SetupChecklist`/`KnowledgeBaseStatus` can show a "search quality reduced
    until rebuild" banner without ever needing to build the full
    `KnowledgeService` singleton just to answer this.
    """
    enabled = await kb_enabled()
    embedding_model = await _probe_embedding_model()
    llm = await _probe_llm()
    index = await asyncio.to_thread(_probe_index_document_count)
    degraded = await asyncio.to_thread(_probe_degraded)
    runtime = _runtime_probe()
    return {
        "enabled": enabled,
        "embeddingModel": embedding_model,
        "llm": llm,
        "index": index,
        "degraded": degraded,
        "runtime": runtime,
    }


def _runtime_probe() -> dict:
    """Runtime readiness: bundled (dev) or downloaded => ok; otherwise report the
    provisioner's live download state so the UI can show progress."""
    result = ensure_onnxruntime_importable()
    if result in ("bundled", "loaded"):
        return {"ok": True, "state": result, "host": select_runtime_host_class()}
    prov_status = get_runtime_provisioner().status()
    return {
        "ok": False,
        "state": prov_status["state"] if prov_status["state"] != "idle" else "missing",
        "host": select_runtime_host_class(),
    }


async def _probe_embedding_model() -> dict:
    try:
        model_name = await resolve_embedding_model_name()
        model_dir = embedding_model_dir(model_name)
        if not embedding_model_files_present(model_dir):
            return {
                "ok": False,
                "reason": "embedding_model_missing",
                "model": model_name,
                "expectedPath": str(model_dir),
            }
        provider, provider_confirmed = await asyncio.to_thread(
            _predict_or_confirm_provider
        )
        result = {
            "ok": True,
            "model": model_name,
            "path": str(model_dir),
            "provider": provider,
            "providerConfirmed": provider_confirmed,
        }
        result["gpuRuntimeMissing"] = await asyncio.to_thread(_gpu_runtime_missing_hint)
        return result
    except Exception:  # noqa: BLE001 - readiness must never 500
        logger.error(
            "knowledge_service.readiness_embedding_probe_failed", exc_info=True
        )
        return {"ok": False, "reason": "probe_failed"}


def _predict_or_confirm_provider() -> tuple[str | None, bool]:
    """The embedding execution provider to report in `/readiness`: the ACTUAL
    provider already in use if the process-wide `KnowledgeService` singleton
    happens to be built already (`providerConfirmed: True`), else a
    best-effort PREDICTION from pysaka's `select_providers()` -- cheap (reads
    `onnxruntime`'s installed-provider list, never loads the ~1GB model) so
    the UI has something to show before the first ask/index has happened.
    """
    if _knowledge_service is not None and _knowledge_service.embedder_provider:
        return _knowledge_service.embedder_provider, True
    try:
        from pysaka.knowledge.backends.onnx_embedder import select_providers

        return select_providers()[0], False
    except Exception:  # noqa: BLE001 - best-effort prediction only
        return None, False


def _gpu_runtime_missing_hint() -> bool:
    """`True` when hardware detection finds a GPU but the installed
    `onnxruntime` build doesn't report `CUDAExecutionProvider` available --
    the "GPU detected, GPU runtime not installed" hint (merges 6 duplicate
    CPU-only-embedder findings, `pwave-4-brief.md` item 5): the machine HAS a
    capable GPU, but `pysaka[embeddings-gpu]` (`onnxruntime-gpu`) isn't
    installed, so embedding silently runs on CPU. Best-effort and always
    safe -- `detect_hardware()` already guards every probe it makes.
    """
    try:
        import onnxruntime as ort

        from backend.services.hardware import detect_hardware

        hw = detect_hardware()
        if not hw.get("gpu"):
            return False
        return "CUDAExecutionProvider" not in ort.get_available_providers()
    except Exception:  # noqa: BLE001 - best-effort hint only
        return False


async def _probe_llm() -> dict:
    try:
        config = await load_config()
        llm_config = (config.get("knowledge_base") or {}).get("llm") or {}
        backend = llm_config.get("backend")
        model = llm_config.get("model")
        client = await build_llm_client_from_settings()
        if client is None:
            return {
                "ok": False,
                "backend": backend,
                "model": model,
                "reason": "not_configured",
            }
        return {"ok": True, "backend": backend, "model": model}
    except Exception:  # noqa: BLE001 - readiness must never 500
        logger.error("knowledge_service.readiness_llm_probe_failed", exc_info=True)
        return {"ok": False, "reason": "probe_failed"}


def _probe_index_document_count() -> dict:
    db_path = get_app_data_dir() / "knowledge_index.db"
    if not db_path.exists():
        return {"documentCount": 0}
    try:
        conn = sqlite3.connect(str(db_path))
        try:
            conn.execute("PRAGMA query_only = ON")
            row = conn.execute("SELECT COUNT(*) FROM kb_documents").fetchone()
            return {"documentCount": row[0] if row is not None else 0}
        finally:
            conn.close()
    except sqlite3.Error:
        logger.warning("knowledge_service.readiness_index_probe_failed", exc_info=True)
        return {"documentCount": 0}


def _probe_degraded() -> bool:
    """Whether `kb_meta['reindex_required']` is set on `knowledge_index.db`
    (P-4 review, Finding 2) -- an embedder-fingerprint mismatch that
    flag-gated (never wiped) the persisted vectors, disabling the vector arm
    at retriever-assembly time until a Rebuild clears it (see
    `KnowledgeService._check_fingerprint`/`_ensure_retriever_cached`).

    Opens its OWN short-lived connection, same rationale as
    `_probe_index_document_count`; `False` (never degraded) when the db
    doesn't exist yet -- nothing indexed, nothing to degrade.
    """
    db_path = get_app_data_dir() / "knowledge_index.db"
    if not db_path.exists():
        return False
    try:
        conn = sqlite3.connect(str(db_path))
        try:
            conn.execute("PRAGMA query_only = ON")
            row = conn.execute(
                "SELECT value FROM kb_meta WHERE key = 'reindex_required'"
            ).fetchone()
            return row is not None and row[0] == "1"
        finally:
            conn.close()
    except sqlite3.Error:
        logger.warning(
            "knowledge_service.readiness_degraded_probe_failed", exc_info=True
        )
        return False
