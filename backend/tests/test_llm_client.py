"""Tests for `backend.services.llm_client` -- the model-agnostic OpenAI-compatible
`LLMClient` powering the KB chatbot, plus `build_llm_client_from_settings`.

The HTTP layer is mocked with `respx` against `httpx.AsyncClient` -- no real network
call is ever made. Ported from `saka_cli/tests/test_llm_backends.py` (aiohttp fakes)
to respx, since SakaDesk uses httpx.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import respx

from pysaka.knowledge.llm import LLMClient
from pysaka.knowledge.tools import TOOL_SCHEMAS

from backend.services.llm_client import (
    LLMBackendError,
    OpenAICompatLLMClient,
    _parse_openai_response,
    _parse_tool_arguments,
    _to_openai_messages,
    build_llm_client_from_draft,
    build_llm_client_from_settings,
)

CHAT_URL = "http://localhost:11434/v1/chat/completions"


# --- protocol conformance ----------------------------------------------------------------


def test_openai_compat_client_is_llm_client_protocol():
    client = OpenAICompatLLMClient(
        base_url="http://localhost:11434/v1", model="qwen2.5:14b"
    )
    assert isinstance(client, LLMClient)


# --- request building ---------------------------------------------------------------------


@respx.mock
@pytest.mark.asyncio
async def test_chat_with_tools_builds_openai_request_and_parses_tool_calls_string_args():
    route = respx.post(CHAT_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call_abc",
                                    "type": "function",
                                    "function": {
                                        "name": "search",
                                        "arguments": '{"query": "test"}',
                                    },
                                }
                            ],
                        }
                    }
                ]
            },
        )
    )

    client = OpenAICompatLLMClient(
        base_url="http://localhost:11434/v1", model="qwen2.5:14b"
    )
    resp = await client.chat(
        [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "hello"},
        ],
        tools=TOOL_SCHEMAS,
    )

    assert resp.text is None
    assert len(resp.tool_calls) == 1
    assert resp.tool_calls[0].name == "search"
    assert resp.tool_calls[0].arguments == {"query": "test"}
    assert resp.tool_calls[0].id == "call_abc"

    sent = route.calls[0].request
    body = json.loads(sent.content)
    assert body["model"] == "qwen2.5:14b"
    assert body["temperature"] == 0.2
    assert body["messages"] == [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "hello"},
    ]
    assert body["tools"][0]["type"] == "function"
    assert body["tools"][0]["function"]["name"] == TOOL_SCHEMAS[0]["name"]
    assert body["tools"][0]["function"]["parameters"] == TOOL_SCHEMAS[0]["parameters"]


@respx.mock
@pytest.mark.asyncio
async def test_chat_parses_tool_call_arguments_as_object():
    """Some servers (llama.cpp) return `arguments` as an already-parsed object, not a string."""
    respx.post("http://localhost:8080/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "tool_calls": [
                                {
                                    "id": "call_1",
                                    "type": "function",
                                    "function": {
                                        "name": "search",
                                        "arguments": {"query": "obj"},
                                    },
                                }
                            ],
                        }
                    }
                ]
            },
        )
    )

    client = OpenAICompatLLMClient(
        base_url="http://localhost:8080/v1", model="local-model"
    )
    resp = await client.chat([{"role": "user", "content": "hi"}])

    assert resp.tool_calls[0].arguments == {"query": "obj"}
    assert resp.tool_calls[0].name == "search"


@respx.mock
@pytest.mark.asyncio
async def test_chat_plain_text_response():
    url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    route = respx.post(url).mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"role": "assistant", "content": "hello there"}}
                ]
            },
        )
    )

    client = OpenAICompatLLMClient(
        base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        model="gemini-2.5-flash",
        api_key="secret",
    )
    resp = await client.chat([{"role": "user", "content": "hi"}])

    assert resp.text == "hello there"
    assert resp.tool_calls == []

    sent = route.calls[0].request
    assert sent.headers["Authorization"] == "Bearer secret"


@respx.mock
@pytest.mark.asyncio
async def test_chat_omits_authorization_header_when_no_api_key():
    route = respx.post(CHAT_URL).mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )

    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")
    await client.chat([{"role": "user", "content": "hi"}])

    headers = route.calls[0].request.headers
    assert "Authorization" not in headers


@respx.mock
@pytest.mark.asyncio
async def test_chat_without_tools_omits_tools_key():
    route = respx.post(CHAT_URL).mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )

    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")
    await client.chat([{"role": "user", "content": "hi"}])

    body = json.loads(route.calls[0].request.content)
    assert "tools" not in body


# --- multi-turn tool_call_id correlation ----------------------------------------------------


@respx.mock
@pytest.mark.asyncio
async def test_chat_multi_turn_synthesizes_and_correlates_tool_call_ids():
    route = respx.post(CHAT_URL).mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "final"}}]}
        )
    )

    client = OpenAICompatLLMClient(
        base_url="http://localhost:11434/v1", model="qwen2.5:14b"
    )
    messages = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "question"},
        {
            "role": "assistant",
            "tool_calls": [
                {"name": "search", "arguments": {"query": "x"}, "id": ""},
                {"name": "get_document", "arguments": {"doc_id": "d1"}, "id": ""},
            ],
        },
        {"role": "tool", "name": "search", "id": "", "content": '{"hits": []}'},
        {
            "role": "tool",
            "name": "get_document",
            "id": "",
            "content": '{"doc_id": "d1"}',
        },
    ]
    await client.chat(messages)

    body = json.loads(route.calls[0].request.content)
    assistant_msg = body["messages"][2]
    tool_msg_1 = body["messages"][3]
    tool_msg_2 = body["messages"][4]

    assert assistant_msg["role"] == "assistant"
    assert assistant_msg["content"] is None
    ids = [tc["id"] for tc in assistant_msg["tool_calls"]]
    assert ids[0] and ids[1] and ids[0] != ids[1]
    assert tool_msg_1["role"] == "tool"
    assert tool_msg_1["tool_call_id"] == ids[0]
    assert tool_msg_2["tool_call_id"] == ids[1]
    assert assistant_msg["tool_calls"][0]["function"]["name"] == "search"
    assert json.loads(assistant_msg["tool_calls"][0]["function"]["arguments"]) == {
        "query": "x"
    }
    assert assistant_msg["tool_calls"][1]["function"]["name"] == "get_document"


@respx.mock
@pytest.mark.asyncio
async def test_chat_reuses_existing_tool_call_ids_when_present():
    route = respx.post(CHAT_URL).mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "final"}}]}
        )
    )

    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")
    messages = [
        {
            "role": "assistant",
            "tool_calls": [{"name": "search", "arguments": {}, "id": "call-1"}],
        },
        {"role": "tool", "name": "search", "id": "call-1", "content": "{}"},
    ]
    await client.chat(messages)

    body = json.loads(route.calls[0].request.content)
    assert body["messages"][0]["tool_calls"][0]["id"] == "call-1"
    assert body["messages"][1]["tool_call_id"] == "call-1"


# --- error handling -------------------------------------------------------------------------


@respx.mock
@pytest.mark.asyncio
async def test_chat_raises_clear_error_on_http_failure():
    respx.post(CHAT_URL).mock(return_value=httpx.Response(500, text="internal error"))

    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")
    with pytest.raises(LLMBackendError) as exc_info:
        await client.chat([{"role": "user", "content": "hi"}])

    assert "500" in str(exc_info.value)
    assert "internal error" in str(exc_info.value)
    # Unclassified HTTP failures fall back to malformed_response.
    assert exc_info.value.kind == "malformed_response"
    assert exc_info.value.status_code == 500
    assert exc_info.value.retry_after_s is None


# --- error taxonomy (kind / status_code / retry_after_s) -----------------------------------


@respx.mock
@pytest.mark.asyncio
async def test_chat_429_with_retry_after_header_classifies_as_quota_exhausted():
    respx.post(CHAT_URL).mock(
        return_value=httpx.Response(
            429, headers={"Retry-After": "42"}, json={"error": "quota exceeded"}
        )
    )
    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")

    with pytest.raises(LLMBackendError) as exc_info:
        await client.chat([{"role": "user", "content": "hi"}])

    assert exc_info.value.kind == "quota_exhausted"
    assert exc_info.value.status_code == 429
    assert exc_info.value.retry_after_s == 42.0


@respx.mock
@pytest.mark.asyncio
async def test_chat_429_gemini_retry_delay_body_classifies_retry_after():
    """No `Retry-After` header -- parsed from Gemini's `RetryInfo` detail instead."""
    respx.post(CHAT_URL).mock(
        return_value=httpx.Response(
            429,
            json={
                "error": {
                    "code": 429,
                    "message": "You exceeded your current quota. Please retry in 34.5s.",
                    "status": "RESOURCE_EXHAUSTED",
                    "details": [
                        {
                            "@type": "type.googleapis.com/google.rpc.RetryInfo",
                            "retryDelay": "34.5s",
                        }
                    ],
                }
            },
        )
    )
    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")

    with pytest.raises(LLMBackendError) as exc_info:
        await client.chat([{"role": "user", "content": "hi"}])

    assert exc_info.value.kind == "quota_exhausted"
    assert exc_info.value.retry_after_s == 34.5


@respx.mock
@pytest.mark.asyncio
async def test_chat_429_message_text_retry_in_seconds_fallback():
    """No header, no `RetryInfo` detail -- fall back to parsing "retry in Xs" from the message."""
    respx.post(CHAT_URL).mock(
        return_value=httpx.Response(
            429,
            json={
                "error": {"message": "Rate limited. Please retry in 7s and try again."}
            },
        )
    )
    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")

    with pytest.raises(LLMBackendError) as exc_info:
        await client.chat([{"role": "user", "content": "hi"}])

    assert exc_info.value.kind == "quota_exhausted"
    assert exc_info.value.retry_after_s == 7.0


@respx.mock
@pytest.mark.asyncio
async def test_chat_429_without_any_retry_info_leaves_retry_after_none():
    respx.post(CHAT_URL).mock(return_value=httpx.Response(429, text="rate limited"))
    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")

    with pytest.raises(LLMBackendError) as exc_info:
        await client.chat([{"role": "user", "content": "hi"}])

    assert exc_info.value.kind == "quota_exhausted"
    assert exc_info.value.retry_after_s is None


@respx.mock
@pytest.mark.asyncio
async def test_chat_401_classifies_as_auth():
    respx.post(CHAT_URL).mock(return_value=httpx.Response(401, text="unauthorized"))
    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")

    with pytest.raises(LLMBackendError) as exc_info:
        await client.chat([{"role": "user", "content": "hi"}])

    assert exc_info.value.kind == "auth"
    assert exc_info.value.status_code == 401


@respx.mock
@pytest.mark.asyncio
async def test_chat_403_classifies_as_auth():
    respx.post(CHAT_URL).mock(return_value=httpx.Response(403, text="forbidden"))
    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")

    with pytest.raises(LLMBackendError) as exc_info:
        await client.chat([{"role": "user", "content": "hi"}])

    assert exc_info.value.kind == "auth"


@respx.mock
@pytest.mark.asyncio
async def test_chat_404_classifies_as_model_not_found():
    """Covers both a plain 404 and Ollama's model-missing 404 body shape."""
    respx.post(CHAT_URL).mock(
        return_value=httpx.Response(
            404, json={"error": "model 'qwen2.5:14b' not found, try pulling it first"}
        )
    )
    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")

    with pytest.raises(LLMBackendError) as exc_info:
        await client.chat([{"role": "user", "content": "hi"}])

    assert exc_info.value.kind == "model_not_found"
    assert exc_info.value.status_code == 404


@respx.mock
@pytest.mark.asyncio
async def test_chat_400_with_thought_signature_classifies_as_model_incompatible():
    respx.post(CHAT_URL).mock(
        return_value=httpx.Response(
            400,
            json={
                "error": {
                    "message": "Unable to submit request because thought_signature is missing"
                }
            },
        )
    )
    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")

    with pytest.raises(LLMBackendError) as exc_info:
        await client.chat([{"role": "user", "content": "hi"}])

    assert exc_info.value.kind == "model_incompatible"
    assert exc_info.value.status_code == 400


@respx.mock
@pytest.mark.asyncio
async def test_chat_400_without_thought_signature_classifies_as_malformed_response():
    respx.post(CHAT_URL).mock(
        return_value=httpx.Response(400, json={"error": {"message": "bad request"}})
    )
    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")

    with pytest.raises(LLMBackendError) as exc_info:
        await client.chat([{"role": "user", "content": "hi"}])

    assert exc_info.value.kind == "malformed_response"


@respx.mock
@pytest.mark.asyncio
async def test_chat_connect_error_classifies_as_unreachable():
    respx.post(CHAT_URL).mock(side_effect=httpx.ConnectError("connection refused"))
    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")

    with pytest.raises(LLMBackendError) as exc_info:
        await client.chat([{"role": "user", "content": "hi"}])

    assert exc_info.value.kind == "unreachable"
    assert exc_info.value.status_code is None


@respx.mock
@pytest.mark.asyncio
async def test_chat_connect_timeout_classifies_as_unreachable():
    respx.post(CHAT_URL).mock(side_effect=httpx.ConnectTimeout("timed out connecting"))
    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")

    with pytest.raises(LLMBackendError) as exc_info:
        await client.chat([{"role": "user", "content": "hi"}])

    assert exc_info.value.kind == "unreachable"


@respx.mock
@pytest.mark.asyncio
async def test_chat_read_timeout_classifies_as_timeout():
    respx.post(CHAT_URL).mock(side_effect=httpx.ReadTimeout("read timed out"))
    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")

    with pytest.raises(LLMBackendError) as exc_info:
        await client.chat([{"role": "user", "content": "hi"}])

    assert exc_info.value.kind == "timeout"


@respx.mock
@pytest.mark.asyncio
async def test_chat_invalid_json_response_classifies_as_malformed_response():
    respx.post(CHAT_URL).mock(
        return_value=httpx.Response(
            200, content=b"not json", headers={"Content-Type": "application/json"}
        )
    )
    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")

    with pytest.raises(LLMBackendError) as exc_info:
        await client.chat([{"role": "user", "content": "hi"}])

    assert exc_info.value.kind == "malformed_response"
    assert exc_info.value.status_code is None


@respx.mock
@pytest.mark.asyncio
async def test_chat_unexpected_response_shape_classifies_as_malformed_response():
    """A `choices[0]` that isn't even an object is a structural shape failure at
    the RESPONSE ENVELOPE level -- distinct from a malformed per-tool-call
    `function`/`arguments`, which is self-correctable (see the invalid-tool-call
    tests below) rather than a whole-`chat()` failure."""
    respx.post(CHAT_URL).mock(
        return_value=httpx.Response(200, json={"choices": ["not-an-object"]})
    )
    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")

    with pytest.raises(LLMBackendError) as exc_info:
        await client.chat([{"role": "user", "content": "hi"}])

    assert exc_info.value.kind == "malformed_response"


@respx.mock
@pytest.mark.asyncio
async def test_chat_tool_call_missing_function_key_entirely_is_still_recoverable():
    """A tool call missing the whole `function` object (not just `arguments`) is
    STILL a per-call self-correction case, not a `chat()`-level crash -- the model
    gets an actionable "invalid tool call, retry" message either way."""
    respx.post(CHAT_URL).mock(
        return_value=httpx.Response(
            200,
            json={"choices": [{"message": {"tool_calls": [{"id": "call_1"}]}}]},
        )
    )
    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")

    resp = await client.chat([{"role": "user", "content": "hi"}])

    assert len(resp.tool_calls) == 1
    assert resp.tool_calls[0].invalid_reason is not None
    assert resp.tool_calls[0].id == "call_1"


def test_llm_backend_error_defaults_to_malformed_response_kind():
    exc = LLMBackendError("boom")
    assert exc.kind == "malformed_response"
    assert exc.status_code is None
    assert exc.retry_after_s is None


# --- malformed tool-call arguments (self-correction, not a crash) --------------------------


@respx.mock
@pytest.mark.asyncio
async def test_chat_unparseable_tool_call_arguments_returns_invalid_flagged_call():
    """A truncated/invalid JSON `arguments` string must not raise -- it must come
    back as a `ToolCall` with `invalid_reason` set, so the agent loop can feed an
    error back to the model instead of the whole ask crashing."""
    respx.post(CHAT_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "tool_calls": [
                                {
                                    "id": "call_1",
                                    "type": "function",
                                    "function": {
                                        "name": "search",
                                        "arguments": '{"query": "unterminated',
                                    },
                                }
                            ]
                        }
                    }
                ]
            },
        )
    )
    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")

    resp = await client.chat([{"role": "user", "content": "hi"}])

    assert len(resp.tool_calls) == 1
    call = resp.tool_calls[0]
    assert call.name == "search"
    assert call.arguments == {}
    assert call.id == "call_1"
    assert call.invalid_reason is not None
    assert "search" in call.invalid_reason


@respx.mock
@pytest.mark.asyncio
async def test_chat_tool_call_missing_function_name_returns_invalid_flagged_call():
    respx.post(CHAT_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "tool_calls": [
                                {
                                    "id": "call_1",
                                    "type": "function",
                                    "function": {"arguments": "{}"},
                                }
                            ]
                        }
                    }
                ]
            },
        )
    )
    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")

    resp = await client.chat([{"role": "user", "content": "hi"}])

    assert len(resp.tool_calls) == 1
    assert resp.tool_calls[0].invalid_reason is not None


@respx.mock
@pytest.mark.asyncio
async def test_chat_mixed_valid_and_invalid_tool_calls_only_flags_the_bad_one():
    respx.post(CHAT_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "tool_calls": [
                                {
                                    "id": "call_1",
                                    "type": "function",
                                    "function": {
                                        "name": "search",
                                        "arguments": '{"query": "ok"}',
                                    },
                                },
                                {
                                    "id": "call_2",
                                    "type": "function",
                                    "function": {
                                        "name": "aggregate",
                                        "arguments": "not json at all",
                                    },
                                },
                            ]
                        }
                    }
                ]
            },
        )
    )
    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")

    resp = await client.chat([{"role": "user", "content": "hi"}])

    assert len(resp.tool_calls) == 2
    assert resp.tool_calls[0].invalid_reason is None
    assert resp.tool_calls[0].arguments == {"query": "ok"}
    assert resp.tool_calls[1].invalid_reason is not None
    assert resp.tool_calls[1].name == "aggregate"


# --- small pure-function edge cases (internal helpers) ---------------------------------------


def test_to_openai_messages_passes_through_plain_assistant_content():
    """An assistant message with no `tool_calls` (a prior final-answer turn in `history`)
    is passed through as a normal `{role, content}` message."""
    result = _to_openai_messages([{"role": "assistant", "content": "previous answer"}])
    assert result == [{"role": "assistant", "content": "previous answer"}]


def test_parse_openai_response_with_no_choices_returns_empty_response():
    resp = _parse_openai_response({"choices": []})
    assert resp.text is None
    assert resp.tool_calls == []


def test_parse_tool_arguments_returns_empty_dict_for_unexpected_type():
    assert _parse_tool_arguments(None) == {}
    assert _parse_tool_arguments(123) == {}


# --- build_llm_client_from_settings --------------------------------------------------------


@respx.mock
@pytest.mark.asyncio
async def test_build_from_settings_cloud_with_api_key_returns_working_client():
    config = {
        "knowledge_base": {
            "llm": {
                "backend": "cloud",
                "base_url": "https://example.test/v1",
                "model": "gemini-x",
            }
        }
    }
    route = respx.post("https://example.test/v1/chat/completions").mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )

    with (
        patch(
            "backend.services.llm_client.load_config",
            new_callable=AsyncMock,
            return_value=config,
        ),
        patch("backend.services.llm_client.get_token_manager") as mock_tm,
    ):
        mock_tm.return_value.store.load.return_value = {"api_key": "secret-key"}
        client = await build_llm_client_from_settings()
        assert client is not None
        await client.chat([{"role": "user", "content": "hi"}])

    sent = route.calls[0].request
    assert sent.headers["Authorization"] == "Bearer secret-key"
    body = json.loads(sent.content)
    assert body["model"] == "gemini-x"


@pytest.mark.asyncio
async def test_build_from_settings_cloud_without_api_key_returns_none():
    config = {"knowledge_base": {"llm": {"backend": "cloud"}}}

    with (
        patch(
            "backend.services.llm_client.load_config",
            new_callable=AsyncMock,
            return_value=config,
        ),
        patch("backend.services.llm_client.get_token_manager") as mock_tm,
    ):
        mock_tm.return_value.store.load.return_value = None
        client = await build_llm_client_from_settings()

    assert client is None


@respx.mock
@pytest.mark.asyncio
async def test_build_from_settings_local_returns_client_without_api_key():
    config = {
        "knowledge_base": {
            "llm": {
                "backend": "local",
                "base_url": "http://localhost:9999/v1",
                "model": "llama3",
            }
        }
    }
    route = respx.post("http://localhost:9999/v1/chat/completions").mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )

    with patch(
        "backend.services.llm_client.load_config",
        new_callable=AsyncMock,
        return_value=config,
    ):
        client = await build_llm_client_from_settings()
        assert client is not None
        await client.chat([{"role": "user", "content": "hi"}])

    headers = route.calls[0].request.headers
    assert "Authorization" not in headers


@respx.mock
@pytest.mark.asyncio
async def test_build_from_settings_defaults_to_cloud_when_knowledge_base_missing():
    """Task 4 (settings defaults) hasn't landed yet -- reads must fall back gracefully."""
    route = respx.post(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    ).mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )

    with (
        patch(
            "backend.services.llm_client.load_config",
            new_callable=AsyncMock,
            return_value={},
        ),
        patch("backend.services.llm_client.get_token_manager") as mock_tm,
    ):
        mock_tm.return_value.store.load.return_value = {"api_key": "k"}
        client = await build_llm_client_from_settings()
        assert client is not None
        await client.chat([{"role": "user", "content": "hi"}])

    body = json.loads(route.calls[0].request.content)
    assert body["model"] == "gemini-2.5-flash"


@respx.mock
@pytest.mark.asyncio
async def test_build_from_settings_local_defaults_when_partial_config():
    """A `local` backend with no `base_url`/`model` set falls back to Ollama defaults."""
    route = respx.post("http://localhost:11434/v1/chat/completions").mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )

    with patch(
        "backend.services.llm_client.load_config",
        new_callable=AsyncMock,
        return_value={"knowledge_base": {"llm": {"backend": "local"}}},
    ):
        client = await build_llm_client_from_settings()
        assert client is not None
        await client.chat([{"role": "user", "content": "hi"}])

    body = json.loads(route.calls[0].request.content)
    assert body["model"] == "qwen2.5:14b"


# --- `on_request` usage-tracking hook (Product-wave Task 5, item 3) ------------------------


@respx.mock
@pytest.mark.asyncio
async def test_chat_success_calls_on_request_with_success_outcome():
    respx.post(CHAT_URL).mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )
    calls: list[tuple[str, str]] = []
    client = OpenAICompatLLMClient(
        base_url="http://localhost:11434/v1",
        model="qwen3:30b",
        on_request=lambda model, outcome: calls.append((model, outcome)),
    )
    await client.chat([{"role": "user", "content": "hi"}])

    assert calls == [("qwen3:30b", "success")]


@respx.mock
@pytest.mark.asyncio
async def test_chat_429_calls_on_request_with_quota_exceeded_outcome():
    respx.post(CHAT_URL).mock(return_value=httpx.Response(429, text="rate limited"))
    calls: list[tuple[str, str]] = []
    client = OpenAICompatLLMClient(
        base_url="http://localhost:11434/v1",
        model="qwen3:30b",
        on_request=lambda model, outcome: calls.append((model, outcome)),
    )
    with pytest.raises(LLMBackendError):
        await client.chat([{"role": "user", "content": "hi"}])

    assert calls == [("qwen3:30b", "quota_exceeded")]


@respx.mock
@pytest.mark.asyncio
async def test_chat_non_quota_error_does_not_call_on_request():
    """A connect error / auth failure / non-429 error never actually
    consumed provider quota -- must not be recorded."""
    respx.post(CHAT_URL).mock(return_value=httpx.Response(401, text="unauthorized"))
    calls: list[tuple[str, str]] = []
    client = OpenAICompatLLMClient(
        base_url="http://localhost:11434/v1",
        model="m",
        on_request=lambda model, outcome: calls.append((model, outcome)),
    )
    with pytest.raises(LLMBackendError):
        await client.chat([{"role": "user", "content": "hi"}])

    assert calls == []


@respx.mock
@pytest.mark.asyncio
async def test_chat_connect_error_does_not_call_on_request():
    respx.post(CHAT_URL).mock(side_effect=httpx.ConnectError("refused"))
    calls: list[tuple[str, str]] = []
    client = OpenAICompatLLMClient(
        base_url="http://localhost:11434/v1",
        model="m",
        on_request=lambda model, outcome: calls.append((model, outcome)),
    )
    with pytest.raises(LLMBackendError):
        await client.chat([{"role": "user", "content": "hi"}])

    assert calls == []


@respx.mock
@pytest.mark.asyncio
async def test_chat_without_on_request_configured_is_a_silent_noop():
    respx.post(CHAT_URL).mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )
    client = OpenAICompatLLMClient(base_url="http://localhost:11434/v1", model="m")
    resp = await client.chat([{"role": "user", "content": "hi"}])
    assert resp.text == "ok"


@respx.mock
@pytest.mark.asyncio
async def test_chat_on_request_callback_raising_does_not_break_a_successful_chat():
    """A broken usage-tracking callback must never turn a successful chat()
    into a crash -- logged and swallowed."""
    respx.post(CHAT_URL).mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )

    def _boom(model: str, outcome: str) -> None:
        raise RuntimeError("usage db is on fire")

    client = OpenAICompatLLMClient(
        base_url="http://localhost:11434/v1", model="m", on_request=_boom
    )
    resp = await client.chat([{"role": "user", "content": "hi"}])
    assert resp.text == "ok"


@respx.mock
@pytest.mark.asyncio
async def test_build_from_settings_wires_on_request_into_the_built_client():
    config = {
        "knowledge_base": {
            "llm": {
                "backend": "local",
                "base_url": "http://localhost:9999/v1",
                "model": "m",
            }
        }
    }
    respx.post("http://localhost:9999/v1/chat/completions").mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )
    calls: list[tuple[str, str]] = []

    with patch(
        "backend.services.llm_client.load_config",
        new_callable=AsyncMock,
        return_value=config,
    ):
        client = await build_llm_client_from_settings(
            on_request=lambda model, outcome: calls.append((model, outcome))
        )
        assert client is not None
        await client.chat([{"role": "user", "content": "hi"}])

    assert calls == [("m", "success")]


# --- `build_llm_client_from_draft` (Product-wave Task 5, item 2) --------------------------


@respx.mock
@pytest.mark.asyncio
async def test_build_from_draft_local_never_reads_settings_or_keyring():
    respx.post("http://localhost:9999/v1/chat/completions").mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )
    with patch(
        "backend.services.llm_client.load_config",
        new_callable=AsyncMock,
        side_effect=AssertionError("must not read settings for a draft client"),
    ):
        client = await build_llm_client_from_draft(
            "local", "http://localhost:9999/v1", "m"
        )
        resp = await client.chat([{"role": "user", "content": "hi"}])
    assert resp.text == "ok"


@respx.mock
@pytest.mark.asyncio
async def test_build_from_draft_local_backend_never_attaches_a_key():
    """Sanity: `backend == "local"` never even looks at the trusted-host
    allow-list -- `api_key` is always `None`, unconditionally."""
    route = respx.post("http://localhost:9999/v1/chat/completions").mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )
    client = await build_llm_client_from_draft("local", "http://localhost:9999/v1", "m")
    await client.chat([{"role": "user", "content": "hi"}])

    assert "Authorization" not in route.calls[0].request.headers


@respx.mock
@pytest.mark.asyncio
async def test_build_from_draft_refuses_key_for_unknown_host():
    """P-5 review, Finding 1 (IMPORTANT -- exfiltration oracle): a draft
    `base_url` on a host the user hasn't already committed to (via the known
    Gemini endpoint, or a previously-Saved cloud base_url) must NEVER receive
    the real keyring API key -- otherwise the Test button lets anyone who can
    reach this endpoint redirect the user's real key to an arbitrary host
    just by typing it into the settings form."""
    route = respx.post("https://example.test/v1/chat/completions").mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )
    with (
        patch(
            "backend.services.llm_client.load_config",
            new_callable=AsyncMock,
            return_value={},  # defaults resolve to the Gemini host, not example.test
        ),
        patch("backend.services.llm_client.get_token_manager") as mock_tm,
    ):
        mock_tm.return_value.store.load.return_value = {"api_key": "secret-key"}
        client = await build_llm_client_from_draft(
            "cloud", "https://example.test/v1", "gemini-x"
        )
        await client.chat([{"role": "user", "content": "hi"}])

    assert "Authorization" not in route.calls[0].request.headers
    # The keyring is never even consulted for an untrusted host.
    mock_tm.assert_not_called()


@respx.mock
@pytest.mark.asyncio
async def test_build_from_draft_refuses_key_for_lookalike_host():
    """A host that merely embeds the trusted Gemini hostname as a substring
    (a spoofed subdomain) must not be trusted -- exact hostname equality
    only, never substring/`endswith` matching."""
    lookalike = "generativelanguage.googleapis.com.evil.example"
    route = respx.post(f"https://{lookalike}/v1/chat/completions").mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )
    with (
        patch(
            "backend.services.llm_client.load_config",
            new_callable=AsyncMock,
            return_value={},
        ),
        patch("backend.services.llm_client.get_token_manager") as mock_tm,
    ):
        mock_tm.return_value.store.load.return_value = {"api_key": "secret-key"}
        client = await build_llm_client_from_draft(
            "cloud", f"https://{lookalike}/v1", "gemini-2.5-flash"
        )
        await client.chat([{"role": "user", "content": "hi"}])

    assert "Authorization" not in route.calls[0].request.headers


@respx.mock
@pytest.mark.asyncio
async def test_build_from_draft_gemini_host_always_trusted_even_when_saved_backend_is_local():
    route = respx.post(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    ).mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )
    with (
        patch(
            "backend.services.llm_client.load_config",
            new_callable=AsyncMock,
            return_value={
                "knowledge_base": {
                    "llm": {"backend": "local", "base_url": "http://localhost:11434/v1"}
                }
            },
        ),
        patch("backend.services.llm_client.get_token_manager") as mock_tm,
    ):
        mock_tm.return_value.store.load.return_value = {"api_key": "secret-key"}
        client = await build_llm_client_from_draft(
            "cloud",
            "https://generativelanguage.googleapis.com/v1beta/openai",
            "gemini-2.5-flash",
        )
        await client.chat([{"role": "user", "content": "hi"}])

    assert route.calls[0].request.headers["Authorization"] == "Bearer secret-key"


@respx.mock
@pytest.mark.asyncio
async def test_build_from_draft_attaches_key_when_host_matches_saved_cloud_base_url():
    """A draft `base_url` on the SAME host as the currently-saved cloud
    base_url is trusted -- the user already committed to this host via Save
    (e.g. a legit custom OpenAI-compatible proxy), so re-testing an edit to
    path/query on that same host shouldn't require a Save round-trip first."""
    saved_config = {
        "knowledge_base": {
            "llm": {
                "backend": "cloud",
                "base_url": "https://my-proxy.example.com/v1",
                "model": "gemini-x",
            }
        }
    }
    route = respx.post("https://my-proxy.example.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )
    with (
        patch(
            "backend.services.llm_client.load_config",
            new_callable=AsyncMock,
            return_value=saved_config,
        ),
        patch("backend.services.llm_client.get_token_manager") as mock_tm,
    ):
        mock_tm.return_value.store.load.return_value = {"api_key": "secret-key"}
        client = await build_llm_client_from_draft(
            "cloud", "https://my-proxy.example.com/v1", "gemini-x"
        )
        await client.chat([{"role": "user", "content": "hi"}])

    assert route.calls[0].request.headers["Authorization"] == "Bearer secret-key"


@respx.mock
@pytest.mark.asyncio
async def test_build_from_draft_refuses_key_when_saved_backend_is_local_even_if_host_matches():
    """The saved `base_url` only counts as a trusted CLOUD host when the
    saved `backend` is itself `"cloud"` -- `base_url` is a single settings
    field shared by both backends, so when the saved backend is `"local"`
    that field holds a local server URL the user never committed to for
    cloud traffic, even if a draft happens to share its host string."""
    route = respx.post("https://example.test/v1/chat/completions").mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )
    with (
        patch(
            "backend.services.llm_client.load_config",
            new_callable=AsyncMock,
            return_value={
                "knowledge_base": {
                    "llm": {"backend": "local", "base_url": "https://example.test/v1"}
                }
            },
        ),
        patch("backend.services.llm_client.get_token_manager") as mock_tm,
    ):
        mock_tm.return_value.store.load.return_value = {"api_key": "secret-key"}
        client = await build_llm_client_from_draft(
            "cloud", "https://example.test/v1", "m"
        )
        await client.chat([{"role": "user", "content": "hi"}])

    assert "Authorization" not in route.calls[0].request.headers


# --- `_url_scheme_allows_key` (final review, Finding 2) --------------------------------


def test_url_scheme_allows_key_https_trusted_host_returns_true():
    from backend.services.llm_client import _url_scheme_allows_key

    assert (
        _url_scheme_allows_key(
            "https://generativelanguage.googleapis.com/v1beta/openai"
        )
        is True
    )


def test_url_scheme_allows_key_http_non_local_host_returns_false():
    """A plain-HTTP URL to a real (non-loopback) host must never receive the
    real key -- it would traverse the network in cleartext even if the host
    itself is otherwise "trusted" by hostname."""
    from backend.services.llm_client import _url_scheme_allows_key

    assert (
        _url_scheme_allows_key("http://generativelanguage.googleapis.com/v1beta/openai")
        is False
    )


def test_url_scheme_allows_key_http_localhost_returns_true():
    from backend.services.llm_client import _url_scheme_allows_key

    assert _url_scheme_allows_key("http://localhost:11434/v1") is True


def test_url_scheme_allows_key_http_127_0_0_1_returns_true():
    from backend.services.llm_client import _url_scheme_allows_key

    assert _url_scheme_allows_key("http://127.0.0.1:11434/v1") is True


def test_url_scheme_allows_key_unparseable_url_returns_false():
    from backend.services.llm_client import _url_scheme_allows_key

    assert _url_scheme_allows_key("not a url at all") is False


@respx.mock
@pytest.mark.asyncio
async def test_build_from_settings_cloud_http_non_local_base_url_refuses_key_and_returns_none():
    """Final-review Finding 2: a saved `cloud` base_url that is plain HTTP
    (and not loopback) must never get the real keyring key attached -- treated
    the same as "no key available" (returns `None`) rather than silently
    building a client that would send the key in cleartext."""
    config = {
        "knowledge_base": {
            "llm": {
                "backend": "cloud",
                "base_url": "http://example.test/v1",
                "model": "gemini-x",
            }
        }
    }
    with (
        patch(
            "backend.services.llm_client.load_config",
            new_callable=AsyncMock,
            return_value=config,
        ),
        patch("backend.services.llm_client.get_token_manager") as mock_tm,
    ):
        mock_tm.return_value.store.load.return_value = {"api_key": "secret-key"}
        client = await build_llm_client_from_settings()

    assert client is None
    # The keyring is never even consulted for an untrusted scheme/host.
    mock_tm.assert_not_called()


@respx.mock
@pytest.mark.asyncio
async def test_build_from_settings_cloud_http_localhost_base_url_attaches_key():
    """The loopback-HTTP carve-out (a local proxy) applies to the saved-config
    path too, not just the draft-config probe."""
    config = {
        "knowledge_base": {
            "llm": {
                "backend": "cloud",
                "base_url": "http://localhost:9999/v1",
                "model": "gemini-x",
            }
        }
    }
    route = respx.post("http://localhost:9999/v1/chat/completions").mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )
    with (
        patch(
            "backend.services.llm_client.load_config",
            new_callable=AsyncMock,
            return_value=config,
        ),
        patch("backend.services.llm_client.get_token_manager") as mock_tm,
    ):
        mock_tm.return_value.store.load.return_value = {"api_key": "secret-key"}
        client = await build_llm_client_from_settings()
        assert client is not None
        await client.chat([{"role": "user", "content": "hi"}])

    assert route.calls[0].request.headers["Authorization"] == "Bearer secret-key"


@respx.mock
@pytest.mark.asyncio
async def test_build_from_draft_refuses_key_for_http_scheme_on_an_otherwise_trusted_host():
    """The trusted-Gemini-host draft path (see
    `test_build_from_draft_gemini_host_always_trusted_even_when_saved_backend_is_local`)
    must still refuse the key when the draft URL's scheme is downgraded to
    plain HTTP -- hostname trust alone is not enough."""
    route = respx.post(
        "http://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    ).mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )
    with (
        patch(
            "backend.services.llm_client.load_config",
            new_callable=AsyncMock,
            return_value={},
        ),
        patch("backend.services.llm_client.get_token_manager") as mock_tm,
    ):
        mock_tm.return_value.store.load.return_value = {"api_key": "secret-key"}
        client = await build_llm_client_from_draft(
            "cloud",
            "http://generativelanguage.googleapis.com/v1beta/openai",
            "gemini-2.5-flash",
        )
        await client.chat([{"role": "user", "content": "hi"}])

    assert "Authorization" not in route.calls[0].request.headers


@respx.mock
@pytest.mark.asyncio
async def test_build_from_draft_attaches_key_for_http_localhost_matching_saved_host():
    """`http://localhost` is trusted for the draft path too (a local proxy
    saved as the `cloud` backend), as long as its host also matches the
    saved cloud base_url -- same host-matching rule as any other draft host,
    just with the loopback-HTTP scheme carve-out applied."""
    saved_config = {
        "knowledge_base": {
            "llm": {
                "backend": "cloud",
                "base_url": "http://localhost:9999/v1",
                "model": "gemini-x",
            }
        }
    }
    route = respx.post("http://localhost:9999/v1/chat/completions").mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )
    with (
        patch(
            "backend.services.llm_client.load_config",
            new_callable=AsyncMock,
            return_value=saved_config,
        ),
        patch("backend.services.llm_client.get_token_manager") as mock_tm,
    ):
        mock_tm.return_value.store.load.return_value = {"api_key": "secret-key"}
        client = await build_llm_client_from_draft(
            "cloud", "http://localhost:9999/v1", "gemini-x"
        )
        await client.chat([{"role": "user", "content": "hi"}])

    assert route.calls[0].request.headers["Authorization"] == "Bearer secret-key"


def test_extract_host_lowercases_and_ignores_port():
    from backend.services.llm_client import _extract_host

    assert (
        _extract_host("https://GenerativeLanguage.GoogleAPIs.com:443/v1")
        == "generativelanguage.googleapis.com"
    )


def test_extract_host_returns_none_when_the_url_has_no_host():
    from backend.services.llm_client import _extract_host

    assert _extract_host("not a url at all") is None
    assert _extract_host("") is None


@respx.mock
@pytest.mark.asyncio
async def test_build_from_draft_never_wires_on_request():
    """A config-test round-trip must never be recorded against the usage
    ledger -- proven by asserting the built client's `_on_request` is unset."""
    client = await build_llm_client_from_draft("local", "http://localhost:9999/v1", "m")
    assert client._on_request is None
