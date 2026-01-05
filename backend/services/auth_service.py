"""
Authentication Service for pymsg-gui
Uses secure credential storage via the credential_store abstraction.
"""
import json
import base64
import logging
from pathlib import Path
from datetime import datetime
from pyhako import BrowserAuth

from backend.services.platform import get_session_dir, is_dev_mode
from backend.services.credential_store import get_credential_store, LegacyFileCredentialStore

logger = logging.getLogger(__name__)


class AuthService:
    def __init__(self):
        self._store = get_credential_store()
        self._session_dir = get_session_dir()
        
        # Check for legacy config.json and migrate if needed
        self._migrate_legacy_config()
    
    def _migrate_legacy_config(self):
        """Migrate from old config.json if exists."""
        legacy_path = Path("config.json")
        if legacy_path.exists():
            legacy_store = LegacyFileCredentialStore(legacy_path)
            if legacy_store.migrate_if_exists():
                logger.info("Successfully migrated credentials from legacy config.json")
    
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
        config = self._store.load_config()
        
        if config:
            token = config.get('access_token')
            if token:
                if self._is_token_expired(token):
                    return {
                        "is_authenticated": False,
                        "token_expired": True,
                        "message": "Token expired. Please re-login."
                    }
                return {
                    "is_authenticated": True,
                    "app_id": config.get('x-talk-app-id'),
                    "storage_type": "secure" if not is_dev_mode() else "development"
                }
        
        return {"is_authenticated": False}
    
    async def login_with_browser(self):
        """Launch browser for OAuth login."""
        try:
            logger.info(f"Starting browser login, session dir: {self._session_dir}")
            
            creds = await BrowserAuth.login(
                group="hinatazaka46",
                headless=False,
                user_data_dir=str(self._session_dir),
                channel="chrome"
            )
            
            if creds:
                self._save_credentials(creds)
                logger.info("Login successful, credentials saved securely")
                return True
                
        except Exception as e:
            logger.error(f"Login error: {e}")
            return False
        
        return False
    
    def _save_credentials(self, creds: dict):
        """Save credentials to secure storage."""
        # Load existing config to preserve settings
        config = self._store.load_config()
        
        # Update with new credentials
        config.update(creds)
        config['session_dir'] = str(self._session_dir)
        
        # Save to secure storage
        self._store.save_config(config)
        
        logger.info("Credentials saved to secure storage")
    
    def logout(self):
        """Clear all credentials."""
        self._store.clear_all()
        logger.info("Credentials cleared")
    
    def get_config(self) -> dict:
        """Get the current config (for sync service)."""
        return self._store.load_config()
