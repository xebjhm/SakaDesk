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
"""

from __future__ import annotations

import asyncio
import json
from datetime import tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import structlog
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.services.hardware import detect_hardware, suggest_llm_backend
from backend.services.knowledge_service import (
    KnowledgeMisconfigured,
    get_knowledge_service,
    invalidate_llm_client,
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

# User-safe error messages -- never include raw exception text (which may echo
# provider response bodies or other details we don't want on the wire twice).
_LLM_ERROR_MESSAGE = (
    "The configured AI backend is unavailable. Check the AI settings and try again."
)
_MISCONFIGURED_MESSAGE = (
    "The knowledge chatbot isn't configured yet. Check the AI settings."
)
_GENERIC_ERROR_MESSAGE = "The request failed unexpectedly."


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


class RebuildRequest(BaseModel):
    service: str


class LLMConfigRequest(BaseModel):
    backend: str
    base_url: str
    model: str


# ----------------------------------------------------------------------------
# SSE helpers
# ----------------------------------------------------------------------------


def _format_sse(event: str, data: dict) -> str:
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


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
    return {
        "doc_id": citation.doc_id,
        "ref": _serialize_ref(citation.source_ref),
        "snippet": citation.quoted_snippet,
        "member": citation.member,
        "timestamp": citation.timestamp.isoformat(),
    }


def _serialize_answer(answer: Answer) -> dict:
    if answer.no_evidence:
        return {"no_evidence": True}
    return {
        "sentences": [
            {"text": sentence.text, "citation_ids": sentence.citation_ids}
            for sentence in answer.sentences
        ],
        "citations": [_serialize_citation(c) for c in answer.citations],
        "no_evidence": False,
    }


async def _run_ask(
    question: str, scope: Scope, tz: tzinfo, history: list[dict] | None
) -> Answer:
    """Look up the service and run `ask()` -- both inside the same task, so
    `get_knowledge_service()` failures (e.g. `KnowledgeMisconfigured`) surface
    through the same in-band `event: error` path as an LLM/provider failure."""
    svc = await get_knowledge_service()
    return await svc.ask(question, scope, tz, history)


async def _ask_event_stream(question: str, scope: Scope, tz: tzinfo):
    # Immediate "thinking" feedback -- guarantees the client sees at least one
    # progress event even if `ask()` resolves faster than the heartbeat interval.
    yield _format_sse("progress", {"stage": "thinking"})

    task: asyncio.Task[Answer] = asyncio.create_task(
        _run_ask(question, scope, tz, None)
    )
    try:
        while not task.done():
            await asyncio.wait({task}, timeout=_HEARTBEAT_INTERVAL_S)
            if not task.done():
                yield _format_sse("progress", {"stage": "thinking"})
        answer = await task
    except LLMBackendError:
        logger.warning("ai.ask.llm_backend_error", service=scope.service)
        yield _format_sse("error", {"message": _LLM_ERROR_MESSAGE})
        return
    except KnowledgeMisconfigured:
        logger.warning("ai.ask.misconfigured", service=scope.service)
        yield _format_sse("error", {"message": _MISCONFIGURED_MESSAGE})
        return
    except Exception:  # noqa: BLE001 - last-resort guard: an SSE client must never see a raw 500 mid-stream
        logger.error("ai.ask.failed", service=scope.service, exc_info=True)
        yield _format_sse("error", {"message": _GENERIC_ERROR_MESSAGE})
        return

    yield _format_sse("answer", _serialize_answer(answer))


# ----------------------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------------------


@router.post("/ask")
async def ask(request: AskRequest) -> StreamingResponse:
    try:
        validate_service(request.service)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        tz: tzinfo = ZoneInfo(request.tz)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise HTTPException(
            status_code=422, detail=f"invalid tz: {request.tz}"
        ) from exc

    scope = Scope(
        service=request.service,
        group_ids=request.group_ids or [],
        member_id=request.member_id,
    )
    logger.info("ai.ask.start", service=request.service, tz=request.tz)
    return StreamingResponse(
        _ask_event_stream(request.question, scope, tz),
        media_type="text/event-stream",
    )


@router.get("/index/status")
async def index_status(service: str | None = Query(None)) -> dict:
    if service is not None:
        try:
            validate_service(service)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    svc = await get_knowledge_service()
    return svc.status(service)


@router.post("/index/rebuild")
async def index_rebuild(request: RebuildRequest) -> dict:
    try:
        validate_service(request.service)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    svc = await get_knowledge_service()
    asyncio.create_task(_run_rebuild(svc, request.service))
    return {"ok": True}


async def _run_rebuild(svc, service: str) -> None:
    """Background rebuild task: logged, errors swallowed (nothing awaits this task)."""
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
