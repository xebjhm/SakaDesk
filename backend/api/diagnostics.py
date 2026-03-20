from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, cast
import platform
import sys
import json
import time
from datetime import datetime
from pathlib import Path
from backend.services.platform import get_app_data_dir, get_settings_path, get_logs_dir
from pysaka.credentials import get_token_manager
from pysaka import Group, get_jwt_remaining_seconds

from backend.version import APP_VERSION

router = APIRouter(prefix="/api/diagnostics", tags=["diagnostics"])

# pysaka version - try importlib.metadata first (works with installed packages)
try:
    from importlib.metadata import version

    PYSAKA_VERSION = version("pysaka")
except Exception:
    PYSAKA_VERSION = "unknown"


class SystemInfo(BaseModel):
    os: str
    os_release: str
    python_version: str
    app_version: str
    pysaka_version: str
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
    last_error: Optional[str] = None
    disk_usage_mb: float = 0.0
    file_count: int = 0
    disk_usage_detailed: Optional[dict] = None  # Expandable breakdown
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
    """Extract expiry from JWT token. Uses shared pysaka utility."""
    if not token:
        return None
    return cast(Optional[int], get_jwt_remaining_seconds(token))


def _get_disk_usage(output_dir: str) -> tuple[float, int]:
    """Get disk usage statistics for output directory.
    Returns: (size_mb, file_count)
    """
    total_size = 0
    file_count = 0
    size_mb = 0.0

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


_disk_cache: dict = {"data": None, "expires": 0}


def _get_detailed_disk_usage(output_dir: str) -> dict:
    """Get per-service, per-category disk usage breakdown with 60-second cache."""
    now = time.time()
    if _disk_cache["data"] and now < _disk_cache["expires"]:
        return _disk_cache["data"]

    result: dict = {"total_bytes": 0, "services": []}
    output_path = Path(output_dir)
    if not output_path.exists():
        return result

    for service_dir in sorted(output_path.iterdir()):
        if not service_dir.is_dir():
            continue
        service_entry: dict = {
            "name": service_dir.name,
            "total_bytes": 0,
            "categories": [],
        }

        for category_dir in sorted(service_dir.iterdir()):
            if not category_dir.is_dir():
                continue
            cat_size = sum(
                f.stat().st_size for f in category_dir.rglob("*") if f.is_file()
            )
            service_entry["categories"].append(
                {
                    "name": category_dir.name,
                    "bytes": cat_size,
                }
            )
            service_entry["total_bytes"] += cat_size

        result["services"].append(service_entry)
        result["total_bytes"] += service_entry["total_bytes"]

    _disk_cache["data"] = result
    _disk_cache["expires"] = now + 60
    return result


@router.get("", response_model=DiagnosticsResponse)
async def get_diagnostics():
    """Collect comprehensive system diagnostics for debugging."""

    # System Info
    sys_info = SystemInfo(
        os=platform.system(),
        os_release=platform.release(),
        python_version=sys.version.split()[0],
        app_version=APP_VERSION,
        pysaka_version=PYSAKA_VERSION,
        app_data_dir=str(get_app_data_dir()),
        settings_path=str(get_settings_path()),
        logs_dir=str(get_logs_dir()),
        is_windows=(platform.system() == "Windows"),
    )

    # Auth Status (token expiry without exposing the token)
    auth_status = AuthStatus(has_token=False)
    try:
        tm = get_token_manager()
        groups_configured = []
        for group in Group:
            session_data = tm.load_session(group.value)
            if session_data and session_data.get("access_token"):
                groups_configured.append(group.value)
                # Get expiry info from first valid token
                if not auth_status.has_token:
                    auth_status.has_token = True
                    expiry_seconds = _get_token_expiry_seconds(
                        session_data["access_token"]
                    )
                    if expiry_seconds is not None:
                        auth_status.token_expiry_seconds = expiry_seconds
                        auth_status.token_expires_in = _format_duration(expiry_seconds)
        auth_status.groups_configured = groups_configured
    except Exception:
        pass  # TokenManager may fail on some systems

    # Config State (Safe subset)
    # Use same defaults as the settings API (SettingsResponse) to avoid
    # dual-source-of-truth bugs where diagnostics shows different values.
    config_state = {}
    output_dir = None
    try:
        if get_settings_path().exists():
            with open(get_settings_path(), "r", encoding="utf-8") as f:
                data = json.load(f)
                config_state["is_configured"] = data.get("is_configured", False)
                config_state["output_dir_configured"] = "output_dir" in data
                config_state["auto_sync"] = data.get("auto_sync_enabled", True)
                config_state["sync_interval"] = data.get("sync_interval_minutes", 1)
                config_state["adaptive_sync"] = data.get("adaptive_sync_enabled", True)
                config_state["notifications"] = data.get("notifications_enabled", True)
                config_state["blogs_full_backup"] = data.get("blogs_full_backup", False)
                output_dir = data.get("output_dir")
        else:
            # No settings file yet — show all defaults
            config_state["is_configured"] = False
            config_state["output_dir_configured"] = False
            config_state["auto_sync"] = True
            config_state["sync_interval"] = 1
            config_state["adaptive_sync"] = True
            config_state["notifications"] = True
            config_state["blogs_full_backup"] = False
    except Exception as e:
        config_state["error"] = str(e)

    # Sync State
    sync_state = SyncState()
    try:
        if output_dir:
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
                        with open(metadata_path, "r", encoding="utf-8") as f:
                            metadata = json.load(f)
                            utc_sync = metadata.get("last_sync")
                            if utc_sync:
                                try:
                                    utc_dt = datetime.fromisoformat(
                                        utc_sync.replace("Z", "+00:00")
                                    )
                                    local_dt = utc_dt.astimezone()
                                    service_info.last_sync = local_dt.strftime(
                                        "%Y-%m-%d %H:%M:%S"
                                    )
                                except Exception:
                                    service_info.last_sync = utc_sync

                            if metadata.get("last_error"):
                                service_info.last_error = metadata.get("last_error")
                                last_error = metadata.get("last_error")

                            # Count members and messages from metadata
                            groups = metadata.get("groups", {})
                            service_info.member_count = len(groups)
                            total_messages = 0
                            for group_data in groups.values():
                                total_messages += group_data.get("message_count", 0)
                            service_info.message_count = total_messages
                    except Exception:
                        pass

                services_info.append(service_info)

            # Sort by display name
            services_info.sort(key=lambda s: s.display_name)
            sync_state.services = services_info
            sync_state.last_error = last_error

            # Get disk usage stats
            size_mb, file_count = _get_disk_usage(output_dir)
            sync_state.disk_usage_mb = size_mb
            sync_state.file_count = file_count
            sync_state.disk_usage_detailed = _get_detailed_disk_usage(output_dir)
    except Exception:
        pass

    # Logs with categorization
    # debug.log has everything (recent context); error.log is pre-filtered
    logs_summary = LogsSummary(recent=[], errors=[], warnings=[])
    all_lines: list[str] = []
    try:
        log_dir = get_logs_dir()
        if log_dir.exists():
            # Recent logs from debug.log (last 50 lines)
            debug_log = log_dir / "debug.log"
            if debug_log.exists():
                with open(debug_log, "r", encoding="utf-8", errors="ignore") as f:
                    all_lines = f.readlines()
                    logs_summary.recent = [line.strip() for line in all_lines[-50:]]

            # Errors/warnings from dedicated error.log (smaller, faster)
            error_log = log_dir / "error.log"
            if error_log.exists():
                with open(error_log, "r", encoding="utf-8", errors="ignore") as f:
                    err_lines = f.readlines()
                    errors = [
                        line.strip() for line in err_lines if "[error" in line.lower()
                    ]
                    warnings = [
                        line.strip() for line in err_lines if "[warning" in line.lower()
                    ]
                    logs_summary.errors = errors[-50:]
                    logs_summary.warnings = warnings[-50:]
            elif debug_log.exists():
                # Fallback: extract from debug.log if error.log doesn't exist yet
                errors = [
                    line.strip() for line in all_lines if "[error" in line.lower()
                ]
                warnings = [
                    line.strip() for line in all_lines if "[warning" in line.lower()
                ]
                logs_summary.errors = errors[-50:]
                logs_summary.warnings = warnings[-50:]
    except Exception as e:
        logs_summary.recent.append(f"Error reading logs: {e}")

    return DiagnosticsResponse(
        system=sys_info,
        auth_status=auth_status,
        config_state=config_state,
        sync_state=sync_state,
        logs=logs_summary,
    )
