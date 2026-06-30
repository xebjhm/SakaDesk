from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


class TestManualToken:
    """POST /api/auth/manual-token — bootstrap a mobile session from a refresh_token."""

    def test_validates_via_refresh_then_saves_session_and_activates_mobile(self):
        with (
            patch("backend.services.auth_service.Client") as MockClient,
            patch("backend.services.auth_service.get_token_manager") as mock_tm,
            patch(
                "backend.services.settings_store.update_config", new_callable=AsyncMock
            ) as mock_update,
        ):
            inst = MockClient.return_value
            inst.refresh_access_token = AsyncMock(return_value=True)
            inst.access_token = "fresh-AT"
            inst.refresh_token = "rotated-RT"

            res = client.post(
                "/api/auth/manual-token",
                json={"service": "hinatazaka46", "refresh_token": "user-RT"},
            )
            assert res.status_code == 200
            # The freshly minted access_token + (rotated) refresh_token get persisted.
            mock_tm.return_value.save_session.assert_called_once()
            args = mock_tm.return_value.save_session.call_args[0]
            assert args[1] == "fresh-AT"
            assert args[2] == "rotated-RT"
            assert args[3] == {}  # no web cookies in mobile mode
            # A valid token activates mobile mode for the service.
            mock_update.assert_called_once()

    def test_rejects_invalid_refresh_without_saving(self):
        with (
            patch("backend.services.auth_service.Client") as MockClient,
            patch("backend.services.auth_service.get_token_manager") as mock_tm,
        ):
            inst = MockClient.return_value
            inst.refresh_access_token = AsyncMock(return_value=False)
            inst.access_token = None

            res = client.post(
                "/api/auth/manual-token",
                json={"service": "hinatazaka46", "refresh_token": "bad-RT"},
            )
            assert res.status_code == 401
            mock_tm.return_value.save_session.assert_not_called()

    def test_invalid_service_returns_400(self):
        res = client.post(
            "/api/auth/manual-token",
            json={"service": "not_a_service", "refresh_token": "x"},
        )
        assert res.status_code == 400

    def test_missing_refresh_token_returns_422(self):
        res = client.post("/api/auth/manual-token", json={"service": "hinatazaka46"})
        assert res.status_code == 422

    def test_blank_refresh_token_returns_422(self):
        res = client.post(
            "/api/auth/manual-token",
            json={"service": "hinatazaka46", "refresh_token": "   "},
        )
        assert res.status_code == 422


def test_get_status_returns_all_services():
    """GET /api/auth/status returns status for all services."""
    response = client.get("/api/auth/status")
    assert response.status_code == 200
    data = response.json()
    assert "services" in data
    assert "hinatazaka46" in data["services"]
    assert "nogizaka46" in data["services"]
    assert "sakurazaka46" in data["services"]


def test_login_requires_service_param():
    """POST /api/auth/login without service param returns 422."""
    response = client.post("/api/auth/login")
    assert response.status_code == 422


def test_refresh_requires_service_param():
    """POST /api/auth/refresh-if-needed without service param returns 422."""
    response = client.post("/api/auth/refresh-if-needed")
    assert response.status_code == 422


def test_logout_requires_service_param():
    """POST /api/auth/logout without service param returns 422."""
    response = client.post("/api/auth/logout")
    assert response.status_code == 422


def test_login_invalid_service_returns_400():
    """POST /api/auth/login with invalid service returns 400."""
    response = client.post("/api/auth/login?service=invalid_service")
    assert response.status_code == 400


def test_logout_invalid_service_returns_400():
    """POST /api/auth/logout with invalid service returns 400."""
    response = client.post("/api/auth/logout?service=invalid_service")
    assert response.status_code == 400


def test_refresh_invalid_service_returns_400():
    """POST /api/auth/refresh-if-needed with invalid service returns 400."""
    response = client.post("/api/auth/refresh-if-needed?service=invalid_service")
    assert response.status_code == 400
