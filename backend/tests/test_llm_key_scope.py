"""The stored LLM key goes only to its own provider's fixed host (security audit 2026-11-13).

report-hardening: test-connection put any model string into the Gemini URL path
and sent the one stored key to whichever provider the request named; the
Files-API delete sent the key to any URI the upload answer contained.
"""

from __future__ import annotations

import asyncio
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
            "backend.api.translation._load_api_key_for", return_value="AIza-stored"
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


# --- Fix round 1: the key is bound to the provider it was saved for ---------

import httpx  # noqa: E402

from backend.api import translation as translation_api  # noqa: E402
from backend.api import transcription as transcription_api  # noqa: E402
from backend.services.translation_service import (  # noqa: E402
    GeminiProvider,
    OpenAIProvider,
)

GEMINI_HOST = "generativelanguage.googleapis.com"
GEMINI_KEY = "AIza-dummy-gemini-key"
OPENAI_KEY = "sk-dummy-openai-key"


@pytest.fixture
def wire(monkeypatch):
    """Record every outgoing httpx request; answer 200 to all of them."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"data": []})

    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", factory)
    return seen


@pytest.fixture
def settings(monkeypatch):
    """In-memory settings.json; the credential store is the suite's fake keyring."""
    cfg: dict = {}

    async def fake_load():
        return dict(cfg)

    async def fake_update(fn):
        fn(cfg)

    monkeypatch.setattr(translation_api, "load_config", fake_load)
    monkeypatch.setattr(translation_api, "update_config", fake_update)
    translation_api._delete_api_key()
    yield cfg
    translation_api._delete_api_key()


def _carried(request: httpx.Request, key: str) -> bool:
    blob = repr(dict(request.headers)) + str(request.url) + request.content.decode()
    return key in blob


def test_switching_provider_without_a_key_clears_the_stored_key(settings, wire):
    client.post(
        "/api/translation/configure",
        json={
            "provider": "gemini",
            "model": "gemini-3.1-flash-lite",
            "api_key": GEMINI_KEY,
        },
    )
    assert translation_api._load_api_key() == GEMINI_KEY
    client.post("/api/translation/configure", json={"provider": "openai"})
    assert translation_api._load_api_key() is None
    resp = client.post(
        "/api/translation/test-connection",
        json={"provider": "openai", "model": "gpt-4o-mini"},
    )
    assert resp.json()["code"] == "no_key"
    assert wire == []


def test_reconfiguring_the_same_provider_keeps_the_key(settings):
    client.post(
        "/api/translation/configure",
        json={
            "provider": "gemini",
            "model": "gemini-3.1-flash-lite",
            "api_key": GEMINI_KEY,
        },
    )
    client.post(
        "/api/translation/configure",
        json={"provider": "gemini", "target_language": "en"},
    )
    assert translation_api._load_api_key() == GEMINI_KEY


def test_a_key_saved_for_one_provider_is_never_sent_to_the_other(settings, wire):
    translation_api._save_api_key(GEMINI_KEY, "gemini")
    settings["translation_provider"] = "openai"  # settings drifted from the key
    resp = client.post(
        "/api/translation/test-connection",
        json={"provider": "openai", "model": "gpt-4o-mini"},
    )
    assert resp.json()["code"] == "no_key"
    with pytest.raises(translation_api.CodedHTTPException):
        asyncio.run(translation_api._get_provider_from_config())
    assert wire == []


def test_test_connection_sends_each_key_only_to_its_own_host(settings, wire):
    translation_api._save_api_key(OPENAI_KEY, "openai")
    settings["translation_provider"] = "openai"
    client.post(
        "/api/translation/test-connection",
        json={"provider": "openai", "model": "gpt-4o-mini"},
    )
    translation_api._save_api_key(GEMINI_KEY, "gemini")
    settings["translation_provider"] = "gemini"
    client.post(
        "/api/translation/test-connection",
        json={"provider": "gemini", "model": "gemini-3.1-flash-lite"},
    )
    assert [r.url.host for r in wire] == ["api.openai.com", GEMINI_HOST]
    assert wire[0].headers["authorization"] == f"Bearer {OPENAI_KEY}"
    assert "x-goog-api-key" not in wire[0].headers
    assert wire[1].headers["x-goog-api-key"] == GEMINI_KEY
    assert "authorization" not in wire[1].headers
    for r in wire:
        other = GEMINI_KEY if r.url.host == "api.openai.com" else OPENAI_KEY
        assert not _carried(r, other)


def test_a_typed_key_is_sent_only_to_the_requested_provider(settings, wire):
    client.post(
        "/api/translation/test-connection",
        json={"provider": "openai", "model": "gpt-4o-mini", "api_key": OPENAI_KEY},
    )
    assert [r.url.host for r in wire] == ["api.openai.com"]
    assert wire[0].headers["authorization"] == f"Bearer {OPENAI_KEY}"


def test_a_key_stored_before_the_provider_was_recorded_binds_to_the_saved_provider(
    settings, wire
):
    from pysaka.credentials import get_token_manager

    get_token_manager().store.save("llm_provider_api_key", {"api_key": GEMINI_KEY})
    settings["translation_provider"] = "gemini"
    resp = client.post(
        "/api/translation/test-connection",
        json={"provider": "gemini", "model": "gemini-3.1-flash-lite"},
    )
    assert resp.json() == {"ok": True}
    assert wire[0].headers["x-goog-api-key"] == GEMINI_KEY
    data = get_token_manager().store.load("llm_provider_api_key")
    assert data["provider"] == "gemini"


def test_an_unrecorded_key_with_no_saved_provider_is_not_used(settings, wire):
    from pysaka.credentials import get_token_manager

    get_token_manager().store.save("llm_provider_api_key", {"api_key": GEMINI_KEY})
    assert transcription_api._get_gemini_api_key(None) is None
    assert transcription_api._get_gemini_api_key("openai") is None  # binds to openai
    assert transcription_api._get_gemini_api_key("gemini") is None


def test_transcription_uses_only_a_gemini_bound_key(settings):
    translation_api._save_api_key(OPENAI_KEY, "openai")
    assert transcription_api._get_gemini_api_key("openai") is None
    assert transcription_api._get_gemini_api_key(None) is None
    translation_api._save_api_key(GEMINI_KEY, "gemini")
    assert transcription_api._get_gemini_api_key(None) == GEMINI_KEY


# --- Files API: what actually leaves the process ----------------------------


def _recording_client():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            headers={"X-Goog-Upload-URL": "https://evil.example/upload"},
            json={"file": {"uri": "https://evil.example/f"}},
        )

    return seen, httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_delete_to_a_foreign_url_makes_no_request():
    seen, http = _recording_client()
    provider = GeminiTranscriptionProvider(api_key=GEMINI_KEY)
    async with http:
        await provider._delete_file("https://evil.example/files/1", http)
    assert seen == []


@pytest.mark.asyncio
async def test_delete_to_the_gemini_url_carries_the_key_only_there():
    seen, http = _recording_client()
    provider = GeminiTranscriptionProvider(api_key=GEMINI_KEY)
    async with http:
        await provider._delete_file(f"https://{GEMINI_HOST}/v1beta/files/1", http)
    assert [(r.method, r.url.host) for r in seen] == [("DELETE", GEMINI_HOST)]
    assert seen[0].headers["x-goog-api-key"] == GEMINI_KEY


@pytest.mark.asyncio
async def test_audio_is_not_posted_to_a_foreign_upload_url():
    seen, http = _recording_client()
    provider = GeminiTranscriptionProvider(api_key=GEMINI_KEY)
    with capture_logs() as logs:
        async with http:
            with pytest.raises(Exception) as err:
                await provider._upload_file(b"AUDIO-BYTES", "audio/aac", http)
    assert [r.url.host for r in seen] == [GEMINI_HOST]  # only the init call
    assert not any(b"AUDIO-BYTES" in r.content for r in seen)
    assert "evil.example" not in repr(logs) + str(err.value)
    assert {
        "event": "transcription.files_api_upload_refused",
        "reason": "foreign_url",
        "log_level": "info",
    } in logs


@pytest.mark.asyncio
async def test_the_uploaded_file_uri_is_not_logged():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/upload/v1beta/files":
            return httpx.Response(
                200,
                headers={"X-Goog-Upload-URL": f"https://{GEMINI_HOST}/upload/s"},
            )
        return httpx.Response(
            200, json={"file": {"uri": f"https://{GEMINI_HOST}/v1beta/files/SECRET-ID"}}
        )

    provider = GeminiTranscriptionProvider(api_key=GEMINI_KEY)
    with capture_logs() as logs:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            uri = await provider._upload_file(b"x", "audio/aac", http)
    assert uri.endswith("SECRET-ID")
    assert "SECRET-ID" not in repr(logs)


# --- Provider text stays out of logs and responses --------------------------

PRIVATE = "PRIVATE-PROVIDER-BODY-TEXT"


def _failing_wire(monkeypatch, status=500):
    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(
            lambda request: httpx.Response(status, text=PRIVATE)
        )
        return real(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", factory)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider",
    [GeminiProvider(api_key="k"), OpenAIProvider(api_key="k")],
)
async def test_translation_http_errors_log_status_only(monkeypatch, provider):
    _failing_wire(monkeypatch)
    with capture_logs() as logs:
        with pytest.raises(httpx.HTTPStatusError):
            await provider.translate("prompt")
    assert PRIVATE not in repr(logs)
    errors = [e for e in logs if e["log_level"] == "error"]
    assert errors and errors[0]["status"] == 500


@pytest.mark.asyncio
async def test_transcription_http_errors_log_status_only(monkeypatch, tmp_path):
    _failing_wire(monkeypatch)
    audio = tmp_path / "a.m4a"
    audio.write_bytes(b"abc")
    with capture_logs() as logs:
        with pytest.raises(httpx.HTTPStatusError):
            await GeminiTranscriptionProvider(api_key="k").transcribe(audio)
    assert PRIVATE not in repr(logs)
    errors = [e for e in logs if e["log_level"] == "error"]
    assert errors and errors[0]["status"] == 500


def test_a_failing_provider_exception_text_reaches_neither_logs_nor_response():
    fake = AsyncMock()
    fake.translate = AsyncMock(side_effect=RuntimeError(PRIVATE))
    body = {
        "type": "blog_full",
        "service": "hinatazaka46",
        "paragraphs": ["a"],
        "target_language": "en",
    }
    with (
        patch(
            "backend.api.translation._get_provider_from_config",
            new=AsyncMock(return_value=fake),
        ),
        capture_logs() as logs,
    ):
        resp = client.post("/api/translation/translate", json=body)
    assert PRIVATE not in repr(logs) + resp.text
    assert any(e.get("error_type") == "RuntimeError" for e in logs)


def test_config_reports_the_key_only_for_the_provider_it_is_bound_to(settings):
    translation_api._save_api_key(GEMINI_KEY, "gemini")
    settings["translation_provider"] = "gemini"
    body = client.get("/api/translation/config").json()
    assert body["has_api_key"] is True
    assert body["api_key_masked"] is not None

    settings["translation_provider"] = "openai"  # settings drifted from the key
    body = client.get("/api/translation/config").json()
    assert body["has_api_key"] is False
    assert body["api_key_masked"] is None


def test_config_adopts_a_key_stored_before_its_provider_was_recorded(settings):
    """The status cache is filled by the startup warm-up, which does not know
    the provider; a not-yet-bound key must still show once settings name one."""
    translation_api.get_token_manager().store.save(
        translation_api._API_KEY_CREDENTIAL_GROUP, {"api_key": GEMINI_KEY}
    )
    translation_api._invalidate_key_status_cache()
    translation_api._load_key_status()  # warm-up: no provider known
    settings["translation_provider"] = "gemini"
    assert client.get("/api/translation/config").json()["has_api_key"] is True


@pytest.mark.asyncio
async def test_the_startup_warm_up_adopts_a_legacy_key_for_the_saved_provider(
    settings,
):
    """The warm-up reads the saved provider, so a key stored before its provider
    was recorded is bound and cached at startup, not re-read on the first open."""
    translation_api.get_token_manager().store.save(
        translation_api._API_KEY_CREDENTIAL_GROUP, {"api_key": GEMINI_KEY}
    )
    settings["translation_provider"] = "gemini"
    translation_api._invalidate_key_status_cache()
    await translation_api.warm_key_status_cache()
    assert translation_api._key_status_cache is not None
    assert translation_api._key_status_cache[2] == "gemini"


@pytest.mark.asyncio
async def test_the_startup_warm_up_without_a_saved_provider_caches_nothing(settings):
    translation_api.get_token_manager().store.save(
        translation_api._API_KEY_CREDENTIAL_GROUP, {"api_key": GEMINI_KEY}
    )
    translation_api._invalidate_key_status_cache()
    await translation_api.warm_key_status_cache()
    assert translation_api._key_status_cache is None


@pytest.mark.asyncio
async def test_a_failing_warm_up_never_raises(monkeypatch):
    async def boom():
        raise OSError("settings unreadable")

    monkeypatch.setattr(translation_api, "load_config", boom)
    await translation_api.warm_key_status_cache()
