"""Tests for AuthService multi-service support."""
import asyncio

import pytest
from unittest.mock import patch, MagicMock
from backend.services.auth_service import AuthService


@pytest.fixture
def auth_service():
    return AuthService()


def test_get_all_status_returns_all_services(auth_service):
    """get_status() with no args returns status for all services."""
    with patch('backend.services.auth_service.get_token_manager') as mock_tm:
        mock_tm.return_value.load_session.return_value = None

        result = asyncio.run(auth_service.get_status())

        assert "services" in result
        assert "hinatazaka46" in result["services"]
        assert "nogizaka46" in result["services"]
        assert "sakurazaka46" in result["services"]


def test_get_status_single_service(auth_service):
    """get_status(service) returns status for specific service only."""
    with patch('backend.services.auth_service.get_token_manager') as mock_tm:
        mock_tm.return_value.load_session.return_value = None

        result = asyncio.run(auth_service.get_status(service="hinatazaka46"))

        assert "authenticated" in result
        assert result["authenticated"] == False


def test_get_status_invalid_service(auth_service):
    """get_status with invalid service raises ValueError."""
    with pytest.raises(ValueError):
        asyncio.run(auth_service.get_status(service="invalid"))


def test_login_with_browser_requires_service(auth_service):
    """login_with_browser requires a service parameter."""
    with pytest.raises(TypeError):
        asyncio.run(auth_service.login_with_browser())


def test_logout_requires_service(auth_service):
    """logout requires a service parameter."""
    with pytest.raises(TypeError):
        auth_service.logout()


def test_get_config_requires_service(auth_service):
    """get_config requires a service parameter."""
    with pytest.raises(TypeError):
        auth_service.get_config()


def test_refresh_if_needed_requires_service(auth_service):
    """refresh_if_needed requires a service parameter."""
    with pytest.raises(TypeError):
        asyncio.run(auth_service.refresh_if_needed())


def test_get_status_authenticated_valid_token(auth_service):
    """get_status returns authenticated=True for valid token."""
    with patch('backend.services.auth_service.get_token_manager') as mock_tm:
        mock_tm.return_value.load_session.return_value = {
            'access_token': 'test_token',
        }
        with patch.object(auth_service, '_is_token_expired', return_value=False):
            result = asyncio.run(auth_service.get_status(service="hinatazaka46"))
            assert result["authenticated"] == True


def test_get_status_expired_token(auth_service):
    """get_status returns token_expired=True for expired token."""
    with patch('backend.services.auth_service.get_token_manager') as mock_tm:
        mock_tm.return_value.load_session.return_value = {
            'access_token': 'expired_token',
        }
        with patch.object(auth_service, '_is_token_expired', return_value=True):
            result = asyncio.run(auth_service.get_status(service="hinatazaka46"))
            assert result["authenticated"] == False
            assert result.get("token_expired") == True


def test_logout_clears_credentials(auth_service):
    """logout calls TokenManager.delete_session with correct service."""
    with patch('backend.services.auth_service.get_token_manager') as mock_tm:
        auth_service.logout(service="hinatazaka46")
        mock_tm.return_value.delete_session.assert_called_once_with("hinatazaka46")
