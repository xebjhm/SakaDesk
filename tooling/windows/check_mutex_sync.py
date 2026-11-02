"""Build-time guard: keep the instance-mutex name in sync across app + installer.

The Windows in-place upgrade relies on a single shared mutex name:

  * ``INSTANCE_MUTEX_NAME`` in ``desktop.py`` — the running app creates it.
  * ``#define MyAppMutex`` in ``tooling/windows/setup.iss`` — the installer's
    ``[Code]`` waits on it for the app to fully exit before replacing locked
    files (and the uninstaller prompts while it is held).

If those drift, the installer silently falls back to the Restart-Manager-only
path, which can roll back an upgrade mid-install (headless index-build workers
keep ``_internal`` DLLs locked).

It also rejects an ``AppMutex=`` directive in ``setup.iss``: Inno checks it at
startup and, under the ``/SILENT /SUPPRESSMSGBOXES`` flags the in-app upgrade
uses, aborts at once while the app is still exiting, so the upgrade closes the
app and installs nothing.

``build.ps1`` runs this as a preflight so a bad installer can never be produced;
``tests/test_mutex_sync_guard.py`` covers the same logic on every pytest run.

Run standalone::

    python tooling/windows/check_mutex_sync.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

_PYTHON_RE = re.compile(r"""INSTANCE_MUTEX_NAME\s*=\s*["']([^"']+)["']""")
_ISS_RE = re.compile(r'^[ \t]*#define[ \t]+MyAppMutex[ \t]+"([^"]+)"', re.MULTILINE)
# Anchored at line start (after optional indent) so ';'-prefixed comment lines
# that merely mention AppMutex are not matched.
_ISS_APPMUTEX_RE = re.compile(r"^[ \t]*AppMutex\s*=", re.MULTILINE)


class MutexNameMismatch(Exception):
    """Raised when the app and installer mutex names do not agree."""


def find_python_mutex_name(source: str) -> str | None:
    match = _PYTHON_RE.search(source)
    return match.group(1) if match else None


def find_iss_mutex_name(source: str) -> str | None:
    match = _ISS_RE.search(source)
    return match.group(1) if match else None


def has_appmutex_directive(source: str) -> bool:
    return _ISS_APPMUTEX_RE.search(source) is not None


def verify_sync(python_source: str, iss_source: str) -> str:
    """Return the shared mutex name, or raise ``MutexNameMismatch``."""
    if has_appmutex_directive(iss_source):
        raise MutexNameMismatch(
            "setup.iss must not set AppMutex= - under /SILENT /SUPPRESSMSGBOXES "
            "Setup aborts at startup while the app is still exiting, so the "
            "in-app upgrade installs nothing. Wait on {#MyAppMutex} in [Code]."
        )
    py_name = find_python_mutex_name(python_source)
    iss_name = find_iss_mutex_name(iss_source)

    if py_name is None:
        raise MutexNameMismatch("Could not find INSTANCE_MUTEX_NAME in desktop.py")
    if iss_name is None:
        raise MutexNameMismatch("Could not find #define MyAppMutex in setup.iss")
    if py_name != iss_name:
        raise MutexNameMismatch(
            "Instance-mutex name mismatch - the Windows upgrade will regress:\n"
            f"  desktop.py INSTANCE_MUTEX_NAME = {py_name!r}\n"
            f"  setup.iss  #define MyAppMutex   = {iss_name!r}\n"
            "Both must be identical."
        )
    return py_name


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    py_source = (repo_root / "desktop.py").read_text(encoding="utf-8")
    iss_source = (repo_root / "tooling" / "windows" / "setup.iss").read_text(
        encoding="utf-8"
    )
    try:
        name = verify_sync(py_source, iss_source)
    except MutexNameMismatch as exc:
        print(f"[mutex-sync] FAIL: {exc}", file=sys.stderr)
        return 1
    print(f"[mutex-sync] OK: app and installer both use {name!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
