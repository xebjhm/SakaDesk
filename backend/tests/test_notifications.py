"""Notification API endpoints (the service itself: test_notification_service.py)."""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.services import notification_service as ns


class TestNotificationAPI:
    """Tests for notification API endpoints."""

    @pytest.fixture
    def client(self):
        return TestClient(app)

    def test_get_notification_status(self, client):
        """Test GET /api/notifications returns status."""
        response = client.get("/api/notifications")
        assert response.status_code == 200

        data = response.json()
        assert "enabled" in data
        assert set(data) == {"enabled", "available", "backend", "last_error", "aumid"}
        assert data["aumid"] == "SakaDesk"
        assert isinstance(data["available"], bool)

    def test_update_notification_settings_enable(self, client):
        """Test enabling notifications via PUT."""
        response = client.put("/api/notifications", json={"enabled": True})
        assert response.status_code == 200
        assert response.json()["enabled"] is True

    def test_update_notification_settings_disable(self, client):
        """Test disabling notifications via PUT."""
        response = client.put("/api/notifications", json={"enabled": False})
        assert response.status_code == 200
        assert response.json()["enabled"] is False

    def test_update_notification_settings_invalid(self, client):
        """Test PUT with invalid body."""
        response = client.put("/api/notifications", json={})
        assert response.status_code == 422  # Missing required field

    @pytest.mark.parametrize(
        ("language", "body"),
        [
            ("en", "Notifications are working"),
            ("ja", "通知は正常に動作しています"),
            ("zh-TW", "通知運作正常"),
            (None, "Notifications are working"),
        ],
    )
    def test_test_notification_endpoint_uses_i18n_strings(self, client, language, body):
        """POST /api/notifications/test sends the localized test strings."""
        shown = []

        class Fake:
            def show(self, plan):
                shown.append(plan)
                return True

            def status(self):
                return {}

        async def fake_config():
            return {"language": language}

        with (
            patch.object(ns, "get_notifier", lambda: Fake()),
            patch("backend.api.notifications.load_config", fake_config),
            patch("backend.services.app_state.get_prefs", lambda: {}),
        ):
            response = client.post("/api/notifications/test")
        assert response.status_code == 200
        data = response.json()
        assert data == {"success": True, "title": "SakaDesk", "body": body}
        assert [(p.title, p.body) for p in shown] == [("SakaDesk", body)]

    def test_test_notification_uses_the_language_chosen_in_settings(self, client):
        """The Settings choice (app_state prefs) beats settings.json."""

        class Fake:
            def show(self, plan):
                return True

            def status(self):
                return {}

        async def fake_config():
            return {"language": "en"}

        with (
            patch.object(ns, "get_notifier", lambda: Fake()),
            patch("backend.api.notifications.load_config", fake_config),
            patch("backend.services.app_state.get_prefs", lambda: {"language": "ja"}),
        ):
            response = client.post("/api/notifications/test")
        assert response.json()["body"] == "通知は正常に動作しています"

    def test_test_notification_endpoint_reports_unavailable(self, client):
        """Off Windows the Null notifier cannot show it: success is False."""
        ns._reset_notifier_for_tests()
        with patch.object(ns, "_is_windows", lambda: False):
            response = client.post("/api/notifications/test")
        ns._reset_notifier_for_tests()
        assert response.status_code == 200
        assert response.json()["success"] is False
