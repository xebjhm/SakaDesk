"""Which folders may become the archive root, ``output_dir`` (security audit 2026-11-13,
backend/api/settings.py:output-dir-unvalidated-archive-trust-root).

Every archive containment check trusts ``output_dir`` as its base, so whoever
sets it decides which files the archive routes may read. ``POST /api/settings``
therefore takes a new value only when the user chose it in the native folder
picker the backend runs (:func:`grant`, then :func:`take_grant` when it is
saved; a pick is used once and expires after ``GRANT_LIFETIME_SECONDS``) or it is the default folder, and only if :func:`check_output_dir`
passes. Reasons (log, API and UI codes):

Lexical, before any filesystem call (so a network path is never opened):

- ``invalid``: not a string, empty, longer than 1024 characters, or with a
  control character;
- ``device``: a ``\\\\?\\`` or ``\\\\.\\`` device path (either slash);
- ``network``: a UNC path (``\\\\host\\share``, ``//host/share``);
- ``root``: a drive or filesystem root (``C:\\``, ``/``);
- ``relative``: not absolute on this system (``C:x`` counts as relative).

Then on the normalised path and on its resolved form (links followed):

- ``root``: it resolves to a root;
- ``profile``: the user's home folder, or a folder above it (``C:\\Users``);
- ``app_data``: a folder SakaDesk or pysaka owns, a folder inside it, or a
  folder above it: SakaDesk's data folder (``%LOCALAPPDATA%\\SakaDesk``), the
  per-user install folder (``%LOCALAPPDATA%\\Programs\\SakaDesk``, which the
  uninstaller empties) and pysaka's sign-in folder (``%APPDATA%\\pysaka``,
  deleted on uninstall);
- ``system``: the Windows folder, Program Files, Program Files (x86) or
  ProgramData, or a folder inside one;
- ``not_writable``: the folder cannot be created or a file written in it.

A mapped drive letter (``Z:\\SakaDesk``) passes even though it resolves to a
UNC path: the user mapped it, and only the typed UNC form is refused. A value
already saved is not held to these rules (an archive in use must keep
working); :func:`lexical_problem` lets a reader log what looks wrong.
"""

from __future__ import annotations

import ntpath
import os
import tempfile
import threading
import time
from pathlib import Path, PureWindowsPath
from typing import Optional

from backend.services.platform import get_app_data_dir

MAX_OUTPUT_DIR_CHARS = 1024
MAX_GRANTS = 8
GRANT_LIFETIME_SECONDS = 600.0
"""How long a pick stays usable."""

_now = time.monotonic
"""The grant clock (tests replace it)."""
_SYSTEM_DIR_VARS = ("SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData")

# Folders the native picker returned in this process (comparison form), oldest first.
_grants: dict[str, tuple[str, float]] = {}
"""Comparison key -> (the picked string, when it was picked), oldest first."""
_grants_lock = threading.Lock()


class OutputDirRejected(ValueError):
    """A folder that may not become the archive root; ``reason`` is a code listed above."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _key(value: str) -> str:
    """The comparison form of a folder path: normalised, case-folded on Windows."""
    return os.path.normcase(os.path.normpath(value))


def same_dir(a: str, b: str) -> bool:
    """True when ``a`` and ``b`` name the same folder as text.

    ``.`` / ``..`` segments, separators and trailing separators, and on
    Windows letter case, are ignored. No filesystem call.
    """
    return _key(a) == _key(b)


def lexical_problem(raw: object) -> str | None:
    """The lexical reason ``raw`` may not be the archive root, or None. No filesystem call."""
    if not isinstance(raw, str) or not raw or len(raw) > MAX_OUTPUT_DIR_CHARS:
        return "invalid"
    if any(ord(c) < 0x20 or c == "\x7f" for c in raw):
        return "invalid"
    unified = raw.replace("/", "\\")
    if unified.startswith(("\\\\?\\", "\\\\.\\")):
        return "device"
    if unified.startswith("\\\\"):
        return "network"
    win = PureWindowsPath(raw)
    if (
        win.drive
        and win.root
        and PureWindowsPath(ntpath.normpath(raw)) == PureWindowsPath(win.anchor)
    ):
        return "root"
    if (win.drive and not win.root) or not Path(raw).is_absolute():
        return "relative"
    normal = Path(os.path.normpath(raw))
    if normal == Path(normal.anchor):
        return "root"
    return None


def _home() -> Path:
    """The user's home folder (a function so tests can point it elsewhere)."""
    return Path.home()


def _forms(path: Path) -> set[Path]:
    """``path`` normalised, and resolved when that works, both in comparison form."""
    forms = {Path(_key(str(path)))}
    try:
        forms.add(Path(_key(str(path.resolve()))))
    except (OSError, RuntimeError):
        pass
    return forms


def _app_owned_dirs() -> list[Path]:
    """The folders the app and its installer own, in comparison form.

    SakaDesk's data folder, the per-user install folder
    (``%LOCALAPPDATA%\\Programs\\SakaDesk``: ``setup.iss`` installs there with
    ``PrivilegesRequired=lowest``) and pysaka's sign-in folder
    (``%APPDATA%\\pysaka``, which pysaka derives from the home folder). The
    environment variables and the home-based forms are both listed.
    """
    app = get_app_data_dir()
    local = {app.parent}
    roaming = {_home() / "AppData" / "Roaming"}
    for name, bases in (("LOCALAPPDATA", local), ("APPDATA", roaming)):
        value = os.environ.get(name)
        if value:
            bases.add(Path(value))
    owned = [app]
    owned += [base / "Programs" / "SakaDesk" for base in local]
    owned += [base / "pysaka" for base in roaming]
    forms: list[Path] = []
    for folder in owned:
        forms.extend(_forms(folder))
    return forms


def _protected(candidates: set[Path]) -> str | None:
    """The reason the folder whose forms are ``candidates`` may not be the root, or None."""
    homes = _forms(_home())
    apps = _app_owned_dirs()
    systems: set[Path] = set()
    for name in _SYSTEM_DIR_VARS:
        value = os.environ.get(name)
        if value:
            systems |= _forms(Path(value))
    for c in candidates:
        if any(c == h or c in h.parents for h in homes):
            return "profile"
        if any(c == a or c in a.parents or a in c.parents for a in apps):
            return "app_data"
        if any(c == s or s in c.parents for s in systems):
            return "system"
    return None


def _writable(folder: Path) -> bool:
    """Create ``folder`` if missing and write and remove one probe file; False on any OSError."""
    try:
        folder.mkdir(parents=True, exist_ok=True)
        fd, probe = tempfile.mkstemp(
            dir=folder, prefix=".sakadesk-write-", suffix=".tmp"
        )
        os.close(fd)
        os.unlink(probe)
    except OSError:
        return False
    return True


def check_output_dir(raw: object) -> str:
    """The value to save for ``raw`` as the archive root, or raise :class:`OutputDirRejected`.

    The rules are in the module docstring. Returns the normalised path text
    (``os.path.normpath``: ``..`` folded, the platform's separators). Creates
    the folder if it is missing and writes and removes one probe file in it.
    Blocking: run it in a thread.
    """
    problem = lexical_problem(raw)
    if problem is not None:
        raise OutputDirRejected(problem)
    normal = Path(os.path.normpath(str(raw)))
    try:
        resolved = normal.resolve()
    except (OSError, RuntimeError):
        raise OutputDirRejected("invalid") from None
    if resolved == Path(resolved.anchor):
        raise OutputDirRejected("root")
    reason = _protected({Path(_key(str(normal))), Path(_key(str(resolved)))})
    if reason is not None:
        raise OutputDirRejected(reason)
    if not _writable(normal):
        raise OutputDirRejected("not_writable")
    return str(normal)


def _expire_locked(now: float) -> None:
    """Drop grants older than ``GRANT_LIFETIME_SECONDS``. ``_grants_lock`` must be held."""
    for key in [
        k for k, (_, at) in _grants.items() if now - at > GRANT_LIFETIME_SECONDS
    ]:
        del _grants[key]


def grant(value: str) -> None:
    """Remember a folder the native picker returned, exactly as ``value``.

    A pick lives ``GRANT_LIFETIME_SECONDS``; only the newest ``MAX_GRANTS``
    are kept.
    """
    key = _key(value)
    now = _now()
    with _grants_lock:
        _expire_locked(now)
        _grants.pop(key, None)
        _grants[key] = (value, now)
        while len(_grants) > MAX_GRANTS:
            del _grants[next(iter(_grants))]


def has_grant(value: str) -> bool:
    """True when the picker returned ``value`` (as :func:`same_dir` compares) and it is unused and fresh."""
    with _grants_lock:
        _expire_locked(_now())
        return _key(value) in _grants


def take_grant(value: str) -> Optional[str]:
    """Use up the pick of ``value`` atomically.

    Returns the exact string the picker returned (it may differ from
    ``value`` in case or slashes), or ``None`` when there was no fresh,
    unused pick: of any number of simultaneous callers, one gets it.
    """
    key = _key(value)
    with _grants_lock:
        _expire_locked(_now())
        entry = _grants.pop(key, None)
    return entry[0] if entry is not None else None


def clear_grants() -> None:
    """Forget every pick (a new archive folder was saved)."""
    with _grants_lock:
        _grants.clear()


def clear_grants_for_tests() -> None:
    """Test-only: forget every pick."""
    with _grants_lock:
        _grants.clear()
