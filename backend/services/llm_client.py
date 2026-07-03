"""Model-agnostic OpenAI-compatible `LLMClient` for SakaDesk's KB-chatbot agent.

`OpenAICompatLLMClient` implements `pysaka.knowledge.llm.LLMClient` against any server
speaking the OpenAI `/v1/chat/completions` wire format -- cloud (Gemini's openai-compat
endpoint, OpenAI itself) and local (Ollama, llama.cpp) alike. It is the single adapter
the future `KnowledgeService` drives regardless of which backend a user selects; only
`base_url` / `model` / `api_key` differ between them.

Ported from `saka_cli.llm_backends` (verified there): the message-translation and
response-parsing logic (including `tool_call_id` correlation and the `arguments`
str-or-object handling) is unchanged. The only adaptation is the transport -- this repo
uses `httpx.AsyncClient` rather than `aiohttp`, matching
`backend.services.translation_service`'s httpx conventions -- plus
`build_llm_client_from_settings()`, which wires the client to SakaDesk's settings store
and OS-keyring credential storage.
"""

from __future__ import annotations

import json
import re
from collections import deque
from typing import Any, Callable, Literal, cast
from urllib.parse import urlparse

import httpx
import structlog

from pysaka.credentials import get_token_manager
from pysaka.knowledge.llm import LLMResponse, ToolCall

from backend.services.settings_store import load_config

logger = structlog.get_logger(__name__)

_DEFAULT_TIMEOUT = 120.0
_ERROR_BODY_SNIPPET_LEN = 500

# Stable taxonomy the UI keys off (`ai.py`'s SSE `event: error` -> frontend
# `ai.error.<kind>` i18n keys). `malformed_response` is also the fallback for
# any HTTP failure this module doesn't have a more specific classification
# for (an unexpected status code, or a 2xx response whose body/shape we can't
# parse) -- "the backend responded, but not in a way we can make sense of".
LLMErrorKind = Literal[
    "quota_exhausted",
    "auth",
    "model_not_found",
    "model_incompatible",
    "unreachable",
    "timeout",
    "malformed_response",
]

# Marker Gemini's openai-compat endpoint includes in a 400 response body when a
# function-calling request is missing/misusing `thought_signature` -- observed
# for models that don't support tool calling the way this client drives it.
_THOUGHT_SIGNATURE_MARKER = "thought_signature"

# Gemini's quota-exceeded body embeds a human-readable "Please retry in Xs"
# hint in `error.message`, and/or a structured `RetryInfo` detail with a
# `retryDelay` field shaped like "34s" / "34.5s". Try the structured form
# first; fall back to the free-text regex.
_RETRY_DELAY_RE = re.compile(r"^(\d+(?:\.\d+)?)s$")
_RETRY_IN_SECONDS_RE = re.compile(r"retry in\s+(\d+(?:\.\d+)?)\s*s", re.IGNORECASE)

# Shared with `backend.api.translation`'s `_API_KEY_CREDENTIAL_GROUP`: the KB chatbot's
# cloud backend reuses the same OS-keyring entry as translation, since both are "the
# user's cloud LLM API key" -- there's only ever one to manage.
_API_KEY_CREDENTIAL_GROUP = "llm_provider_api_key"

# `settings.knowledge_base.llm` defaults. Task 4 (settings `knowledge_base` subsection)
# adds these to `_SETTINGS_DEFAULTS` in `settings_store.py`; until that lands (and for
# any settings.json written before it did), `build_llm_client_from_settings()` falls
# back to these same values so behavior doesn't depend on ordering between tasks.
_CLOUD_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
_CLOUD_DEFAULT_MODEL = "gemini-2.5-flash"
_LOCAL_DEFAULT_BASE_URL = "http://localhost:11434/v1"
_LOCAL_DEFAULT_MODEL = "qwen2.5:14b"

# P-5 review, Finding 1 (IMPORTANT): the host a DRAFT `POST /api/ai/config/test`
# base_url is allowed to receive the real keyring API key for. Derived from
# `_CLOUD_DEFAULT_BASE_URL` (rather than a second hardcoded literal) so the two
# can never drift apart. See `_draft_key_host_is_trusted`'s docstring for the
# full threat model.
_TRUSTED_DRAFT_KEY_HOST = urlparse(_CLOUD_DEFAULT_BASE_URL).hostname


class LLMBackendError(RuntimeError):
    """Raised when a call to an OpenAI-compatible LLM backend fails.

    `kind` (`LLMErrorKind`) is the stable, typed taxonomy the UI keys off --
    `backend/api/ai.py`'s SSE `event: error` carries it as `code`, which the
    frontend maps to a localized `ai.error.<code>` message. It is NEVER derived
    from `str(self)`: that message may include a raw provider response body
    snippet (see `chat()`), which is log-only and must never reach the wire.

    `status_code` is the HTTP status when the failure came from an HTTP
    response (`None` for transport-level failures -- connect/timeout -- and for
    `kind="model_incompatible"` raised from the agent's tool-calling loop
    rather than an HTTP response). `retry_after_s` is populated only when the
    provider told us how long to wait (a `Retry-After` header, or Gemini's
    `RetryInfo` detail / "Please retry in Xs" message text) -- almost always
    alongside `kind="quota_exhausted"`.
    """

    def __init__(
        self,
        message: str,
        *,
        kind: LLMErrorKind = "malformed_response",
        status_code: int | None = None,
        retry_after_s: float | None = None,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.status_code = status_code
        self.retry_after_s = retry_after_s


class OpenAICompatLLMClient:
    """`LLMClient` adapter over any OpenAI-compatible `/chat/completions` endpoint.

    Works unmodified against cloud backends (Gemini's `v1beta/openai` compat endpoint,
    OpenAI itself) and local backends (Ollama, llama.cpp) -- only `base_url`/`model`/
    `api_key` change between them. `api_key` is optional since most local servers don't
    require one; when set, it's sent as `Authorization: Bearer <api_key>`.

    `on_request` (Product-wave Task 5, item 3) is an optional
    `(model, outcome) -> None` callback invoked once per `chat()` call that
    actually reaches the provider -- on a successful response AND on a 429
    (`outcome` is `"success"`/`"quota_exceeded"` respectively; every OTHER
    failure kind is deliberately NOT counted, see `chat()`'s call sites
    below). Never invoked for a call that never left this process (e.g. a
    connect error). `build_llm_client_from_settings()` wires this to
    `backend.services.llm_usage.on_llm_request`; a draft config probed by
    `POST /api/ai/config/test` deliberately leaves this `None` -- a
    connectivity test is not a real user question and must never consume
    quota-meter budget. Exceptions raised BY the callback are logged and
    swallowed, never allowed to turn a successful/classified `chat()` call
    into an unrelated crash.
    """

    def __init__(
        self,
        base_url: str,
        model: str,
        api_key: str | None = None,
        timeout: float = _DEFAULT_TIMEOUT,
        on_request: Callable[[str, str], None] | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._api_key = api_key
        self._timeout = timeout
        self._on_request = on_request

    def _notify_request(self, outcome: str) -> None:
        if self._on_request is None:
            return
        try:
            self._on_request(self._model, outcome)
        except Exception:  # noqa: BLE001 - a usage-tracking callback must never break chat()
            logger.warning(
                "llm_client.on_request_callback_failed", outcome=outcome, exc_info=True
            )

    async def chat(
        self, messages: list[dict], tools: list[dict] | None = None
    ) -> LLMResponse:
        openai_messages = _to_openai_messages(messages)
        openai_tools = _to_openai_tools(tools)

        payload: dict[str, Any] = {
            "model": self._model,
            "messages": openai_messages,
            "temperature": 0.2,
        }
        if openai_tools:
            payload["tools"] = openai_tools

        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        url = f"{self._base_url}/chat/completions"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(url, json=payload, headers=headers)
        except httpx.ConnectError as exc:
            logger.warning("llm_client.unreachable", url=url, error=str(exc))
            raise LLMBackendError(
                f"could not connect to LLM backend at {url}: {exc}", kind="unreachable"
            ) from exc
        except httpx.ConnectTimeout as exc:
            logger.warning("llm_client.unreachable_timeout", url=url, error=str(exc))
            raise LLMBackendError(
                f"timed out connecting to LLM backend at {url}: {exc}",
                kind="unreachable",
            ) from exc
        except httpx.TimeoutException as exc:
            logger.warning("llm_client.timeout", url=url, error=str(exc))
            raise LLMBackendError(
                f"LLM backend at {url} timed out after {self._timeout}s: {exc}",
                kind="timeout",
            ) from exc

        if resp.status_code >= 400:
            body_snippet = resp.text[:_ERROR_BODY_SNIPPET_LEN]
            kind, retry_after_s = _classify_http_error(resp)
            logger.warning(
                "llm_client.http_error",
                url=url,
                status=resp.status_code,
                kind=kind,
                body=body_snippet,
            )
            if kind == "quota_exhausted":
                # A 429 still means the request was actually sent and counted
                # against the provider's quota -- must not be silently
                # excluded from the usage ledger (see `_notify_request`'s
                # docstring / the pre-Task-5 quota-blindness bug).
                self._notify_request("quota_exceeded")
            raise LLMBackendError(
                f"OpenAI-compatible LLM backend at {url} returned "
                f"HTTP {resp.status_code}: {body_snippet}",
                kind=kind,
                status_code=resp.status_code,
                retry_after_s=retry_after_s,
            )

        try:
            data = resp.json()
        except json.JSONDecodeError as exc:
            logger.warning("llm_client.invalid_json_response", url=url, error=str(exc))
            raise LLMBackendError(
                f"LLM backend at {url} returned a 2xx response with invalid JSON",
                kind="malformed_response",
            ) from exc

        try:
            response = _parse_openai_response(data)
        except (KeyError, TypeError, IndexError, AttributeError) as exc:
            # Structural failures of the RESPONSE ENVELOPE itself (e.g. `choices[0]`
            # isn't even an object) -- distinct from a malformed per-tool-call
            # `function`/`arguments`, which `_parse_tool_call` already handles as a
            # per-call `invalid_reason` rather than raising.
            logger.warning(
                "llm_client.unexpected_response_shape", url=url, error=str(exc)
            )
            raise LLMBackendError(
                f"LLM backend at {url} returned an unexpected response shape",
                kind="malformed_response",
            ) from exc

        self._notify_request("success")
        return response


def _to_openai_messages(messages: list[dict]) -> list[dict]:
    """Translate the agent's generic message list into OpenAI `/chat/completions` messages.

    `tool_call_id` correlation: OpenAI ties an `assistant` message's `tool_calls[].id` to
    the following `tool` message(s)' `tool_call_id` by exact string match. The agent
    (`pysaka.knowledge.agent.KnowledgeAgent`) already threads a `ToolCall.id` through both
    the assistant turn and its matching tool result -- but that id can be empty (e.g. a
    `FakeLLMClient` script, or a real model that never sets one). When it's empty, we
    synthesize a stable per-call id (`call_<index-in-this-assistant-turn>`) and push it
    onto `pending_tool_call_ids`; the `tool` messages that immediately follow (one per
    call, same order -- see `KnowledgeAgent.ask`) pop from that queue so the assistant
    tool_call and its tool result always end up sharing the same id, synthesized or not.
    """
    openai_messages: list[dict] = []
    pending_tool_call_ids: deque[str] = deque()

    for msg in messages:
        role = msg.get("role")
        if role == "system":
            openai_messages.append({"role": "system", "content": msg.get("content")})
        elif role == "user":
            openai_messages.append({"role": "user", "content": msg.get("content", "")})
        elif role == "assistant":
            calls = msg.get("tool_calls") or []
            if calls:
                openai_calls = []
                for i, call in enumerate(calls):
                    call_id = call.get("id") or f"call_{i}"
                    pending_tool_call_ids.append(call_id)
                    openai_calls.append(
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": call["name"],
                                "arguments": json.dumps(
                                    call["arguments"], ensure_ascii=False
                                ),
                            },
                        }
                    )
                openai_messages.append(
                    {"role": "assistant", "content": None, "tool_calls": openai_calls}
                )
            else:
                openai_messages.append(
                    {"role": "assistant", "content": msg.get("content")}
                )
        elif role == "tool":
            original_id = msg.get("id") or ""
            synthesized_id = (
                pending_tool_call_ids.popleft() if pending_tool_call_ids else ""
            )
            tool_call_id = original_id or synthesized_id
            openai_messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": msg.get("content", ""),
                }
            )

    return openai_messages


def _to_openai_tools(tools: list[dict] | None) -> list[dict] | None:
    """Translate pysaka `TOOL_SCHEMAS`-shaped tools (`{name, description, parameters}`) to OpenAI's."""
    if not tools:
        return None
    return [
        {
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool.get("description", ""),
                "parameters": tool["parameters"],
            },
        }
        for tool in tools
    ]


def _parse_openai_response(data: dict) -> LLMResponse:
    choices = data.get("choices") or []
    if not choices:
        return LLMResponse(text=None, tool_calls=[])

    message = choices[0].get("message") or {}
    raw_tool_calls = message.get("tool_calls")
    if raw_tool_calls:
        tool_calls = [_parse_tool_call(tc) for tc in raw_tool_calls]
        return LLMResponse(text=None, tool_calls=tool_calls)

    return LLMResponse(text=message.get("content") or "", tool_calls=[])


def _parse_tool_call(tc: Any) -> ToolCall:
    """Parse one raw OpenAI `tool_calls[]` entry into a `ToolCall`.

    Weak/local models routinely emit truncated or malformed `arguments` JSON --
    or an unexpected shape for the call entry itself (missing `function`/`name`
    entirely). Rather than letting `JSONDecodeError`/`KeyError`/`TypeError`
    escape `chat()` and crash the whole ask (see the "malformed tool calls
    crash the whole ask" finding), any parse failure here is caught and turned
    into a `ToolCall` with `invalid_reason` set -- `KnowledgeAgent` feeds that
    back to the model as a `{"error": ...}` tool result instead of dispatching
    it to `ToolRunner`, giving the model a chance to self-correct within its
    step budget instead of aborting the ask.
    """
    call_id = tc.get("id", "") if isinstance(tc, dict) else ""
    try:
        function = tc["function"]
        name = function["name"]
        arguments = _parse_tool_arguments(function.get("arguments"))
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        name = _best_effort_tool_name(tc)
        logger.warning(
            "llm_client.malformed_tool_call", tool_name=name or None, error=str(exc)
        )
        reason = (
            f"invalid arguments for tool '{name}': emit valid JSON matching its schema and retry"
            if name
            else "invalid tool call: the tool name/arguments could not be parsed -- retry with valid JSON"
        )
        return ToolCall(name=name, arguments={}, id=call_id, invalid_reason=reason)
    return ToolCall(name=name, arguments=arguments, id=call_id)


def _best_effort_tool_name(tc: Any) -> str:
    """Recover a tool `name` for the error message even when `tc`'s shape is malformed."""
    if isinstance(tc, dict):
        function = tc.get("function")
        if isinstance(function, dict):
            name = function.get("name")
            if isinstance(name, str):
                return name
    return ""


def _parse_tool_arguments(arguments: Any) -> dict:
    """Some servers (llama.cpp) return `arguments` already parsed as an object, not a JSON string."""
    if isinstance(arguments, dict):
        return arguments
    if isinstance(arguments, str):
        return json.loads(arguments) if arguments else {}
    return {}


def _classify_http_error(resp: httpx.Response) -> tuple[LLMErrorKind, float | None]:
    """Classify a non-2xx HTTP response into `(kind, retry_after_s)`.

    See `LLMErrorKind` for the taxonomy; anything not explicitly recognized
    here falls back to `malformed_response` (a response we got, but can't
    trust/make sense of).
    """
    status = resp.status_code
    if status == 429:
        return "quota_exhausted", _parse_retry_after(resp)
    if status in (401, 403):
        return "auth", None
    if status == 404:
        return "model_not_found", None
    if status == 400 and _THOUGHT_SIGNATURE_MARKER in resp.text:
        return "model_incompatible", None
    return "malformed_response", None


def _parse_retry_after(resp: httpx.Response) -> float | None:
    """Best-effort seconds-to-wait from a 429: `Retry-After` header, else Gemini's
    `RetryInfo` detail (`retryDelay: "34s"`), else a "Please retry in Xs" message."""
    header = resp.headers.get("Retry-After")
    if header:
        try:
            return float(header)
        except ValueError:
            pass  # HTTP-date form -- not worth parsing for this use case

    try:
        body = resp.json()
    except json.JSONDecodeError:
        return None
    if not isinstance(body, dict):
        return None
    error = body.get("error")
    if not isinstance(error, dict):
        return None

    for detail in error.get("details") or []:
        if isinstance(detail, dict):
            delay = detail.get("retryDelay")
            if isinstance(delay, str):
                match = _RETRY_DELAY_RE.match(delay.strip())
                if match:
                    return float(match.group(1))

    message = error.get("message")
    if isinstance(message, str):
        match = _RETRY_IN_SECONDS_RE.search(message)
        if match:
            return float(match.group(1))
    return None


async def build_llm_client_from_settings(
    on_request: Callable[[str, str], None] | None = None,
) -> OpenAICompatLLMClient | None:
    """Build the KB chatbot's `LLMClient` from `settings.knowledge_base.llm`.

    Reads `{backend, base_url, model}` defensively (`.get(..., {})` chains + per-field
    fallbacks) since Task 4 -- which adds `knowledge_base.llm` to the settings
    defaults -- may not have landed in every settings.json this runs against yet.

    - `backend == "local"`: `api_key=None` (most local servers don't require one) and a
      client is always returned.
    - `backend == "cloud"` (default): the API key is loaded from the OS keyring, shared
      with translation's `"llm_provider_api_key"` credential group. Returns `None` only
      in this case, when no key is stored -- there's nothing usable to build a client
      with.

    `on_request` (Product-wave Task 5, item 3) is threaded straight through to
    the built client's `OpenAICompatLLMClient(on_request=...)` -- callers that
    want usage-ledger tracking (`KnowledgeService`'s three build sites) pass
    `backend.services.llm_usage.on_llm_request`; callers that must NOT record
    usage (e.g. `compute_readiness()`'s `_probe_llm`, which never calls
    `.chat()` anyway, or a future draft-config probe) simply omit it.
    """
    config = await load_config()
    kb_config = config.get("knowledge_base") or {}
    llm_config = kb_config.get("llm") or {}

    backend = llm_config.get("backend") or "cloud"

    if backend == "local":
        base_url = llm_config.get("base_url") or _LOCAL_DEFAULT_BASE_URL
        model = llm_config.get("model") or _LOCAL_DEFAULT_MODEL
        return OpenAICompatLLMClient(
            base_url=base_url, model=model, api_key=None, on_request=on_request
        )

    base_url = llm_config.get("base_url") or _CLOUD_DEFAULT_BASE_URL
    model = llm_config.get("model") or _CLOUD_DEFAULT_MODEL
    api_key = _load_cloud_api_key()
    if not api_key:
        logger.info("llm_client.build_from_settings.no_api_key", backend=backend)
        return None
    return OpenAICompatLLMClient(
        base_url=base_url, model=model, api_key=api_key, on_request=on_request
    )


async def build_llm_client_from_draft(
    backend: str, base_url: str, model: str
) -> OpenAICompatLLMClient:
    """Build an `OpenAICompatLLMClient` from an explicit, NOT-YET-PERSISTED
    `(backend, base_url, model)` -- `POST /api/ai/config/test`'s draft-config
    probe (Product-wave Task 5, item 2). Mirrors `build_llm_client_from_settings`'s
    cloud/local key-loading logic but never reads `settings.knowledge_base.llm`
    itself, so a config can be validated BEFORE it's saved.

    P-5 review, Finding 1 (IMPORTANT -- exfiltration oracle): for `backend ==
    "cloud"`, the real keyring API key is attached ONLY when `base_url`'s host
    is trusted (`_draft_key_host_is_trusted`) -- NOT for every draft
    `base_url` unconditionally, which would let anyone who can reach this
    endpoint (the draft `base_url` is fully attacker/user-controlled request
    body) redirect the user's real cloud API key to an arbitrary host just by
    typing it into the settings form and clicking Test. When the host isn't
    trusted, `api_key=None` -- the probe still runs and fails with `auth` (no
    key) or `unreachable`, which is a safe, informative outcome; it never
    silently drops the request. This function is now `async` (it may need to
    read `settings.knowledge_base.llm` to resolve the saved-cloud-host branch
    of the allow-list) -- see `_draft_key_host_is_trusted`.

    Deliberately never wires `on_request`: a connectivity test round-trip is
    not a real user question and must never be recorded against the usage
    ledger/quota meter.
    """
    if backend == "local":
        return OpenAICompatLLMClient(base_url=base_url, model=model, api_key=None)

    api_key: str | None = None
    if await _draft_key_host_is_trusted(base_url):
        api_key = _load_cloud_api_key()
    else:
        logger.warning(
            "llm_client.draft_key_attach_refused",
            draft_host=_extract_host(base_url),
        )
    return OpenAICompatLLMClient(base_url=base_url, model=model, api_key=api_key)


def _extract_host(url: str) -> str | None:
    """Lowercased hostname from `url`, or `None` when it's unparseable or has
    no host at all. `urlparse(...).hostname` already lowercases per RFC 3986,
    but the explicit `.lower()` keeps that guarantee independent of urllib's
    implementation detail -- callers must never compare hosts case-sensitively
    or via substring/`endswith` matching (a look-alike host like
    `generativelanguage.googleapis.com.evil.example` must NOT match)."""
    try:
        hostname = urlparse(url).hostname
    except ValueError:
        return None
    return hostname.lower() if hostname else None


async def _draft_key_host_is_trusted(draft_base_url: str) -> bool:
    """Whether `draft_base_url` (a `POST /api/ai/config/test` request body
    field -- fully user-controlled, not-yet-saved) may receive the real
    cloud API key (P-5 review, Finding 1).

    Trusted iff the draft's host, compared case-insensitively by EXACT
    hostname equality (never substring/`endswith`), is either:
      - the known Gemini host (`_TRUSTED_DRAFT_KEY_HOST`), or
      - the host of the CURRENTLY-SAVED `knowledge_base.llm.base_url`, but
        only when the saved `backend` is itself `"cloud"` -- `base_url` is a
        single shared settings field for both backends, so when the saved
        backend is `"local"` that field holds a local server URL, not a
        cloud proxy the user ever actually committed to via Save.

    This is deliberately narrower than "any base_url the user typed" -- a
    draft `base_url` is exactly what an attacker (a malicious settings-import,
    a compromised extension, or just a user copy-pasting a bad link) would
    control to turn the Test button into a way to exfiltrate whatever's in
    the OS keyring to an arbitrary host. Restricting to hosts the user has
    ALREADY explicitly committed to (the official Gemini endpoint, or a
    custom proxy they already Saved) closes that hole while still letting a
    legitimate custom-proxy edit be re-tested without a Save round-trip
    first.
    """
    draft_host = _extract_host(draft_base_url)
    if draft_host is None:
        return False
    if draft_host == _TRUSTED_DRAFT_KEY_HOST:
        return True

    config = await load_config()
    llm_config = (config.get("knowledge_base") or {}).get("llm") or {}
    if (llm_config.get("backend") or "cloud") != "cloud":
        return False
    saved_base_url = llm_config.get("base_url") or _CLOUD_DEFAULT_BASE_URL
    saved_host = _extract_host(saved_base_url)
    return saved_host is not None and draft_host == saved_host


def _load_cloud_api_key() -> str | None:
    """Load the cloud LLM provider API key from the OS keyring (shared with translation)."""
    tm = get_token_manager()
    data = tm.store.load(_API_KEY_CREDENTIAL_GROUP)
    if data:
        return cast("str | None", data.get("api_key"))
    return None
