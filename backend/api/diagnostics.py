
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
from pyhako.credentials import get_token_manager
from pyhako import Group

router = APIRouter(prefix="/api/diagnostics", tags=["diagnostics"])

# App version - ideally from pyproject.toml or __version__
APP_VERSION = "0.1.0"

# PyHako version - try importlib.metadata first (works with installed packages)
try:
    from importlib.metadata import version
    PYHAKO_VERSION = version("pyhako")
except Exception:
    PYHAKO_VERSION = "unknown"


class SystemInfo(BaseModel):
    os: str
    os_release: str
    python_version: str
    app_version: str
    pyhako_version: str
    app_data_dir: str
    settings_path: str
    logs_dir: str
    is_windows: bool


class AuthStatus(BaseModel):
    has_token: bool
    token_expires_in: Optional[str] = None  # Human-readable, e.g., "2h 30m"
    token_expiry_seconds: Optional[int] = None
    groups_configured: list[str] = []


class ServiceSyncInfo(BaseModel):
    """Sync status for a single service."""
    service_id: str
    display_name: str
    last_sync: Optional[str] = None
    last_error: Optional[str] = None
    message_count: int = 0
    member_count: int = 0


class SyncState(BaseModel):
    last_sync: Optional[str] = None  # Legacy: most recent across all services
    last_error: Optional[str] = None
    disk_usage_mb: float = 0.0
    file_count: int = 0
    services: list[ServiceSyncInfo] = []  # Per-service sync status


class LogsSummary(BaseModel):
    recent: list[str]  # Last 50 lines
    errors: list[str]  # All ERROR lines (max 50)
    warnings: list[str]  # All WARNING lines (max 50)


class DiagnosticsResponse(BaseModel):
    system: SystemInfo
    auth_status: AuthStatus
    config_state: dict
    sync_state: SyncState
    logs: LogsSummary


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


def _get_disk_usage(output_dir: str) -> tuple[float, int]:
    """Get disk usage statistics for output directory.
    Returns: (size_mb, file_count)
    """
    total_size = 0
    file_count = 0

    try:
        output_path = Path(output_dir)
        if not output_path.exists():
            return 0.0, 0

        # Recursively sum all file sizes
        for file_path in output_path.rglob("*"):
            if file_path.is_file():
                file_count += 1
                total_size += file_path.stat().st_size

        size_mb = total_size / (1024 * 1024)
    except Exception:
        pass

    return round(size_mb, 2), file_count


@router.get("", response_model=DiagnosticsResponse)
async def get_diagnostics():
    """Collect comprehensive system diagnostics for debugging."""

    # System Info
    sys_info = SystemInfo(
        os=platform.system(),
        os_release=platform.release(),
        python_version=sys.version.split()[0],
        app_version=APP_VERSION,
        pyhako_version=PYHAKO_VERSION,
        app_data_dir=str(get_app_data_dir()),
        settings_path=str(get_settings_path()),
        logs_dir=str(get_logs_dir()),
        is_windows=(platform.system() == "Windows")
    )

    # Auth Status (token expiry without exposing the token)
    auth_status = AuthStatus(has_token=False)
    try:
        tm = get_token_manager()
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
    output_dir = None
    try:
        if get_settings_path().exists():
            with open(get_settings_path(), 'r') as f:
                data = json.load(f)
                config_state['is_configured'] = data.get('is_configured')
                config_state['output_dir_configured'] = 'output_dir' in data
                config_state['auto_sync'] = data.get('auto_sync_enabled')
                config_state['sync_interval'] = data.get('sync_interval_minutes')
                output_dir = data.get('output_dir')
    except Exception as e:
        config_state['error'] = str(e)

    # Sync State
    sync_state = SyncState()
    try:
        if output_dir:
            # Check for per-service sync metadata files
            # Find the most recent last_sync across all services
            latest_sync = None
            last_error = None
            output_path = Path(output_dir)
            services_info: list[ServiceSyncInfo] = []

            # Service display name to ID mapping
            service_name_to_id = {
                "日向坂46": "hinatazaka46",
                "櫻坂46": "sakurazaka46",
                "乃木坂46": "nogizaka46",
            }

            for service_dir in output_path.iterdir():
                if not service_dir.is_dir():
                    continue

                display_name = service_dir.name
                service_id = service_name_to_id.get(display_name, display_name)

                service_info = ServiceSyncInfo(
                    service_id=service_id,
                    display_name=display_name,
                )

                metadata_path = service_dir / "sync_metadata.json"
                if metadata_path.exists():
                    try:
                        with open(metadata_path, 'r') as f:
                            metadata = json.load(f)
                            utc_sync = metadata.get('last_sync')
                            if utc_sync:
                                # Track latest for legacy field
                                if latest_sync is None or utc_sync > latest_sync:
                                    latest_sync = utc_sync
                                # Format for this service
                                try:
                                    utc_dt = datetime.fromisoformat(utc_sync.replace('Z', '+00:00'))
                                    local_dt = utc_dt.astimezone()
                                    service_info.last_sync = local_dt.strftime('%Y-%m-%d %H:%M:%S')
                                except Exception:
                                    service_info.last_sync = utc_sync

                            if metadata.get('last_error'):
                                service_info.last_error = metadata.get('last_error')
                                last_error = metadata.get('last_error')

                            # Count members and messages from metadata
                            groups = metadata.get('groups', {})
                            service_info.member_count = len(groups)
                            total_messages = 0
                            for group_data in groups.values():
                                total_messages += group_data.get('message_count', 0)
                            service_info.message_count = total_messages
                    except Exception:
                        pass

                services_info.append(service_info)

            # Sort by display name
            services_info.sort(key=lambda s: s.display_name)
            sync_state.services = services_info

            if latest_sync:
                try:
                    # Parse ISO format with Z suffix (UTC)
                    utc_dt = datetime.fromisoformat(latest_sync.replace('Z', '+00:00'))
                    # Convert to local time
                    local_dt = utc_dt.astimezone()
                    # Format as human-readable local time
                    sync_state.last_sync = local_dt.strftime('%Y-%m-%d %H:%M:%S %Z')
                except Exception:
                    # Fallback: show as-is if parsing fails
                    sync_state.last_sync = latest_sync
            sync_state.last_error = last_error

            # Get disk usage stats
            size_mb, file_count = _get_disk_usage(output_dir)
            sync_state.disk_usage_mb = size_mb
            sync_state.file_count = file_count
    except Exception:
        pass

    # Logs with categorization
    logs_summary = LogsSummary(recent=[], errors=[], warnings=[])
    try:
        log_dir = get_logs_dir()
        if log_dir.exists():
            log_files = sorted(log_dir.glob("*.log"), key=os.path.getmtime, reverse=True)
            if log_files:
                latest_log = log_files[0]
                with open(latest_log, 'r', encoding='utf-8', errors='ignore') as f:
                    all_lines = f.readlines()

                    # Recent logs (last 50)
                    logs_summary.recent = [l.strip() for l in all_lines[-50:]]

                    # Errors (all ERROR lines, max 50)
                    errors = [l.strip() for l in all_lines if ' - ERROR - ' in l]
                    logs_summary.errors = errors[-50:]

                    # Warnings (all WARNING lines, max 50)
                    warnings = [l.strip() for l in all_lines if ' - WARNING - ' in l]
                    logs_summary.warnings = warnings[-50:]
    except Exception as e:
        logs_summary.recent.append(f"Error reading logs: {e}")

    return DiagnosticsResponse(
        system=sys_info,
        auth_status=auth_status,
        config_state=config_state,
        sync_state=sync_state,
        logs=logs_summary
    )
