"""
Platform Abstraction Layer for pymsg-gui
Handles cross-platform differences for Windows deployment with Linux development.
"""
import os
import platform
import logging
from pathlib import Path
from typing import Literal

logger = logging.getLogger(__name__)

# Environment variable to force dev mode
DEV_MODE = os.environ.get("PYMSG_DEV_MODE", "false").lower() == "true"


def get_system() -> Literal["Windows", "Linux", "Darwin"]:
    """Get the current operating system."""
    return platform.system()


def is_windows() -> bool:
    """Check if running on Windows."""
    return get_system() == "Windows"


def is_dev_mode() -> bool:
    """Check if running in development mode."""
    return DEV_MODE or not is_windows()


def get_app_data_dir() -> Path:
    """
    Get the application data directory.
    
    Windows: %LOCALAPPDATA%\\pymsg (e.g., C:\\Users\\Name\\AppData\\Local\\pymsg)
    Linux/Mac: ~/.pymsg (development fallback)
    """
    if is_windows():
        base = os.environ.get("LOCALAPPDATA")
        if base:
            app_dir = Path(base) / "pymsg"
        else:
            # Fallback if LOCALAPPDATA not set
            app_dir = Path.home() / "AppData" / "Local" / "pymsg"
    else:
        # Development mode on Linux/Mac
        app_dir = Path.home() / ".pymsg"
    
    # Ensure directory exists
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
    """Get directory for browser session data (auth_data)."""
    session_dir = get_credentials_dir() / "session"
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_dir


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
