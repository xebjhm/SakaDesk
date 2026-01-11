"""
Authentication Service for HakoDesk

Uses pyhako's TokenManager for credential storage (same as CLI).
This ensures consistent behavior across CLI and GUI:
- Windows: Windows Credential Manager (WCM)
- Linux: Plaintext fallback (development only)
"""
import json
import base64
import logging
from pathlib import Path
from datetime import datetime
from pyhako import BrowserAuth, Group
from pyhako.credentials import TokenManager

from backend.services.platform import get_session_dir, is_dev_mode, is_test_mode

logger = logging.getLogger(__name__)


class AuthService:
    def __init__(self):
        self._session_dir = get_session_dir()
        self._group = Group.HINATAZAKA46  # Default group

        # Use pyhako's TokenManager (same as CLI) - handles WCM on Windows
        try:
            self._token_manager = TokenManager()
        except Exception as e:
            logger.warning(f"TokenManager init failed: {e}")
            self._token_manager = None

    def _get_token_manager(self) -> TokenManager:
        """Get or create TokenManager."""
        if self._token_manager is None:
            self._token_manager = TokenManager()
        return self._token_manager
    
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
                    return datetime.now() > exp_time
        except:
            pass
        return True  # Assume expired if can't parse
    
    async def get_status(self):
        """Check authentication status."""
        # Test mode: always return authenticated with test config
        if is_test_mode():
            from backend.fixtures.test_data import TEST_AUTH_CONFIG
            return {
                "is_authenticated": True,
                "app_id": TEST_AUTH_CONFIG.get("x-talk-app-id"),
                "storage_type": "test_mode"
            }

        try:
            tm = self._get_token_manager()
            token_data = tm.load_session(self._group.value)

            if token_data:
                token = token_data.get('access_token')
                if token:
                    if self._is_token_expired(token):
                        return {
                            "is_authenticated": False,
                            "token_expired": True,
                            "message": "Token expired. Please re-login."
                        }
                    return {
                        "is_authenticated": True,
                        "app_id": token_data.get('x-talk-app-id'),
                        "storage_type": "secure" if not is_dev_mode() else "development"
                    }
        except Exception as e:
            logger.error(f"Failed to check auth status: {e}")

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
            tm = self._get_token_manager()
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
            tm = self._get_token_manager()
            tm.delete_session(self._group.value)
            logger.info("Credentials cleared from TokenManager")
        except Exception as e:
            logger.error(f"Failed to clear credentials: {e}")

    def get_config(self) -> dict:
        """Get the current config (for sync service)."""
        if is_test_mode():
            from backend.fixtures.test_data import TEST_AUTH_CONFIG
            return TEST_AUTH_CONFIG

        try:
            tm = self._get_token_manager()
            token_data = tm.load_session(self._group.value)
            return token_data or {}
        except Exception as e:
            logger.error(f"Failed to load config: {e}")
            return {}
