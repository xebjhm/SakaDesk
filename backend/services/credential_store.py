"""
Secure Credential Storage for hakodesk-gui

Windows: Uses keyring (Windows Credential Manager)
Linux/Mac: Uses plaintext JSON (development mode only)

This abstraction allows development on Linux while ensuring
production security on Windows.
"""
import json
import logging
from pathlib import Path
from typing import Optional, Dict, Any
from abc import ABC, abstractmethod

from backend.services.platform import is_windows, is_dev_mode, get_credentials_dir

logger = logging.getLogger(__name__)

# Service name for keyring
KEYRING_SERVICE = "hakodesk"


class CredentialStore(ABC):
    """Abstract base class for credential storage."""
    
    @abstractmethod
    def save(self, key: str, value: str) -> None:
        """Save a credential."""
        pass
    
    @abstractmethod
    def get(self, key: str) -> Optional[str]:
        """Get a credential. Returns None if not found."""
        pass
    
    @abstractmethod
    def delete(self, key: str) -> None:
        """Delete a credential."""
        pass
    
    @abstractmethod
    def save_config(self, config: Dict[str, Any]) -> None:
        """Save the full config (tokens, app-id, etc.)."""
        pass
    
    @abstractmethod
    def load_config(self) -> Dict[str, Any]:
        """Load the full config."""
        pass
    
    @abstractmethod
    def clear_all(self) -> None:
        """Clear all stored credentials."""
        pass


class KeyringCredentialStore(CredentialStore):
    """
    Secure credential storage using Windows Credential Manager.
    Uses the 'keyring' library which automatically uses:
    - Windows: Windows Credential Manager
    - macOS: macOS Keychain
    - Linux with GUI: GNOME Keyring / KWallet
    
    NOTE: PyInstaller does not auto-detect the Windows backend.
    We must explicitly set it for packaged builds on Windows.
    """
    
    def __init__(self):
        try:
            import keyring
            
            # CRITICAL FIX: PyInstaller cannot auto-detect the Windows backend.
            # We must explicitly set it to avoid falling back to file storage.
            # See: https://github.com/jaraco/keyring/issues/324
            # Only do this on Windows - Linux/Mac use different backends.
            if is_windows():
                import keyring.backends.Windows
                keyring.set_keyring(keyring.backends.Windows.WinVaultKeyring())
                logger.info("Using Windows Credential Manager (WinVaultKeyring)")
            else:
                # On Linux/Mac, let keyring auto-detect (GNOME Keyring, KWallet, macOS Keychain)
                logger.info(f"Using keyring with auto-detected backend: {keyring.get_keyring()}")
            
            self._keyring = keyring
        except ImportError as e:
            logger.error(f"Keyring import failed: {e}")
            raise ImportError(
                "keyring library not installed or backend unavailable. "
                "Install with: pip install keyring"
            )
            logger.error(f"Failed to initialize credential manager: {e}")
            raise
        
        # Keys we store - only essential tokens, not the entire config
        # Windows Credential Manager has a ~1280 char limit
        self._access_token_key = "access_token"
        self._app_id_key = "app_id"
    
    def save(self, key: str, value: str) -> None:
        self._keyring.set_password(KEYRING_SERVICE, key, value)
    
    def get(self, key: str) -> Optional[str]:
        try:
            return self._keyring.get_password(KEYRING_SERVICE, key)
        except Exception:
            return None
    
    def delete(self, key: str) -> None:
        try:
            self._keyring.delete_password(KEYRING_SERVICE, key)
        except Exception:
            pass  # Key might not exist
    
    def save_config(self, config: Dict[str, Any]) -> None:
        """
        Save only essential credentials to Windows Credential Manager.
        Non-sensitive data (cookies, user-agent) is NOT stored securely.
        """
        # Only store the essential tokens that need protection
        access_token = config.get('access_token', '')
        app_id = config.get('x-talk-app-id', '')
        
        if access_token:
            self.save(self._access_token_key, access_token)
        if app_id:
            self.save(self._app_id_key, app_id)
        
        logger.info(f"Saved essential tokens to Windows Credential Manager")
    
    def load_config(self) -> Dict[str, Any]:
        """Load essential credentials from Windows Credential Manager."""
        config = {}
        
        access_token = self.get(self._access_token_key)
        if access_token:
            config['access_token'] = access_token
        
        app_id = self.get(self._app_id_key)
        if app_id:
            config['x-talk-app-id'] = app_id
        
        return config
    
    def clear_all(self) -> None:
        """Clear all hakodesk credentials."""
        self.delete(self._access_token_key)
        self.delete(self._app_id_key)
        # Legacy keys
        self.delete("config_json")
        self.delete("config_chunks")


class FileCredentialStore(CredentialStore):
    """
    Development-only credential storage using plaintext JSON.
    
    ⚠️  WARNING: This is NOT secure and should only be used for development.
    Credentials are stored in plaintext in ~/.hakodesk/credentials/tokens.json
    """
    
    def __init__(self):
        self._file_path = get_credentials_dir() / "tokens.json"
        logger.warning(
            f"⚠️  Using INSECURE file-based credential storage at {self._file_path}. "
            "This is for development only!"
        )
    
    def _load_file(self) -> Dict[str, Any]:
        if self._file_path.exists():
            try:
                with open(self._file_path, 'r') as f:
                    return json.load(f)
            except:
                return {}
        return {}
    
    def _save_file(self, data: Dict[str, Any]) -> None:
        with open(self._file_path, 'w') as f:
            json.dump(data, f, indent=2)
    
    def save(self, key: str, value: str) -> None:
        data = self._load_file()
        data[key] = value
        self._save_file(data)
    
    def get(self, key: str) -> Optional[str]:
        data = self._load_file()
        return data.get(key)
    
    def delete(self, key: str) -> None:
        data = self._load_file()
        if key in data:
            del data[key]
            self._save_file(data)
    
    def save_config(self, config: Dict[str, Any]) -> None:
        """Save config to file."""
        self._save_file(config)
    
    def load_config(self) -> Dict[str, Any]:
        """Load config from file."""
        return self._load_file()
    
    def clear_all(self) -> None:
        """Delete the credentials file."""
        if self._file_path.exists():
            self._file_path.unlink()


class LegacyFileCredentialStore(CredentialStore):
    """
    Migration helper - reads from old config.json location.
    Used to migrate existing installations.
    """
    
    def __init__(self, legacy_path: Path):
        self._file_path = legacy_path
        self._new_store = get_credential_store(use_legacy=False)
    
    def migrate_if_exists(self) -> bool:
        """
        Migrate credentials from legacy location to new secure storage.
        Returns True if migration occurred.
        """
        if not self._file_path.exists():
            return False
        
        try:
            with open(self._file_path, 'r') as f:
                old_config = json.load(f)
            
            if old_config:
                logger.info(f"Migrating credentials from {self._file_path}")
                self._new_store.save_config(old_config)
                
                # Optionally remove old file (commented for safety)
                # self._file_path.unlink()
                
                return True
        except Exception as e:
            logger.error(f"Migration failed: {e}")
        
        return False
    
    # Delegate to new store for other operations
    def save(self, key, value): self._new_store.save(key, value)
    def get(self, key): return self._new_store.get(key)
    def delete(self, key): self._new_store.delete(key)
    def save_config(self, config): self._new_store.save_config(config)
    def load_config(self): return self._new_store.load_config()
    def clear_all(self): self._new_store.clear_all()


# Singleton instance
_credential_store: Optional[CredentialStore] = None


def get_credential_store(use_legacy: bool = False) -> CredentialStore:
    """
    Factory function to get the appropriate credential store.
    
    On Windows: Uses Windows Credential Manager (secure)
    On Linux/Mac: Uses file-based storage (development only)
    """
    global _credential_store
    
    if _credential_store is not None and not use_legacy:
        return _credential_store
    
    # Log the decision factors
    logger.info(f"Credential Store Init: is_windows={is_windows()}, is_dev_mode={is_dev_mode()}")
    
    if is_windows() and not is_dev_mode():
        try:
            _credential_store = KeyringCredentialStore()
            logger.info("[OK] Credential Store: Windows Credential Manager (Secure)")
        except Exception as e:
            # Catch ALL exceptions, not just ImportError
            logger.error(f"[FAIL] Credential Store: Keyring failed - {type(e).__name__}: {e}")
            logger.warning("[WARN] Falling back to INSECURE file storage!")
            _credential_store = FileCredentialStore()
    else:
        _credential_store = FileCredentialStore()
        logger.info("Credential Store: File (Development/Linux)")
    
    return _credential_store
