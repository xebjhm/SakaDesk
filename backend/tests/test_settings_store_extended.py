"""Extended tests for settings_store.py — atomic write, read, and defaults."""

import asyncio
import json
from unittest.mock import patch

import pytest

import backend.services.settings_store as settings_store_mod
from backend.services.settings_store import (
    _SETTINGS_DEFAULTS,
    _read_file,
    _write_file,
    load_config,
    save_config,
    update_config,
)


# ── _read_file ───────────────────────────────────────────────────────


class TestReadFile:
    """Tests for the synchronous _read_file helper."""

    def test_returns_defaults_when_file_missing(self, tmp_path):
        path = tmp_path / "nonexistent.json"
        result = _read_file(path)
        assert result == dict(_SETTINGS_DEFAULTS)

    def test_reads_existing_file(self, tmp_path):
        path = tmp_path / "settings.json"
        data = {"theme": "dark", "custom_key": 42}
        path.write_text(json.dumps(data), encoding="utf-8")
        result = _read_file(path)
        assert result["theme"] == "dark"
        assert result["custom_key"] == 42

    def test_merges_with_defaults(self, tmp_path):
        path = tmp_path / "settings.json"
        data = {"theme": "dark"}
        path.write_text(json.dumps(data), encoding="utf-8")
        result = _read_file(path)
        # Should have both the file data and all defaults
        assert result["theme"] == "dark"
        for key, value in _SETTINGS_DEFAULTS.items():
            assert key in result

    def test_file_values_override_defaults(self, tmp_path):
        path = tmp_path / "settings.json"
        data = {"auto_sync_enabled": False}
        path.write_text(json.dumps(data), encoding="utf-8")
        result = _read_file(path)
        assert result["auto_sync_enabled"] is False

    def test_empty_json_returns_defaults(self, tmp_path):
        path = tmp_path / "settings.json"
        path.write_text("{}", encoding="utf-8")
        result = _read_file(path)
        assert result == dict(_SETTINGS_DEFAULTS)


# ── _write_file ──────────────────────────────────────────────────────


class TestWriteFile:
    """Tests for the atomic _write_file helper."""

    def test_creates_file(self, tmp_path):
        path = tmp_path / "new_settings.json"
        data = {"key": "value"}
        _write_file(path, data)
        assert path.exists()
        content = json.loads(path.read_text(encoding="utf-8"))
        assert content == data

    def test_creates_parent_dirs(self, tmp_path):
        path = tmp_path / "deep" / "nested" / "settings.json"
        data = {"nested": True}
        _write_file(path, data)
        assert path.exists()
        content = json.loads(path.read_text(encoding="utf-8"))
        assert content["nested"] is True

    def test_overwrites_existing(self, tmp_path):
        path = tmp_path / "settings.json"
        _write_file(path, {"version": 1})
        _write_file(path, {"version": 2})
        content = json.loads(path.read_text(encoding="utf-8"))
        assert content["version"] == 2

    def test_writes_valid_json(self, tmp_path):
        path = tmp_path / "settings.json"
        data = {
            "string": "hello",
            "number": 42,
            "boolean": True,
            "null_val": None,
            "list": [1, 2, 3],
        }
        _write_file(path, data)
        # Should be parseable JSON
        loaded = json.loads(path.read_text(encoding="utf-8"))
        assert loaded == data

    def test_writes_with_indent(self, tmp_path):
        path = tmp_path / "settings.json"
        _write_file(path, {"key": "value"})
        text = path.read_text(encoding="utf-8")
        # indent=2 should produce multi-line output
        assert "\n" in text

    def test_unicode_content(self, tmp_path):
        path = tmp_path / "settings.json"
        data = {"name": "日向坂46", "emoji": "test"}
        _write_file(path, data)
        loaded = json.loads(path.read_text(encoding="utf-8"))
        assert loaded["name"] == "日向坂46"


# ── _SETTINGS_DEFAULTS ───────────────────────────────────────────────


class TestSettingsDefaults:
    """Tests for the defaults dictionary."""

    def test_has_auto_sync_enabled(self):
        assert "auto_sync_enabled" in _SETTINGS_DEFAULTS
        assert _SETTINGS_DEFAULTS["auto_sync_enabled"] is True

    def test_has_sync_interval_minutes(self):
        assert "sync_interval_minutes" in _SETTINGS_DEFAULTS
        assert isinstance(_SETTINGS_DEFAULTS["sync_interval_minutes"], int)

    def test_has_adaptive_sync_enabled(self):
        assert "adaptive_sync_enabled" in _SETTINGS_DEFAULTS

    def test_has_is_configured(self):
        assert "is_configured" in _SETTINGS_DEFAULTS
        assert _SETTINGS_DEFAULTS["is_configured"] is False

    def test_has_notifications_enabled(self):
        assert "notifications_enabled" in _SETTINGS_DEFAULTS
        assert _SETTINGS_DEFAULTS["notifications_enabled"] is True

    def test_has_blogs_full_backup(self):
        assert "blogs_full_backup" in _SETTINGS_DEFAULTS
        assert _SETTINGS_DEFAULTS["blogs_full_backup"] is False


# ── Async API (load_config, save_config, update_config) ─────────────


class TestAsyncApi:
    """Tests for the async load_config / save_config / update_config.

    Each test creates a fresh asyncio.Lock to avoid cross-test event loop issues.
    """

    @pytest.mark.asyncio
    async def test_load_config_returns_defaults(self, tmp_path):
        settings_store_mod._lock = asyncio.Lock()
        path = tmp_path / "settings.json"
        with patch(
            "backend.services.settings_store.get_settings_path",
            return_value=path,
        ):
            result = await load_config()
        assert result == dict(_SETTINGS_DEFAULTS)

    @pytest.mark.asyncio
    async def test_save_and_load_roundtrip(self, tmp_path):
        settings_store_mod._lock = asyncio.Lock()
        path = tmp_path / "settings.json"
        with patch(
            "backend.services.settings_store.get_settings_path",
            return_value=path,
        ):
            data = {"auto_sync_enabled": False, "custom": "value"}
            await save_config(data)
            loaded = await load_config()
        assert loaded["custom"] == "value"
        assert loaded["auto_sync_enabled"] is False

    @pytest.mark.asyncio
    async def test_update_config_read_modify_write(self, tmp_path):
        settings_store_mod._lock = asyncio.Lock()
        path = tmp_path / "settings.json"
        initial = {"auto_sync_enabled": True, "counter": 0}
        path.write_text(json.dumps(initial), encoding="utf-8")

        def incrementer(cfg):
            cfg["counter"] = cfg.get("counter", 0) + 1

        with patch(
            "backend.services.settings_store.get_settings_path",
            return_value=path,
        ):
            result = await update_config(incrementer)
        assert result["counter"] == 1
        # Verify persisted
        on_disk = json.loads(path.read_text(encoding="utf-8"))
        assert on_disk["counter"] == 1

    @pytest.mark.asyncio
    async def test_update_config_returns_modified_config(self, tmp_path):
        settings_store_mod._lock = asyncio.Lock()
        path = tmp_path / "settings.json"

        def add_key(cfg):
            cfg["new_key"] = "new_value"

        with patch(
            "backend.services.settings_store.get_settings_path",
            return_value=path,
        ):
            result = await update_config(add_key)
        assert result["new_key"] == "new_value"


# ── knowledge_base defaults (Task 4) ──────────────────────────────────


class TestKnowledgeBaseDefaults:
    """Tests for the `knowledge_base` settings subsection.

    `backend.services.llm_client.build_llm_client_from_settings()` (Task 2)
    assumes these exact values as its own fallback defaults -- kept in sync
    here so the two agree regardless of task ordering.
    """

    @pytest.mark.asyncio
    async def test_load_config_exposes_knowledge_base_defaults(self, tmp_path):
        settings_store_mod._lock = asyncio.Lock()
        path = tmp_path / "settings.json"
        with patch(
            "backend.services.settings_store.get_settings_path",
            return_value=path,
        ):
            result = await load_config()

        kb = result["knowledge_base"]
        assert kb["enabled"] is False
        assert kb["embedding_model"] == "granite-embedding-278m-multilingual"
        assert kb["last_built"] is None
        assert kb["llm"]["backend"] == "cloud"
        assert (
            kb["llm"]["base_url"]
            == "https://generativelanguage.googleapis.com/v1beta/openai"
        )
        assert kb["llm"]["model"] == "gemini-2.5-flash"

    @pytest.mark.asyncio
    async def test_update_config_flips_knowledge_base_enabled_and_persists(
        self, tmp_path
    ):
        settings_store_mod._lock = asyncio.Lock()
        path = tmp_path / "settings.json"

        def enable_kb(cfg: dict) -> None:
            cfg.setdefault("knowledge_base", {})["enabled"] = True

        with patch(
            "backend.services.settings_store.get_settings_path",
            return_value=path,
        ):
            result = await update_config(enable_kb)
            assert result["knowledge_base"]["enabled"] is True

            reloaded = await load_config()

        assert reloaded["knowledge_base"]["enabled"] is True

    @pytest.mark.asyncio
    async def test_partial_knowledge_base_does_not_backfill_missing_subkeys(
        self, tmp_path
    ):
        """`_read_file` does a shallow, top-level merge (`{**defaults, **file}`), not
        a recursive/deep merge -- so a stored file with a *partial* `knowledge_base`
        dict replaces the default dict wholesale rather than being filled in from
        `_SETTINGS_DEFAULTS`. This test documents that current (non-deep-merge)
        behavior: `llm_client.build_llm_client_from_settings()` and
        `knowledge_service._build_embedder()` already compensate for it themselves
        via defensive `.get(..., {})` / `or <fallback>` chains, so they don't rely on
        settings_store to deep-merge.
        """
        settings_store_mod._lock = asyncio.Lock()
        path = tmp_path / "settings.json"
        path.write_text(
            json.dumps({"knowledge_base": {"enabled": True}}), encoding="utf-8"
        )

        with patch(
            "backend.services.settings_store.get_settings_path",
            return_value=path,
        ):
            result = await load_config()

        assert result["knowledge_base"] == {"enabled": True}
        assert "llm" not in result["knowledge_base"]
