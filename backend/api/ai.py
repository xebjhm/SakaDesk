"""`/api/ai` -- the KB-chatbot router: two-pass SSE `ask`, index status/rebuild,
hardware-suggestion, and LLM config endpoints.

**Two-pass `/ask` design.** `KnowledgeService.ask()` (Task 3) runs fully offloaded
under a store lock and does not stream its own progress -- from this router's
point of view it's a single opaque coroutine that eventually resolves to an
ALREADY-VALIDATED `Answer` (grounding already enforced server-side, see
`pysaka.knowledge.validator.validate`). So "two-pass" here means: pass 1 is a
periodic `event: progress` heartbeat emitted for as long as that coroutine is
pending (a generic "thinking" label -- real per-tool-call labels need a pysaka
agent progress hook, which is a documented v1.1 item, not built here); pass 2 is
the single terminal `event: answer` (or `event: error`) emitted once it resolves.
The whole `ask()` call -- including the `get_knowledge_service()` lookup, which
can itself raise `KnowledgeMisconfigured` (e.g. no LLM configured) -- runs inside
one `asyncio.Task` so every failure mode surfaces as an in-band SSE `event: error`
rather than an unhandled exception mid-stream (the HTTP status is already 200 by
the time any of this runs).

**Client disconnect.** The heartbeat loop polls `request.is_disconnected()` each
cycle; once the client is gone, the generator stops emitting entirely (no more
heartbeats, no terminal event) but deliberately does NOT `task.cancel()` the
in-flight ask. `KnowledgeService.ask()` holds `_store_lock` for the duration of a
worker thread (`asyncio.to_thread`) that the event loop cannot preempt --
cancelling the awaiting coroutine would only unwind the `async with
self._store_lock:` block and free the lock *while the orphaned worker thread kept
running*, letting a concurrent index/ask race that orphaned thread over the shared
sqlite/vector store. So the task is instead detached into the module-level
`_pending_ask_tasks` set (via `add_done_callback`) and left to finish naturally --
bounded by `OpenAICompatLLMClient`'s ~120s httpx timeout, so the lock is never
held indefinitely -- which also guarantees its exception (if any) is always
retrieved even though nothing `await`s it directly anymore.

**Citation `ref` serialization.** Each `Citation.source_ref` (`pysaka.knowledge
.models.SourceRef`) is translated into the frontend's `CitationReference` shape
(Plan B Shared Contracts / Task 7's `navigateToSource`): `kind == "blog"` ->
`{type: "blog", service, blogId, memberId}`; `kind == "message"` ->
`{type: "message", service, groupId, groupName, memberId, memberName, messageId,
isGroupChat}`.

**Config invalidation.** `PUT /config` persists `settings.knowledge_base.llm` via
`update_config()`, then calls `KnowledgeService`'s
`backend.services.knowledge_service.invalidate_llm_client()` hook so the *next*
`ask()` builds its `LLMClient` from the new backend/base_url/model instead of a
stale cached one -- see that function's docstring for why it's a safe no-op when
the service singleton hasn't been built yet.

**Enabled gate + lifecycle.** `PUT /enabled` is the KB settings section's on/off
switch, separate from `PUT /config` (which stays LLM-only so a user can
configure before enabling). `/ask` and `/index/rebuild` both check
`knowledge_service.kb_enabled()` before doing any KB work -- `/ask` via
`_run_ask` raising `KnowledgeDisabled`, translated to SSE `event: error
{code: "kb_disabled"}`; `/index/rebuild` via a plain 409
`{code: "kb_disabled"}`. `PUT /config` and `GET /index/status` are
deliberately NOT gated: a user must be able to configure/inspect the KB before
turning it on. `/index/rebuild` also 409s `{alreadyRunning: true}` when
`KnowledgeService.index_progress()` isn't `"idle"`, instead of stacking another
background rebuild behind `_store_lock` on a repeated click.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import structlog
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

from backend.services.background_tasks import track_background_task
from backend.services.hardware import detect_hardware, suggest_llm_backend
from backend.services.knowledge_service import (
    KnowledgeDisabled,
    KnowledgeMisconfigured,
    KnowledgeService,
    get_knowledge_service,
    invalidate_llm_client,
    kb_enabled,
    schedule_initial_build_all,
)
from backend.services.llm_client import LLMBackendError
from backend.services.service_utils import validate_service
from backend.services.settings_store import load_config, update_config
from pysaka.knowledge import Answer, Citation, Scope, SourceRef

logger = structlog.get_logger(__name__)

router = APIRouter()

# How often to emit an `event: progress` heartbeat while `ask()` is pending.
_HEARTBEAT_INTERVAL_S = 1.0

_VALID_LLM_BACKENDS = {"cloud", "local"}

# User-safe FALLBACK error text for old clients that don't yet understand the
# structured `code` field -- never raw exception text (which may echo provider
# response bodies or other details we don't want on the wire twice). New
# clients key off `code` (== `LLMBackendError.kind`, or one of `misconfigured`/
# `unknown`) and localize it themselves; `message` is never the sole signal.
_LLM_ERROR_MESSAGES: dict[str, str] = {
    "quota_exhausted": (
        "The AI provider's usage quota was reached. Try again later, or switch "
        "models in AI settings."
    ),
    "auth": "The AI provider rejected the API key. Check the AI settings.",
    "model_not_found": (
        "The selected model isn't available on the configured backend. Pick "
        "another in AI settings."
    ),
    "model_incompatible": (
        "This model doesn't reliably support the knowledge tools. Try a "
        "different model in AI settings."
    ),
    "unreachable": (
        "Couldn't reach the configured AI backend. Check your connection, or "
        "that a local server (e.g. Ollama) is running."
    ),
    "timeout": "The AI backend took too long to respond. Please try again.",
    "malformed_response": (
        "The AI backend returned an unexpected response. Please try again."
    ),
}
_LLM_ERROR_FALLBACK_MESSAGE = (
    "The configured AI backend is unavailable. Check the AI settings and try again."
)
_MISCONFIGURED_MESSAGE = (
    "The knowledge chatbot isn't configured yet. Check the AI settings."
)
_KB_DISABLED_MESSAGE = "The knowledge chatbot is turned off. Enable it in AI settings."
_GENERIC_ERROR_MESSAGE = "The request failed unexpectedly."

# `member_id` must be a pysaka `CanonicalId`: f"{service}:{blog_id}" (D8), e.g.
# "hinatazaka46:12" -- what `doc.author_id`/`Scope.member_id` are always
# compared against (see `pysaka.knowledge.store._matches`). Rejects the shape
# a plain numeric blog id would take if sent as a bare string ("12") or as a
# JSON number coerced to string by an old/buggy client -- those would parse as
# valid `str`s but never equal any `author_id`, silently scoping every ask to
# zero documents instead of erroring.
_CANONICAL_MEMBER_ID_RE = re.compile(r"^\S+:\d+$")


# ----------------------------------------------------------------------------
# Request/response models
# ----------------------------------------------------------------------------


class AskRequest(BaseModel):
    question: str
    service: str
    group_ids: list[int] | None = None
    member_id: str | None = None  # pysaka CanonicalId, e.g. "hinatazaka46:12"
    tz: str
    # Accepted for forward-compatibility with a future conversation store; not
    # yet resolved into `history` here (no conversation-store seam exists yet).
    conversation_id: str | None = None

    @field_validator("member_id")
    @classmethod
    def _member_id_must_be_canonical(cls, value: str | None) -> str | None:
        """Reject a `member_id` that isn't shaped like a pysaka `CanonicalId`
        (`"<service>:<blog_id>"`) up front, as a 422, instead of letting it
        silently scope the ask to zero documents (see `_CANONICAL_MEMBER_ID_RE`
        docstring)."""
        if value is not None and not _CANONICAL_MEMBER_ID_RE.match(value):
            raise ValueError(
                "member_id must be a canonical id shaped '<service>:<blog_id>' "
                "(e.g. 'hinatazaka46:12')"
            )
        return value


class RebuildRequest(BaseModel):
    service: str


class LLMConfigRequest(BaseModel):
    backend: str
    base_url: str
    model: str


class KbEnabledRequest(BaseModel):
    enabled: bool


# ----------------------------------------------------------------------------
# SSE helpers
# ----------------------------------------------------------------------------


def _format_sse(event: str, data: dict) -> str:
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


async def _current_llm_backend_model() -> tuple[str | None, str | None]:
    """The currently-configured `knowledge_base.llm` `(backend, model)`, for the
    error event's `backend`/`model` fields -- read fresh from settings (not
    cached on the failed `LLMBackendError`) so it reflects reality even when the
    failure was `KnowledgeMisconfigured`/a generic exception with nothing to ask."""
    config = await load_config()
    llm_config = (config.get("knowledge_base") or {}).get("llm") or {}
    return llm_config.get("backend"), llm_config.get("model")


def _serialize_error_event(
    code: str,
    message: str,
    *,
    retry_after_s: float | None,
    backend: str | None,
    model: str | None,
) -> dict:
    """`{code, message, retryAfterS?, backend, model}` -- the SSE `event: error` contract.

    `code` is what the frontend keys off (`ai.error.<code>` i18n lookup);
    `message` is a safe English fallback for old, not-yet-updated clients.
    `retryAfterS` is omitted entirely (not sent as `null`) when unknown.
    """
    data: dict = {"code": code, "message": message, "backend": backend, "model": model}
    if retry_after_s is not None:
        data["retryAfterS"] = retry_after_s
    return data


def _serialize_ref(ref: SourceRef) -> dict:
    """`SourceRef` -> the frontend `CitationReference` shape (blog | message)."""
    if ref.kind == "blog":
        return {
            "type": "blog",
            "service": ref.service,
            "blogId": ref.blog_id,
            "memberId": ref.member_id,
        }
    return {
        "type": "message",
        "service": ref.service,
        "groupId": ref.group_id,
        "groupName": ref.group_name,
        "memberId": ref.member_id,
        "memberName": ref.member_name,
        "messageId": ref.message_id,
        "isGroupChat": ref.is_group_chat,
    }


def _serialize_citation(citation: Citation) -> dict:
    """`Citation` -> the frontend `Citation` shape (camelCase, Shared Contracts)."""
    return {
        "docId": citation.doc_id,
        "ref": _serialize_ref(citation.source_ref),
        "snippet": citation.quoted_snippet,
        "member": citation.member,
        "timestamp": citation.timestamp.isoformat(),
    }


def _serialize_answer(answer: Answer) -> dict:
    """`Answer` -> the frontend `Answer` shape (camelCase, Shared Contracts)."""
    if answer.no_evidence:
        return {"noEvidence": True}
    return {
        "sentences": [
            {"text": sentence.text, "citationIds": sentence.citation_ids}
            for sentence in answer.sentences
        ],
        "citations": [_serialize_citation(c) for c in answer.citations],
        "noEvidence": False,
    }


async def _run_ask(
    question: str, scope: Scope, tz: tzinfo, history: list[dict] | None
) -> Answer:
    """Check `kb_enabled()`, look up the service, and run `ask()` -- all inside
    the same task, so every failure mode (disabled, `KnowledgeMisconfigured`, an
    LLM/provider failure) surfaces through the same in-band `event: error` path.

    The `kb_enabled()` check runs BEFORE `get_knowledge_service()` so a disabled
    KB never builds the embedder/store/LLM client just to answer a question no
    one is allowed to ask yet (mirrors the index hooks' guard).
    """
    if not await kb_enabled():
        raise KnowledgeDisabled()
    svc = await get_knowledge_service()
    return await svc.ask(question, scope, tz, history)


async def _heartbeat_payload(service: str) -> dict:
    """The `event: progress` payload for one heartbeat tick.

    `{"stage": "indexing", "done": ..., "total": ...}` when `service`'s index is
    actively embedding right now (Lock fairness): an ask queued behind an
    in-flight index batch only ever waits SECONDS between batches (see
    `KnowledgeService._persist_batched`), but without this it would show a
    generic "thinking" spinner that looks identical to a slow LLM call for
    however long that wait lasts. Falls back to `{"stage": "thinking"}` --
    including when the knowledge service isn't buildable at all (disabled/
    misconfigured); `_run_ask` surfaces THAT failure through the normal error
    path already, so this is purely best-effort progress labeling.
    """
    try:
        svc = await get_knowledge_service()
        progress = svc.index_progress()
        if progress.get("phase") != "idle" and progress.get("service") == service:
            return {
                "stage": "indexing",
                "done": progress.get("done", 0),
                "total": progress.get("total", 0),
            }
    except KnowledgeMisconfigured:
        pass
    except Exception:  # noqa: BLE001 - best-effort UX label; must never break the heartbeat/ask
        logger.debug("ai.ask.heartbeat_progress_lookup_failed", exc_info=True)
    return {"stage": "thinking"}


# Ask tasks detached from a generator that stopped early (client disconnect) --
# see `_ask_event_stream`'s WHY-NOT-CANCEL comment. Kept alive here so asyncio
# never garbage-collects a still-running task, and `add_done_callback` below
# guarantees its result/exception is always retrieved exactly once even though
# nothing `await`s it directly anymore (avoids an "exception was never
# retrieved" warning once the worker thread finally finishes).
_pending_ask_tasks: set[asyncio.Task] = set()


def _on_ask_task_done(task: asyncio.Task) -> None:
    _pending_ask_tasks.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("ai.ask.background_task_failed", exc_info=exc)


async def _ask_event_stream(request: Request, question: str, scope: Scope, tz: tzinfo):
    # Immediate "thinking" feedback -- guarantees the client sees at least one
    # progress event even if `ask()` resolves faster than the heartbeat interval.
    yield _format_sse("progress", {"stage": "thinking"})

    task: asyncio.Task[Answer] = asyncio.create_task(
        _run_ask(question, scope, tz, None)
    )
    _pending_ask_tasks.add(task)
    task.add_done_callback(_on_ask_task_done)

    try:
        while not task.done():
            if await request.is_disconnected():
                # Client is gone -- stop streaming (no point heartbeating to a
                # dead socket). We deliberately do NOT `task.cancel()` here.
                #
                # WHY: `svc.ask()` holds `KnowledgeService._store_lock` for its
                # entire body, which runs inside `asyncio.to_thread` -- a worker
                # thread the event loop cannot preempt. Cancelling this
                # generator's `task` only raises `CancelledError` in the
                # *awaiting* coroutine (the `await asyncio.to_thread(...)`
                # call); it cannot stop the worker thread already executing
                # `_run_ask_blocking` underneath it. That would unwind the
                # `async with self._store_lock:` block and release the lock
                # WHILE the orphaned worker thread keeps mutating the shared
                # sqlite/vector store -- letting a concurrent index write or
                # another ask acquire the freed lock and race that orphaned
                # thread (a torn read/write). So instead we let `task` run to
                # natural completion (it's already detached into
                # `_pending_ask_tasks`, above) -- bounded by
                # `OpenAICompatLLMClient`'s ~120s httpx timeout, so the lock
                # can never be held forever even with no one left to hear the
                # answer.
                logger.info("ai.ask.client_disconnected", service=scope.service)
                return
            await asyncio.wait({task}, timeout=_HEARTBEAT_INTERVAL_S)
            if not task.done():
                yield _format_sse("progress", await _heartbeat_payload(scope.service))
        answer = await task
    except LLMBackendError as exc:
        # `exc.kind`/`status_code` are logged for diagnostics; `str(exc)` (which
        # may include a raw provider response body snippet -- see
        # `llm_client.py`) is deliberately NEVER put on the wire.
        logger.warning(
            "ai.ask.llm_backend_error",
            service=scope.service,
            kind=exc.kind,
            status_code=exc.status_code,
        )
        backend, model = await _current_llm_backend_model()
        yield _format_sse(
            "error",
            _serialize_error_event(
                exc.kind,
                _LLM_ERROR_MESSAGES.get(exc.kind, _LLM_ERROR_FALLBACK_MESSAGE),
                retry_after_s=exc.retry_after_s,
                backend=backend,
                model=model,
            ),
        )
        return
    except KnowledgeMisconfigured:
        logger.warning("ai.ask.misconfigured", service=scope.service)
        backend, model = await _current_llm_backend_model()
        yield _format_sse(
            "error",
            _serialize_error_event(
                "misconfigured",
                _MISCONFIGURED_MESSAGE,
                retry_after_s=None,
                backend=backend,
                model=model,
            ),
        )
        return
    except KnowledgeDisabled:
        logger.info("ai.ask.kb_disabled", service=scope.service)
        backend, model = await _current_llm_backend_model()
        yield _format_sse(
            "error",
            _serialize_error_event(
                "kb_disabled",
                _KB_DISABLED_MESSAGE,
                retry_after_s=None,
                backend=backend,
                model=model,
            ),
        )
        return
    except Exception:  # noqa: BLE001 - last-resort guard: an SSE client must never see a raw 500 mid-stream
        logger.error("ai.ask.failed", service=scope.service, exc_info=True)
        backend, model = await _current_llm_backend_model()
        yield _format_sse(
            "error",
            _serialize_error_event(
                "unknown",
                _GENERIC_ERROR_MESSAGE,
                retry_after_s=None,
                backend=backend,
                model=model,
            ),
        )
        return

    yield _format_sse("answer", _serialize_answer(answer))


# ----------------------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------------------


@router.post("/ask")
async def ask(http_request: Request, body: AskRequest) -> StreamingResponse:
    try:
        validate_service(body.service)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        tz: tzinfo = ZoneInfo(body.tz)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"invalid tz: {body.tz}") from exc

    scope = Scope(
        service=body.service,
        group_ids=body.group_ids or [],
        member_id=body.member_id,
    )
    logger.info("ai.ask.start", service=body.service, tz=body.tz)
    return StreamingResponse(
        _ask_event_stream(http_request, body.question, scope, tz),
        media_type="text/event-stream",
    )


async def _get_knowledge_service_or_409() -> KnowledgeService:
    """`get_knowledge_service()`, translating `KnowledgeMisconfigured` (e.g. no
    embedding model installed yet) into a typed 409 instead of a raw 500 --
    the non-SSE counterpart of `_ask_event_stream`'s `code: "misconfigured"`."""
    try:
        return await get_knowledge_service()
    except KnowledgeMisconfigured as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "misconfigured", "message": _MISCONFIGURED_MESSAGE},
        ) from exc


@router.get("/index/status")
async def index_status(service: str | None = Query(None)) -> dict:
    if service is not None:
        try:
            validate_service(service)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    svc = await _get_knowledge_service_or_409()
    status = svc.status(service)
    # `status()` stays sync (see its docstring) and can't `await load_config()`
    # itself, so the settings-owned `last_built` timestamp (Task 3 item 2) is
    # enriched here at the async endpoint layer instead -- `KnowledgeBaseStatus`
    # renders it as "Last indexed: …".
    config = await load_config()
    status["last_built"] = (config.get("knowledge_base") or {}).get("last_built")
    return status


@router.post("/index/rebuild")
async def index_rebuild(request: RebuildRequest) -> dict:
    try:
        validate_service(request.service)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not await kb_enabled():
        raise HTTPException(
            status_code=409,
            detail={"code": "kb_disabled", "message": _KB_DISABLED_MESSAGE},
        )

    svc = await _get_knowledge_service_or_409()
    if svc.index_progress().get("phase") != "idle":
        # An index/rebuild is already in flight (process-wide -- see
        # `KnowledgeService.status`'s docstring on why `_index_progress` isn't
        # per-service). Reject instead of stacking another background task
        # behind `_store_lock`: repeated clicks used to each queue a FULL extra
        # rebuild, compounding a multi-minute lock hold (see
        # `pwave-confirmed-bugs.md`).
        raise HTTPException(status_code=409, detail={"alreadyRunning": True})
    track_background_task(_run_rebuild(svc, request.service), name="index_rebuild")
    return {"ok": True}


async def _run_rebuild(svc, service: str) -> None:
    """Background rebuild task: logged, errors swallowed (nothing awaits this task).

    Retained (not bare `asyncio.create_task`) via `track_background_task` --
    without a strong reference the event loop's weak task ref can GC this
    mid-run, silently killing a multi-minute first index; see that helper's
    module docstring.
    """
    try:
        changed = await svc.rebuild(service)
        logger.info("ai.index_rebuild.done", service=service, changed=changed)
    except Exception:
        logger.error("ai.index_rebuild.failed", service=service, exc_info=True)


@router.get("/hardware-suggestion")
async def hardware_suggestion() -> dict:
    hardware = await asyncio.to_thread(detect_hardware)
    suggestion = suggest_llm_backend(hardware)
    return {"hardware": hardware, "suggestion": suggestion}


@router.get("/config")
async def get_ai_config() -> dict:
    config = await load_config()
    kb_config = config.get("knowledge_base") or {}
    return dict(kb_config.get("llm") or {})


@router.put("/config")
async def put_ai_config(request: LLMConfigRequest) -> dict:
    if request.backend not in _VALID_LLM_BACKENDS:
        raise HTTPException(
            status_code=400,
            detail=f"invalid backend: {request.backend!r} (expected 'cloud' or 'local')",
        )
    if not request.base_url.strip():
        raise HTTPException(status_code=400, detail="base_url must not be empty")
    if not request.model.strip():
        raise HTTPException(status_code=400, detail="model must not be empty")

    def _update(config: dict) -> None:
        # Copy rather than mutate `config["knowledge_base"]` in place: when the
        # key is absent on disk, `load_config()`'s shallow default-merge leaves
        # it pointing at the shared `_SETTINGS_DEFAULTS["knowledge_base"]` dict
        # object, and mutating that in place would corrupt the process-wide
        # defaults for every other settings read for the rest of the process.
        kb_config = dict(config.get("knowledge_base") or {})
        kb_config["llm"] = {
            "backend": request.backend,
            "base_url": request.base_url,
            "model": request.model,
        }
        config["knowledge_base"] = kb_config

    await update_config(_update)
    await invalidate_llm_client()
    logger.info("ai.config.updated", backend=request.backend)
    return {"ok": True}


@router.get("/enabled")
async def get_kb_enabled() -> dict:
    return {"enabled": await kb_enabled()}


@router.put("/enabled")
async def put_kb_enabled(request: KbEnabledRequest) -> dict:
    """Toggle `settings.knowledge_base.enabled` -- the KB settings section's
    top-level Enable switch (`KbBackendSelector.tsx`). Separate from
    `PUT /config` (which only ever covered the `llm` block, and stays that way
    so a user can configure backend/model BEFORE turning the KB on) since
    "enabled" is a distinct concept with its own side effect: flipping
    false->true schedules a background initial build (`rebuild()`, via
    `schedule_initial_build_all`) for every already-synced service, so a corpus
    that accumulated while the KB was off converges automatically instead of
    silently staying empty until someone finds the Rebuild button.
    """
    previously_enabled = await kb_enabled()

    def _update(config: dict) -> None:
        # Copy rather than mutate in place -- see `put_ai_config`'s comment.
        kb_config = dict(config.get("knowledge_base") or {})
        kb_config["enabled"] = request.enabled
        config["knowledge_base"] = kb_config

    await update_config(_update)
    logger.info("ai.enabled.updated", enabled=request.enabled)
    if request.enabled and not previously_enabled:
        await schedule_initial_build_all()
    return {"ok": True, "enabled": request.enabled}
