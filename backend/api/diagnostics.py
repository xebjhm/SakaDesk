
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import platform
import sys
import os
import json
import base64
from datetime import datetime, timezone
from pathlib import Path
from backend.services.platform import get_app_data_dir, get_settings_path, get_logs_dir
from pyhako.credentials import TokenManager
from pyhako import Group

router = APIRouter(prefix="/api/diagnostics", tags=["diagnostics"])

# App version - ideally from pyproject.toml or __version__
APP_VERSION = "0.1.0"


class SystemInfo(BaseModel):
    os: str
    os_release: str
    python_version: str
    app_version: str
    app_data_dir: str
    settings_path: str
    is_windows: bool


class AuthStatus(BaseModel):
    has_token: bool
    token_expires_in: Optional[str] = None  # Human-readable, e.g., "2h 30m"
    token_expiry_seconds: Optional[int] = None
    groups_configured: list[str] = []


class DiagnosticsResponse(BaseModel):
    system: SystemInfo
    auth_status: AuthStatus
    config_state: dict
    logs: list[str]


def _format_duration(seconds: int) -> str:
    """Format seconds into human-readable duration."""
    if seconds < 0:
        return "expired"
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m {seconds % 60}s"
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    return f"{hours}h {minutes}m"


def _get_token_expiry_seconds(token: str) -> Optional[int]:
    """Extract expiry from JWT token. Returns seconds remaining or None."""
    if not token:
        return None
    try:
        parts = token.split('.')
        if len(parts) < 2:
            return None
        payload = parts[1]
        payload += '=' * (4 - len(payload) % 4)
        decoded = base64.b64decode(payload)
        data = json.loads(decoded)
        if 'exp' in data:
            exp_timestamp = data['exp']
            now = datetime.now(timezone.utc).timestamp()
            return int(exp_timestamp - now)
    except Exception:
        pass
    return None


@router.get("", response_model=DiagnosticsResponse)
async def get_diagnostics():
    """Collect system diagnostics and recent logs."""

    # System Info
    sys_info = SystemInfo(
        os=platform.system(),
        os_release=platform.release(),
        python_version=sys.version.split()[0],
        app_version=APP_VERSION,
        app_data_dir=str(get_app_data_dir()),
        settings_path=str(get_settings_path()),
        is_windows=(platform.system() == "Windows")
    )

    # Auth Status (token expiry without exposing the token)
    auth_status = AuthStatus(has_token=False)
    try:
        tm = TokenManager()
        groups_configured = []
        for group in Group:
            session_data = tm.load_session(group.value)
            if session_data and session_data.get('access_token'):
                groups_configured.append(group.value)
                # Get expiry info from first valid token
                if not auth_status.has_token:
                    auth_status.has_token = True
                    expiry_seconds = _get_token_expiry_seconds(session_data['access_token'])
                    if expiry_seconds is not None:
                        auth_status.token_expiry_seconds = expiry_seconds
                        auth_status.token_expires_in = _format_duration(expiry_seconds)
        auth_status.groups_configured = groups_configured
    except Exception:
        pass  # TokenManager may fail on some systems

    # Config State (Safe subset)
    config_state = {}
    try:
        if get_settings_path().exists():
            with open(get_settings_path(), 'r') as f:
                data = json.load(f)
                config_state['is_configured'] = data.get('is_configured')
                config_state['output_dir_configured'] = 'output_dir' in data
                config_state['auto_sync'] = data.get('auto_sync_enabled')
    except Exception as e:
        config_state['error'] = str(e)

    # Logs (Last 50 lines of latest log)
    logs = []
    try:
        log_dir = get_logs_dir()
        if log_dir.exists():
            log_files = sorted(log_dir.glob("*.log"), key=os.path.getmtime, reverse=True)
            if log_files:
                latest_log = log_files[0]
                with open(latest_log, 'r', encoding='utf-8', errors='ignore') as f:
                    lines = f.readlines()
                    logs = [l.strip() for l in lines[-50:]]
    except Exception as e:
        logs.append(f"Error reading logs: {e}")

    return DiagnosticsResponse(
        system=sys_info,
        auth_status=auth_status,
        config_state=config_state,
        logs=logs
    )
