"""
Authentication Service for HakoDesk

Uses pyhako's TokenManager for credential storage (same as CLI).
This ensures consistent behavior across CLI and GUI:
- Windows: Windows Credential Manager (WCM)
- Linux: Plaintext fallback (development only)
"""
import json
import base64
import structlog
from pathlib import Path
from datetime import datetime
from typing import Optional
import aiohttp
from pyhako import BrowserAuth, Group, Client
from pyhako.credentials import get_token_manager

from backend.services.platform import get_session_dir, is_dev_mode, is_test_mode
from backend.services.service_utils import (
    get_all_services,
    get_service_enum,
    get_service_display_name,
    validate_service,
)

logger = structlog.get_logger(__name__)


class AuthService:
    def __init__(self):
        self._session_dir = get_session_dir()

    def _get_group(self, service: str) -> Group:
        """Convert service string to Group enum."""
        return get_service_enum(service)

    def _is_token_expired(self, token: str) -> bool:
        """Check if JWT token is expired."""
        try:
            parts = token.split('.')
            if len(parts) >= 2:
                payload = parts[1]
                # Add padding
                payload += '=' * (4 - len(payload) % 4)
                decoded = base64.b64decode(payload)
                data = json.loads(decoded)
                if 'exp' in data:
                    exp_time = datetime.fromtimestamp(data['exp'])
                    now = datetime.now()
                    is_expired = now > exp_time
                    remaining_seconds = (exp_time - now).total_seconds()

                    logger.debug(
                        f"Token expiry check: expired={is_expired}, "
                        f"remaining_seconds={remaining_seconds:.0f}, "
                        f"exp_time={exp_time.isoformat()}"
                    )
                    return is_expired
            logger.warning("Token does not have expected JWT structure (missing parts)")
        except Exception as e:
            logger.error(f"Failed to parse token expiry: {e}")
        return True  # Assume expired if can't parse

    def _get_token_expiry_timestamp(self, token: str) -> int | None:
        """Extract expiry timestamp from JWT token. Returns Unix timestamp or None."""
        try:
            parts = token.split('.')
            if len(parts) >= 2:
                payload = parts[1]
                payload += '=' * (4 - len(payload) % 4)
                decoded = base64.b64decode(payload)
                data = json.loads(decoded)
                if 'exp' in data:
                    return int(data['exp'])
        except Exception as e:
            logger.error(f"Failed to parse token expiry timestamp: {e}")
        return None

    def _get_service_auth_status(self, service: str) -> dict:
        """Get authentication status for a single service."""
        try:
            group = self._get_group(service)
            tm = get_token_manager()
            token_data = tm.load_session(group.value)

            if token_data:
                token = token_data.get('access_token')
                cookies = token_data.get('cookies', {})
                cookie_keys = list(cookies.keys()) if cookies else []

                logger.debug(
                    f"Loaded session from TokenManager for {service}: "
                    f"has_token={bool(token)}, "
                    f"has_cookies={bool(cookies)}, "
                    f"cookie_keys={cookie_keys}"
                )

                if token:
                    expires_at = self._get_token_expiry_timestamp(token)
                    if self._is_token_expired(token):
                        logger.warning(f"Token is expired for {service}, returning token_expired status")
                        return {
                            "authenticated": False,
                            "token_expired": True,
                            "expires_at": expires_at,
                            "message": "Token expired. Please re-login."
                        }
                    logger.info(f"Auth status check for {service}: authenticated and token valid, expires_at={expires_at}")
                    return {
                        "authenticated": True,
                        "expires_at": expires_at,
                        "app_id": token_data.get('x-talk-app-id'),
                        "storage_type": "secure" if not is_dev_mode() else "development"
                    }
            else:
                logger.debug(f"No token data found in TokenManager for {service}")
        except Exception as e:
            logger.error(f"Failed to check auth status for {service}: {e}", exc_info=True)

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
        logger.debug(f"Checking authentication status for service={service}...")

        # Test mode: always return authenticated with test config
        if is_test_mode():
            from backend.fixtures.test_data import TEST_AUTH_CONFIG
            if service:
                validate_service(service)
                return {
                    "authenticated": True,
                    "app_id": TEST_AUTH_CONFIG.get("x-talk-app-id"),
                    "storage_type": "test_mode"
                }
            return {
                "services": {
                    s: {
                        "authenticated": True,
                        "app_id": TEST_AUTH_CONFIG.get("x-talk-app-id"),
                        "storage_type": "test_mode"
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
                s: self._get_service_auth_status(s)
                for s in get_all_services()
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

        try:
            logger.info(f"Starting browser login for {service}, session dir: {self._session_dir}")

            creds = await BrowserAuth.login(
                group=group,
                headless=False,
                user_data_dir=str(self._session_dir),
                channel="chrome"
            )

            if creds:
                self._save_credentials(service, creds)
                logger.info(f"Login successful for {service}, credentials saved to TokenManager")
                return True

        except Exception as e:
            logger.error(f"Login error for {service}: {e}")
            return False

        return False

    def _save_credentials(self, service: str, creds: dict):
        """Save credentials to pyhako's TokenManager (CLI pattern)."""
        group = self._get_group(service)
        try:
            tm = get_token_manager()
            tm.save_session(
                group.value,
                creds.get('access_token'),
                creds.get('refresh_token'),
                creds.get('cookies')
            )
            logger.info(f"Credentials saved to TokenManager for {service}")
        except Exception as e:
            logger.error(f"Failed to save credentials for {service}: {e}")
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
            logger.info(f"Credentials cleared from TokenManager for {service}")
        except Exception as e:
            logger.error(f"Failed to clear credentials for {service}: {e}")

    def _get_token_remaining_seconds(self, token: str) -> float:
        """Get seconds remaining until token expires. Returns negative if expired."""
        try:
            parts = token.split('.')
            if len(parts) >= 2:
                payload = parts[1]
                payload += '=' * (4 - len(payload) % 4)
                decoded = base64.b64decode(payload)
                data = json.loads(decoded)
                if 'exp' in data:
                    exp_time = datetime.fromtimestamp(data['exp'])
                    return (exp_time - datetime.now()).total_seconds()
        except Exception as e:
            logger.error(f"Failed to parse token expiry: {e}")
        return -1  # Assume expired if can't parse

    async def refresh_if_needed(self, service: str, threshold_minutes: int = 10) -> dict:
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

        logger.debug(f"refresh_if_needed called for {service} with threshold={threshold_minutes} minutes")

        if is_test_mode():
            return {"refreshed": False, "remaining_seconds": 3600, "status": "test_mode"}

        try:
            tm = get_token_manager()
            token_data = tm.load_session(group.value)

            if not token_data or not token_data.get('access_token'):
                logger.warning(f"No token found for refresh check for {service}")
                return {"refreshed": False, "remaining_seconds": 0, "status": "no_token"}

            token = token_data['access_token']
            remaining_seconds = self._get_token_remaining_seconds(token)
            threshold_seconds = threshold_minutes * 60

            logger.debug(
                f"Token status for {service}: remaining_seconds={remaining_seconds:.0f}, "
                f"threshold_seconds={threshold_seconds}"
            )

            # If token is still valid and not within threshold, no refresh needed
            if remaining_seconds > threshold_seconds:
                logger.debug(f"Token still valid for {service}, no refresh needed")
                return {
                    "refreshed": False,
                    "remaining_seconds": remaining_seconds,
                    "status": "valid"
                }

            # Token is expired or within threshold - attempt refresh
            logger.info(f"Token for {service} expires in {remaining_seconds:.0f}s, attempting refresh...")

            # Use proper API-based refresh via Client.refresh_access_token()
            # This calls /update_token endpoint with cookies - much more reliable
            # than headless browser scraping
            client = Client(
                group=group,
                access_token=token,
                cookies=token_data.get('cookies'),
                auth_dir=self._session_dir
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
                        new_cookies
                    )

                    new_remaining = self._get_token_remaining_seconds(new_token)
                    logger.info(f"Token refreshed successfully for {service} via API, new expiry in {new_remaining:.0f}s")
                    return {
                        "refreshed": True,
                        "remaining_seconds": new_remaining,
                        "status": "refreshed"
                    }
                else:
                    logger.warning(f"API-based refresh failed for {service}, session may require re-login")
                    return {
                        "refreshed": False,
                        "remaining_seconds": remaining_seconds,
                        "status": "refresh_failed"
                    }

        except Exception as e:
            logger.error(f"refresh_if_needed error for {service}: {e}", exc_info=True)
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
            return TEST_AUTH_CONFIG

        try:
            tm = get_token_manager()
            token_data = tm.load_session(group.value)
            return token_data or {}
        except Exception as e:
            logger.error(f"Failed to load config for {service}: {e}")
            return {}
