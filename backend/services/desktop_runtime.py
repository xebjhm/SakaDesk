"""Windows GUI hardening for the packaged (frozen) desktop app.

Two papercuts that exist only in the shipped, windowed (``console=False``) build:

1. A GUI process with no console makes Windows allocate a brand-new console
   window for any console child started without an explicit no-window flag. The
   bundled Playwright Node driver is such a child, so its subprocess pops a black
   terminal. ``suppress_child_console_windows`` defaults every subprocess to
   ``CREATE_NO_WINDOW`` unless the caller already chose a console disposition
   (e.g. the upgrade helper's ``DETACHED_PROCESS``), which must be preserved.

2. pysaka's silent token refresh would otherwise launch a bundled Chromium that
   the installer does not ship, triggering a runtime download — which is what
   spawned the console window in (1) several times over. Pinning
   ``PYSAKA_BROWSER_CHANNEL`` makes the refresh reuse the user's installed
   Chrome/Edge (the same browser interactive login already requires), so nothing
   is ever downloaded. See ``pysaka.auth.BrowserAuth.refresh_token_headless``.

Everything here is a no-op unless running as the frozen Windows exe, so dev runs
and tests are unaffected.
"""

from __future__ import annotations

import os
import sys

# Windows process-creation flags (winbase.h).
_CREATE_NO_WINDOW = 0x08000000
# Flags that already fix a child's console disposition — never override these
# (CREATE_NO_WINDOW is contradictory with DETACHED_PROCESS/CREATE_NEW_CONSOLE and
# would fail CreateProcess).
_CONSOLE_DISPOSITION_FLAGS = (
    0x00000008  # DETACHED_PROCESS
    | 0x00000010  # CREATE_NEW_CONSOLE
    | 0x08000000  # CREATE_NO_WINDOW
)

# System browser the packaged app pins its silent token-refresh to. Matches the
# channel interactive login already requires (see auth_service.login_with_browser),
# so a user who can log in can always refresh — with zero download.
_REFRESH_BROWSER_CHANNEL = "chrome"


def is_frozen_windows() -> bool:
    """True only when running as the packaged Windows exe.

    PyInstaller sets ``sys.frozen`` on the built exe; dev runs and tests do not,
    so all hardening below no-ops there.
    """
    return os.name == "nt" and bool(getattr(sys, "frozen", False))


def no_window_creationflags(creationflags: int) -> int:
    """Return ``creationflags`` with ``CREATE_NO_WINDOW`` added, unless the caller
    already chose a console disposition (which must be preserved)."""
    if creationflags & _CONSOLE_DISPOSITION_FLAGS:
        return creationflags
    return creationflags | _CREATE_NO_WINDOW


def pin_refresh_browser_channel() -> None:
    """Point pysaka's headless token refresh at the user's installed browser so
    it never downloads Chromium at runtime. Respects an existing override."""
    os.environ.setdefault("PYSAKA_BROWSER_CHANNEL", _REFRESH_BROWSER_CHANNEL)


def suppress_child_console_windows() -> None:
    """Default every child process to ``CREATE_NO_WINDOW`` so none flashes a
    console in the windowed app. Idempotent and preserves callers' explicit
    console flags.

    Playwright spawns its Node driver via ``asyncio`` subprocess, which on
    Windows goes through ``subprocess.Popen`` — so patching ``Popen.__init__``
    covers it. ``multiprocessing`` workers use a different path and already
    inherit the windowed exe's no-console state, so they are unaffected.
    """
    import subprocess

    if getattr(subprocess.Popen.__init__, "_saka_no_window", False):
        return  # already patched (idempotent)

    original_init = subprocess.Popen.__init__

    def _init(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        kwargs["creationflags"] = no_window_creationflags(
            kwargs.get("creationflags", 0)
        )
        original_init(self, *args, **kwargs)

    _init._saka_no_window = True  # type: ignore[attr-defined]
    subprocess.Popen.__init__ = _init  # type: ignore[method-assign]


def harden_frozen_windows() -> None:
    """Apply all GUI hardening. No-op unless running as the frozen Windows exe."""
    if not is_frozen_windows():
        return
    pin_refresh_browser_channel()
    suppress_child_console_windows()
