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
