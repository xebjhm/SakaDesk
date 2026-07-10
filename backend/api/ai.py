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
cycle; once the client is gone, the generator SETS `cancel_event` (see below),
then stops emitting entirely (no more heartbeats, no terminal event) -- but
still deliberately does NOT `task.cancel()` the in-flight ask. `KnowledgeService
.ask()` holds `_store_lock` for the duration of a worker thread (`asyncio
.to_thread`) that the event loop cannot preempt -- cancelling the awaiting
coroutine would only unwind the `async with self._store_lock:` block and free
the lock *while the orphaned worker thread kept running*, letting a concurrent
index/ask race that orphaned thread over the shared sqlite/vector store. So the
task is instead detached into the module-level `_pending_ask_tasks` set (via
`add_done_callback`) and left to finish naturally -- which also guarantees its
exception (if any) is always retrieved even though nothing `await`s it directly
anymore.

**Cooperative cancel, not hard cancel (final review, Finding 1 -- the dropped
P6 brief item).** `_ask_event_stream` creates one `threading.Event`
(`cancel_event`) per ask and threads it through `_run_ask` ->
`KnowledgeService.ask()` -> `KnowledgeAgent.ask()`'s `should_abort` (see
`pysaka.knowledge.agent.AskCancelled`), which the agent polls BETWEEN steps --
before each LLM call, after each tool-call batch. `cancel_event` is SET right
before this generator detaches, either on disconnect (above) or on deadline
expiry (below) -- Stop is covered by disconnect, since the frontend's abort
closes the SSE connection the same way a network drop would. This does not
replace the "detach, don't cancel" design above (the worker thread still can't
be preempted mid-step -- an in-flight LLM HTTP call still runs to its own
timeout), but it shrinks `_store_lock`'s worst case from "the rest of
`max_steps` sequential LLM calls" down to "however long the current step takes
to finish" -- a queued retry no longer has to queue behind an abandoned ask for
the full bounded-loop duration. A worker that raises `AskCancelled` after this
generator has already detached is logged at INFO by `_on_ask_task_done` (not
ERROR): it's an intentional, requested stop, not a backend failure.

**The worker is still not TIGHTLY bounded.** Even with cooperative cancel, a
single in-flight LLM call's own ~120s `OpenAICompatLLMClient` httpx timeout is
NOT interrupted mid-call (`should_abort` is only checked between steps, never
during one) -- so the worst case for one step is that timeout, not instant.
Across a whole ask, `KnowledgeAgent` still runs up to `max_steps` (6)
sequential LLM calls in the ABSENCE of a cancel signal, each with that same
~120s budget, plus embedding/tool-call time in between -- see
`pwave-confirmed-bugs.md`'s original "no cancel" finding for the worst case
this replaces. What IS (and always was) bounded is the STREAM the client sees:
`_ask_event_stream` separately enforces an overall wall-clock `ask_deadline_s`
(settings `knowledge_base.ask_deadline_s`, default 300s -- see
`_ask_deadline_seconds`) that's independent of any single LLM call's timeout.
Once that deadline passes, the generator emits a typed `event: error {code:
"timeout"}` and detaches -- the SAME "let it finish, don't cancel" reasoning as
an actual disconnect (above) -- so the user is never left waiting past the
deadline, and (with the cooperative-cancel seam above) the orphaned worker
itself now also unwinds within roughly one step instead of running unbounded
underneath.

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
turning it on. `/index/rebuild` also 409s `{code: "already_running",
alreadyRunning: true}` when `KnowledgeService.is_indexing(service)` is true --
the per-service in-flight registry (Finding 1, KB review), NOT the
display-only `_index_progress` this used to read -- instead of stacking
another background rebuild behind `_store_lock` on a repeated click.

**Rebuild pre-check lazy pickup (P-4 review, Finding 1, CRITICAL).**
`/index/rebuild` calls `svc.ensure_ready()` BEFORE reading `svc.status(...)
.get("configured")`: without it, an in-app model download completing AFTER
the process-wide `KnowledgeService` singleton was built left this endpoint
409ing `{code: "not_configured"}` forever, even once `GET /readiness`
already reported the model installed and a direct `svc.rebuild()` call would
have succeeded. See `KnowledgeService.ensure_ready`'s docstring.
"""

from __future__ import annotations

import asyncio
import json
import re
import threading
import time
from datetime import datetime, timezone, tzinfo
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import structlog
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from backend.services import llm_usage, ollama
from backend.services.background_tasks import track_background_task
from backend.services.hardware import detect_hardware, suggest_llm_backend
from backend.services.knowledge_service import (
    EmbeddingModelMissing,
    KnowledgeDisabled,
    KnowledgeMisconfigured,
    KnowledgeService,
    RuntimeMissing,
    compute_readiness,
    embedding_model_dir,
    get_knowledge_service,
    invalidate_llm_client,
    kb_enabled,
    resolve_embedding_model_name,
    schedule_initial_build_all,
)
from backend.services.llm_client import (
    LLMBackendError,
    build_llm_client_from_draft,
)
from backend.services.llm_models import curated_for_backend, lookup_model
from backend.services.model_assets import get_manifest, get_model_download_manager
from backend.services.onnx_runtime_provision import get_runtime_provisioner
from backend.services.service_utils import validate_service
from backend.services.settings_store import load_config, update_config
from pysaka.knowledge import Answer, AskCancelled, Citation, Scope, SourceRef

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
_EMBEDDING_MODEL_MISSING_MESSAGE = (
    "The embedding model isn't installed yet. Download it in AI settings to "
    "enable the knowledge chatbot."
)
# On-demand ONNX runtime provisioning: the runtime itself (distinct from the
# embedding MODEL above) is downloaded on first use on a packaged Windows
# build (Task 7 excludes it from the installer). `RuntimeMissing` already
# triggered that download as a tracked background task by the time this
# message is shown -- see `KnowledgeService._ensure_embedder`'s runtime gate.
_RUNTIME_MISSING_MESSAGE = (
    "Setting up the AI engine for the first time -- this can take a minute. "
    "Try again shortly."
)
_NOT_CONFIGURED_MESSAGE = (
    "The knowledge chatbot needs the embedding model installed before it can "
    "build an index. Download it in AI settings."
)
# P-4 review, Finding 1: the `alreadyRunning` 409 used to carry no `code`/
# `message` at all (just `{"alreadyRunning": true}`), so a caller keying off
# `code` (the same pattern every other typed error here uses) had nothing to
# show. `alreadyRunning` is kept alongside `code` for any existing consumer
# still reading that boolean directly (`KnowledgeBaseStatus.tsx`).
_ALREADY_RUNNING_MESSAGE = (
    "An index rebuild is already running for this service. It'll finish "
    "shortly -- no need to try again."
)
# Product-wave Task 5, item 5: the one-time cloud-privacy consent gate.
_CLOUD_CONSENT_REQUIRED_MESSAGE = (
    "This question would be sent to a cloud AI provider. Review and accept "
    "the privacy notice in AI settings first, or switch to a local model."
)
# Product-wave Task 5, item 1: `PUT /config` rejecting a blocked model.
_MODEL_BLOCKED_MESSAGE = (
    "This model is blocked for the knowledge chatbot -- it's known not to "
    "work with this app's tool-calling integration. Pick another model in "
    "AI settings."
)
# Product-wave Task 6, item 2: the overall ask-deadline SSE timeout. Reuses
# the SAME `code: "timeout"` the frontend already renders for a single LLM
# call's httpx timeout (`ai.error.timeout` -- no new i18n key needed) since
# both boil down to the same user-facing fact: the chatbot took too long.
_ASK_DEADLINE_MESSAGE = (
    "The knowledge chatbot took too long to answer within the time limit. "
    "Please try again."
)

# `member_id` must be a pysaka `CanonicalId`: f"{service}:{blog_id}" (D8), e.g.
# "hinatazaka46:12" -- what `doc.author_id`/`Scope.member_id` are always
# compared against (see `pysaka.knowledge.store._matches`). Rejects the shape
# a plain numeric blog id would take if sent as a bare string ("12") or as a
# JSON number coerced to string by an old/buggy client -- those would parse as
# valid `str`s but never equal any `author_id`, silently scoping every ask to
# zero documents instead of erroring.
_CANONICAL_MEMBER_ID_RE = re.compile(r"^\S+:\d+$")

# Product-wave Task 6, item 3: `AskRequest.history`'s server-side cap. The
# frontend derives at most ~6 exchanges (12 messages: user text verbatim +
# the previous assistant answer's sentences joined -- see `AiFeature.tsx`'s
# `deriveHistory`) so a well-behaved client never hits this; it exists as a
# belt-and-braces guard against a buggy/future client sending an unbounded
# history and blowing up the per-ask LLM prompt size. Chosen design: REJECT
# (422) rather than silently truncate -- an oversized request is a client
# bug worth surfacing, not a user-visible request to silently reinterpret.
_MAX_HISTORY_MESSAGES = 12

# Final review, minors: a generous per-message character cap on `question`
# and every `history[].content` -- belt-and-braces against a buggy/future
# client (or a pasted wall of text) blowing up the per-ask LLM prompt size
# the same way `_MAX_HISTORY_MESSAGES` guards message COUNT. 4000 chars is
# well beyond any real question or a rendered answer's joined sentences, so
# no well-behaved client should ever hit this; pydantic's built-in
# `max_length` rejects an over-long value with a typed 422, same "reject,
# don't silently truncate" choice as `_MAX_HISTORY_MESSAGES`.
_MAX_MESSAGE_LENGTH = 4000


# ----------------------------------------------------------------------------
# Request/response models
# ----------------------------------------------------------------------------


class HistoryMessage(BaseModel):
    """One prior chat turn, in the shape `pysaka.knowledge.KnowledgeAgent.ask`/
    `.answer` already expect for their `history: list[dict] | None` param
    (spliced verbatim between the system prompt and the new user question --
    see `agent.py`'s `ask()`): `{"role": "user" | "assistant", "content": str}`.
    No `tool`/`system` turns -- those are internal to one agent loop's own
    scratch messages, never part of the cross-ask conversation history the
    frontend reconstructs from the rendered thread."""

    role: Literal["user", "assistant"]
    content: str = Field(max_length=_MAX_MESSAGE_LENGTH)


class AskRequest(BaseModel):
    question: str = Field(max_length=_MAX_MESSAGE_LENGTH)
    service: str
    group_ids: list[int] | None = None
    member_id: str | None = None  # pysaka CanonicalId, e.g. "hinatazaka46:12"
    tz: str
    # Accepted for forward-compatibility with a future conversation store; not
    # yet resolved into `history` here (no conversation-store seam exists yet).
    conversation_id: str | None = None
    # Product-wave Task 6, item 3: prior turns for a multi-turn follow-up
    # ("she said what else?"), derived client-side from the rendered thread
    # (`AiFeature.tsx`'s `deriveHistory`: last ~6 exchanges, user text
    # verbatim, assistant = the answer sentences joined, no citations/refs).
    # `None`/omitted means "no history" (first question in a thread, or a
    # thread that was just cleared) -- forwarded to `KnowledgeService.ask`
    # unchanged, which was already threading it into `KnowledgeAgent`; only
    # this endpoint used to hardcode `None` regardless of what the client sent.
    history: list[HistoryMessage] | None = None

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

    @field_validator("history")
    @classmethod
    def _history_must_not_exceed_cap(
        cls, value: list[HistoryMessage] | None
    ) -> list[HistoryMessage] | None:
        """Reject (422) rather than silently truncate an oversized `history`
        -- see `_MAX_HISTORY_MESSAGES`'s docstring for why."""
        if value is not None and len(value) > _MAX_HISTORY_MESSAGES:
            raise ValueError(
                f"history must contain at most {_MAX_HISTORY_MESSAGES} messages "
                f"(got {len(value)})"
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


class CloudConsentRequired(RuntimeError):
    """Raised by `_run_ask` when the configured `knowledge_base.llm.backend`
    is `"cloud"` and the user hasn't yet granted the one-time cloud-privacy
    consent (`settings.knowledge_base.cloud_consent`, Product-wave Task 5,
    item 5 -- see `POST /api/ai/consent`). The Local backend never raises
    this: nothing leaves the device, so there's nothing to consent to.
    """


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


# Fallback when `knowledge_base.ask_deadline_s` is absent/invalid (e.g. an old
# settings.json written before this key existed) -- mirrors
# `_SETTINGS_DEFAULTS`'s own default (settings_store.py) so a fresh install
# and a pre-existing one behave the same.
_DEFAULT_ASK_DEADLINE_S = 300.0


async def _ask_deadline_seconds() -> float:
    """The configured `knowledge_base.ask_deadline_s` (Product-wave Task 6,
    item 2) -- the overall wall-clock budget `_ask_event_stream` gives ONE
    ask's SSE stream before detaching with a typed `timeout` error. See the
    module docstring's "worker is NOT tightly bounded" section for why this
    is deliberately NOT the same thing as bounding the background worker.
    """
    config = await load_config()
    kb_config = config.get("knowledge_base") or {}
    value = kb_config.get("ask_deadline_s")
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
        return float(value)
    return _DEFAULT_ASK_DEADLINE_S


def _serialize_error_event(
    code: str,
    message: str,
    *,
    retry_after_s: float | None,
    backend: str | None,
    model: str | None,
    extra: dict | None = None,
) -> dict:
    """`{code, message, retryAfterS?, backend, model, ...extra}` -- the SSE
    `event: error` contract.

    `code` is what the frontend keys off (`ai.error.<code>` i18n lookup);
    `message` is a safe English fallback for old, not-yet-updated clients.
    `retryAfterS` is omitted entirely (not sent as `null`) when unknown.
    `extra` (Product-wave Task 5, item 3) merges in additional fields --
    currently just the usage-meter numbers a `quota_exhausted` error is
    enriched with (`requestsToday`/`dailyLimit`/`estQuestionsLeft`), so the
    ErrorTurn can show them alongside the quota-exceeded copy without a
    second round-trip to `GET /api/ai/usage`.
    """
    data: dict = {"code": code, "message": message, "backend": backend, "model": model}
    if retry_after_s is not None:
        data["retryAfterS"] = retry_after_s
    if extra:
        data.update(extra)
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


async def _cloud_consent_required() -> bool:
    """Whether the CURRENTLY configured backend is `"cloud"` and the user
    hasn't granted `knowledge_base.cloud_consent` yet (Product-wave Task 5,
    item 5). A cheap settings-only read -- checked before
    `get_knowledge_service()` so a not-yet-consented cloud ask never builds
    the embedder/store/LLM client either (same "cheap gate first" pattern as
    `kb_enabled()`)."""
    config = await load_config()
    kb_config = config.get("knowledge_base") or {}
    llm_config = kb_config.get("llm") or {}
    backend = llm_config.get("backend") or "cloud"
    if backend != "cloud":
        return False
    return not bool(kb_config.get("cloud_consent", False))


async def _run_ask(
    question: str,
    scope: Scope,
    tz: tzinfo,
    history: list[dict] | None,
    cancel_event: threading.Event | None = None,
) -> Answer:
    """Check `kb_enabled()` and cloud consent, look up the service, and run
    `ask()` -- all inside the same task, so every failure mode (disabled,
    consent required, `KnowledgeMisconfigured`, an LLM/provider failure)
    surfaces through the same in-band `event: error` path.

    Both gates run BEFORE `get_knowledge_service()` so a disabled/not-yet-
    consented KB never builds the embedder/store/LLM client just to answer a
    question no one is allowed to ask yet (mirrors the index hooks' guard).

    `cancel_event` (final review, Finding 1) is threaded straight through to
    `KnowledgeService.ask()` -- see that method and `_ask_event_stream` (which
    creates and sets it) for the cooperative-cancel seam this implements.
    """
    if not await kb_enabled():
        raise KnowledgeDisabled()
    if await _cloud_consent_required():
        raise CloudConsentRequired()
    svc = await get_knowledge_service()
    return await svc.ask(question, scope, tz, history, cancel_event=cancel_event)


async def _heartbeat_payload(service: str) -> dict:
    """The `event: progress` payload for one heartbeat tick.

    `{"stage": "indexing", "done": ..., "total": ...}` when `service`'s index is
    actively embedding right now (Lock fairness): an ask queued behind an
    in-flight index batch only ever waits SECONDS between batches (see
    `KnowledgeService._persist_batched`), but without this it would show a
    generic "thinking" spinner that looks identical to a slow LLM call for
    however long that wait lasts. `index_progress(service)` is already scoped
    to `service` (Finding 1, KB review: per-service, not process-wide), so
    there's no need to separately compare a `"service"` field here anymore.
    Falls back to `{"stage": "thinking"}` -- including when the knowledge
    service isn't buildable at all (disabled/misconfigured); `_run_ask`
    surfaces THAT failure through the normal error path already, so this is
    purely best-effort progress labeling.
    """
    try:
        svc = await get_knowledge_service()
        progress = svc.index_progress(service)
        if progress.get("phase") != "idle":
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
    if exc is None:
        return
    if isinstance(exc, AskCancelled):
        # Final review, Finding 1: the ONLY way this task ever raises
        # `AskCancelled` is `_ask_event_stream` setting `cancel_event` itself
        # (on disconnect or its own deadline) -- always immediately before
        # THAT generator already returned/yielded its own terminal event. By
        # the time this callback runs, the stream is already done with this
        # ask, so there is nothing left to emit; log at INFO (an intentional,
        # requested stop), not the ERROR level a genuine backend failure gets.
        logger.info("ai.ask.background_task_cancelled")
        return
    logger.error("ai.ask.background_task_failed", exc_info=exc)


async def _ask_event_stream(
    request: Request,
    question: str,
    scope: Scope,
    tz: tzinfo,
    history: list[dict] | None = None,
):
    # Immediate "thinking" feedback -- guarantees the client sees at least one
    # progress event even if `ask()` resolves faster than the heartbeat interval.
    yield _format_sse("progress", {"stage": "thinking"})

    # Product-wave Task 6, item 2: the overall wall-clock budget for the
    # STREAM (not the worker -- see `_ask_deadline_seconds`'s docstring). Read
    # BEFORE creating the task, and awaited to completion here -- both so a
    # mid-ask settings change can't retroactively shorten/lengthen an ask
    # already in flight, and so this `load_config()` call never genuinely
    # races the task's OWN settings reads (`_run_ask`'s `_cloud_consent_
    # required`) for `settings_store`'s shared lock within the same request.
    ask_deadline_s = await _ask_deadline_seconds()
    deadline_at = time.monotonic() + ask_deadline_s

    # Final review, Finding 1 (the dropped P6 brief item): the cooperative-
    # cancel seam. Threaded through `_run_ask` -> `KnowledgeService.ask()` ->
    # `KnowledgeAgent.ask()`'s `should_abort` (see `pysaka.knowledge.agent
    # .AskCancelled`), which polls it BETWEEN steps -- before each LLM call,
    # after each tool-call batch -- and raises to unwind. SET below on
    # disconnect and on deadline expiry (Stop is covered by disconnect: the
    # frontend's abort closes the SSE connection, which `is_disconnected()`
    # observes the same way), always immediately before this generator itself
    # detaches. This does NOT replace the "detach, don't cancel" design below
    # -- the worker thread still can't be preempted mid-step, so an in-flight
    # LLM HTTP call still runs to its own timeout -- but it shrinks
    # `_store_lock`'s worst-case hold time from "the rest of `max_steps`
    # sequential LLM calls" (up to several minutes) down to "however long the
    # CURRENT step takes to finish" -- one LLM call or tool batch, typically
    # seconds.
    cancel_event = threading.Event()

    task: asyncio.Task[Answer] = asyncio.create_task(
        _run_ask(question, scope, tz, history, cancel_event)
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
                # `_pending_ask_tasks`, above) -- but we DO set `cancel_event`
                # first, so the agent loop stops cooperatively at its next
                # between-steps check instead of running the FULL bounded loop
                # to completion; see this function's `cancel_event` comment,
                # above, for how much that shrinks the worst case.
                cancel_event.set()
                logger.info("ai.ask.client_disconnected", service=scope.service)
                return
            if time.monotonic() >= deadline_at:
                # Same detach-don't-cancel reasoning as a disconnect, just
                # triggered by our OWN wall-clock budget instead of the
                # client going away -- the difference is the client is still
                # here, so it gets a typed error instead of silence. Also
                # sets `cancel_event` for the same reason as the disconnect
                # branch above.
                cancel_event.set()
                logger.info(
                    "ai.ask.deadline_exceeded",
                    service=scope.service,
                    deadline_s=ask_deadline_s,
                )
                backend, model = await _current_llm_backend_model()
                yield _format_sse(
                    "error",
                    _serialize_error_event(
                        "timeout",
                        _ASK_DEADLINE_MESSAGE,
                        retry_after_s=None,
                        backend=backend,
                        model=model,
                    ),
                )
                return
            await asyncio.wait(
                {task},
                timeout=min(
                    _HEARTBEAT_INTERVAL_S, max(deadline_at - time.monotonic(), 0)
                ),
            )
            if not task.done():
                yield _format_sse("progress", await _heartbeat_payload(scope.service))
        answer = await task
    except AskCancelled:
        # Defensive guard against the double-path (see `cancel_event`'s
        # comment above and `_on_ask_task_done`): in the current design,
        # `cancel_event` is only ever set immediately before THIS generator
        # itself returns/yields-then-returns (the two branches above), so in
        # practice `await task` above is never reached once it's set --
        # `_on_ask_task_done` is what actually observes an `AskCancelled`
        # from an already-detached task. This branch exists so that can never
        # change out from under this function and leak a raw exception onto
        # the SSE stream; no error event is emitted (the ask was cancelled by
        # OUR OWN request, not a failure the client needs telling about).
        logger.info("ai.ask.cancelled", service=scope.service)
        return
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
        extra = None
        if exc.kind == "quota_exhausted" and model is not None:
            # Enrich with the usage-meter numbers (Product-wave Task 5, item
            # 3) so the ErrorTurn can show "~N left today" copy without a
            # second `GET /api/ai/usage` round-trip. Best-effort: a usage-DB
            # read failure must never turn an already-classified quota error
            # into a 500 -- `llm_usage.usage_snapshot` itself never raises
            # (see that module's docstring), but the `model is not None`
            # guard above is the belt for the (rare) case settings couldn't
            # even be read.
            config = await load_config()
            override = ((config.get("knowledge_base") or {}).get("llm") or {}).get(
                "daily_limit"
            )
            snapshot = await asyncio.to_thread(
                llm_usage.usage_snapshot, model, backend or "cloud", override
            )
            extra = {
                "requestsToday": snapshot["requestsToday"],
                "dailyLimit": snapshot["dailyLimit"],
                "estQuestionsLeft": snapshot["estQuestionsLeft"],
            }
        yield _format_sse(
            "error",
            _serialize_error_event(
                exc.kind,
                _LLM_ERROR_MESSAGES.get(exc.kind, _LLM_ERROR_FALLBACK_MESSAGE),
                retry_after_s=exc.retry_after_s,
                backend=backend,
                model=model,
                extra=extra,
            ),
        )
        return
    except EmbeddingModelMissing:
        # Caught BEFORE the generic `KnowledgeMisconfigured` (it's a subclass
        # of it, see that class's docstring): a distinct, actionable SSE code
        # so the UI can point straight at the in-app model download instead
        # of a vague "check AI settings".
        logger.info("ai.ask.embedding_model_missing", service=scope.service)
        backend, model = await _current_llm_backend_model()
        yield _format_sse(
            "error",
            _serialize_error_event(
                "embedding_model_missing",
                _EMBEDDING_MODEL_MISSING_MESSAGE,
                retry_after_s=None,
                backend=backend,
                model=model,
            ),
        )
        return
    except RuntimeMissing:
        # Same sibling-of-`KnowledgeMisconfigured` treatment as
        # `EmbeddingModelMissing` just above (both must be caught BEFORE the
        # generic `KnowledgeMisconfigured` case below, or they'd be swallowed
        # by it): a distinct SSE code for "the ONNX runtime itself hasn't
        # been downloaded yet" (Task 6, on-demand runtime provisioning) --
        # provisioning was already triggered as a background task by
        # `_ensure_embedder()` by the time this is raised, so the UI can show
        # "setting up..." and the user just retries shortly.
        logger.info("ai.ask.runtime_missing", service=scope.service)
        backend, model = await _current_llm_backend_model()
        yield _format_sse(
            "error",
            _serialize_error_event(
                "runtime_missing",
                _RUNTIME_MISSING_MESSAGE,
                retry_after_s=None,
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
    except CloudConsentRequired:
        logger.info("ai.ask.cloud_consent_required", service=scope.service)
        backend, model = await _current_llm_backend_model()
        yield _format_sse(
            "error",
            _serialize_error_event(
                "cloud_consent_required",
                _CLOUD_CONSENT_REQUIRED_MESSAGE,
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
    history = (
        [{"role": m.role, "content": m.content} for m in body.history]
        if body.history
        else None
    )
    logger.info(
        "ai.ask.start", service=body.service, tz=body.tz, history_len=len(history or [])
    )
    return StreamingResponse(
        _ask_event_stream(http_request, body.question, scope, tz, history),
        media_type="text/event-stream",
    )


async def _get_knowledge_service_or_409() -> KnowledgeService:
    """`get_knowledge_service()`, translating `KnowledgeMisconfigured` into a
    typed 409 instead of a raw 500 -- the non-SSE counterpart of
    `_ask_event_stream`'s `code: "misconfigured"`.

    A missing embedding model no longer raises this (Product-wave Task 4:
    `get_knowledge_service()` always succeeds, building the service with
    `embedder=None` -- see `KnowledgeService.status()`'s `configured: false`
    shape for how callers detect that instead). This still fires for the
    genuinely unrecoverable case: `knowledge_index.db`'s schema version is
    newer than this SakaDesk build understands.
    """
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
    if not status.get("configured", True):
        # Never a 500 for a missing embedding model (item 1): `status()`
        # already reports `configured: false, reason: "embedding_model_missing"`
        # -- enrich with `model`/`expected_path` here (an async settings read
        # `status()` deliberately can't do itself, same reasoning as the
        # `last_built` enrichment below).
        model_name = await resolve_embedding_model_name()
        status["model"] = model_name
        status["expected_path"] = str(embedding_model_dir(model_name))
        return status
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
    # P-4 review, Finding 1 (CRITICAL): trigger the lazy embedder pickup
    # BEFORE reading `status()`'s `configured` flag. Without this, an in-app
    # model download that completes AFTER the process-wide `KnowledgeService`
    # singleton was built left `svc._embedder` stuck at `None` from THIS
    # endpoint's point of view forever -- nothing else on this request path
    # ever called `_ensure_embedder()` -- even though `GET /readiness`
    # already reported the model as installed (it probes the filesystem
    # directly, see `compute_readiness`) and a direct `svc.rebuild()` call
    # would have succeeded (`rebuild()` retries the embedder itself). See
    # `KnowledgeService.ensure_ready`'s docstring for the full story.
    await svc.ensure_ready()
    if not svc.status(request.service).get("configured", True):
        # No embedding model installed yet -- 409 instead of silently
        # scheduling a background task that would just skip quietly (item 1).
        raise HTTPException(
            status_code=409,
            detail={"code": "not_configured", "message": _NOT_CONFIGURED_MESSAGE},
        )
    if svc.is_indexing(request.service):
        # An index/rebuild is already in flight for THIS service -- the
        # per-service in-flight registry (Finding 1, KB review), the actual
        # source of truth (NOT the display-only `_index_progress`, which was
        # never really exclusive). Reject instead of stacking another
        # background task behind `_store_lock`: repeated clicks used to each
        # queue a FULL extra rebuild, compounding a multi-minute lock hold
        # (see `pwave-confirmed-bugs.md`).
        raise HTTPException(
            status_code=409,
            detail={
                "code": "already_running",
                "alreadyRunning": True,
                "message": _ALREADY_RUNNING_MESSAGE,
            },
        )
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


@router.get("/readiness")
async def readiness() -> dict:
    """First-run provisioning checks (Product-wave Task 4, item 2):
    `{embeddingModel, llm, index, enabled}`, each probed independently and
    WITHOUT building the full `KnowledgeService` (which would load a ~1GB
    ONNX model just to answer "is it configured?"). Drives the frontend's
    `SetupChecklist` (chat empty state + settings). Never 500s -- every
    individual probe inside `compute_readiness()` degrades to `ok: false`
    rather than raising.
    """
    return await compute_readiness()


@router.get("/config")
async def get_ai_config() -> dict:
    config = await load_config()
    kb_config = config.get("knowledge_base") or {}
    return dict(kb_config.get("llm") or {})


@router.put("/config")
async def put_ai_config(request: LLMConfigRequest) -> dict:
    """Persist `settings.knowledge_base.llm`. Product-wave Task 5, item 1:
    REJECTS a `blocked` model (400 `model_blocked`, i18n'd via the frontend's
    `ai.error.model_blocked` key) before persisting anything; a `degraded`
    or `unknown` model is accepted, but the response's `tier`/`noteKey`
    carry the registry's verdict so `KbBackendSelector` can show a warning
    (`backend.services.llm_models.lookup_model`).
    """
    if request.backend not in _VALID_LLM_BACKENDS:
        raise HTTPException(
            status_code=400,
            detail=f"invalid backend: {request.backend!r} (expected 'cloud' or 'local')",
        )
    if not request.base_url.strip():
        raise HTTPException(status_code=400, detail="base_url must not be empty")
    if not request.model.strip():
        raise HTTPException(status_code=400, detail="model must not be empty")

    lookup = lookup_model(request.backend, request.model)  # type: ignore[arg-type]
    if lookup.tier == "blocked":
        raise HTTPException(
            status_code=400,
            detail={
                "code": "model_blocked",
                "message": _MODEL_BLOCKED_MESSAGE,
                "noteKey": lookup.note_key,
            },
        )

    def _update(config: dict) -> None:
        # Copy rather than mutate `config["knowledge_base"]` in place: when the
        # key is absent on disk, `load_config()`'s shallow default-merge leaves
        # it pointing at the shared `_SETTINGS_DEFAULTS["knowledge_base"]` dict
        # object, and mutating that in place would corrupt the process-wide
        # defaults for every other settings read for the rest of the process.
        kb_config = dict(config.get("knowledge_base") or {})
        # Preserve `daily_limit` (Task 5, item 3): this form never edits it --
        # that's a distinct concept (`PUT /config` is LLM connection settings
        # only), so a PUT here must not silently clobber a previously-set
        # override.
        existing_llm = kb_config.get("llm") or {}
        kb_config["llm"] = {
            "backend": request.backend,
            "base_url": request.base_url,
            "model": request.model,
            "daily_limit": existing_llm.get("daily_limit"),
        }
        config["knowledge_base"] = kb_config

    await update_config(_update)
    await invalidate_llm_client()
    logger.info(
        "ai.config.updated",
        backend=request.backend,
        model=request.model,
        tier=lookup.tier,
    )
    return {"ok": True, "tier": lookup.tier, "noteKey": lookup.note_key}


@router.get("/models")
async def list_models(
    backend: str = Query(...), base_url: str | None = Query(None)
) -> dict:
    """`{backend, models: [{id, tier, noteKey, installed?}], ollamaReachable?}`
    -- the curated registry (Product-wave Task 5, item 1), merged with LIVE
    Ollama-probed models for the local backend (item 4) so the picker's
    select shows what's ACTUALLY installed, not just the curated list.

    `base_url` optionally overrides the probe target (e.g. a draft base URL
    the user hasn't saved yet); defaults to the configured
    `knowledge_base.llm.base_url` when omitted. Ignored for `backend=cloud`
    (nothing to probe -- cloud models aren't "installed").
    """
    if backend not in _VALID_LLM_BACKENDS:
        raise HTTPException(
            status_code=400,
            detail=f"invalid backend: {backend!r} (expected 'cloud' or 'local')",
        )
    curated = curated_for_backend(backend)  # type: ignore[arg-type]
    if backend == "cloud":
        return {
            "backend": backend,
            "models": [
                {"id": m.id, "tier": m.tier, "noteKey": m.note_key} for m in curated
            ],
        }

    if base_url is None:
        config = await load_config()
        llm_config = (config.get("knowledge_base") or {}).get("llm") or {}
        base_url = llm_config.get("base_url") or "http://localhost:11434/v1"

    probe_result = await ollama.probe(base_url)
    live_ids = set(probe_result["models"])
    curated_ids = {m.id for m in curated}

    models = [
        {
            "id": m.id,
            "tier": m.tier,
            "noteKey": m.note_key,
            "installed": m.id in live_ids,
        }
        for m in curated
    ]
    for live_id in probe_result["models"]:
        if live_id not in curated_ids:
            models.append(
                {"id": live_id, "tier": "unknown", "noteKey": None, "installed": True}
            )

    return {
        "backend": backend,
        "models": models,
        "ollamaReachable": probe_result["reachable"],
    }


@router.get("/local/probe")
async def local_probe(base_url: str = Query(...)) -> dict:
    """`{reachable, models}` for the local server at `base_url` (Product-wave
    Task 5, item 4) -- a thin passthrough to `backend.services.ollama.probe`,
    exposed as its own endpoint (rather than folded only into `/models`) so
    the frontend can probe reachability independently of the curated
    registry (e.g. to render the "Ollama not running" hint immediately on
    switching to Local, before deciding what to show in the model select).
    """
    result = await ollama.probe(base_url)
    return result


# `probe_tool` -- the single dummy tool `POST /config/test` forces the model
# to call. Deliberately trivial (one boolean arg): the point is proving the
# backend/model can drive OpenAI-style tool-calling AT ALL, not exercising
# any real KB tool schema.
_CONFIG_TEST_TOOL_SCHEMA = {
    "name": "probe_tool",
    "description": (
        "Call this to confirm you can use tools. Always call it -- never "
        "answer with plain text."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "ack": {"type": "boolean", "description": "Always true."},
        },
        "required": ["ack"],
    },
}
_CONFIG_TEST_MESSAGES = [
    {
        "role": "system",
        "content": (
            "You are being connectivity-tested. You MUST call the "
            '`probe_tool` function with {"ack": true}. Do not respond '
            "with plain text."
        ),
    },
    {"role": "user", "content": "Run the connectivity test."},
]

# Per-completion token cap for both probe round-trips: a connectivity test
# must never burn meaningful provider budget. Generous enough for a one-arg
# tool call plus a short acknowledgement (including a thinking model's
# overhead), tiny next to a real ask.
_CONFIG_TEST_MAX_TOKENS = 256


@router.post("/config/test")
async def test_ai_config(request: LLMConfigRequest) -> dict:
    """A minimal TWO-TURN forced-tool-call exchange against the DRAFT config
    in the request body -- NEVER persisted (Product-wave Task 5, item 2).
    Backs `KbBackendSelector`'s "Test" button (next to Save): catches auth, a
    wrong `base_url`, incompatibility, AND a weak model that answers without
    calling the tool.

    Why two turns: the original single-turn probe (force one tool call,
    never send the result back) false-passed gemini-3.5-flash -- Gemini
    3.x's OpenAI-compat layer only rejects (HTTP 400 `thought_signature`)
    the SECOND request of a tool exchange, when the assistant tool-call turn
    is echoed back. So after a successful forced call, the probe now replays
    the exchange exactly the way a real ask does (`pysaka.knowledge.agent
    .KnowledgeAgent`'s echo shape, through the same `chat()` raw-echo seam)
    and requires a sane second response. Both completions are bounded by
    `_CONFIG_TEST_MAX_TOKENS`.

    `verdict` is `"ok"` (forced call + sane second turn), `"no_tool_call"`
    (it answered with plain text instead -- a weak-tool-calling model, the
    live-observed `gemini-2.5-flash-lite`/`qwen2.5:14b` failure mode),
    `"malformed_response"` (the second turn returned neither text nor a tool
    call), or an `LLMBackendError.kind` (`auth`, `quota_exhausted`,
    `unreachable`, `model_incompatible`, ...) from either turn. `ok` mirrors
    `verdict == "ok"`. The API key is never read from the request body
    (there is no such field) or logged -- `build_llm_client_from_draft`
    loads it from the OS keyring exactly like the real client does (P-5
    review, Finding 1: only for a base_url host on its trusted allow-list --
    see that function's docstring), and only `backend`/`model`/the
    classified `verdict` are logged below, never the key or any response
    content.

    P-5 review, minors: deliberately NOT gated behind the cloud-privacy
    consent check (`_cloud_consent_required`/`CloudConsentRequired`) that
    `/ask` enforces. This is a documented choice, not an oversight: the
    probe sends a fixed, canned `_CONFIG_TEST_MESSAGES` payload -- never any
    user content (no synced blog/message text, no free-form question) -- so
    there is nothing consent-relevant leaving the device here, unlike a real
    `/ask`.
    """
    if request.backend not in _VALID_LLM_BACKENDS:
        raise HTTPException(
            status_code=400,
            detail=f"invalid backend: {request.backend!r} (expected 'cloud' or 'local')",
        )
    if not request.base_url.strip():
        raise HTTPException(status_code=400, detail="base_url must not be empty")
    if not request.model.strip():
        raise HTTPException(status_code=400, detail="model must not be empty")

    client = await build_llm_client_from_draft(
        request.backend,
        request.base_url,
        request.model,
        max_tokens=_CONFIG_TEST_MAX_TOKENS,
    )

    def _result(verdict: str, start: float) -> dict:
        latency_ms = int((time.monotonic() - start) * 1000)
        logger.info(
            "ai.config_test.result",
            backend=request.backend,
            model=request.model,
            verdict=verdict,
            latency_ms=latency_ms,
        )
        return {"ok": verdict == "ok", "verdict": verdict, "latencyMs": latency_ms}

    start = time.monotonic()
    try:
        response = await client.chat(
            _CONFIG_TEST_MESSAGES, tools=[_CONFIG_TEST_TOOL_SCHEMA]
        )
    except LLMBackendError as exc:
        return _result(exc.kind, start)

    if not response.tool_calls:
        return _result("no_tool_call", start)

    # Turn 2: echo the tool-call turn and feed a canned tool result back --
    # the same message shapes `KnowledgeAgent`'s loop appends (agent.py), so
    # the probe exercises the exact echo path a real ask uses (including the
    # raw provider-message echo in `OpenAICompatLLMClient`).
    messages: list[dict] = [
        *_CONFIG_TEST_MESSAGES,
        {
            "role": "assistant",
            "tool_calls": [
                {"name": call.name, "arguments": call.arguments, "id": call.id}
                for call in response.tool_calls
            ],
        },
    ]
    messages.extend(
        {
            "role": "tool",
            "name": call.name,
            "id": call.id,
            "content": json.dumps({"ok": True}),
        }
        for call in response.tool_calls
    )
    try:
        second = await client.chat(messages, tools=[_CONFIG_TEST_TOOL_SCHEMA])
    except LLMBackendError as exc:
        return _result(exc.kind, start)

    # Any parsed 2xx second response proves the echoed exchange was accepted;
    # text and a follow-up tool call are both sane. Empty is not.
    verdict = "ok" if (second.text or second.tool_calls) else "malformed_response"
    return _result(verdict, start)


@router.get("/usage")
async def get_usage() -> dict:
    """`{model, requestsToday, dailyLimit, estQuestionsLeft}` (Product-wave
    Task 5, item 3) -- backs the composer/settings "~N questions left today"
    meter. `estQuestionsLeft` is `None` (omitted as JSON `null`, same as
    every other optional field this router serializes) when `dailyLimit` is
    unlimited (local backend, or a cloud model with no known free-tier cap).
    """
    config = await load_config()
    llm_config = (config.get("knowledge_base") or {}).get("llm") or {}
    backend = llm_config.get("backend") or "cloud"
    model = llm_config.get("model") or "gemini-2.5-flash"
    override = llm_config.get("daily_limit")
    return await asyncio.to_thread(llm_usage.usage_snapshot, model, backend, override)


@router.get("/consent")
async def get_cloud_consent() -> dict:
    """`{granted, consentedAt}` -- current state of the one-time cloud-
    privacy consent (Product-wave Task 5, item 5)."""
    config = await load_config()
    kb_config = config.get("knowledge_base") or {}
    return {
        "granted": bool(kb_config.get("cloud_consent", False)),
        "consentedAt": kb_config.get("cloud_consent_at"),
    }


@router.post("/consent")
async def grant_cloud_consent() -> dict:
    """Records the one-time cloud-privacy consent (Product-wave Task 5, item
    5): "your question and excerpts of your synced content are sent to
    <provider>". Persists `knowledge_base.cloud_consent=True` plus a UTC
    timestamp; there is no request body (granting consent is the only thing
    this endpoint does -- declining is purely client-side: the modal just
    doesn't call this, and the ask stays unsent, see `CloudConsentRequired`).
    """
    consented_at = datetime.now(timezone.utc).isoformat()

    def _update(config: dict) -> None:
        kb_config = dict(config.get("knowledge_base") or {})
        kb_config["cloud_consent"] = True
        kb_config["cloud_consent_at"] = consented_at
        config["knowledge_base"] = kb_config

    await update_config(_update)
    logger.info("ai.consent.granted")
    return {"ok": True, "consentedAt": consented_at}


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


# ----------------------------------------------------------------------------
# In-app model download (Product-wave Task 4, item 3)
#
# Progress lives on its OWN endpoint (`GET .../download/status`) rather than
# folded into `/readiness`: download progress changes many times a second
# while "installed or not" is a coarse boolean the frontend only needs to
# recheck occasionally -- keeping them separate lets `SetupChecklist` poll
# progress fast without re-running the (cheap, but not free) readiness probes
# every tick. Documented here per the brief's "pick one, document" note.
# ----------------------------------------------------------------------------


class ModelDownloadRequest(BaseModel):
    model: str | None = None  # defaults to the currently-configured embedding model


async def _default_download_model_name(request: ModelDownloadRequest) -> str:
    return request.model or await resolve_embedding_model_name()


@router.post("/models/download")
async def start_model_download(request: ModelDownloadRequest) -> dict:
    manager = get_model_download_manager()
    model_name = await _default_download_model_name(request)

    async def _run() -> None:
        try:
            await manager.start(model_name)
        except (ValueError, RuntimeError) as exc:
            # `manager.status()` already carries its own error state for
            # download-time failures; a bad model name or a duplicate-start
            # race is caught here so the background task doesn't just vanish
            # into `background_tasks`'s `exception was never logged` guard
            # with nothing surfaced to the poller.
            logger.warning(
                "ai.models_download.start_failed", model=model_name, error=str(exc)
            )
            return
        # Empty-index trap (UX quick win 6): if the user flipped Enable while
        # this download was still running, the enable-toggle's initial build
        # ran before the model existed and skipped quietly
        # (`rebuild_skipped_embedding_model_missing`) -- nothing would ever
        # re-trigger it, leaving documentCount=0 until a manual Rebuild. Now
        # that the model is verified and installed (state == "done"),
        # (re)schedule the initial build if the KB is enabled. Safe to call
        # unconditionally then: `rebuild()`'s per-service in-flight registry
        # skips services already building, and the content-hash no-op fast
        # path makes an already-indexed corpus a cheap pass.
        if manager.status()["state"] == "done" and await kb_enabled():
            logger.info(
                "ai.models_download.initial_build_scheduled", model=model_name
            )
            await schedule_initial_build_all()

    try:
        # Fail fast (before scheduling a background task) for the common
        # synchronous mistakes -- an unknown model name, or a download already
        # in flight -- so the caller gets an immediate 400/409 instead of
        # having to poll status() to discover the request was rejected.
        if get_manifest(model_name) is None:
            raise HTTPException(
                status_code=400, detail=f"no pinned manifest for model {model_name!r}"
            )
        if manager.status()["state"] in ("downloading", "verifying"):
            raise HTTPException(status_code=409, detail={"code": "already_downloading"})
    except HTTPException:
        raise

    track_background_task(_run(), name="model_download")
    logger.info("ai.models_download.started", model=model_name)
    return {"ok": True, "model": model_name}


@router.get("/models/download/status")
async def model_download_status() -> dict:
    return get_model_download_manager().status()


@router.get("/runtime/status")
async def runtime_status() -> dict:
    """Progress of the on-demand onnxruntime download (mirrors /models/download/status)."""
    return get_runtime_provisioner().status()


@router.delete("/models/download")
async def cancel_model_download() -> dict:
    cancelled = get_model_download_manager().cancel()
    logger.info("ai.models_download.cancel_requested", cancelled=cancelled)
    return {"ok": True, "cancelled": cancelled}
