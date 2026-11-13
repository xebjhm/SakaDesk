from fastapi import APIRouter
from pydantic import BaseModel
from typing import Literal, Optional, cast
import asyncio
import os
import platform
import sys
import json
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import structlog
from backend.services.path_resolver import output_dir_value
from backend.services.platform import (
    get_app_data_dir,
    get_default_output_dir,
    get_settings_path,
    get_logs_dir,
)
from backend.services.settings_store import read_settings_file
from pysaka.credentials import get_token_manager
from pysaka import Group, get_jwt_remaining_seconds

from backend.version import APP_VERSION
from backend.api.report import _get_username, _get_nicknames, scrub_log_line

router = APIRouter(prefix="/api/diagnostics", tags=["diagnostics"])
logger = structlog.get_logger(__name__)

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
    # Backward-compatible mirrors of ``DiagnosticsResponse.disk_usage``: filled
    # only once the background walk is ``ready`` (0 / None while pending/failed).
    disk_usage_mb: float = 0.0
    file_count: int = 0
    disk_usage_detailed: Optional[dict] = None  # Expandable breakdown
    services: list[ServiceSyncInfo] = []  # Per-service sync status


DiskUsageState = Literal["pending", "ready", "failed"]


class DiskUsage(BaseModel):
    """Output-folder disk usage, computed in the background (L6).

    ``state`` is ``pending`` while the walk runs, ``ready`` once a result is
    cached for this app run, and ``failed`` if the walk raised (also cached
    until a refresh). ``size_mb`` / ``file_count`` / ``detailed`` /
    ``computed_at`` are filled only when ``ready``; ``duration_ms`` when
    ``ready`` or ``failed``. ``computed_at`` is UTC (ISO 8601, ``Z``).
    ``detailed`` is ``{total_bytes, services: [{name, total_bytes, categories:
    [{name, bytes}]}]}``.
    """

    state: DiskUsageState
    size_mb: float = 0.0
    file_count: int = 0
    detailed: Optional[dict] = None
    computed_at: Optional[str] = None
    duration_ms: Optional[int] = None


class LogsSummary(BaseModel):
    recent: list[str]  # Last 50 lines
    errors: list[str]  # All ERROR lines (max 50)
    warnings: list[str]  # All WARNING lines (max 50)


class DiagnosticsResponse(BaseModel):
    system: SystemInfo
    auth_status: AuthStatus
    config_state: dict
    sync_state: SyncState
    disk_usage: DiskUsage
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


@dataclass
class DiskWalkResult:
    """Totals from one pass over the output folder (see ``_walk_disk_usage``)."""

    total_bytes: int = 0
    file_count: int = 0
    skipped: int = 0  # entries that vanished / could not be read mid-walk
    detailed: dict = field(default_factory=lambda: {"total_bytes": 0, "services": []})


def _walk_disk_usage(output_dir: Path) -> DiskWalkResult:
    """Sum every file under ``output_dir`` in ONE pass (blocking — slow on big archives).

    ``total_bytes`` / ``file_count`` cover every regular file. ``detailed``
    breaks bytes down by top-level folder (service) and its sub-folders
    (categories); files lying directly in the root or a service folder count
    toward the totals but not toward a category (as before).

    Uses ``os.scandir`` rather than ``Path.rglob`` + ``stat``: on Windows the
    directory listing already carries file sizes, so no extra syscall per file.
    Symlinks and Windows junctions are not followed (no loops, no double
    counting); they count as neither file nor folder. An entry that disappears
    or cannot be read mid-walk (sync writes concurrently) is counted in
    ``skipped`` instead of failing the walk. Only the top two levels (services
    and their categories) are sorted by name, for a stable breakdown order;
    deeper listings are summed unsorted.
    """
    result = DiskWalkResult()

    def _scan(path: str, ordered: bool = False) -> list["os.DirEntry[str]"]:
        try:
            with os.scandir(path) as entries:
                if ordered:
                    return sorted(entries, key=lambda e: e.name)
                return list(entries)
        except OSError:
            result.skipped += 1
            return []

    def _kind(entry: "os.DirEntry[str]") -> str:
        try:
            # A junction reports is_dir() even with follow_symlinks=False.
            if entry.is_junction():
                return "other"
            if entry.is_dir(follow_symlinks=False):
                return "dir"
            if entry.is_file(follow_symlinks=False):
                return "file"
        except OSError:
            result.skipped += 1
        return "other"  # symlink, junction, device, or unreadable

    def _file_bytes(entry: "os.DirEntry[str]") -> int:
        try:
            size = entry.stat(follow_symlinks=False).st_size
        except OSError:
            result.skipped += 1
            return 0
        result.file_count += 1
        return size

    def _tree_bytes(root: str) -> int:
        """Bytes of all files under ``root`` (iterative, no recursion limit)."""
        total = 0
        stack = [root]
        while stack:
            for entry in _scan(stack.pop()):
                kind = _kind(entry)
                if kind == "dir":
                    stack.append(entry.path)
                elif kind == "file":
                    total += _file_bytes(entry)
        return total

    if not output_dir.is_dir():
        return result

    # The root listing itself is not guarded: an unreadable output folder is a
    # failed walk, not an empty one.
    with os.scandir(output_dir) as root_entries:
        tops = sorted(root_entries, key=lambda e: e.name)

    loose_bytes = 0  # files outside any category folder
    services: list[dict] = []
    for top in tops:
        kind = _kind(top)
        if kind == "file":
            loose_bytes += _file_bytes(top)
            continue
        if kind != "dir":
            continue
        service: dict = {"name": top.name, "total_bytes": 0, "categories": []}
        for child in _scan(top.path, ordered=True):
            child_kind = _kind(child)
            if child_kind == "dir":
                cat_bytes = _tree_bytes(child.path)
                service["categories"].append({"name": child.name, "bytes": cat_bytes})
                service["total_bytes"] += cat_bytes
            elif child_kind == "file":
                loose_bytes += _file_bytes(child)
        services.append(service)

    categorised = sum(svc["total_bytes"] for svc in services)
    result.detailed = {"total_bytes": categorised, "services": services}
    result.total_bytes = categorised + loose_bytes
    return result


class _DiskUsageTracker:
    """Single-flight, run-cached background disk-usage computation (L6).

    ``snapshot()`` never blocks on the walk: the first call for an output folder
    starts it on a daemon thread and reports ``pending``; concurrent calls join
    that same walk; once it finishes, its result (or failure) is cached for the
    rest of the app run. ``refresh=True`` starts a new walk unless one is
    already running (then it joins it). A daemon thread rather than an executor
    so a long walk can never hold up app shutdown. If the thread cannot be
    started, the slot is freed and ``failed`` is returned (not cached, so the
    next poll or refresh retries). Thread-safe.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._idle = threading.Event()
        self._idle.set()
        self._running_dir: Optional[str] = None
        self._cached_dir: Optional[str] = None
        self._cached: Optional[DiskUsage] = None

    def snapshot(self, output_dir: Optional[str], refresh: bool = False) -> DiskUsage:
        """Current disk usage for ``output_dir``; starts a walk when needed."""
        if not output_dir:
            logger.debug("diagnostics_disk_usage_skipped", reason="no_output_dir")
            return DiskUsage(state="ready")
        with self._lock:
            if self._running_dir is not None:
                logger.debug(
                    "diagnostics_disk_usage_joined",
                    same_dir=self._running_dir == output_dir,
                    refresh=refresh,
                )
                return DiskUsage(state="pending")
            if (
                self._cached is not None
                and self._cached_dir == output_dir
                and not refresh
            ):
                return self._cached
            if refresh:
                reason = "refresh"
            elif self._cached is None:
                reason = "first"
            else:
                reason = "output_dir_changed"
            self._running_dir = output_dir
            self._idle.clear()
        logger.info("diagnostics_disk_usage_started", reason=reason)
        try:
            threading.Thread(
                target=self._run,
                args=(output_dir,),
                name="diagnostics-disk-usage",
                daemon=True,
            ).start()
        except Exception as e:  # noqa: BLE001 — e.g. RuntimeError: can't start thread
            # Nothing is running: free the slot so a later poll / Refresh retries.
            with self._lock:
                self._running_dir = None
                self._idle.set()
            logger.warning(
                "diagnostics_disk_usage_failed",
                phase="thread_start",
                error_type=type(e).__name__,
            )
            return DiskUsage(state="failed")
        return DiskUsage(state="pending")

    def wait_idle(self, timeout: float) -> bool:
        """Block until no walk is running (used by tests); True if idle."""
        return self._idle.wait(timeout)

    def _run(self, output_dir: str) -> None:
        """Thread body: walk, cache the result, and ALWAYS go idle again.

        Any exception — in the walk or while building / logging the result —
        becomes a cached ``failed`` (logged with ``error_type`` only: messages
        can carry the PII folder path); the ``finally`` frees the single-flight
        slot so a crash can never leave the panel ``pending`` forever.
        """
        started = time.monotonic()
        usage = DiskUsage(state="failed")
        try:
            walk = _walk_disk_usage(Path(output_dir))
            duration_ms = int((time.monotonic() - started) * 1000)
            size_mb = round(walk.total_bytes / (1024 * 1024), 2)
            usage = DiskUsage(
                state="ready",
                size_mb=size_mb,
                file_count=walk.file_count,
                detailed=walk.detailed,
                computed_at=datetime.now(timezone.utc)
                .isoformat(timespec="seconds")
                .replace("+00:00", "Z"),
                duration_ms=duration_ms,
            )
            logger.info(
                "diagnostics_disk_usage_finished",
                duration_ms=duration_ms,
                file_count=walk.file_count,
                size_mb=size_mb,
                skipped=walk.skipped,
            )
        except Exception as e:  # noqa: BLE001 — any failure becomes state=failed
            duration_ms = int((time.monotonic() - started) * 1000)
            usage = DiskUsage(state="failed", duration_ms=duration_ms)
            logger.warning(
                "diagnostics_disk_usage_failed",
                phase="walk",
                duration_ms=duration_ms,
                error_type=type(e).__name__,
            )
        finally:
            with self._lock:
                self._cached = usage
                self._cached_dir = output_dir
                self._running_dir = None
                self._idle.set()


_disk_usage_tracker = _DiskUsageTracker()


def _tail_lines(path: Path, max_lines: int, max_bytes: int = 1_000_000) -> list[str]:
    """Return the last ``max_lines`` lines of ``path`` without reading it all.

    SD-BE-API-01: debug.log is DEBUG-level and can grow to many MB; slurping it
    with ``readlines()`` on every diagnostics request wastes memory and time.
    This seeks to the end and reads at most ``max_bytes`` from the tail, which
    bounds the work regardless of total file size. Lines include their trailing
    newline (as ``readlines`` does), so callers can ``.strip()`` uniformly.
    """
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)  # end
            size = f.tell()
            read_size = min(size, max_bytes)
            f.seek(size - read_size)
            chunk = f.read(read_size)
    except OSError:
        return []
    text = chunk.decode("utf-8", errors="ignore")
    # If we truncated mid-file, drop the (likely partial) first line.
    lines = text.splitlines(keepends=True)
    if read_size < size and lines:
        lines = lines[1:]
    return lines[-max_lines:]


@router.get("", response_model=DiagnosticsResponse)
async def get_diagnostics(refresh_disk_usage: bool = False):
    """Collect comprehensive system diagnostics for debugging.

    SD-BE-API-01: the gather does blocking keyring reads, a settings-file read
    and log tail-reads — all off-loaded to a single thread so the endpoint never
    freezes the event loop.

    L6: the output-folder disk walk is NOT part of the gather (it took ~160 s on
    a 34 GB archive). ``disk_usage`` comes from the background tracker: the
    first request starts the walk and reports ``pending``; poll
    ``GET /api/diagnostics/disk-usage`` until ``ready`` / ``failed``.
    ``refresh_disk_usage=true`` recomputes a cached result.
    """
    return await asyncio.to_thread(_collect_diagnostics, refresh_disk_usage)


@router.get("/disk-usage", response_model=DiskUsage)
async def get_disk_usage():
    """Poll the background disk-usage result (never walks on the request path).

    Starts a walk only if none is cached or running for the configured output
    folder — the same single-flight tracker as ``GET /api/diagnostics``.
    """
    return await asyncio.to_thread(
        lambda: _disk_usage_tracker.snapshot(_configured_output_dir())
    )


def _configured_output_dir() -> Optional[str]:
    """The archive folder sync uses, as text, or None when settings cannot be read.

    Read through ``path_resolver.output_dir_value``, the resolver sync uses: an
    unset, empty or non-string saved value is the default folder, and the
    value never reaches ``Path()`` unchecked. Blocking read.
    """
    try:
        data = read_settings_file(get_settings_path())
        if isinstance(data, dict):
            return str(
                output_dir_value(data.get("output_dir"), get_default_output_dir())
            )
    except Exception as e:
        logger.warning("diagnostics_settings_read_failed", error_type=type(e).__name__)
    return None


def _collect_diagnostics(refresh_disk_usage: bool = False) -> DiagnosticsResponse:
    """Blocking diagnostics gather — call via ``asyncio.to_thread`` (SD-BE-API-01)."""
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
    output_dir: Optional[str] = None
    try:
        data = read_settings_file(get_settings_path())
        if data is not None:
            config_state["is_configured"] = data.get("is_configured", False)
            config_state["output_dir_configured"] = "output_dir" in data
            config_state["auto_sync"] = data.get("auto_sync_enabled", True)
            config_state["sync_interval"] = data.get("sync_interval_minutes", 1)
            config_state["adaptive_sync"] = data.get("adaptive_sync_enabled", True)
            config_state["notifications"] = data.get("notifications_enabled", True)
            config_state["blogs_full_backup"] = data.get("blogs_full_backup", False)
            output_dir = str(
                output_dir_value(data.get("output_dir"), get_default_output_dir())
            )
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
        # A code, never str(e): the endpoint needs no login and an OSError's
        # text carries the settings path.
        config_state["error"] = "settings_unreadable"
        logger.warning("diagnostics_config_read_failed", error_type=type(e).__name__)

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

    except Exception:
        pass

    # L6: never walk here — the tracker answers at once (pending/ready/failed).
    disk_usage = _disk_usage_tracker.snapshot(output_dir, refresh=refresh_disk_usage)
    if disk_usage.state == "ready":
        sync_state.disk_usage_mb = disk_usage.size_mb
        sync_state.file_count = disk_usage.file_count
        sync_state.disk_usage_detailed = disk_usage.detailed

    # Logs with categorization
    # debug.log has everything (recent context); error.log is pre-filtered
    #
    # SEC-5: scrub every emitted log line for PII (OS username, cached nicknames)
    # and token-like/bearer/JWT/long-secret strings before returning it, matching
    # report.py's redaction. Diagnostics is reachable without auth, so raw log
    # tails must never leak credentials or paths.
    username = _get_username()
    nickname = _get_nicknames()  # every service's nickname, longest first

    def _scrub(line: str) -> str:
        return scrub_log_line(line.strip(), username, nickname, output_dir)

    logs_summary = LogsSummary(recent=[], errors=[], warnings=[])
    # SD-BE-API-01: tail-read the logs instead of slurping the whole (possibly
    # multi-MB DEBUG-level) file. `debug_tail` bounds the work regardless of
    # total size; it covers both the recent-50 and the error.log-missing fallback.
    debug_tail: list[str] = []
    try:
        log_dir = get_logs_dir()
        if nickname is None:  # settings unreadable: fail closed, send no log lines
            logger.warning("diagnostics_logs_withheld", reason="nicknames_unavailable")
        elif log_dir.exists():
            # Recent logs from debug.log (last 50 lines)
            debug_log = log_dir / "debug.log"
            if debug_log.exists():
                debug_tail = _tail_lines(debug_log, 2000)
                logs_summary.recent = [_scrub(line) for line in debug_tail[-50:]]

            # Errors/warnings from dedicated error.log (smaller, faster)
            error_log = log_dir / "error.log"
            if error_log.exists():
                err_lines = _tail_lines(error_log, 2000)
                errors = [
                    _scrub(line) for line in err_lines if "[error" in line.lower()
                ]
                warnings = [
                    _scrub(line) for line in err_lines if "[warning" in line.lower()
                ]
                logs_summary.errors = errors[-50:]
                logs_summary.warnings = warnings[-50:]
            elif debug_log.exists():
                # Fallback: extract from debug.log if error.log doesn't exist yet
                errors = [
                    _scrub(line) for line in debug_tail if "[error" in line.lower()
                ]
                warnings = [
                    _scrub(line) for line in debug_tail if "[warning" in line.lower()
                ]
                logs_summary.errors = errors[-50:]
                logs_summary.warnings = warnings[-50:]
    except Exception as e:
        logs_summary.recent.append("logs_unreadable")  # a code: str(e) has paths
        logger.warning("diagnostics_logs_read_failed", error_type=type(e).__name__)

    return DiagnosticsResponse(
        system=sys_info,
        auth_status=auth_status,
        config_state=config_state,
        sync_state=sync_state,
        disk_usage=disk_usage,
        logs=logs_summary,
    )
