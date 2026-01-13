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
from pyhako import BrowserAuth, Group
from pyhako.credentials import get_token_manager

from backend.services.platform import get_session_dir, is_dev_mode, is_test_mode

logger = structlog.get_logger(__name__)


class AuthService:
    def __init__(self):
        self._session_dir = get_session_dir()
        self._group = Group.HINATAZAKA46  # Default group
    
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
    
    async def get_status(self):
        """Check authentication status."""
        logger.debug("Checking authentication status...")

        # Test mode: always return authenticated with test config
        if is_test_mode():
            from backend.fixtures.test_data import TEST_AUTH_CONFIG
            return {
                "is_authenticated": True,
                "app_id": TEST_AUTH_CONFIG.get("x-talk-app-id"),
                "storage_type": "test_mode"
            }

        try:
            tm = get_token_manager()
            token_data = tm.load_session(self._group.value)

            if token_data:
                token = token_data.get('access_token')
                cookies = token_data.get('cookies', {})
                cookie_keys = list(cookies.keys()) if cookies else []

                logger.debug(
                    f"Loaded session from TokenManager: "
                    f"has_token={bool(token)}, "
                    f"has_cookies={bool(cookies)}, "
                    f"cookie_keys={cookie_keys}"
                )

                if token:
                    if self._is_token_expired(token):
                        logger.warning("Token is expired, returning token_expired status")
                        return {
                            "is_authenticated": False,
                            "token_expired": True,
                            "message": "Token expired. Please re-login."
                        }
                    logger.info("Auth status check: authenticated and token valid")
                    return {
                        "is_authenticated": True,
                        "app_id": token_data.get('x-talk-app-id'),
                        "storage_type": "secure" if not is_dev_mode() else "development"
                    }
            else:
                logger.debug("No token data found in TokenManager")
        except Exception as e:
            logger.error(f"Failed to check auth status: {e}", exc_info=True)

        logger.debug("Auth status check: not authenticated")
        return {"is_authenticated": False}
    
    async def login_with_browser(self):
        """Launch browser for OAuth login."""
        try:
            logger.info(f"Starting browser login, session dir: {self._session_dir}")

            creds = await BrowserAuth.login(
                group=self._group,
                headless=False,
                user_data_dir=str(self._session_dir),
                channel="chrome"
            )

            if creds:
                self._save_credentials(creds)
                logger.info("Login successful, credentials saved to TokenManager")
                return True

        except Exception as e:
            logger.error(f"Login error: {e}")
            return False

        return False

    def _save_credentials(self, creds: dict):
        """Save credentials to pyhako's TokenManager (CLI pattern)."""
        try:
            tm = get_token_manager()
            tm.save_session(
                self._group.value,
                creds.get('access_token'),
                creds.get('refresh_token'),
                creds.get('cookies')
            )
            logger.info(f"Credentials saved to TokenManager for {self._group.value}")
        except Exception as e:
            logger.error(f"Failed to save credentials: {e}")
            raise

    def logout(self):
        """Clear all credentials."""
        try:
            tm = get_token_manager()
            tm.delete_session(self._group.value)
            logger.info("Credentials cleared from TokenManager")
        except Exception as e:
            logger.error(f"Failed to clear credentials: {e}")

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

    async def refresh_if_needed(self, threshold_minutes: int = 10) -> dict:
        """
        Check token expiry and refresh if within threshold.

        Called by frontend polling to proactively refresh tokens before expiry.

        Args:
            threshold_minutes: Refresh if token expires within this many minutes.

        Returns:
            dict with 'refreshed' (bool), 'remaining_seconds' (float), 'status' (str)
        """
        logger.debug(f"refresh_if_needed called with threshold={threshold_minutes} minutes")

        if is_test_mode():
            return {"refreshed": False, "remaining_seconds": 3600, "status": "test_mode"}

        try:
            tm = get_token_manager()
            token_data = tm.load_session(self._group.value)

            if not token_data or not token_data.get('access_token'):
                logger.warning("No token found for refresh check")
                return {"refreshed": False, "remaining_seconds": 0, "status": "no_token"}

            token = token_data['access_token']
            remaining_seconds = self._get_token_remaining_seconds(token)
            threshold_seconds = threshold_minutes * 60

            logger.debug(
                f"Token status: remaining_seconds={remaining_seconds:.0f}, "
                f"threshold_seconds={threshold_seconds}"
            )

            # If token is still valid and not within threshold, no refresh needed
            if remaining_seconds > threshold_seconds:
                logger.debug("Token still valid, no refresh needed")
                return {
                    "refreshed": False,
                    "remaining_seconds": remaining_seconds,
                    "status": "valid"
                }

            # Token is expired or within threshold - attempt refresh
            logger.info(f"Token expires in {remaining_seconds:.0f}s, attempting refresh...")

            # Use headless browser refresh (Plan C - most reliable)
            creds = await BrowserAuth.refresh_token_headless(
                group=self._group,
                auth_dir=self._session_dir
            )

            if creds and creds.get('access_token'):
                self._save_credentials(creds)
                new_remaining = self._get_token_remaining_seconds(creds['access_token'])
                logger.info(f"Token refreshed successfully, new expiry in {new_remaining:.0f}s")
                return {
                    "refreshed": True,
                    "remaining_seconds": new_remaining,
                    "status": "refreshed"
                }
            else:
                logger.warning("Headless refresh failed, session may require re-login")
                return {
                    "refreshed": False,
                    "remaining_seconds": remaining_seconds,
                    "status": "refresh_failed"
                }

        except Exception as e:
            logger.error(f"refresh_if_needed error: {e}", exc_info=True)
            return {"refreshed": False, "remaining_seconds": 0, "status": f"error: {e}"}

    def get_config(self) -> dict:
        """Get the current config (for sync service)."""
        if is_test_mode():
            from backend.fixtures.test_data import TEST_AUTH_CONFIG
            return TEST_AUTH_CONFIG

        try:
            tm = get_token_manager()
            token_data = tm.load_session(self._group.value)
            return token_data or {}
        except Exception as e:
            logger.error(f"Failed to load config: {e}")
            return {}
