"""The stored LLM key goes only to its own provider's fixed host (security audit 2026-11-13).

report-hardening: test-connection put any model string into the Gemini URL path
and sent the one stored key to whichever provider the request named; the
Files-API delete sent the key to any URI the upload answer contained.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app
from backend.services.transcription_service import (
    GeminiTranscriptionProvider,
    _is_gemini_url,
)

client = TestClient(app)


@pytest.mark.parametrize(
    "model", ["../../v1/files", "gemini-3.1-flash-lite\r\nX: y", "x?key=1"]
)
def test_an_unknown_gemini_model_is_refused_before_any_request(model):
    with (
        patch("backend.api.translation._instantiate_provider") as make,
        capture_logs() as logs,
    ):
        resp = client.post(
            "/api/translation/test-connection",
            json={"provider": "gemini", "model": model, "api_key": "k" * 39},
        )
    assert resp.status_code == 400
    assert resp.json()["code"] == "invalid_model"
    make.assert_not_called()
    assert {
        "event": "translation_test_refused",
        "reason": "model",
        "log_level": "info",
    } in logs


def test_the_stored_key_is_not_sent_to_another_provider():
    with (
        patch(
            "backend.api.translation.load_config",
            new=AsyncMock(return_value={"translation_provider": "gemini"}),
        ),
        patch(
            "backend.api.translation._load_api_key", return_value="AIza-stored"
        ) as load,
        patch("backend.api.translation._instantiate_provider") as make,
        capture_logs() as logs,
    ):
        resp = client.post(
            "/api/translation/test-connection",
            json={"provider": "openai", "model": "gpt-4o-mini"},
        )
    assert resp.json()["code"] == "no_key"
    load.assert_not_called()
    make.assert_not_called()
    assert {
        "event": "translation_test_refused",
        "reason": "provider_mismatch",
        "log_level": "info",
    } in logs


def test_a_key_typed_in_the_request_works_for_any_provider():
    fake = AsyncMock()
    fake.check_connection = AsyncMock(return_value="ok")
    with patch(
        "backend.api.translation._instantiate_provider", return_value=fake
    ) as make:
        resp = client.post(
            "/api/translation/test-connection",
            json={"provider": "openai", "model": "gpt-4o-mini", "api_key": "sk-typed"},
        )
    assert resp.json() == {"ok": True}
    make.assert_called_once_with("openai", "gpt-4o-mini", "sk-typed")


@pytest.mark.parametrize(
    "url,ok",
    [
        ("https://generativelanguage.googleapis.com/v1beta/files/abc-123", True),
        ("https://generativelanguage.googleapis.com:443/v1beta/files/a", True),
        ("http://generativelanguage.googleapis.com/v1beta/files/a", False),
        ("https://evil.example/v1beta/files/a", False),
        ("https://generativelanguage.googleapis.com.evil.example/x", False),
        ("https://generativelanguage.googleapis.com:8443/x", False),
        ("https://[::1/x", False),
        (None, False),
    ],
)
def test_is_gemini_url(url, ok):
    assert _is_gemini_url(url) is ok


@pytest.mark.asyncio
async def test_the_files_api_delete_never_sends_the_key_elsewhere():
    http = MagicMock()
    http.delete = AsyncMock(return_value=SimpleNamespace(status_code=204))
    provider = GeminiTranscriptionProvider(api_key="AIza-secret")
    with capture_logs() as logs:
        await provider._delete_file("https://evil.example/files/1", http)
    http.delete.assert_not_called()
    assert {
        "event": "transcription.files_api_delete_skipped",
        "reason": "foreign_url",
        "log_level": "info",
    } in logs
    await provider._delete_file(
        "https://generativelanguage.googleapis.com/v1beta/files/1", http
    )
    http.delete.assert_awaited_once()


def test_a_broken_translation_answer_is_not_logged():
    secret = "PRIVATE MESSAGE TEXT"
    fake = AsyncMock()
    fake.translate = AsyncMock(return_value="not json " + secret)
    with (
        patch(
            "backend.api.translation._get_provider_from_config",
            new=AsyncMock(return_value=fake),
        ),
        capture_logs() as logs,
    ):
        client.post(
            "/api/translation/translate",
            json={
                "type": "blog_full",
                "service": "hinatazaka46",
                "paragraphs": ["a"],
                "target_language": "en",
            },
        )
    assert secret not in repr(logs)
    parse = [e for e in logs if e["event"] == "translation_parse_failed"]
    assert parse and parse[0]["kind"] == "blog" and parse[0]["length"] > 0
