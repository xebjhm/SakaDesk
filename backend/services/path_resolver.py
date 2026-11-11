"""
Path resolver for multi-service content API.
Converts API parameters to disk paths, decoupling API from disk structure.
"""

import json
import threading
from pathlib import Path
import re
from typing import Any, cast

import structlog

from backend.services.service_utils import get_service_display_name, validate_service

logger = structlog.get_logger(__name__)

# settings path -> the output dir last read from it. A failed read returns this
# instead of the default dir: on Windows, reading settings.json while
# ``settings_store`` swaps it in with ``os.replace`` can fail for a moment
# (PermissionError). Falling back to the default dir then made every archive
# path look "outside" the output dir (a burst of ``path_traversal_blocked``)
# and a view built meanwhile was cached with no photos.
_last_good: dict[str, Path] = {}
_last_good_lock = threading.Lock()


def _read_settings(settings_path: Path) -> Any:
    with open(settings_path, "r", encoding="utf-8") as f:
        return json.load(f)


def output_dir_from_settings(settings_path: Path, default: Path) -> Path:
    """The ``output_dir`` in ``settings_path``, else ``default``. Blocking; never raises.

    A file that exists but cannot be read or parsed gives the last value read
    from it (else ``default``) and logs ``output_dir_settings_unreadable``
    (``error_type``, ``fallback=last_good|default``; never a path).
    """
    key = str(settings_path)
    if not settings_path.exists():
        return default
    try:
        settings = _read_settings(settings_path)
    except (OSError, ValueError) as e:
        with _last_good_lock:
            last = _last_good.get(key)
        logger.warning(
            "output_dir_settings_unreadable",
            error_type=type(e).__name__,
            fallback="last_good" if last is not None else "default",
        )
        return last if last is not None else default
    path_str = settings.get("output_dir") if isinstance(settings, dict) else None
    if not path_str:
        return default
    out = Path(path_str)
    with _last_good_lock:
        _last_good[key] = out
    return out


def get_output_dir() -> Path:
    """Get configured output directory (see :func:`output_dir_from_settings`)."""
    from backend.services.platform import get_settings_path, get_default_output_dir

    return output_dir_from_settings(get_settings_path(), get_default_output_dir())


def resolve_service_path(service: str) -> Path:
    """Get base path for a service's content."""
    validate_service(service)
    display_name = get_service_display_name(service)
    return cast(Path, get_output_dir() / display_name)


def find_folder_by_id(base_path: Path, folder_id: int) -> Path:
    """
    Find a folder that starts with the given ID.
    Folder names are in format "{id} {name}", e.g., "40 松田 好花".
    """
    if not base_path.exists():
        raise FileNotFoundError(f"Base path does not exist: {base_path}")

    pattern = re.compile(rf"^{folder_id}\s+.+$")

    for item in base_path.iterdir():
        if item.is_dir() and pattern.match(item.name):
            return item

    raise FileNotFoundError(f"No folder found with ID {folder_id} in {base_path}")


def resolve_talk_room_path(service: str, talk_room_id: int) -> Path:
    """Resolve path to a talk room directory."""
    service_path = resolve_service_path(service)
    messages_path = service_path / "messages"
    return find_folder_by_id(messages_path, talk_room_id)


def resolve_member_path(service: str, talk_room_id: int, member_id: int) -> Path:
    """Resolve path to a member directory within a talk room."""
    talk_room_path = resolve_talk_room_path(service, talk_room_id)
    return find_folder_by_id(talk_room_path, member_id)


def resolve_messages_file(service: str, talk_room_id: int, member_id: int) -> Path:
    """Resolve path to messages.json file."""
    member_path = resolve_member_path(service, talk_room_id, member_id)
    return member_path / "messages.json"


def resolve_media_path(
    service: str, talk_room_id: int, member_id: int, media_type: str, filename: str
) -> Path:
    """Resolve path to a media file."""
    member_path = resolve_member_path(service, talk_room_id, member_id)
    return member_path / media_type / filename
