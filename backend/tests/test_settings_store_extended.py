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

    def test_has_incoming_call_enabled(self):
        assert "incoming_call_enabled" in _SETTINGS_DEFAULTS
        assert _SETTINGS_DEFAULTS["incoming_call_enabled"] is True

    def test_has_call_popup_enabled(self):
        assert _SETTINGS_DEFAULTS["call_popup_enabled"] is True

    def test_tray_defaults(self):
        assert _SETTINGS_DEFAULTS["close_to_tray"] is True
        assert _SETTINGS_DEFAULTS["autostart"] is False
        assert _SETTINGS_DEFAULTS["tray_hint_shown"] is False

    def test_has_notifications_hide_content(self):
        assert _SETTINGS_DEFAULTS["notifications_hide_content"] is False


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


# ── read_config_sync ─────────────────────────────────────────────────


class TestReadConfigSync:
    def test_merges_defaults_over_the_file(self, tmp_path):
        path = tmp_path / "settings.json"
        path.write_text(json.dumps({"close_to_tray": False}), "utf-8")
        with patch.object(settings_store_mod, "get_settings_path", return_value=path):
            config = settings_store_mod.read_config_sync()
        assert config["close_to_tray"] is False
        assert config["autostart"] is False and config["tray_hint_shown"] is False

    def test_missing_file_gives_the_defaults(self, tmp_path):
        path = tmp_path / "settings.json"
        with patch.object(settings_store_mod, "get_settings_path", return_value=path):
            assert settings_store_mod.read_config_sync() == dict(_SETTINGS_DEFAULTS)

    def test_unreadable_file_raises_for_the_caller_to_handle(self, tmp_path):
        path = tmp_path / "settings.json"
        path.write_text("{not json", "utf-8")
        with patch.object(settings_store_mod, "get_settings_path", return_value=path):
            with pytest.raises(json.JSONDecodeError):
                settings_store_mod.read_config_sync()


# ── mark_tray_hint_shown ─────────────────────────────────────────────


class TestMarkTrayHintShown:
    def test_persists_flag_and_keeps_other_keys(self, tmp_path):
        path = tmp_path / "settings.json"
        path.write_text(
            json.dumps({"output_dir": "x", "window": {"width": 9}}), "utf-8"
        )
        with patch.object(settings_store_mod, "get_settings_path", return_value=path):
            assert settings_store_mod.mark_tray_hint_shown() is True
        saved = json.loads(path.read_text("utf-8"))
        assert saved["tray_hint_shown"] is True
        assert saved["output_dir"] == "x"
        assert saved["window"] == {"width": 9}

    def test_creates_the_file_when_missing(self, tmp_path):
        path = tmp_path / "sub" / "settings.json"
        with patch.object(settings_store_mod, "get_settings_path", return_value=path):
            assert settings_store_mod.mark_tray_hint_shown() is True
        assert json.loads(path.read_text("utf-8"))["tray_hint_shown"] is True

    def test_failure_returns_false_and_logs_type_only(self, tmp_path):
        from structlog.testing import capture_logs

        path = tmp_path / "settings.json"
        path.write_text("{not json 金村", "utf-8")
        with patch.object(settings_store_mod, "get_settings_path", return_value=path):
            with capture_logs() as logs:
                assert settings_store_mod.mark_tray_hint_shown() is False
        (e,) = [x for x in logs if x["event"] == "tray_hint_persist_failed"]
        assert e["error_type"] == "JSONDecodeError"
        assert "金村" not in repr(logs)


# ── cross-thread serialization ───────────────────────────────────────


class TestSettingsWritesAreSerialized:
    @pytest.mark.asyncio
    async def test_mark_tray_hint_and_update_config_both_persist(self, tmp_path):
        """A GUI-thread mark_tray_hint_shown racing update_config loses nothing.

        A barrier in the patched read forces both read-modify-write cycles to be
        in flight at once: without a shared lock both would read the same
        snapshot and the later write would drop the other's change.
        """
        import threading

        settings_store_mod._lock = asyncio.Lock()
        path = tmp_path / "settings.json"
        path.write_text("{}", encoding="utf-8")
        real_read = settings_store_mod._read_file
        barrier = threading.Barrier(2, timeout=0.2)

        def racing_read(p):
            result = real_read(p)
            try:
                barrier.wait()
            except threading.BrokenBarrierError:
                pass  # serialized: the other cycle cannot start until we finish
            return result

        results: list = []
        with (
            patch.object(settings_store_mod, "get_settings_path", return_value=path),
            patch.object(settings_store_mod, "_read_file", racing_read),
        ):
            t = threading.Thread(
                target=lambda: results.append(settings_store_mod.mark_tray_hint_shown())
            )
            t.start()
            await update_config(lambda c: c.__setitem__("sync_interval_minutes", 99))
            t.join(5)
        assert results == [True]
        saved = json.loads(path.read_text(encoding="utf-8"))
        assert saved["tray_hint_shown"] is True
        assert saved["sync_interval_minutes"] == 99

    @pytest.mark.asyncio
    async def test_many_interleavings_keep_every_update(self, tmp_path):
        import threading

        settings_store_mod._lock = asyncio.Lock()
        path = tmp_path / "settings.json"
        path.write_text("{}", encoding="utf-8")
        n = 25
        with patch.object(settings_store_mod, "get_settings_path", return_value=path):
            threads = [
                threading.Thread(
                    target=settings_store_mod.update_raw_sync,
                    args=(path, {f"k{i}": i}),
                )
                for i in range(n)
            ]
            for t in threads:
                t.start()
            await asyncio.gather(
                *(
                    update_config(lambda c, i=i: c.__setitem__(f"a{i}", i))
                    for i in range(n)
                )
            )
            for t in threads:
                t.join(5)
        saved = json.loads(path.read_text(encoding="utf-8"))
        assert all(saved[f"k{i}"] == i and saved[f"a{i}"] == i for i in range(n))


class TestUpdateRawSync:
    def test_merges_without_materialising_defaults(self, tmp_path):
        path = tmp_path / "sub" / "settings.json"
        settings_store_mod.update_raw_sync(path, {"window": {"width": 1}})
        assert json.loads(path.read_text(encoding="utf-8")) == {"window": {"width": 1}}

    def test_missing_file_is_written_and_reports_saved(self, tmp_path):
        path = tmp_path / "settings.json"
        assert settings_store_mod.update_raw_sync(path, {"window": {}}) is True
        assert json.loads(path.read_text(encoding="utf-8")) == {"window": {}}

    def test_unreadable_file_is_left_untouched(self, tmp_path):
        """A corrupt-but-present file must never be replaced by ``updates`` alone.

        Overwriting it would wipe output_dir / is_configured / language and
        every other setting on the next close-to-tray geometry save.
        """
        from structlog.testing import capture_logs

        path = tmp_path / "settings.json"
        path.write_text("{broken", encoding="utf-8")
        with capture_logs() as logs:
            saved = settings_store_mod.update_raw_sync(path, {"window": {}})
        assert saved is False
        assert path.read_text(encoding="utf-8") == "{broken"
        skipped = [e for e in logs if e["event"] == "settings_raw_update_skipped"]
        assert skipped == [
            {
                "event": "settings_raw_update_skipped",
                "reason": "unreadable",
                "error_type": "JSONDecodeError",
                "log_level": "warning",
            }
        ]

    def test_non_object_file_is_left_untouched(self, tmp_path):
        from structlog.testing import capture_logs

        path = tmp_path / "settings.json"
        path.write_text("[1, 2]", encoding="utf-8")
        with capture_logs() as logs:
            saved = settings_store_mod.update_raw_sync(path, {"window": {}})
        assert saved is False
        assert path.read_text(encoding="utf-8") == "[1, 2]"
        assert any(
            e["event"] == "settings_raw_update_skipped" and e["reason"] == "not_object"
            for e in logs
        )
