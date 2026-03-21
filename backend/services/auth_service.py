"""
Authentication Service for SakaDesk

Uses pysaka's TokenManager for credential storage (same as CLI).
This ensures consistent behavior across CLI and GUI:
- Windows: Windows Credential Manager (WCM)
- Linux: Plaintext fallback (development only)
"""

import asyncio
import structlog
from typing import Any, Dict, Optional, cast
import aiohttp
from pysaka import (
    BrowserAuth,
    Group,
    Client,
    is_jwt_expired,
    parse_jwt_expiry,
    get_jwt_remaining_seconds,
)
from pysaka.credentials import get_token_manager

from backend.services.platform import get_session_dir, is_dev_mode, is_test_mode
from backend.services.service_utils import (
    get_all_services,
    get_service_enum,
    validate_service,
)

logger = structlog.get_logger(__name__)


class AuthService:
    def __init__(self):
        self._session_dir = get_session_dir()
        self._browser_lock = asyncio.Lock()

    def _get_group(self, service: str) -> Group:
        """Convert service string to Group enum."""
        return get_service_enum(service)

    def _is_token_expired(self, token: str) -> bool:
        """Check if JWT token is expired. Uses shared pysaka utility."""
        expired = is_jwt_expired(token)
        remaining = get_jwt_remaining_seconds(token)
        exp_timestamp = parse_jwt_expiry(token)

        if remaining is not None:
            logger.debug(
                "Token expiry check",
                expired=expired,
                remaining_seconds=remaining,
                exp_timestamp=exp_timestamp,
            )
        else:
            logger.warning("Token does not have expected JWT structure")

        return cast(bool, expired)

    def _get_token_expiry_timestamp(self, token: str) -> Optional[int]:
        """Extract expiry timestamp from JWT token. Uses shared pysaka utility."""
        return cast(Optional[int], parse_jwt_expiry(token))

    def _get_service_auth_status(self, service: str) -> dict:
        """Get authentication status for a single service."""
        try:
            group = self._get_group(service)
            tm = get_token_manager()
            token_data = tm.load_session(group.value)

            if token_data:
                token = token_data.get("access_token")
                cookies = token_data.get("cookies", {})
                cookie_keys = list(cookies.keys()) if cookies else []

                logger.debug(
                    "Loaded session from TokenManager",
                    service=service,
                    has_token=bool(token),
                    has_cookies=bool(cookies),
                    cookie_keys=cookie_keys,
                )

                if token:
                    expires_at = self._get_token_expiry_timestamp(token)
                    if self._is_token_expired(token):
                        logger.warning(
                            "Token is expired, returning token_expired status",
                            service=service,
                        )
                        return {
                            "authenticated": False,
                            "token_expired": True,
                            "expires_at": expires_at,
                            "message": "Token expired. Please re-login.",
                        }
                    logger.info(
                        "Auth status check: authenticated and token valid",
                        service=service,
                        expires_at=expires_at,
                    )
                    return {
                        "authenticated": True,
                        "expires_at": expires_at,
                        "app_id": token_data.get("x-talk-app-id"),
                        "storage_type": "secure"
                        if not is_dev_mode()
                        else "development",
                    }
            else:
                logger.debug("No token data found in TokenManager", service=service)
        except Exception as e:
            logger.error(
                "Failed to check auth status",
                service=service,
                error=str(e),
                exc_info=True,
            )

        return {"authenticated": False}

    async def get_status(self, service: Optional[str] = None):
        """
        Check authentication status.

        Args:
            service: If provided, return status for that service only.
                     If None, return status for all services.

        Returns:
            If service is provided: dict with 'authenticated' key for that service.
            If service is None: dict with 'services' key containing status for all services.
        """
        logger.debug("Checking authentication status", service=service)

        # Test mode: always return authenticated with test config
        if is_test_mode():
            from backend.fixtures.test_data import TEST_AUTH_CONFIG

            if service:
                validate_service(service)
                return {
                    "authenticated": True,
                    "app_id": TEST_AUTH_CONFIG.get("x-talk-app-id"),
                    "storage_type": "test_mode",
                }
            return {
                "services": {
                    s: {
                        "authenticated": True,
                        "app_id": TEST_AUTH_CONFIG.get("x-talk-app-id"),
                        "storage_type": "test_mode",
                    }
                    for s in get_all_services()
                }
            }

        if service:
            validate_service(service)
            return self._get_service_auth_status(service)

        # Return status for all services
        return {
            "services": {
                s: self._get_service_auth_status(s) for s in get_all_services()
            }
        }

    async def login_with_browser(self, service: str):
        """
        Launch browser for OAuth login.

        Args:
            service: The service to log in to (e.g., 'hinatazaka46').
        """
        validate_service(service)
        group = self._get_group(service)

        if self._browser_lock.locked():
            logger.warning(
                "Browser login already in progress, queuing", service=service
            )

        async with self._browser_lock:
            try:
                logger.info(
                    "Starting browser login",
                    service=service,
                    session_dir=str(self._session_dir),
                )

                creds = await BrowserAuth.login(
                    group=group,
                    headless=False,
                    user_data_dir=str(self._session_dir),
                    channel="chrome",
                )

                if creds:
                    self._save_credentials(service, creds)
                    logger.info(
                        "Login successful, credentials saved to TokenManager",
                        service=service,
                    )
                    return True

            except Exception as e:
                logger.error("Login error", service=service, error=str(e))
                return False

        return False

    def _save_credentials(self, service: str, creds: dict):
        """Save credentials to pysaka's TokenManager (CLI pattern)."""
        group = self._get_group(service)
        try:
            tm = get_token_manager()
            tm.save_session(
                group.value,
                creds.get("access_token"),
                creds.get("refresh_token"),
                creds.get("cookies"),
            )
            logger.info("Credentials saved to TokenManager", service=service)
        except Exception as e:
            logger.error("Failed to save credentials", service=service, error=str(e))
            raise

    def logout(self, service: str):
        """
        Clear credentials for a specific service.

        Args:
            service: The service to log out of (e.g., 'hinatazaka46').
        """
        validate_service(service)
        group = self._get_group(service)

        try:
            tm = get_token_manager()
            tm.delete_session(group.value)
            logger.info("Credentials cleared from TokenManager", service=service)
        except Exception as e:
            logger.error("Failed to clear credentials", service=service, error=str(e))

    def _get_token_remaining_seconds(self, token: str) -> float:
        """Get seconds remaining until token expires. Uses shared pysaka utility."""
        remaining = get_jwt_remaining_seconds(token)
        if remaining is None:
            return -1  # Assume expired if can't parse
        return float(remaining)

    async def refresh_if_needed(
        self, service: str, threshold_minutes: int = 10
    ) -> dict:
        """
        Check token expiry and refresh if within threshold.

        Called by frontend polling to proactively refresh tokens before expiry.

        Args:
            service: The service to check/refresh (e.g., 'hinatazaka46').
            threshold_minutes: Refresh if token expires within this many minutes.

        Returns:
            dict with 'refreshed' (bool), 'remaining_seconds' (float), 'status' (str)
        """
        validate_service(service)
        group = self._get_group(service)

        logger.debug(
            "refresh_if_needed called",
            service=service,
            threshold_minutes=threshold_minutes,
        )

        if is_test_mode():
            return {
                "refreshed": False,
                "remaining_seconds": 3600,
                "status": "test_mode",
            }

        try:
            tm = get_token_manager()
            token_data = tm.load_session(group.value)

            if not token_data or not token_data.get("access_token"):
                logger.warning("No token found for refresh check", service=service)
                return {
                    "refreshed": False,
                    "remaining_seconds": 0,
                    "status": "no_token",
                }

            token = token_data["access_token"]
            remaining_seconds = self._get_token_remaining_seconds(token)
            threshold_seconds = threshold_minutes * 60

            logger.debug(
                "Token status",
                service=service,
                remaining_seconds=round(remaining_seconds),
                threshold_seconds=threshold_seconds,
            )

            # If token is still valid and not within threshold, no refresh needed
            if remaining_seconds > threshold_seconds:
                logger.debug("Token still valid, no refresh needed", service=service)
                return {
                    "refreshed": False,
                    "remaining_seconds": remaining_seconds,
                    "status": "valid",
                }

            # Token is expired or within threshold - attempt refresh
            logger.info(
                "Token expiring soon, attempting refresh",
                service=service,
                remaining_seconds=round(remaining_seconds),
            )

            # Use proper API-based refresh via Client.refresh_access_token()
            # This calls /update_token endpoint with cookies - much more reliable
            # than headless browser scraping
            client = Client(
                group=group,
                access_token=token,
                cookies=token_data.get("cookies"),
                auth_dir=self._session_dir,
            )

            async with aiohttp.ClientSession() as session:
                refresh_success = await client.refresh_access_token(session)

                if refresh_success:
                    # Client.refresh_access_token() updates client.access_token and client.cookies
                    # Save the refreshed credentials
                    new_token = client.access_token
                    new_cookies = client.cookies

                    tm.save_session(
                        group.value,
                        new_token,
                        None,  # refresh_token (web flow doesn't use this)
                        new_cookies,
                    )

                    new_remaining = self._get_token_remaining_seconds(new_token)
                    logger.info(
                        "Token refreshed successfully via API",
                        service=service,
                        new_remaining_seconds=round(new_remaining),
                    )
                    return {
                        "refreshed": True,
                        "remaining_seconds": new_remaining,
                        "status": "refreshed",
                    }
                else:
                    logger.warning(
                        "API-based refresh failed, session may require re-login",
                        service=service,
                    )
                    return {
                        "refreshed": False,
                        "remaining_seconds": remaining_seconds,
                        "status": "refresh_failed",
                    }

        except Exception as e:
            logger.error(
                "refresh_if_needed error", service=service, error=str(e), exc_info=True
            )
            return {"refreshed": False, "remaining_seconds": 0, "status": f"error: {e}"}

    def get_config(self, service: str) -> dict:
        """
        Get the current config for a specific service (for sync service).

        Args:
            service: The service to get config for (e.g., 'hinatazaka46').
        """
        validate_service(service)
        group = self._get_group(service)

        if is_test_mode():
            from backend.fixtures.test_data import TEST_AUTH_CONFIG

            return cast(Dict[Any, Any], TEST_AUTH_CONFIG)

        try:
            tm = get_token_manager()
            token_data = tm.load_session(group.value)
            return cast(Dict[Any, Any], token_data or {})
        except Exception as e:
            logger.error("Failed to load config", service=service, error=str(e))
            return {}
