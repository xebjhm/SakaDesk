from unittest.mock import patch

import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.api.translation import _provider_http_error
from backend.main import app

client = TestClient(app)


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
