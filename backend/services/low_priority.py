"""Background thread priority for the media pipeline's worker threads (Windows).

:func:`enter_background_mode` puts the **calling** thread into Windows'
background processing mode (``SetThreadPriority(GetCurrentThread(),
THREAD_MODE_BACKGROUND_BEGIN)``), which lowers its CPU, IO and memory
priority, so thumbnail and poster generation never slow a sync or the UI.
Off Windows it does nothing and returns ``False`` (the thread keeps its
normal priority). ``kernel32`` is a test seam; the real binding is only
loaded inside the call, never at import time.

Logs carry codes only: ``low_priority_failed`` (debug, ``error_type``).
"""

from __future__ import annotations

import ctypes
import sys
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

THREAD_MODE_BACKGROUND_BEGIN = 0x00010000
"""``winbase.h``: begin background processing mode (only valid for the current thread)."""


def _on_windows() -> bool:
    # A call, not an inline ``sys.platform`` test, so mypy checks the Windows path too.
    return sys.platform == "win32"


def _load_kernel32():  # pragma: no cover - Windows binding, exercised on Windows (M9)
    """kernel32 with typed thread-priority functions. Windows only."""
    kernel32 = ctypes.WinDLL("kernel32")  # type: ignore[attr-defined,unused-ignore]
    kernel32.GetCurrentThread.restype = ctypes.c_void_p
    kernel32.GetCurrentThread.argtypes = []
    kernel32.SetThreadPriority.restype = ctypes.c_int
    kernel32.SetThreadPriority.argtypes = [ctypes.c_void_p, ctypes.c_int]
    return kernel32


def enter_background_mode(kernel32: Any = None) -> bool:
    """Lower the calling thread to background mode; ``True`` when Windows accepted it.

    Never raises: a failure (or any non-Windows platform) leaves the priority
    unchanged and returns ``False``.
    """
    if not _on_windows():
        return False
    try:
        if kernel32 is None:
            kernel32 = _load_kernel32()
        ok = bool(
            kernel32.SetThreadPriority(
                kernel32.GetCurrentThread(), THREAD_MODE_BACKGROUND_BEGIN
            )
        )
    except Exception as e:  # noqa: BLE001 - a priority hint must never fail the worker
        logger.debug("low_priority_failed", error_type=type(e).__name__)
        return False
    if not ok:
        logger.debug("low_priority_failed", error_type="set_thread_priority")
    return ok
