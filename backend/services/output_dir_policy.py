"""Which folders may become the archive root, ``output_dir`` (security audit 2026-11-13,
backend/api/settings.py:output-dir-unvalidated-archive-trust-root).

Every archive containment check trusts ``output_dir`` as its base, so whoever
sets it decides which files the archive routes may read. A new value must pass
:func:`check_output_dir`. Reasons (log, API and UI codes):

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
- ``app_data``: SakaDesk's own data folder, a folder inside it, or a folder
  above it;
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
from pathlib import Path, PureWindowsPath

from backend.services.platform import get_app_data_dir

MAX_OUTPUT_DIR_CHARS = 1024
_SYSTEM_DIR_VARS = ("SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData")


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


def _protected(candidates: set[Path]) -> str | None:
    """The reason the folder whose forms are ``candidates`` may not be the root, or None."""
    homes = _forms(_home())
    apps = _forms(get_app_data_dir())
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
