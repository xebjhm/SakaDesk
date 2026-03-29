"""Tests for version API endpoints (GET /api/version, upgrade lifecycle)."""

from datetime import datetime, timezone, timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def _reset_version_cache():
    """Reset the module-level cache and upgrade state between tests."""
    import backend.api.version as v

    v._cache = {
        "last_check": None,
        "latest_version": None,
        "release_url": None,
        "release_notes": None,
        "error": None,
    }
    v._upgrade_state = {
        "state": "idle",
        "progress": 0.0,
        "error": None,
        "version": None,
        "installer_path": None,
    }


class TestGetCurrentVersion:
    """Tests for GET /api/version/current."""

    def test_get_current_version(self):
        """Returns the current app version."""
        response = client.get("/api/version/current")
        assert response.status_code == 200
        data = response.json()
        assert "version" in data
        assert isinstance(data["version"], str)


class TestCheckVersion:
    """Tests for GET /api/version."""

    def setup_method(self):
        _reset_version_cache()

    @patch("backend.api.version._fetch_latest_release")
    def test_check_version_no_update(self, mock_fetch):
        """Returns no update when latest == current."""
        from backend.version import APP_VERSION

        mock_fetch.return_value = {
            "last_check": datetime.now(timezone.utc),
            "latest_version": APP_VERSION.lstrip("v"),
            "release_url": "https://github.com/test",
            "release_notes": "notes",
            "error": None,
        }
        response = client.get("/api/version")
        assert response.status_code == 200
        data = response.json()
        assert data["current_version"] == APP_VERSION
        assert data["update_available"] is False

    @patch("backend.api.version._fetch_latest_release")
    def test_check_version_update_available(self, mock_fetch):
        """Returns update_available when a newer version exists."""
        mock_fetch.return_value = {
            "last_check": datetime.now(timezone.utc),
            "latest_version": "99.99.99",
            "release_url": "https://github.com/test",
            "release_notes": "big update",
            "error": None,
        }
        response = client.get("/api/version")
        assert response.status_code == 200
        data = response.json()
        assert data["update_available"] is True
        assert data["latest_version"] == "99.99.99"
        assert data["release_url"] == "https://github.com/test"

    @patch("backend.api.version._fetch_latest_release")
    def test_check_version_with_error(self, mock_fetch):
        """Returns error when fetch fails."""
        mock_fetch.return_value = {
            "last_check": datetime.now(timezone.utc),
            "latest_version": None,
            "release_url": None,
            "release_notes": None,
            "error": "Rate limited - try again later",
        }
        response = client.get("/api/version")
        assert response.status_code == 200
        data = response.json()
        assert data["update_available"] is False
        assert data["error"] == "Rate limited - try again later"


class TestErrorCacheTTL:
    """Tests for shorter error cache duration."""

    def setup_method(self):
        _reset_version_cache()

    def test_error_cache_expires_after_5_minutes(self):
        """Error responses use a shorter cache TTL than successes."""
        import backend.api.version as v

        # Simulate a cached error from 6 minutes ago
        v._cache["last_check"] = datetime.now(timezone.utc) - timedelta(minutes=6)
        v._cache["error"] = "Request timed out"
        v._cache["latest_version"] = None

        # Cache should be stale — _fetch_latest_release would re-fetch
        # We verify by checking the TTL logic directly
        from backend.api.version import ERROR_CACHE_DURATION

        cache_age = datetime.now(timezone.utc) - v._cache["last_check"]
        assert cache_age > ERROR_CACHE_DURATION

    def test_success_cache_survives_5_minutes(self):
        """Successful responses use the full 1-hour cache."""
        import backend.api.version as v

        v._cache["last_check"] = datetime.now(timezone.utc) - timedelta(minutes=6)
        v._cache["error"] = None
        v._cache["latest_version"] = "1.0.0"

        from backend.api.version import CACHE_DURATION

        cache_age = datetime.now(timezone.utc) - v._cache["last_check"]
        assert cache_age < CACHE_DURATION


class TestUpgradeStatus:
    """Tests for GET /api/version/upgrade/status."""

    def setup_method(self):
        _reset_version_cache()

    def test_upgrade_status_idle(self):
        """Returns idle state when no upgrade is in progress."""
        response = client.get("/api/version/upgrade/status")
        assert response.status_code == 200
        data = response.json()
        assert data["state"] == "idle"
        assert data["progress"] == 0.0

    def test_upgrade_status_reflects_state(self):
        """Returns current upgrade state."""
        import backend.api.version as v

        v._upgrade_state["state"] = "downloading"
        v._upgrade_state["progress"] = 50.0
        v._upgrade_state["version"] = "1.0.0"
        response = client.get("/api/version/upgrade/status")
        data = response.json()
        assert data["state"] == "downloading"
        assert data["progress"] == 50.0
        assert data["version"] == "1.0.0"


class TestStartUpgrade:
    """Tests for POST /api/version/upgrade/start."""

    def setup_method(self):
        _reset_version_cache()

    @patch("backend.api.version.is_upgrade_supported", return_value=False)
    def test_start_upgrade_not_supported(self, mock_supported):
        """Returns error when upgrade is not supported on the platform."""
        response = client.post("/api/version/upgrade/start")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert "not supported" in data["error"].lower()

    @patch("backend.api.version.is_upgrade_supported", return_value=True)
    @patch("backend.api.version._fetch_latest_release")
    def test_start_upgrade_no_version(self, mock_fetch, mock_supported):
        """Returns error when no version is available."""
        mock_fetch.return_value = {
            "last_check": datetime.now(timezone.utc),
            "latest_version": None,
            "release_url": None,
            "release_notes": None,
            "error": "No releases found",
        }
        response = client.post("/api/version/upgrade/start")
        data = response.json()
        assert data["success"] is False

    @patch("backend.api.version.is_upgrade_supported", return_value=True)
    def test_start_upgrade_already_downloading(self, mock_supported):
        """Returns error when upgrade is already in progress."""
        import backend.api.version as v

        v._upgrade_state["state"] = "downloading"
        response = client.post("/api/version/upgrade/start")
        data = response.json()
        assert data["success"] is False
        assert "already in progress" in data["error"].lower()

    @patch("backend.api.version.is_upgrade_supported", return_value=True)
    @patch("backend.api.version._fetch_latest_release")
    def test_start_upgrade_already_up_to_date(self, mock_fetch, mock_supported):
        """Returns error when already on the latest version."""
        from backend.version import APP_VERSION

        mock_fetch.return_value = {
            "last_check": datetime.now(timezone.utc),
            "latest_version": APP_VERSION.lstrip("v"),
            "release_url": "https://github.com/test",
            "release_notes": "same version",
            "error": None,
        }
        response = client.post("/api/version/upgrade/start")
        data = response.json()
        assert data["success"] is False
        assert "up to date" in data["error"].lower()

    @patch("backend.api.version.is_upgrade_supported", return_value=True)
    @patch("backend.api.version._fetch_latest_release")
    def test_start_upgrade_success(self, mock_fetch, mock_supported):
        """Successfully starts an upgrade."""
        mock_fetch.return_value = {
            "last_check": datetime.now(timezone.utc),
            "latest_version": "2.0.0",
            "release_url": "https://github.com/test",
            "release_notes": "new version",
            "error": None,
        }
        response = client.post("/api/version/upgrade/start")
        data = response.json()
        assert data["success"] is True
        assert data["version"] == "2.0.0"


class TestInstallUpgrade:
    """Tests for POST /api/version/upgrade/install."""

    def setup_method(self):
        _reset_version_cache()

    def test_install_upgrade_wrong_state(self):
        """Returns error when not in 'ready' state."""
        response = client.post("/api/version/upgrade/install")
        data = response.json()
        assert data["success"] is False
        assert "idle" in data["error"]

    def test_install_upgrade_no_installer(self):
        """Returns error when installer path is missing."""
        import backend.api.version as v

        v._upgrade_state["state"] = "ready"
        v._upgrade_state["installer_path"] = None
        response = client.post("/api/version/upgrade/install")
        data = response.json()
        assert data["success"] is False
        assert "not found" in data["error"].lower()

    @patch("backend.api.version.asyncio.create_task")
    @patch("backend.api.version.launch_installer", return_value=True)
    def test_install_upgrade_success(self, mock_launch, mock_create_task, tmp_path):
        """Successfully launches installer when ready."""
        import backend.api.version as v

        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        v._upgrade_state["state"] = "ready"
        v._upgrade_state["installer_path"] = installer
        response = client.post("/api/version/upgrade/install")
        data = response.json()
        assert data["success"] is True
        mock_create_task.assert_called_once()

    @patch("backend.api.version.launch_installer", return_value=False)
    def test_install_upgrade_failure(self, mock_launch, tmp_path):
        """Returns error when installer launch fails."""
        import backend.api.version as v

        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        v._upgrade_state["state"] = "ready"
        v._upgrade_state["installer_path"] = installer
        response = client.post("/api/version/upgrade/install")
        data = response.json()
        assert data["success"] is False


class TestCancelUpgrade:
    """Tests for POST /api/version/upgrade/cancel."""

    def setup_method(self):
        _reset_version_cache()

    @patch("backend.api.version.cleanup_upgrade_files")
    def test_cancel_upgrade(self, mock_cleanup):
        """Cancelling resets state to idle."""
        import backend.api.version as v

        v._upgrade_state["state"] = "downloading"
        v._upgrade_state["progress"] = 50.0
        response = client.post("/api/version/upgrade/cancel")
        data = response.json()
        assert data["success"] is True
        assert v._upgrade_state["state"] == "idle"
        assert v._upgrade_state["progress"] == 0.0
        mock_cleanup.assert_called_once()


class TestParseVersion:
    """Tests for version parsing and comparison helpers."""

    def test_parse_version_with_v_prefix(self):
        from backend.api.version import _parse_version

        assert _parse_version("v1.2.3") == (1, 2, 3)

    def test_parse_version_without_prefix(self):
        from backend.api.version import _parse_version

        assert _parse_version("0.5.1") == (0, 5, 1)

    def test_parse_version_invalid(self):
        from backend.api.version import _parse_version

        assert _parse_version("invalid") == (0, 0, 0)

    def test_is_newer_true(self):
        from backend.api.version import _is_newer

        assert _is_newer("1.1.0", "1.0.0") is True

    def test_is_newer_false_same(self):
        from backend.api.version import _is_newer

        assert _is_newer("1.0.0", "1.0.0") is False

    def test_is_newer_false_older(self):
        from backend.api.version import _is_newer

        assert _is_newer("0.9.0", "1.0.0") is False
