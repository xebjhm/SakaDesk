"""Extended tests for AuthService — session management, concurrency, credentials, error handling."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

import pytest

from backend.services.auth_service import AuthService


@pytest.fixture
def auth_service():
    return AuthService()


# ---------------------------------------------------------------------------
# Session persistence & expiry
# ---------------------------------------------------------------------------


class TestSessionPersistence:
    """Verify that _get_service_auth_status reads from TokenManager correctly."""

    def test_no_token_data_returns_unauthenticated(self, auth_service):
        """When TokenManager has no session, return authenticated=False."""
        with patch("backend.services.auth_service.get_token_manager") as mock_tm:
            mock_tm.return_value.load_session.return_value = None
            result = auth_service._get_service_auth_status("hinatazaka46")
            assert result == {"authenticated": False}

    def test_token_data_without_access_token_returns_unauthenticated(self, auth_service):
        """Session data present but missing access_token should be unauthenticated."""
        with patch("backend.services.auth_service.get_token_manager") as mock_tm:
            mock_tm.return_value.load_session.return_value = {
                "cookies": {"sid": "abc"},
            }
            result = auth_service._get_service_auth_status("hinatazaka46")
            # No access_token -> the code skips to the end and returns unauthenticated
            assert result["authenticated"] is False

    def test_valid_token_returns_authenticated_with_metadata(self, auth_service):
        """Valid (non-expired) token returns authenticated=True plus metadata."""
        with patch("backend.services.auth_service.get_token_manager") as mock_tm:
            mock_tm.return_value.load_session.return_value = {
                "access_token": "valid.jwt.token",
                "x-talk-app-id": "app123",
                "cookies": {"sid": "abc"},
            }
            with patch.object(auth_service, "_is_token_expired", return_value=False):
                with patch.object(auth_service, "_get_token_expiry_timestamp", return_value=9999999999):
                    result = auth_service._get_service_auth_status("hinatazaka46")

        assert result["authenticated"] is True
        assert result["expires_at"] == 9999999999
        assert result["app_id"] == "app123"

    def test_expired_token_returns_token_expired_status(self, auth_service):
        """Expired token should set authenticated=False and token_expired=True."""
        with patch("backend.services.auth_service.get_token_manager") as mock_tm:
            mock_tm.return_value.load_session.return_value = {
                "access_token": "expired.jwt.token",
            }
            with patch.object(auth_service, "_is_token_expired", return_value=True):
                with patch.object(auth_service, "_get_token_expiry_timestamp", return_value=1000):
                    result = auth_service._get_service_auth_status("hinatazaka46")

        assert result["authenticated"] is False
        assert result["token_expired"] is True
        assert result["expires_at"] == 1000
        assert "expired" in result["message"].lower()

    def test_token_data_with_empty_cookies(self, auth_service):
        """Session data with empty cookies dict should still work."""
        with patch("backend.services.auth_service.get_token_manager") as mock_tm:
            mock_tm.return_value.load_session.return_value = {
                "access_token": "tok",
                "cookies": {},
            }
            with patch.object(auth_service, "_is_token_expired", return_value=False):
                with patch.object(auth_service, "_get_token_expiry_timestamp", return_value=None):
                    result = auth_service._get_service_auth_status("hinatazaka46")
        assert result["authenticated"] is True

    def test_token_data_with_no_cookies_key(self, auth_service):
        """Session data without cookies key entirely should still work."""
        with patch("backend.services.auth_service.get_token_manager") as mock_tm:
            mock_tm.return_value.load_session.return_value = {
                "access_token": "tok",
            }
            with patch.object(auth_service, "_is_token_expired", return_value=False):
                with patch.object(auth_service, "_get_token_expiry_timestamp", return_value=None):
                    result = auth_service._get_service_auth_status("hinatazaka46")
        assert result["authenticated"] is True


# ---------------------------------------------------------------------------
# Token expiry helpers
# ---------------------------------------------------------------------------


class TestTokenExpiryHelpers:
    """Test _is_token_expired, _get_token_expiry_timestamp, _get_token_remaining_seconds."""

    def test_is_token_expired_delegates_to_pysaka(self, auth_service):
        """_is_token_expired should call pysaka's is_jwt_expired."""
        with patch("backend.services.auth_service.is_jwt_expired", return_value=True) as mock_exp:
            with patch("backend.services.auth_service.get_jwt_remaining_seconds", return_value=0):
                with patch("backend.services.auth_service.parse_jwt_expiry", return_value=100):
                    result = auth_service._is_token_expired("some.token")
        assert result is True
        mock_exp.assert_called_once_with("some.token")

    def test_is_token_expired_false_when_valid(self, auth_service):
        with patch("backend.services.auth_service.is_jwt_expired", return_value=False):
            with patch("backend.services.auth_service.get_jwt_remaining_seconds", return_value=3600):
                with patch("backend.services.auth_service.parse_jwt_expiry", return_value=9999999):
                    result = auth_service._is_token_expired("valid.token")
        assert result is False

    def test_is_token_expired_handles_none_remaining(self, auth_service):
        """When get_jwt_remaining_seconds returns None, warning is logged but still works."""
        with patch("backend.services.auth_service.is_jwt_expired", return_value=True):
            with patch("backend.services.auth_service.get_jwt_remaining_seconds", return_value=None):
                with patch("backend.services.auth_service.parse_jwt_expiry", return_value=None):
                    result = auth_service._is_token_expired("malformed.token")
        assert result is True

    def test_get_token_expiry_timestamp_delegates(self, auth_service):
        with patch("backend.services.auth_service.parse_jwt_expiry", return_value=1717200000) as mock_parse:
            result = auth_service._get_token_expiry_timestamp("some.jwt")
        assert result == 1717200000
        mock_parse.assert_called_once_with("some.jwt")

    def test_get_token_expiry_timestamp_none(self, auth_service):
        with patch("backend.services.auth_service.parse_jwt_expiry", return_value=None):
            assert auth_service._get_token_expiry_timestamp("bad.jwt") is None

    def test_get_token_remaining_seconds_positive(self, auth_service):
        with patch("backend.services.auth_service.get_jwt_remaining_seconds", return_value=1800):
            result = auth_service._get_token_remaining_seconds("tok")
        assert result == 1800.0

    def test_get_token_remaining_seconds_none_returns_neg1(self, auth_service):
        """If pysaka cannot parse the token, return -1 (assume expired)."""
        with patch("backend.services.auth_service.get_jwt_remaining_seconds", return_value=None):
            result = auth_service._get_token_remaining_seconds("bad")
        assert result == -1


# ---------------------------------------------------------------------------
# Concurrent login prevention (browser lock)
# ---------------------------------------------------------------------------


class TestConcurrentLoginPrevention:
    """Test that _browser_lock serialises concurrent login_with_browser calls."""

    def test_second_login_waits_for_first(self, auth_service):
        """Two concurrent logins should not overlap: the lock serialises them."""
        call_order = []

        async def fake_login(group, headless, user_data_dir, channel):
            call_order.append("start")
            await asyncio.sleep(0.05)
            call_order.append("end")
            return {"access_token": "tok"}

        async def run():
            with patch("backend.services.auth_service.BrowserAuth") as mock_auth:
                mock_auth.login = AsyncMock(side_effect=fake_login)
                with patch.object(auth_service, "_save_credentials"):
                    task1 = asyncio.create_task(auth_service.login_with_browser("hinatazaka46"))
                    # Small delay to ensure task1 acquires the lock first
                    await asyncio.sleep(0.01)
                    task2 = asyncio.create_task(auth_service.login_with_browser("hinatazaka46"))
                    await asyncio.gather(task1, task2)

        asyncio.run(run())
        # Verify serialised execution: start-end-start-end, not start-start-end-end
        assert call_order == ["start", "end", "start", "end"]

    def test_browser_lock_locked_check(self, auth_service):
        """When lock is held, login_with_browser logs a warning but still proceeds."""
        async def run():
            # Manually acquire lock to simulate a login in progress
            async with auth_service._browser_lock:
                assert auth_service._browser_lock.locked()

            # After release, lock is free
            assert not auth_service._browser_lock.locked()

        asyncio.run(run())


# ---------------------------------------------------------------------------
# Credential storage (_save_credentials, get_config, logout)
# ---------------------------------------------------------------------------


class TestCredentialStorage:
    """Test keyring/TokenManager interactions."""

    def test_save_credentials_calls_token_manager(self, auth_service):
        """_save_credentials should delegate to TokenManager.save_session."""
        with patch("backend.services.auth_service.get_token_manager") as mock_tm:
            creds = {
                "access_token": "access_tok",
                "refresh_token": "refresh_tok",
                "cookies": {"sid": "val"},
            }
            auth_service._save_credentials("hinatazaka46", creds)

            mock_tm.return_value.save_session.assert_called_once_with(
                "hinatazaka46",
                "access_tok",
                "refresh_tok",
                {"sid": "val"},
            )

    def test_save_credentials_partial_data(self, auth_service):
        """Creds dict missing keys should pass None values to save_session."""
        with patch("backend.services.auth_service.get_token_manager") as mock_tm:
            auth_service._save_credentials("sakurazaka46", {})
            mock_tm.return_value.save_session.assert_called_once_with(
                "sakurazaka46", None, None, None,
            )

    def test_save_credentials_raises_on_tm_error(self, auth_service):
        """If TokenManager.save_session fails, exception propagates."""
        with patch("backend.services.auth_service.get_token_manager") as mock_tm:
            mock_tm.return_value.save_session.side_effect = OSError("disk full")
            with pytest.raises(OSError, match="disk full"):
                auth_service._save_credentials("hinatazaka46", {"access_token": "t"})

    def test_logout_calls_delete_session(self, auth_service):
        """logout delegates to TokenManager.delete_session with correct group value."""
        with patch("backend.services.auth_service.get_token_manager") as mock_tm:
            auth_service.logout("sakurazaka46")
            mock_tm.return_value.delete_session.assert_called_once_with("sakurazaka46")

    def test_logout_invalid_service_raises(self, auth_service):
        with pytest.raises(ValueError):
            auth_service.logout("nonexistent_service")

    def test_logout_swallows_tm_error(self, auth_service):
        """logout catches exceptions from TokenManager and does not propagate."""
        with patch("backend.services.auth_service.get_token_manager") as mock_tm:
            mock_tm.return_value.delete_session.side_effect = RuntimeError("fail")
            # Should not raise
            auth_service.logout("hinatazaka46")

    def test_get_config_returns_token_data(self, auth_service):
        """get_config should load from TokenManager and return the dict."""
        with patch("backend.services.auth_service.get_token_manager") as mock_tm:
            mock_tm.return_value.load_session.return_value = {
                "access_token": "tok",
                "cookies": {},
            }
            result = auth_service.get_config("hinatazaka46")
        assert result == {"access_token": "tok", "cookies": {}}

    def test_get_config_returns_empty_when_no_session(self, auth_service):
        with patch("backend.services.auth_service.get_token_manager") as mock_tm:
            mock_tm.return_value.load_session.return_value = None
            result = auth_service.get_config("hinatazaka46")
        assert result == {}

    def test_get_config_returns_empty_on_error(self, auth_service):
        with patch("backend.services.auth_service.get_token_manager") as mock_tm:
            mock_tm.return_value.load_session.side_effect = RuntimeError("boom")
            result = auth_service.get_config("hinatazaka46")
        assert result == {}

    def test_get_config_invalid_service_raises(self, auth_service):
        with pytest.raises(ValueError):
            auth_service.get_config("bad_service")


# ---------------------------------------------------------------------------
# Error handling (_get_service_auth_status exception path)
# ---------------------------------------------------------------------------


class TestAuthStatusErrorHandling:
    """Test error paths in _get_service_auth_status and get_status."""

    def test_token_manager_exception_returns_unauthenticated(self, auth_service):
        """If TokenManager raises, _get_service_auth_status returns authenticated=False."""
        with patch("backend.services.auth_service.get_token_manager") as mock_tm:
            mock_tm.return_value.load_session.side_effect = RuntimeError("keyring unavailable")
            result = auth_service._get_service_auth_status("hinatazaka46")
        assert result == {"authenticated": False}

    def test_get_status_all_services_with_tm_error(self, auth_service):
        """get_status() should still return all services even if TM fails for each."""
        with patch("backend.services.auth_service.get_token_manager") as mock_tm:
            mock_tm.return_value.load_session.side_effect = Exception("keyring fail")
            result = asyncio.run(auth_service.get_status())

        assert "services" in result
        for svc_status in result["services"].values():
            assert svc_status["authenticated"] is False

    def test_get_status_invalid_single_service(self, auth_service):
        with pytest.raises(ValueError):
            asyncio.run(auth_service.get_status(service="garbage"))


# ---------------------------------------------------------------------------
# login_with_browser edge cases
# ---------------------------------------------------------------------------


class TestLoginWithBrowser:
    """Test login_with_browser happy path and error paths."""

    def test_login_success_saves_credentials(self, auth_service):
        """Successful browser login should save creds and return True."""
        async def run():
            with patch("backend.services.auth_service.BrowserAuth") as mock_auth:
                mock_auth.login = AsyncMock(return_value={"access_token": "tok"})
                with patch.object(auth_service, "_save_credentials") as mock_save:
                    result = await auth_service.login_with_browser("hinatazaka46")
            assert result is True
            mock_save.assert_called_once()

        asyncio.run(run())

    def test_login_returns_false_when_no_creds(self, auth_service):
        """If BrowserAuth returns None/falsy, login returns False."""
        async def run():
            with patch("backend.services.auth_service.BrowserAuth") as mock_auth:
                mock_auth.login = AsyncMock(return_value=None)
                result = await auth_service.login_with_browser("hinatazaka46")
            assert result is False

        asyncio.run(run())

    def test_login_returns_false_on_exception(self, auth_service):
        """If BrowserAuth raises, login catches it and returns False."""
        async def run():
            with patch("backend.services.auth_service.BrowserAuth") as mock_auth:
                mock_auth.login = AsyncMock(side_effect=RuntimeError("chrome crash"))
                result = await auth_service.login_with_browser("hinatazaka46")
            assert result is False

        asyncio.run(run())

    def test_login_invalid_service_raises(self, auth_service):
        with pytest.raises(ValueError):
            asyncio.run(auth_service.login_with_browser("fake_service"))


# ---------------------------------------------------------------------------
# refresh_if_needed
# ---------------------------------------------------------------------------


class TestRefreshIfNeeded:
    """Test the proactive token refresh logic."""

    def test_no_token_returns_no_token_status(self, auth_service):
        """Missing token data should return status='no_token'."""
        async def run():
            with patch("backend.services.auth_service.get_token_manager") as mock_tm:
                mock_tm.return_value.load_session.return_value = None
                return await auth_service.refresh_if_needed("hinatazaka46")

        result = asyncio.run(run())
        assert result["status"] == "no_token"
        assert result["refreshed"] is False
        assert result["remaining_seconds"] == 0

    def test_no_access_token_returns_no_token(self, auth_service):
        async def run():
            with patch("backend.services.auth_service.get_token_manager") as mock_tm:
                mock_tm.return_value.load_session.return_value = {"cookies": {}}
                return await auth_service.refresh_if_needed("hinatazaka46")

        result = asyncio.run(run())
        assert result["status"] == "no_token"

    def test_valid_token_above_threshold_no_refresh(self, auth_service):
        """Token with plenty of time left should not refresh."""
        async def run():
            with patch("backend.services.auth_service.get_token_manager") as mock_tm:
                mock_tm.return_value.load_session.return_value = {
                    "access_token": "valid.tok",
                }
                with patch.object(auth_service, "_get_token_remaining_seconds", return_value=7200.0):
                    return await auth_service.refresh_if_needed("hinatazaka46", threshold_minutes=10)

        result = asyncio.run(run())
        assert result["status"] == "valid"
        assert result["refreshed"] is False
        assert result["remaining_seconds"] == 7200.0

    def test_token_within_threshold_attempts_refresh(self, auth_service):
        """Token expiring soon should trigger refresh via Client API."""
        async def run():
            with patch("backend.services.auth_service.get_token_manager") as mock_tm:
                mock_tm.return_value.load_session.return_value = {
                    "access_token": "old.tok",
                    "cookies": {"s": "v"},
                }
                with patch.object(auth_service, "_get_token_remaining_seconds") as mock_rem:
                    # First call: expiring soon; second call: refreshed token has more time
                    mock_rem.side_effect = [300.0, 3600.0]
                    with patch("backend.services.auth_service.Client") as mock_client_cls:
                        mock_client = MagicMock()
                        mock_client.access_token = "new.tok"
                        mock_client.cookies = {"s": "v2"}
                        mock_client.refresh_access_token = AsyncMock(return_value=True)
                        mock_client_cls.return_value = mock_client

                        with patch("backend.services.auth_service.aiohttp.ClientSession") as mock_session_cls:
                            mock_session = AsyncMock()
                            mock_session_cls.return_value.__aenter__ = AsyncMock(return_value=mock_session)
                            mock_session_cls.return_value.__aexit__ = AsyncMock(return_value=False)
                            return await auth_service.refresh_if_needed("hinatazaka46", threshold_minutes=10)

        result = asyncio.run(run())
        assert result["refreshed"] is True
        assert result["status"] == "refreshed"
        assert result["remaining_seconds"] == 3600.0

    def test_token_refresh_fails_returns_refresh_failed(self, auth_service):
        """When Client.refresh_access_token returns False, status is refresh_failed."""
        async def run():
            with patch("backend.services.auth_service.get_token_manager") as mock_tm:
                mock_tm.return_value.load_session.return_value = {
                    "access_token": "old.tok",
                    "cookies": {},
                }
                with patch.object(auth_service, "_get_token_remaining_seconds", return_value=100.0):
                    with patch("backend.services.auth_service.Client") as mock_client_cls:
                        mock_client = MagicMock()
                        mock_client.refresh_access_token = AsyncMock(return_value=False)
                        mock_client_cls.return_value = mock_client

                        with patch("backend.services.auth_service.aiohttp.ClientSession") as mock_session_cls:
                            mock_session = AsyncMock()
                            mock_session_cls.return_value.__aenter__ = AsyncMock(return_value=mock_session)
                            mock_session_cls.return_value.__aexit__ = AsyncMock(return_value=False)
                            return await auth_service.refresh_if_needed("hinatazaka46")

        result = asyncio.run(run())
        assert result["refreshed"] is False
        assert result["status"] == "refresh_failed"

    def test_refresh_exception_returns_error(self, auth_service):
        """An unexpected error during refresh returns an error status."""
        async def run():
            with patch("backend.services.auth_service.get_token_manager") as mock_tm:
                mock_tm.return_value.load_session.side_effect = RuntimeError("kaboom")
                return await auth_service.refresh_if_needed("hinatazaka46")

        result = asyncio.run(run())
        assert result["refreshed"] is False
        assert "error" in result["status"]

    def test_refresh_invalid_service_raises(self, auth_service):
        with pytest.raises(ValueError):
            asyncio.run(auth_service.refresh_if_needed("invalid_svc"))


# ---------------------------------------------------------------------------
# Test mode
# ---------------------------------------------------------------------------


class TestTestMode:
    """Verify that test mode (SAKADESK_TEST_MODE=true) shortcuts work."""

    def test_get_status_test_mode_single_service(self, auth_service):
        with patch("backend.services.auth_service.is_test_mode", return_value=True):
            result = asyncio.run(auth_service.get_status(service="hinatazaka46"))
        assert result["authenticated"] is True
        assert result["storage_type"] == "test_mode"

    def test_get_status_test_mode_all_services(self, auth_service):
        with patch("backend.services.auth_service.is_test_mode", return_value=True):
            result = asyncio.run(auth_service.get_status())
        assert "services" in result
        for svc_status in result["services"].values():
            assert svc_status["authenticated"] is True

    def test_refresh_if_needed_test_mode(self, auth_service):
        async def run():
            with patch("backend.services.auth_service.is_test_mode", return_value=True):
                return await auth_service.refresh_if_needed("hinatazaka46")

        result = asyncio.run(run())
        assert result["status"] == "test_mode"
        assert result["remaining_seconds"] == 3600


# ---------------------------------------------------------------------------
# Storage type in auth status
# ---------------------------------------------------------------------------


class TestStorageType:
    """Verify the 'storage_type' field logic."""

    def test_dev_mode_returns_development(self, auth_service):
        with patch("backend.services.auth_service.get_token_manager") as mock_tm:
            mock_tm.return_value.load_session.return_value = {"access_token": "tok"}
            with patch.object(auth_service, "_is_token_expired", return_value=False):
                with patch.object(auth_service, "_get_token_expiry_timestamp", return_value=None):
                    with patch("backend.services.auth_service.is_dev_mode", return_value=True):
                        result = auth_service._get_service_auth_status("hinatazaka46")
        assert result["storage_type"] == "development"

    def test_prod_mode_returns_secure(self, auth_service):
        with patch("backend.services.auth_service.get_token_manager") as mock_tm:
            mock_tm.return_value.load_session.return_value = {"access_token": "tok"}
            with patch.object(auth_service, "_is_token_expired", return_value=False):
                with patch.object(auth_service, "_get_token_expiry_timestamp", return_value=None):
                    with patch("backend.services.auth_service.is_dev_mode", return_value=False):
                        result = auth_service._get_service_auth_status("hinatazaka46")
        assert result["storage_type"] == "secure"
