"""
Platform Abstraction Layer for ZakaDesk
Handles cross-platform differences for Windows deployment with Linux development.
"""
import os
import platform
import structlog
from pathlib import Path
from typing import cast

logger = structlog.get_logger(__name__)

# Environment variable to force dev mode
DEV_MODE = os.environ.get("ZAKADESK_DEV_MODE", "false").lower() == "true"

# Environment variable to enable test mode (bypasses real auth)
TEST_MODE = os.environ.get("ZAKADESK_TEST_MODE", "false").lower() == "true"


def is_test_mode() -> bool:
    """Check if running in test mode (for E2E testing)."""
    return TEST_MODE


def get_system() -> str:
    """Get the current operating system."""
    return platform.system()


def is_windows() -> bool:
    """Check if running on Windows."""
    return get_system() == "Windows"


def is_dev_mode() -> bool:
    """Check if running in development mode."""
    return DEV_MODE or not is_windows()


def get_default_output_dir() -> Path:
    """
    Get the default output directory for synced data.

    Windows: %USERPROFILE%\\Documents\\ZakaDesk (e.g., C:\\Users\\Name\\Documents\\ZakaDesk)
    Linux/Mac: ~/Documents/ZakaDesk (development fallback)
    """
    return Path.home() / "Documents" / "ZakaDesk"


def get_app_data_dir() -> Path:
    """
    Get the application data directory.

    Windows: %LOCALAPPDATA%\\ZakaDesk (e.g., C:\\Users\\Name\\AppData\\Local\\ZakaDesk)
    Linux/Mac: ~/.ZakaDesk (development fallback)
    """
    if is_windows():
        base = os.environ.get("LOCALAPPDATA")
        if base:
            app_dir = Path(base) / "ZakaDesk"
        else:
            app_dir = Path.home() / "AppData" / "Local" / "ZakaDesk"
    else:
        app_dir = Path.home() / ".ZakaDesk"

    app_dir.mkdir(parents=True, exist_ok=True)
    return app_dir


def get_settings_path() -> Path:
    """Get path to settings.json (non-sensitive app preferences)."""
    return get_app_data_dir() / "settings.json"


def get_credentials_dir() -> Path:
    """Get directory for credential storage."""
    creds_dir = get_app_data_dir() / "credentials"
    creds_dir.mkdir(parents=True, exist_ok=True)
    return creds_dir


def get_session_dir() -> Path:
    """
    Get directory for browser session data (auth_data).

    Uses pyzaka.get_auth_dir() to share browser session with CLI.
    This enables:
    - Shared Google OAuth cookies between CLI and ZakaDesk
    - Auto-OAuth when re-logging in (no password re-entry)
    - Consistent session state across both apps
    """
    from pyzaka import get_auth_dir
    return cast(Path, get_auth_dir())


def get_logs_dir() -> Path:
    """Get directory for log files."""
    logs_dir = get_app_data_dir() / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    return logs_dir


def log_platform_info():
    """Log platform information for debugging."""
    logger.info(f"Platform: {get_system()}")
    logger.info(f"Dev Mode: {is_dev_mode()}")
    logger.info(f"App Data Dir: {get_app_data_dir()}")
    
    if is_dev_mode() and not is_windows():
        logger.warning(
            "⚠️  Running in development mode - credentials are stored in plaintext. "
            "For production, run on Windows where credentials use Windows Credential Manager."
        )
