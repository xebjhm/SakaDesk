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
