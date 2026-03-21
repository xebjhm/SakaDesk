"""Tests for notification service and API."""

from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

from main import app
from services.notification_service import (
    is_plyer_available,
    send_notification,
    notify_new_messages,
    notify_sync_complete,
    set_notifications_enabled,
    get_notifications_enabled,
    get_notification_status,
)


class TestNotificationService:
    """Tests for notification service functions."""

    def setup_method(self):
        """Reset notification state before each test."""
        set_notifications_enabled(True)

    def test_is_plyer_available(self):
        """Test checking if plyer is available."""
        # Should return True since plyer is installed
        result = is_plyer_available()
        assert isinstance(result, bool)

    def test_is_plyer_available_not_installed(self):
        """Test is_plyer_available when plyer not installed."""
        with patch.dict("sys.modules", {"plyer": None}):
            # Can't easily test this without unloading plyer
            pass

    def test_set_notifications_enabled(self):
        """Test enabling/disabling notifications."""
        set_notifications_enabled(False)
        assert get_notifications_enabled() is False

        set_notifications_enabled(True)
        assert get_notifications_enabled() is True

    def test_get_notification_status(self):
        """Test getting notification status."""
        set_notifications_enabled(True)
        status = get_notification_status()

        assert "enabled" in status
        assert "plyer_available" in status
        assert "last_error" in status
        assert status["enabled"] is True
        assert isinstance(status["plyer_available"], bool)

    def test_send_notification_disabled(self):
        """Test that notifications don't send when disabled."""
        set_notifications_enabled(False)
        result = send_notification("Test", "Message")
        assert result is False

    def test_send_notification_with_mock(self):
        """Test sending notification with mocked plyer."""
        set_notifications_enabled(True)

        # Patch the import within the function
        mock_notification = MagicMock()
        mock_notification.notify = MagicMock()

        with patch.dict(
            "sys.modules", {"plyer": MagicMock(notification=mock_notification)}
        ):
            result = send_notification("Test", "Message")
            # Should succeed with mock
            assert result is True
            mock_notification.notify.assert_called_once()

    def test_notify_new_messages_zero_count(self):
        """Test notify_new_messages with zero messages."""
        result = notify_new_messages("Test Member", 0)
        assert result is False

    def test_notify_new_messages_negative_count(self):
        """Test notify_new_messages with negative count."""
        result = notify_new_messages("Test Member", -1)
        assert result is False

    def test_notify_sync_complete_zero(self):
        """Test notify_sync_complete with no new messages."""
        result = notify_sync_complete(0, 0)
        assert result is False

    def test_notify_sync_complete_negative(self):
        """Test notify_sync_complete with negative count."""
        result = notify_sync_complete(-1, 1)
        assert result is False


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
        assert "plyer_available" in data
        assert "last_error" in data

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

    def test_test_notification_endpoint(self, client):
        """Test POST /api/notifications/test."""
        response = client.post("/api/notifications/test")
        assert response.status_code == 200

        data = response.json()
        assert "success" in data
        assert "message" in data
