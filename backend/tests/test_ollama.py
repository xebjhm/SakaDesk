"""Tests for `backend.services.ollama` -- local-server auto-detect (Product-wave
Task 5, item 4). `probe()` never raises; the HTTP layer is mocked with respx
(no real network call), matching `test_llm_client.py`'s conventions.
"""

from __future__ import annotations

import httpx
import pytest
import respx

from backend.services.ollama import probe

_BASE_URL = "http://localhost:11434/v1"


@respx.mock
@pytest.mark.asyncio
async def test_probe_reads_ollama_native_tags_endpoint():
    respx.get("http://localhost:11434/api/tags").mock(
        return_value=httpx.Response(
            200,
            json={
                "models": [
                    {"name": "qwen3:30b"},
                    {"name": "qwen2.5:14b"},
                ]
            },
        )
    )
    result = await probe(_BASE_URL)
    assert result == {"reachable": True, "models": ["qwen3:30b", "qwen2.5:14b"]}


@respx.mock
@pytest.mark.asyncio
async def test_probe_strips_trailing_v1_before_hitting_tags():
    route = respx.get("http://localhost:11434/api/tags").mock(
        return_value=httpx.Response(200, json={"models": []})
    )
    await probe("http://localhost:11434/v1")
    assert route.called
    # Never hit the base_url's own /v1/api/tags (wrong path).
    assert not respx.get("http://localhost:11434/v1/api/tags").called


@respx.mock
@pytest.mark.asyncio
async def test_probe_falls_back_to_openai_compat_v1_models_when_tags_unreachable():
    """llama.cpp / LM Studio don't serve Ollama's native `/api/tags` --
    fall back to the OpenAI-compat `/v1/models` listing."""
    respx.get("http://localhost:8080/api/tags").mock(
        side_effect=httpx.ConnectError("refused")
    )
    respx.get("http://localhost:8080/v1/models").mock(
        return_value=httpx.Response(
            200,
            json={"data": [{"id": "llama-3-8b-instruct"}, {"id": "phi-3-mini"}]},
        )
    )
    result = await probe("http://localhost:8080/v1")
    assert result == {
        "reachable": True,
        "models": ["llama-3-8b-instruct", "phi-3-mini"],
    }


@respx.mock
@pytest.mark.asyncio
async def test_probe_unreachable_on_both_endpoints_reports_not_reachable():
    respx.get("http://localhost:9/api/tags").mock(
        side_effect=httpx.ConnectError("refused")
    )
    respx.get("http://localhost:9/v1/models").mock(
        side_effect=httpx.ConnectError("refused")
    )
    result = await probe("http://localhost:9/v1")
    assert result == {"reachable": False, "models": []}


@respx.mock
@pytest.mark.asyncio
async def test_probe_timeout_on_tags_falls_back_then_reports_unreachable_if_both_timeout():
    respx.get("http://localhost:11434/api/tags").mock(
        side_effect=httpx.ConnectTimeout("slow")
    )
    respx.get("http://localhost:11434/v1/models").mock(
        side_effect=httpx.ConnectTimeout("slow")
    )
    result = await probe(_BASE_URL)
    assert result == {"reachable": False, "models": []}


@respx.mock
@pytest.mark.asyncio
async def test_probe_tags_404_falls_back_to_v1_models():
    respx.get("http://localhost:11434/api/tags").mock(return_value=httpx.Response(404))
    respx.get("http://localhost:11434/v1/models").mock(
        return_value=httpx.Response(200, json={"data": [{"id": "m1"}]})
    )
    result = await probe(_BASE_URL)
    assert result == {"reachable": True, "models": ["m1"]}


@respx.mock
@pytest.mark.asyncio
async def test_probe_malformed_json_on_tags_falls_back_to_v1_models():
    respx.get("http://localhost:11434/api/tags").mock(
        return_value=httpx.Response(200, content=b"not json")
    )
    respx.get("http://localhost:11434/v1/models").mock(
        return_value=httpx.Response(200, json={"data": [{"id": "m1"}]})
    )
    result = await probe(_BASE_URL)
    assert result == {"reachable": True, "models": ["m1"]}


@respx.mock
@pytest.mark.asyncio
async def test_probe_tags_response_missing_models_key_falls_back():
    respx.get("http://localhost:11434/api/tags").mock(
        return_value=httpx.Response(200, json={"unexpected": "shape"})
    )
    respx.get("http://localhost:11434/v1/models").mock(
        return_value=httpx.Response(200, json={"data": [{"id": "m1"}]})
    )
    result = await probe(_BASE_URL)
    assert result == {"reachable": True, "models": ["m1"]}


@respx.mock
@pytest.mark.asyncio
async def test_probe_empty_tags_list_is_still_reachable():
    respx.get("http://localhost:11434/api/tags").mock(
        return_value=httpx.Response(200, json={"models": []})
    )
    result = await probe(_BASE_URL)
    assert result == {"reachable": True, "models": []}


@respx.mock
@pytest.mark.asyncio
async def test_probe_base_url_without_v1_suffix_still_probes_root_tags():
    route = respx.get("http://localhost:11434/api/tags").mock(
        return_value=httpx.Response(200, json={"models": [{"name": "m"}]})
    )
    result = await probe("http://localhost:11434")
    assert route.called
    assert result == {"reachable": True, "models": ["m"]}
