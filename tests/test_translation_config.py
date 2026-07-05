"""Regression tests for translation provider/model config resolution
(backend/api/translation.py).

Root cause context: a partial ``/configure`` full-replaces settings and can leave
``translation_model`` as ``None``. Translation must not hard-fail in that state.
"""

import pytest

from backend.api import translation
from backend.api.translation import DEFAULT_GEMINI_MODEL
from backend.services.translation_service import GeminiProvider


@pytest.mark.asyncio
async def test_get_provider_defaults_model_when_none(monkeypatch):
    """A saved provider + API key but ``translation_model=None`` must resolve to
    the default model, NOT raise ``no_model`` (which made translation impossible)."""

    async def fake_load_config():
        return {"translation_provider": "gemini", "translation_model": None}

    monkeypatch.setattr(translation, "load_config", fake_load_config)
    monkeypatch.setattr(translation, "_load_api_key", lambda: "fake-key")

    provider = await translation._get_provider_from_config()

    assert isinstance(provider, GeminiProvider)
    assert provider._model == DEFAULT_GEMINI_MODEL


def test_config_endpoint_backfills_default_model_when_none(client, monkeypatch):
    """GET /config must self-heal a null ``translation_model`` to the default and
    persist it, so the settings UI shows a real model and stops re-saving null."""

    async def fake_load_config():
        return {
            "translation_provider": "gemini",
            "translation_model": None,
            "translation_target_language": "zh-TW",
        }

    persisted: dict = {}

    async def fake_update_config(fn):
        cfg = {"translation_model": None}
        fn(cfg)
        persisted.update(cfg)

    monkeypatch.setattr(translation, "load_config", fake_load_config)
    monkeypatch.setattr(translation, "update_config", fake_update_config)
    monkeypatch.setattr(translation, "_load_api_key", lambda: "fake-key-1234")

    resp = client.get("/api/translation/config")

    assert resp.status_code == 200
    assert resp.json()["model"] == DEFAULT_GEMINI_MODEL
    assert persisted.get("translation_model") == DEFAULT_GEMINI_MODEL


def test_config_caches_keyring_read(client, monkeypatch):
    """/config must not pay the slow OS keyring read on every AI-tab open: the
    key status is cached in memory and only re-read after the key is saved/cleared
    (which invalidates the cache)."""
    calls = {"n": 0}

    def fake_load_api_key():
        calls["n"] += 1
        return "AIzaSECRET12"

    async def fake_load_config():
        return {
            "translation_provider": "gemini",
            "translation_model": DEFAULT_GEMINI_MODEL,
            "translation_target_language": "zh-TW",
        }

    monkeypatch.setattr(translation, "_load_api_key", fake_load_api_key)
    monkeypatch.setattr(translation, "load_config", fake_load_config)
    translation._invalidate_key_status_cache()

    r1 = client.get("/api/translation/config")
    r2 = client.get("/api/translation/config")

    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["has_api_key"] is True
    assert r1.json()["api_key_masked"] == "AIza...12"
    assert calls["n"] == 1  # keyring read once; second call served from cache

    # Invalidation (as _save_api_key/_delete_api_key do) forces a fresh read.
    translation._invalidate_key_status_cache()
    client.get("/api/translation/config")
    assert calls["n"] == 2


@pytest.mark.asyncio
async def test_translate_no_key_invalidates_stale_status_cache(monkeypatch):
    """Coherence: the key can be removed out-of-band (installer uninstall, another
    instance) while the running app's status cache still reports it present, so
    /config shows 'saved securely' while translate (a direct keyring read) fails
    with no_api_key. The failing translate must invalidate the stale status cache
    so the next /config open reflects reality instead of falsely reassuring."""
    from backend.api.errors import CodedHTTPException

    async def fake_load_config():
        return {"translation_provider": "gemini", "translation_model": DEFAULT_GEMINI_MODEL}

    monkeypatch.setattr(translation, "load_config", fake_load_config)
    monkeypatch.setattr(translation, "_load_api_key", lambda: None)  # key gone from keyring
    # Stale "present" status (warmed while the key still existed).
    translation._key_status_cache = (True, "AIza...12")

    with pytest.raises(CodedHTTPException) as exc_info:
        await translation._get_provider_from_config()

    assert exc_info.value.code == "no_api_key"
    assert translation._key_status_cache is None  # cleared → /config self-heals
