"""
Service utilities for multi-service support.
Maps between service identifiers and pysaka Group enum.
"""

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, cast

from pysaka import Group
from pysaka.client import GROUP_CONFIG


def _replace_with_retry(
    src: str, dst: str, *, attempts: int = 5, base_delay: float = 0.1
) -> None:
    """``os.replace`` that retries transient Windows lock errors.

    On Windows ``os.replace`` raises ``PermissionError`` (WinError 5/32) when
    another handle briefly holds the destination (a concurrent reader, antivirus,
    the Search indexer). These clear within milliseconds, so retry with a short
    linear backoff rather than dropping the write. (blog_service.py / settings_store.py
    carry parallel copies that can later consolidate here.)
    """
    for attempt in range(attempts):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(base_delay * (attempt + 1))


def atomic_write_json(path: Path, data: Any) -> None:
    """Write ``data`` as JSON to ``path`` atomically (temp file in the same dir +
    ``os.replace``), so a crash or force-close mid-write cannot leave a truncated
    or corrupt file. Windows-safe via ``_replace_with_retry``."""
    path = Path(path)
    fd, tmp_path = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        _replace_with_retry(tmp_path, str(path))
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def get_all_services() -> List[str]:
    """Get list of all supported service identifiers (lowercase)."""
    # Return lowercase names matching Group enum values
    return [g.value for g in Group]


def get_service_display_name(service: str) -> str:
    """Get display name for a service (e.g., '日向坂46')."""
    group = get_service_enum(service)
    return cast(str, GROUP_CONFIG[group]["display_name"])


def get_service_identifier(display_name: str) -> Optional[str]:
    """
    Reverse lookup: Get service identifier from display name or romanized name.
    E.g., '日向坂46' -> 'hinatazaka46'
    E.g., 'hinatazaka46' -> 'hinatazaka46'
    E.g., 'Hinatazaka46' -> 'hinatazaka46'
    Returns None if not found.
    """
    # First try Japanese display name lookup
    for group in Group:
        if GROUP_CONFIG[group]["display_name"] == display_name:
            return cast(str, group.value)

    # Then try romanized name lookup (case-insensitive)
    lower_name = display_name.lower()
    for group in Group:
        if group.value == lower_name:
            return cast(str, group.value)

    return None


def get_service_enum(service: str) -> Group:
    """Convert service string to Group enum (case-insensitive)."""
    try:
        return Group(service.lower())
    except ValueError:
        raise ValueError(f"Unknown service: {service}")


def validate_service(service: str) -> str:
    """Validate service identifier. Raises ValueError if invalid."""
    get_service_enum(service)  # Will raise if invalid
    return service


def get_service_config(service: str) -> Dict[str, Any]:
    """Get full config for a service."""
    group = get_service_enum(service)
    return cast(Dict[str, Any], GROUP_CONFIG[group])
