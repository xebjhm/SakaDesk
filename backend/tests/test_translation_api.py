import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.api.translation import _provider_http_error
from backend.main import app

client = TestClient(app)


class _FakeProvider:
    """Provider stub whose translate() returns a preset raw string."""

    def __init__(self, raw: str):
        self._raw = raw

    async def translate(self, prompt, system_instruction=None):
        return self._raw


class TestCodedErrors:
    """AI errors carry a stable `code` (in addition to `detail`) for the UI."""

    def test_provider_error_mapper_codes(self):
        from backend.api.errors import ai_provider_error
        from backend.services.ai_errors import SafetyBlockedError

        def status(code):
            req = httpx.Request("POST", "https://p.example")
            return httpx.HTTPStatusError(
                "x", request=req, response=httpx.Response(code, request=req)
            )

        assert ai_provider_error(status(429)).code == "rate_limit"
        assert ai_provider_error(status(401)).code == "invalid_key"
        assert ai_provider_error(status(403)).code == "invalid_key"
        assert ai_provider_error(status(404)).code == "model_not_found"
        assert ai_provider_error(status(503)).code == "unavailable"
        assert ai_provider_error(httpx.ConnectError("x")).code == "network"
        assert ai_provider_error(httpx.TimeoutException("x")).code == "timeout"
        assert ai_provider_error(SafetyBlockedError("x")).code == "safety_blocked"
        assert ai_provider_error(ValueError("x")).code == "unknown"

    def test_translate_no_provider_returns_code(self):
        with patch(
            "backend.services.settings_store.load_config",
            new=AsyncMock(return_value={}),
        ):
            resp = client.post(
                "/api/translation/translate",
                json={
                    "type": "message",
                    "message_id": 1,
                    "service": "hinatazaka46",
                    "member_path": "x/y",
                    "target_language": "en",
                },
            )
        assert resp.status_code == 400
        assert resp.json()["code"] == "no_provider"

    def test_safety_block_surfaces_code(self):
        from backend.services.ai_errors import SafetyBlockedError

        class _SafetyProvider:
            async def translate(self, prompt, system_instruction=None):
                raise SafetyBlockedError("blocked")

        with patch(
            "backend.api.translation._get_provider_from_config",
            new=AsyncMock(return_value=_SafetyProvider()),
        ):
            resp = client.post(
                "/api/translation/translate",
                json={
                    "type": "blog_full",
                    "service": "hinatazaka46",
                    "paragraphs": ["A"],
                    "target_language": "en",
                },
            )
        assert resp.status_code == 422
        assert resp.json()["code"] == "safety_blocked"


class TestBlogAlignment:
    """blog_full re-aligns a JSON map to source order; omissions stay empty."""

    def test_missing_paragraph_stays_empty_not_shifted(self):
        # 3 source paragraphs; model omits index 1.
        provider = _FakeProvider(json.dumps({"0": "A-en", "2": "C-en"}))
        with patch(
            "backend.api.translation._get_provider_from_config",
            new=AsyncMock(return_value=provider),
        ):
            resp = client.post(
                "/api/translation/translate",
                json={
                    "type": "blog_full",
                    "service": "hinatazaka46",
                    "paragraphs": ["A", "B", "C"],
                    "target_language": "en",
                },
            )
        assert resp.status_code == 200
        body = resp.json()
        # Alignment preserved: C-en stays at index 2, not shifted up to index 1.
        assert body["translations"] == ["A-en", "", "C-en"]
        assert body["partial"] is True

    def test_all_present_is_not_partial(self):
        provider = _FakeProvider(json.dumps({"0": "A-en", "1": "B-en"}))
        with patch(
            "backend.api.translation._get_provider_from_config",
            new=AsyncMock(return_value=provider),
        ):
            resp = client.post(
                "/api/translation/translate",
                json={
                    "type": "blog_full",
                    "service": "hinatazaka46",
                    "paragraphs": ["A", "B"],
                    "target_language": "en",
                },
            )
        assert resp.json()["translations"] == ["A-en", "B-en"]
        assert resp.json()["partial"] is False


class TestBatchMissing:
    """translate-batch reports message IDs the model silently dropped."""

    def test_missing_ids_surfaced(self, tmp_path, monkeypatch):
        member_rel = "日向坂46/messages/34 金村 美玖/58 金村 美玖"
        member_dir = tmp_path / member_rel
        member_dir.mkdir(parents=True)
        (member_dir / "messages.json").write_text(
            json.dumps(
                {
                    "messages": [
                        {"id": 1, "content": "おはよう"},
                        {"id": 2, "content": "こんにちは"},
                    ]
                }
            ),
            encoding="utf-8",
        )
        monkeypatch.setattr("backend.api.translation.get_output_dir", lambda: tmp_path)
        # Model returns only id 1; id 2 is silently dropped.
        provider = _FakeProvider(json.dumps({"1": "morning"}))
        with patch(
            "backend.api.translation._get_provider_from_config",
            new=AsyncMock(return_value=provider),
        ):
            resp = client.post(
                "/api/translation/translate-batch",
                json={
                    "type": "messages",
                    "message_ids": [1, 2],
                    "service": "hinatazaka46",
                    "member_path": member_rel,
                    "target_language": "en",
                },
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["translations"] == {"1": "morning"}
        assert body["missing"] == ["2"]


class TestProviderModelRepair:
    """SD-BE-API-08: the stale-model repair must not force a Gemini model id onto
    a non-Gemini provider."""

    @pytest.mark.asyncio
    async def test_openai_model_not_repaired_to_gemini(self):
        from backend.api import translation as translation_api

        with patch(
            "backend.api.translation.load_config",
            new=AsyncMock(
                return_value={
                    "translation_provider": "openai",
                    "translation_model": "gpt-4o-mini",
                }
            ),
        ):
            with patch(
                "backend.api.translation._load_api_key", return_value="k"
            ):
                provider = await translation_api._get_provider_from_config()

        # The configured OpenAI model must be preserved, not overwritten with the
        # default Gemini model id (which would 404 at api.openai.com).
        assert isinstance(provider, translation_api.OpenAIProvider)
        assert provider._model == "gpt-4o-mini"

    @pytest.mark.asyncio
    async def test_gemini_stale_model_still_repaired(self):
        from backend.api import translation as translation_api

        with patch(
            "backend.api.translation.load_config",
            new=AsyncMock(
                return_value={
                    "translation_provider": "gemini",
                    "translation_model": "gemini-obsolete-preview",
                }
            ),
        ):
            with patch(
                "backend.api.translation._load_api_key", return_value="k"
            ):
                provider = await translation_api._get_provider_from_config()

        assert isinstance(provider, translation_api.GeminiProvider)
        assert provider._model == translation_api.DEFAULT_GEMINI_MODEL


class TestBatchPlaceholders:
    """SD-BE-API-09: batch translate must apply the same %%% nickname-placeholder
    handling the single-message path does."""

    def test_batch_tokenizes_and_restores_nickname(self, tmp_path, monkeypatch):
        from backend.api import translation as translation_api

        member_rel = "日向坂46/messages/34 金村 美玖/58 金村 美玖"
        member_dir = tmp_path / member_rel
        member_dir.mkdir(parents=True)
        # Message content carries the raw %%% placeholder.
        (member_dir / "messages.json").write_text(
            json.dumps({"messages": [{"id": 1, "content": "%%%おはよう"}]}),
            encoding="utf-8",
        )
        monkeypatch.setattr(
            "backend.api.translation.get_output_dir", lambda: tmp_path
        )

        captured: dict = {}

        class _CapturingProvider:
            async def translate(self, prompt, system_instruction=None):
                captured["prompt"] = prompt
                # The model is instructed to preserve {{NICKNAME}}; echo it back.
                return json.dumps({"1": "{{NICKNAME}} good morning"})

        with patch(
            "backend.api.translation._get_provider_from_config",
            new=AsyncMock(return_value=_CapturingProvider()),
        ):
            resp = client.post(
                "/api/translation/translate-batch",
                json={
                    "type": "messages",
                    "message_ids": [1],
                    "service": "hinatazaka46",
                    "member_path": member_rel,
                    "target_language": "en",
                    "user_nickname": "みく",
                },
            )

        assert resp.status_code == 200
        body = resp.json()
        # The raw %%% must be tokenized (never sent verbatim) to the LLM ...
        assert "%%%" not in captured["prompt"]
        assert translation_api._NICKNAME_TOKEN in captured["prompt"]
        # ... and the nickname restored in the returned translation.
        assert body["translations"]["1"] == "みく good morning"
        assert translation_api._NICKNAME_TOKEN not in body["translations"]["1"]

    def test_batch_no_nickname_leaves_placeholder_raw(self, tmp_path, monkeypatch):
        """Regression: with NO nickname configured, %%% must NOT be tokenized —
        otherwise the unrestored {{NICKNAME}} token leaks into the user-visible
        translation instead of the original placeholder."""
        from backend.api import translation as translation_api

        member_rel = "日向坂46/messages/34 金村 美玖/58 金村 美玖"
        member_dir = tmp_path / member_rel
        member_dir.mkdir(parents=True)
        (member_dir / "messages.json").write_text(
            json.dumps({"messages": [{"id": 1, "content": "%%%おはよう"}]}),
            encoding="utf-8",
        )
        monkeypatch.setattr(
            "backend.api.translation.get_output_dir", lambda: tmp_path
        )

        captured: dict = {}

        class _CapturingProvider:
            async def translate(self, prompt, system_instruction=None):
                captured["prompt"] = prompt
                return json.dumps({"1": "good morning"})

        with patch(
            "backend.api.translation._get_provider_from_config",
            new=AsyncMock(return_value=_CapturingProvider()),
        ):
            resp = client.post(
                "/api/translation/translate-batch",
                json={
                    "type": "messages",
                    "message_ids": [1],
                    "service": "hinatazaka46",
                    "member_path": member_rel,
                    "target_language": "en",
                    # no user_nickname configured
                },
            )

        assert resp.status_code == 200
        body = resp.json()
        # No nickname -> %%% left raw, the {{NICKNAME}} token never appears.
        assert translation_api._NICKNAME_TOKEN not in captured["prompt"]
        assert "%%%" in captured["prompt"]
        assert translation_api._NICKNAME_TOKEN not in body["translations"]["1"]


class TestTestConnectionCodes:
    """test-connection distinguishes a rejected key from an unreachable host."""

    @pytest.mark.parametrize(
        "status,code",
        [("auth", "auth"), ("unreachable", "unreachable")],
    )
    def test_status_maps_to_code(self, status, code):
        fake = AsyncMock()
        fake.check_connection = AsyncMock(return_value=status)
        with (
            patch("backend.api.translation._load_api_key", return_value="k"),
            patch("backend.api.translation._instantiate_provider", return_value=fake),
        ):
            resp = client.post(
                "/api/translation/test-connection",
                json={"provider": "gemini", "model": "gemini-3.1-flash-lite"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is False
        assert body["code"] == code

    def test_ok_status(self):
        fake = AsyncMock()
        fake.check_connection = AsyncMock(return_value="ok")
        with (
            patch("backend.api.translation._load_api_key", return_value="k"),
            patch("backend.api.translation._instantiate_provider", return_value=fake),
        ):
            resp = client.post(
                "/api/translation/test-connection",
                json={"provider": "gemini", "model": "gemini-3.1-flash-lite"},
            )
        assert resp.json() == {"ok": True}


def _status_error(code: int) -> httpx.HTTPStatusError:
    req = httpx.Request("POST", "https://provider.example/v1")
    resp = httpx.Response(code, request=req)
    return httpx.HTTPStatusError("boom", request=req, response=resp)


class TestProviderHttpError:
    """The shared, provider-agnostic error mapper used by every translate branch."""

    def test_rate_limit_maps_to_429(self):
        exc = _provider_http_error(_status_error(429))
        assert isinstance(exc, HTTPException)
        assert exc.status_code == 429

    def test_unavailable_maps_to_503(self):
        assert _provider_http_error(_status_error(503)).status_code == 503

    def test_other_status_maps_to_502(self):
        exc = _provider_http_error(_status_error(400))
        assert exc.status_code == 502
        # provider-agnostic: must not hardcode a specific vendor name
        assert "gemini" not in str(exc.detail).lower()

    def test_connect_error_maps_to_503(self):
        assert _provider_http_error(httpx.ConnectError("no route")).status_code == 503

    def test_timeout_maps_to_504(self):
        assert _provider_http_error(httpx.TimeoutException("slow")).status_code == 504

    def test_generic_error_maps_to_500_without_leaking_detail(self):
        exc = _provider_http_error(ValueError("internal secret detail"))
        assert exc.status_code == 500
        assert "internal secret detail" not in str(exc.detail)


def test_translation_routes_registered():
    """Translation configure endpoint should be accessible."""
    response = client.post(
        "/api/translation/configure",
        json={
            "provider": "gemini",
            "model": "gemini-3.1-flash-lite",
            "api_key": "test-key",
            "target_language": "en",
        },
    )
    assert response.status_code == 200


class TestConfigurePatchSemantics:
    """SD-BE-API-10: /configure only writes fields the caller sent; a partial
    update must not null provider/model or delete the stored API key."""

    def test_partial_update_does_not_delete_key_or_clobber_fields(self):
        writes: dict = {"translation_provider": "gemini", "translation_model": "m"}

        async def fake_update(fn):
            fn(writes)

        with (
            patch("backend.api.translation.update_config", new=fake_update),
            patch("backend.api.translation._delete_api_key") as mock_delete,
            patch("backend.api.translation._save_api_key") as mock_save,
        ):
            resp = client.post(
                "/api/translation/configure",
                json={"target_language": "en"},  # only target_language sent
            )
        assert resp.status_code == 200
        # Provider/model left intact ...
        assert writes["translation_provider"] == "gemini"
        assert writes["translation_model"] == "m"
        assert writes["translation_target_language"] == "en"
        # ... and the API key is neither saved nor deleted on a partial update.
        mock_delete.assert_not_called()
        mock_save.assert_not_called()

    def test_explicit_null_provider_clears_key(self):
        async def fake_update(fn):
            fn({})

        with (
            patch("backend.api.translation.update_config", new=fake_update),
            patch("backend.api.translation._delete_api_key") as mock_delete,
        ):
            resp = client.post(
                "/api/translation/configure",
                json={"provider": None},  # explicit clear
            )
        assert resp.status_code == 200
        mock_delete.assert_called_once()


def test_clear_api_key_endpoint():
    """POST /api/translation/clear-api-key removes the stored key and returns ok."""
    with patch("backend.api.translation._delete_api_key") as mock_delete:
        response = client.post("/api/translation/clear-api-key")
        assert response.status_code == 200
        assert response.json() == {"ok": True}
        mock_delete.assert_called_once()


def test_translate_requires_fields():
    """POST /api/translation/translate requires all fields."""
    response = client.post("/api/translation/translate", json={})
    assert response.status_code == 422


def test_translate_batch_requires_fields():
    """POST /api/translation/translate-batch requires all fields."""
    response = client.post("/api/translation/translate-batch", json={})
    assert response.status_code == 422


def test_translate_rejects_unconfigured_provider():
    """Translation should fail when no provider is configured."""
    client.post(
        "/api/translation/configure",
        json={
            "provider": None,
            "model": None,
            "api_key": None,
            "target_language": "en",
        },
    )
    response = client.post(
        "/api/translation/translate",
        json={
            "type": "message",
            "message_id": 1,
            "service": "hinatazaka46",
            "member_path": "日向坂46/messages/34 金村 美玖/58 金村 美玖",
            "target_language": "en",
        },
    )
    assert response.status_code == 400
    assert "provider" in response.json()["detail"].lower()
