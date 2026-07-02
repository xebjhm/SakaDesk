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
