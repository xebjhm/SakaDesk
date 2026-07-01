"""
Platform Abstraction Layer for SakaDesk
Handles cross-platform differences for Windows deployment with Linux development.
"""

import os
import platform
import struct
import structlog
from pathlib import Path
from typing import cast

logger = structlog.get_logger(__name__)

# Environment variable to force dev mode
DEV_MODE = os.environ.get("SAKADESK_DEV_MODE", "false").lower() == "true"

# Environment variable to enable test mode (bypasses real auth)
TEST_MODE = os.environ.get("SAKADESK_TEST_MODE", "false").lower() == "true"


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

    Windows: %USERPROFILE%\\Documents\\SakaDesk (e.g., C:\\Users\\Name\\Documents\\SakaDesk)
    Linux/Mac: ~/Documents/SakaDesk (development fallback)
    """
    return Path.home() / "Documents" / "SakaDesk"


def get_app_data_dir() -> Path:
    """
    Get the application data directory.

    Windows: %LOCALAPPDATA%\\SakaDesk (e.g., C:\\Users\\Name\\AppData\\Local\\SakaDesk)
    Linux/Mac: ~/.SakaDesk (development fallback)
    """
    if is_windows():
        base = os.environ.get("LOCALAPPDATA")
        if base:
            app_dir = Path(base) / "SakaDesk"
        else:
            app_dir = Path.home() / "AppData" / "Local" / "SakaDesk"
    else:
        app_dir = Path.home() / ".SakaDesk"

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

    Uses pysaka.get_auth_dir() to share browser session with CLI.
    This enables:
    - Shared Google OAuth cookies between CLI and SakaDesk
    - Auto-OAuth when re-logging in (no password re-entry)
    - Consistent session state across both apps
    """
    from pysaka import get_auth_dir

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


def _build_dropfiles_data(file_path: Path) -> bytes:
    """
    Build a DROPFILES struct for CF_HDROP clipboard data.

    Layout:
    - DROPFILES header (20 bytes): pFiles offset, pt(0,0), fNC=0, fWide=1
    - File path as null-terminated UTF-16LE string
    - Extra null terminator (end of file list)
    """
    path_str = str(file_path)
    # Encode path as UTF-16LE with null terminator
    path_bytes = path_str.encode("utf-16-le") + b"\x00\x00"
    # Double null terminator marks end of file list
    path_bytes += b"\x00\x00"

    # DROPFILES header: pFiles (DWORD), pt.x (LONG), pt.y (LONG), fNC (BOOL), fWide (BOOL)
    header = struct.pack("<I ii I I", 20, 0, 0, 0, 1)

    return header + path_bytes


def copy_file_to_clipboard(file_path: Path) -> None:
    """
    Copy a file to the Windows clipboard using CF_HDROP format.

    The file appears on the clipboard as if the user had pressed Ctrl+C
    on it in Explorer. Paste into Discord, Telegram, folders, etc.

    Raises RuntimeError on non-Windows or if the clipboard operation fails.
    """
    if not is_windows():
        raise RuntimeError("copy_file_to_clipboard is only supported on Windows")

    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    import ctypes
    from ctypes import wintypes

    CF_HDROP = 15
    GMEM_MOVEABLE = 0x0002

    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]  # Windows-only
    user32 = ctypes.windll.user32  # type: ignore[attr-defined]  # Windows-only

    # Set correct return/arg types for 64-bit Windows.
    # Without this, ctypes defaults to c_int (32-bit) which truncates
    # 64-bit HANDLE/pointer values and corrupts them.
    kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
    kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    kernel32.GlobalLock.restype = ctypes.c_void_p
    kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalUnlock.restype = wintypes.BOOL
    kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalFree.restype = wintypes.HGLOBAL
    kernel32.GlobalFree.argtypes = [wintypes.HGLOBAL]
    user32.OpenClipboard.restype = wintypes.BOOL
    user32.OpenClipboard.argtypes = [wintypes.HWND]
    user32.EmptyClipboard.restype = wintypes.BOOL
    user32.CloseClipboard.restype = wintypes.BOOL
    user32.SetClipboardData.restype = wintypes.HANDLE
    user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]

    data = _build_dropfiles_data(file_path.resolve())

    h_global = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
    if not h_global:
        raise RuntimeError("GlobalAlloc failed")

    try:
        p_global = kernel32.GlobalLock(h_global)
        if not p_global:
            raise RuntimeError("GlobalLock failed")
        try:
            ctypes.memmove(p_global, data, len(data))
        finally:
            kernel32.GlobalUnlock(h_global)

        if not user32.OpenClipboard(None):
            raise RuntimeError("OpenClipboard failed")
        try:
            user32.EmptyClipboard()
            if not user32.SetClipboardData(CF_HDROP, h_global):
                raise RuntimeError("SetClipboardData failed")
            # Clipboard now owns the memory — do not free h_global
            h_global = None
        finally:
            user32.CloseClipboard()
    finally:
        # Only free if clipboard didn't take ownership
        if h_global:
            kernel32.GlobalFree(h_global)

    logger.info("File copied to clipboard", filename=file_path.name)
