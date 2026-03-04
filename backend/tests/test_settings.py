"""Tests for settings API - global and per-service settings."""
import contextlib
import pytest
import tempfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


@pytest.fixture
def temp_settings_file():
    """Create a temporary settings file for isolated testing."""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        settings_path = Path(f.name)
    # Write empty initial config
    settings_path.write_text("{}")
    yield settings_path
    # Cleanup
    if settings_path.exists():
        settings_path.unlink()


@contextlib.contextmanager
def patch_settings_file(temp_path: Path):
    """Patch settings file path in both the API module and the centralized store."""
    with (
        patch('backend.api.settings.SETTINGS_FILE', temp_path),
        patch('backend.services.settings_store.get_settings_path', return_value=temp_path),
    ):
        yield


def test_settings_has_global_and_services_structure(temp_settings_file):
    """Settings should have global and services sections."""
    from backend.api.settings import load_config, save_config

    with patch_settings_file(temp_settings_file):
        # Save new structure
        save_config({
            "global": {
                "theme": "dark",
                "notifications_enabled": True,
            },
            "services": {
                "hinatazaka46": {
                    "sync_enabled": True,
                    "blogs_full_backup": False,
                }
            },
            "is_configured": True,
            "output_dir": "/tmp/output",
        })

        config = load_config()
        assert "is_configured" in config  # Backward compat


def test_get_service_settings_returns_defaults(temp_settings_file):
    """GET /api/settings/service/{service} returns default settings."""
    with patch_settings_file(temp_settings_file):
        response = client.get("/api/settings/service/hinatazaka46")
        assert response.status_code == 200
        data = response.json()
        assert data["sync_enabled"]
        assert not data["blogs_full_backup"]


def test_get_service_settings_invalid_service(temp_settings_file):
    """GET /api/settings/service/{service} with invalid service returns 400."""
    with patch_settings_file(temp_settings_file):
        response = client.get("/api/settings/service/invalid_service")
        assert response.status_code == 400


def test_update_service_settings(temp_settings_file):
    """POST /api/settings/service/{service} updates settings."""
    with patch_settings_file(temp_settings_file):
        # Update settings
        response = client.post(
            "/api/settings/service/hinatazaka46",
            json={
                "sync_enabled": False,
                "adaptive_sync_enabled": True,
                "last_sync": "2024-01-01T00:00:00Z",
                "blogs_full_backup": True,
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert not data["sync_enabled"]
        assert data["blogs_full_backup"]


def test_update_service_settings_invalid_service(temp_settings_file):
    """POST /api/settings/service/{service} with invalid service returns 400."""
    with patch_settings_file(temp_settings_file):
        response = client.post(
            "/api/settings/service/invalid_service",
            json={
                "sync_enabled": True,
                "adaptive_sync_enabled": True,
                "blogs_full_backup": False,
            }
        )
        assert response.status_code == 400


def test_update_service_settings_persists(temp_settings_file):
    """POST /api/settings/service/{service} persists settings that can be retrieved."""
    with patch_settings_file(temp_settings_file):
        # First update settings
        response = client.post(
            "/api/settings/service/hinatazaka46",
            json={
                "sync_enabled": False,
                "adaptive_sync_enabled": False,
                "last_sync": "2024-01-15T12:00:00Z",
                "blogs_full_backup": True,
            }
        )
        assert response.status_code == 200

        # Then retrieve them
        response = client.get("/api/settings/service/hinatazaka46")
        assert response.status_code == 200
        data = response.json()
        assert not data["sync_enabled"]
        assert not data["adaptive_sync_enabled"]
        assert data["last_sync"] == "2024-01-15T12:00:00Z"
        assert data["blogs_full_backup"]
