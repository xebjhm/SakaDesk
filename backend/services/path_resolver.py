"""
Path resolver for multi-service content API.
Converts API parameters to disk paths, decoupling API from disk structure.
"""

import hashlib
import json
import threading
from pathlib import Path
import re
from typing import Any, cast

import structlog

from backend.services.output_dir_policy import deep_problem, lexical_problem
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


# Digests of saved values (and defaulting reasons) already logged (never the values).
_noted_values: set[str] = set()
# Saved values whose filesystem rules were already checked (or are being) in this
# process, and the checking threads (tests wait for them).
_deep_checked: set[str] = set()
_deep_threads: list[threading.Thread] = []


def _check_saved_value(value: str) -> None:
    """Log ``output_dir_saved_unusual`` if ``value`` breaks a filesystem folder rule. Runs in a thread."""
    try:
        problem = deep_problem(value)
    except Exception as e:  # a check must never take the thread down silently
        logger.warning("output_dir_saved_check_failed", error_type=type(e).__name__)
        return
    if problem is not None:
        _note_once(value, "output_dir_saved_unusual", problem)


def _note_deep_once(value: str) -> None:
    """Start the one-per-process filesystem check of a saved value (a daemon thread).

    ``deep_problem`` resolves links, which can be slow on a network drive, so
    it never runs on the caller's thread (this is reached from request
    handlers on the event loop).
    """
    with _last_good_lock:
        if value in _deep_checked:
            return
        _deep_checked.add(value)
        thread = threading.Thread(
            target=_check_saved_value,
            args=(value,),
            name="output-dir-saved-check",
            daemon=True,
        )
        _deep_threads.append(thread)
    thread.start()


def wait_for_output_dir_checks_for_tests() -> None:
    """Test-only: wait for the saved-value check threads started so far."""
    with _last_good_lock:
        threads = list(_deep_threads)
    for thread in threads:
        thread.join(timeout=10)


def _note_once(key: str, event: str, reason: str) -> None:
    """Log ``event`` with ``reason`` the first time ``key`` is seen in this process."""
    digest = hashlib.sha256(key.encode("utf-8", "surrogatepass")).hexdigest()
    with _last_good_lock:
        first = digest not in _noted_values
        _noted_values.add(digest)
    if first:
        logger.warning(event, reason=reason)


def output_dir_value(value: object, default: Path) -> Path:
    """The archive root for a saved ``output_dir`` value: ``Path(value)``, or ``default`` when unset.

    ``None`` means unset. So does an empty or whitespace-only string (it used
    to become the process's working directory for the sync writer) and a
    non-string; those two also log ``output_dir_defaulted`` once per process
    with ``reason`` ``empty`` or ``not_string``. A saved value is used as
    saved, even one that would not be accepted as a new value today, so an
    archive in use keeps working (security audit 2026-11-13); if it fails
    ``output_dir_policy.lexical_problem`` (relative, a root, a network or
    device path) that reason is logged once per distinct value per process as
    ``output_dir_saved_unusual``, never the value. A value that passes the
    lexical rules but breaks a filesystem rule (``root`` once resolved,
    ``profile``, ``app_data``, ``system``; ``output_dir_policy.deep_problem``)
    is logged the same way, once per distinct value per process, from a
    background thread after this returns. No filesystem call on the calling
    thread.
    """
    if value is None:
        return default
    if not isinstance(value, str):
        _note_once("\0not_string", "output_dir_defaulted", "not_string")
        return default
    if not value.strip():
        _note_once("\0empty", "output_dir_defaulted", "empty")
        return default
    problem = lexical_problem(value)
    if problem is not None:
        _note_once(value, "output_dir_saved_unusual", problem)
    else:
        _note_deep_once(value)
    return Path(value)


def reset_output_dir_notes_for_tests() -> None:
    """Test-only: forget which unusual saved values were already logged."""
    wait_for_output_dir_checks_for_tests()
    with _last_good_lock:
        _noted_values.clear()
        _deep_checked.clear()
        _deep_threads.clear()


def output_dir_from_settings(settings_path: Path, default: Path) -> Path:
    """The ``output_dir`` in ``settings_path`` (:func:`output_dir_value`), else ``default``. Blocking; never raises.

    A file that exists but cannot be read or parsed gives the last value read
    from it (else ``default``) and logs ``output_dir_settings_unreadable``
    (``error_type``, ``fallback=last_good|default``; never a path).
    """
    key = str(settings_path)
    try:
        # inside the try: on Python 3.12 exists() re-raises a PermissionError
        # from stat, the very Windows race this function guards against
        if not settings_path.exists():
            return default
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
    raw = settings.get("output_dir") if isinstance(settings, dict) else None
    # An unset value records the default as the last value read: a later
    # transient failure must not bring back a custom dir the user cleared.
    out = output_dir_value(raw, default)
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
