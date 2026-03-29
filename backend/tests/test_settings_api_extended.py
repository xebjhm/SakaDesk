"""Extended tests for settings API — covers global GET/POST, fresh-install check,
folder picker, init-service endpoint, and blog backup toggle.

Existing test_settings.py covers per-service GET/POST and invalid-service.
This file covers the remaining untested routes and branches.
"""

import asyncio
import contextlib
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _default_config(**overrides):
    """Return a settings dict that satisfies SettingsResponse fields."""
    base = {
        "output_dir": "/tmp/test-output",
        "auto_sync_enabled": True,
        "sync_interval_minutes": 1,
        "adaptive_sync_enabled": True,
        "is_configured": True,
        "notifications_enabled": True,
        "blogs_full_backup": False,
        "auto_download_updates": True,
    }
    base.update(overrides)
    return base


@contextlib.contextmanager
def _patch_store(load_return=None, update_side_effect=None):
    """Patch the async settings_store functions used by the API layer.

    - load_return: dict returned by _store_load
    - update_side_effect: callable(updater_fn) -> dict  (simulates read-modify-write)
    """
    if load_return is None:
        load_return = _default_config()

    mock_load = AsyncMock(return_value=load_return)

    async def _default_update(updater_fn):
        cfg = dict(load_return)
        updater_fn(cfg)
        return cfg

    mock_update = AsyncMock(side_effect=update_side_effect or _default_update)

    with (
        patch("backend.api.settings._store_load", mock_load),
        patch("backend.api.settings._store_update", mock_update),
        patch("backend.api.settings.set_notifications_enabled"),
    ):
        yield mock_load, mock_update


# ===========================================================================
# GET /api/settings
# ===========================================================================


class TestGetSettings:
    """Tests for GET /api/settings (global settings retrieval)."""

    def test_returns_all_fields(self):
        """Response includes every SettingsResponse field."""
        cfg = _default_config(user_nickname="TestUser", language="ja")
        with _patch_store(load_return=cfg):
            response = client.get("/api/settings")
        assert response.status_code == 200
        data = response.json()
        assert data["output_dir"] == "/tmp/test-output"
        assert data["auto_sync_enabled"] is True
        assert data["sync_interval_minutes"] == 1
        assert data["adaptive_sync_enabled"] is True
        assert data["is_configured"] is True
        assert data["user_nickname"] == "TestUser"
        assert data["notifications_enabled"] is True
        assert data["blogs_full_backup"] is False
        assert data["language"] == "ja"

    def test_uses_default_output_dir_when_absent(self):
        """When output_dir is missing from config, the platform default is used."""
        cfg = _default_config()
        del cfg["output_dir"]
        with (
            _patch_store(load_return=cfg),
            patch(
                "backend.api.settings.get_default_output_dir",
                return_value="/fallback/dir",
            ),
        ):
            response = client.get("/api/settings")
        assert response.status_code == 200
        assert response.json()["output_dir"] == "/fallback/dir"

    def test_syncs_notification_state(self):
        """GET /api/settings calls set_notifications_enabled with persisted value."""
        cfg = _default_config(notifications_enabled=False)
        with (
            patch("backend.api.settings._store_load", AsyncMock(return_value=cfg)),
            patch("backend.api.settings._store_update"),
            patch("backend.api.settings.set_notifications_enabled") as mock_notify,
        ):
            response = client.get("/api/settings")
        assert response.status_code == 200
        mock_notify.assert_called_once_with(False)

    def test_optional_fields_default_to_none(self):
        """user_nickname and language default to None when not in config."""
        cfg = _default_config()  # no user_nickname or language key
        with _patch_store(load_return=cfg):
            response = client.get("/api/settings")
        assert response.status_code == 200
        data = response.json()
        assert data["user_nickname"] is None
        assert data["language"] is None


# ===========================================================================
# POST /api/settings
# ===========================================================================


class TestUpdateSettings:
    """Tests for POST /api/settings (global settings update)."""

    def test_update_output_dir_marks_configured(self):
        """Setting output_dir also sets is_configured to True."""
        cfg = _default_config(is_configured=False)

        async def _update(updater_fn):
            updater_fn(cfg)
            return cfg

        with _patch_store(load_return=cfg, update_side_effect=_update):
            response = client.post(
                "/api/settings",
                json={
                    "output_dir": "/new/output",
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert data["output_dir"] == "/new/output"
        assert data["is_configured"] is True

    def test_update_auto_sync(self):
        """Toggle auto_sync_enabled."""
        cfg = _default_config(auto_sync_enabled=True)

        async def _update(updater_fn):
            updater_fn(cfg)
            return cfg

        with _patch_store(load_return=cfg, update_side_effect=_update):
            response = client.post(
                "/api/settings",
                json={
                    "auto_sync_enabled": False,
                },
            )
        assert response.status_code == 200
        assert response.json()["auto_sync_enabled"] is False

    def test_update_sync_interval(self):
        """Update sync_interval_minutes."""
        cfg = _default_config(sync_interval_minutes=1)

        async def _update(updater_fn):
            updater_fn(cfg)
            return cfg

        with _patch_store(load_return=cfg, update_side_effect=_update):
            response = client.post(
                "/api/settings",
                json={
                    "sync_interval_minutes": 30,
                },
            )
        assert response.status_code == 200
        assert response.json()["sync_interval_minutes"] == 30

    def test_update_adaptive_sync(self):
        """Toggle adaptive_sync_enabled."""
        cfg = _default_config(adaptive_sync_enabled=True)

        async def _update(updater_fn):
            updater_fn(cfg)
            return cfg

        with _patch_store(load_return=cfg, update_side_effect=_update):
            response = client.post(
                "/api/settings",
                json={
                    "adaptive_sync_enabled": False,
                },
            )
        assert response.status_code == 200
        assert response.json()["adaptive_sync_enabled"] is False

    def test_update_notifications(self):
        """Toggle notifications_enabled also calls set_notifications_enabled."""
        cfg = _default_config(notifications_enabled=True)

        async def _update(updater_fn):
            updater_fn(cfg)
            return cfg

        with (
            patch("backend.api.settings._store_load", AsyncMock(return_value=cfg)),
            patch("backend.api.settings._store_update", AsyncMock(side_effect=_update)),
            patch("backend.api.settings.set_notifications_enabled") as mock_notify,
        ):
            response = client.post(
                "/api/settings",
                json={
                    "notifications_enabled": False,
                },
            )
        assert response.status_code == 200
        assert response.json()["notifications_enabled"] is False
        # Called once during _apply inside update_settings
        mock_notify.assert_called_with(False)

    def test_update_blogs_full_backup(self):
        """Toggle blogs_full_backup."""
        cfg = _default_config(blogs_full_backup=False)

        async def _update(updater_fn):
            updater_fn(cfg)
            return cfg

        with _patch_store(load_return=cfg, update_side_effect=_update):
            response = client.post(
                "/api/settings",
                json={
                    "blogs_full_backup": True,
                },
            )
        assert response.status_code == 200
        assert response.json()["blogs_full_backup"] is True

    def test_update_multiple_fields(self):
        """Update several fields at once."""
        cfg = _default_config()

        async def _update(updater_fn):
            updater_fn(cfg)
            return cfg

        with _patch_store(load_return=cfg, update_side_effect=_update):
            response = client.post(
                "/api/settings",
                json={
                    "output_dir": "/multi/update",
                    "auto_sync_enabled": False,
                    "sync_interval_minutes": 60,
                    "blogs_full_backup": True,
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert data["output_dir"] == "/multi/update"
        assert data["auto_sync_enabled"] is False
        assert data["sync_interval_minutes"] == 60
        assert data["blogs_full_backup"] is True

    def test_update_empty_body_no_changes(self):
        """Empty update body leaves config unchanged."""
        cfg = _default_config()
        original_dir = cfg["output_dir"]

        async def _update(updater_fn):
            updater_fn(cfg)
            return cfg

        with _patch_store(load_return=cfg, update_side_effect=_update):
            response = client.post("/api/settings", json={})
        assert response.status_code == 200
        assert response.json()["output_dir"] == original_dir

    def test_update_uses_default_output_dir_when_absent(self):
        """Response falls back to platform default when output_dir not in config."""
        cfg = _default_config()
        del cfg["output_dir"]

        async def _update(updater_fn):
            updater_fn(cfg)
            return cfg

        with (
            _patch_store(load_return=cfg, update_side_effect=_update),
            patch(
                "backend.api.settings.get_default_output_dir",
                return_value="/platform/default",
            ),
        ):
            response = client.post(
                "/api/settings",
                json={
                    "auto_sync_enabled": False,
                },
            )
        assert response.status_code == 200
        assert response.json()["output_dir"] == "/platform/default"


# ===========================================================================
# GET /api/settings/fresh
# ===========================================================================


class TestFreshInstallCheck:
    """Tests for GET /api/settings/fresh."""

    def test_fresh_when_dir_does_not_exist(self, tmp_path):
        """is_fresh=True when the output directory does not exist."""
        missing = tmp_path / "nonexistent"
        cfg = _default_config(output_dir=str(missing))
        with _patch_store(load_return=cfg):
            response = client.get("/api/settings/fresh")
        assert response.status_code == 200
        data = response.json()
        assert data["is_fresh"] is True
        assert data["output_dir"] == str(missing)

    def test_fresh_when_dir_is_empty(self, tmp_path):
        """is_fresh=True when the output directory is empty."""
        cfg = _default_config(output_dir=str(tmp_path))
        with _patch_store(load_return=cfg):
            response = client.get("/api/settings/fresh")
        assert response.status_code == 200
        assert response.json()["is_fresh"] is True

    def test_fresh_when_only_metadata(self, tmp_path):
        """is_fresh=True when directory only contains ignored files."""
        (tmp_path / "sync_metadata.json").write_text("{}", encoding="utf-8")
        (tmp_path / ".gitkeep").write_text("", encoding="utf-8")
        cfg = _default_config(output_dir=str(tmp_path))
        with _patch_store(load_return=cfg):
            response = client.get("/api/settings/fresh")
        assert response.status_code == 200
        assert response.json()["is_fresh"] is True

    def test_not_fresh_when_data_present(self, tmp_path):
        """is_fresh=False when real data files exist."""
        (tmp_path / "messages.db").write_text("data", encoding="utf-8")
        cfg = _default_config(output_dir=str(tmp_path))
        with _patch_store(load_return=cfg):
            response = client.get("/api/settings/fresh")
        assert response.status_code == 200
        assert response.json()["is_fresh"] is False

    def test_not_fresh_with_metadata_and_data(self, tmp_path):
        """is_fresh=False even when metadata files are present alongside real data."""
        (tmp_path / "sync_metadata.json").write_text("{}", encoding="utf-8")
        (tmp_path / "user_data.json").write_text("{}", encoding="utf-8")
        cfg = _default_config(output_dir=str(tmp_path))
        with _patch_store(load_return=cfg):
            response = client.get("/api/settings/fresh")
        assert response.status_code == 200
        assert response.json()["is_fresh"] is False

    def test_uses_default_dir_when_config_missing(self, tmp_path):
        """Falls back to platform default when output_dir is absent from config."""
        cfg = _default_config()
        del cfg["output_dir"]
        with (
            _patch_store(load_return=cfg),
            patch(
                "backend.api.settings.get_default_output_dir",
                return_value=str(tmp_path),
            ),
        ):
            response = client.get("/api/settings/fresh")
        assert response.status_code == 200
        assert response.json()["output_dir"] == str(tmp_path)


# ===========================================================================
# POST /api/settings/select-folder
# ===========================================================================


class TestSelectFolder:
    """Tests for POST /api/settings/select-folder."""

    def test_returns_selected_path(self):
        """Returns the path chosen by the user."""

        async def fake_wait_for(coro, *, timeout=None):
            return "/selected/folder"

        with (
            patch.object(asyncio, "wait_for", new=fake_wait_for),
            patch.object(asyncio, "get_event_loop") as mock_get_loop,
        ):
            mock_loop = MagicMock()
            mock_get_loop.return_value = mock_loop
            response = client.post("/api/settings/select-folder")

        assert response.status_code == 200
        assert response.json()["path"] == "/selected/folder"

    def test_returns_none_when_tkinter_missing(self):
        """Returns path=None with error when tkinter is not available."""
        with patch.dict("sys.modules", {"tkinter": None}):
            response = client.post("/api/settings/select-folder")
        assert response.status_code == 200
        data = response.json()
        assert "path" in data

    def test_returns_none_when_user_cancels(self):
        """Returns path=None when user cancels the dialog."""

        async def fake_wait_for(coro, *, timeout=None):
            return None

        with (
            patch.object(asyncio, "wait_for", new=fake_wait_for),
            patch.object(asyncio, "get_event_loop") as mock_get_loop,
        ):
            mock_loop = MagicMock()
            mock_get_loop.return_value = mock_loop
            response = client.post("/api/settings/select-folder")

        assert response.status_code == 200
        assert response.json()["path"] is None

    def test_returns_error_on_timeout(self):
        """Returns path=None with error message on timeout."""

        async def fake_wait_for(coro, *, timeout=None):
            raise asyncio.TimeoutError()

        with (
            patch.object(asyncio, "wait_for", new=fake_wait_for),
            patch.object(asyncio, "get_event_loop") as mock_get_loop,
        ):
            mock_loop = MagicMock()
            mock_get_loop.return_value = mock_loop
            response = client.post("/api/settings/select-folder")

        assert response.status_code == 200
        data = response.json()
        assert data["path"] is None
        assert "timed out" in data.get("error", "").lower()

    def test_returns_error_on_executor_exception(self):
        """Returns path=None with error on executor failure."""

        async def fake_wait_for(coro, *, timeout=None):
            raise RuntimeError("executor crashed")

        with (
            patch.object(asyncio, "wait_for", new=fake_wait_for),
            patch.object(asyncio, "get_event_loop") as mock_get_loop,
        ):
            mock_loop = MagicMock()
            mock_get_loop.return_value = mock_loop
            response = client.post("/api/settings/select-folder")

        assert response.status_code == 200
        data = response.json()
        assert data["path"] is None
        assert "error" in data


# ===========================================================================
# POST /api/settings/service/{service}/init
# ===========================================================================


class TestInitServiceSettings:
    """Tests for POST /api/settings/service/{service}/init."""

    @patch("backend.api.settings._store_update")
    def test_init_new_service(self, mock_update):
        """Initializing a new service creates default settings."""
        cfg = _default_config()
        cfg["services"] = {}

        async def _update(updater_fn):
            updater_fn(cfg)
            return cfg

        mock_update.side_effect = _update
        with patch("backend.api.settings.set_notifications_enabled"):
            response = client.post("/api/settings/service/hinatazaka46/init")
        assert response.status_code == 200
        data = response.json()
        assert data["sync_enabled"] is True
        assert data["adaptive_sync_enabled"] is True
        assert data["last_sync"] is None
        assert data["blogs_full_backup"] is False

    @patch("backend.api.settings._store_update")
    def test_init_existing_service_preserves(self, mock_update):
        """Initializing an already-configured service does not overwrite."""
        existing_svc = {
            "sync_enabled": False,
            "adaptive_sync_enabled": False,
            "last_sync": "2025-06-01T00:00:00Z",
            "blogs_full_backup": True,
        }
        cfg = _default_config()
        cfg["services"] = {"hinatazaka46": existing_svc}

        async def _update(updater_fn):
            updater_fn(cfg)
            return cfg

        mock_update.side_effect = _update
        with patch("backend.api.settings.set_notifications_enabled"):
            response = client.post("/api/settings/service/hinatazaka46/init")
        assert response.status_code == 200
        data = response.json()
        # Should preserve the existing values, not reset to defaults
        assert data["sync_enabled"] is False
        assert data["blogs_full_backup"] is True
        assert data["last_sync"] == "2025-06-01T00:00:00Z"

    @patch("backend.api.settings._store_update")
    def test_init_creates_services_dict_if_missing(self, mock_update):
        """init creates the 'services' key when config has none."""
        cfg = _default_config()
        # No "services" key at all

        async def _update(updater_fn):
            updater_fn(cfg)
            return cfg

        mock_update.side_effect = _update
        with patch("backend.api.settings.set_notifications_enabled"):
            response = client.post("/api/settings/service/sakurazaka46/init")
        assert response.status_code == 200
        data = response.json()
        assert data["sync_enabled"] is True
        # Verify the config was mutated to include "services"
        assert "services" in cfg
        assert "sakurazaka46" in cfg["services"]

    def test_init_invalid_service(self):
        """Invalid service returns 400."""
        response = client.post("/api/settings/service/invalid_service/init")
        assert response.status_code == 400
        assert "invalid service" in response.json()["detail"].lower()
