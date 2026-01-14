import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


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
