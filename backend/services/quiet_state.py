"""Is Windows in a state where a popup would intrude? (spec §4.3)

Step 1 asks ``shell32.SHQueryUserNotificationState`` (fullscreen app,
presentation mode, quiet time, ...). When it reports "accepts notifications" (or
any other value, or fails) step 2 reads Focus Assist from the shell's
quiet-hours WNF profile with ``ntdll.NtQueryWnfStateData`` (undocumented; a
failure reads as "unknown", which is not quiet, so the popup shows). Windows
only: off Windows it returns :data:`UNKNOWN`. Never raises. Logs codes only.
"""

from __future__ import annotations

import ctypes
import sys
from dataclasses import dataclass
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED = 0x0D83063EA3BF1C75
_QUNS_QUIET = {
    1: "not_present",
    2: "fullscreen",
    3: "d3d_fullscreen",
    4: "presentation",
    6: "quiet_time",
    7: "app_fullscreen",
}
_FOCUS_QUIET = {1: "focus_assist_priority", 2: "focus_assist_alarms"}


@dataclass(frozen=True)
class QuietState:
    """``code`` is the logged result; ``quns``/``focus_assist`` are raw (-1 = unread)."""

    code: str
    quiet: bool
    quns: int
    focus_assist: int


UNKNOWN = QuietState("unknown", False, -1, -1)


def _read_quns(shell32: Any) -> int:
    try:
        value = ctypes.c_int(0)
        hr = shell32.SHQueryUserNotificationState(ctypes.byref(value))
        if hr != 0:
            logger.warning("quiet_state_failed", api="quns", error_type="hresult")
            return -1
        return int(value.value)
    except Exception as e:
        logger.warning("quiet_state_failed", api="quns", error_type=type(e).__name__)
        return -1


def _read_focus_assist(ntdll: Any) -> int:
    try:
        name = ctypes.c_uint64(WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED)
        stamp = ctypes.c_ulong(0)
        buf = ctypes.c_uint32(0)
        size = ctypes.c_ulong(ctypes.sizeof(buf))
        status = ntdll.NtQueryWnfStateData(
            ctypes.byref(name),
            None,
            None,
            ctypes.byref(stamp),
            ctypes.byref(buf),
            ctypes.byref(size),
        )
        if status != 0:
            logger.warning("quiet_state_failed", api="wnf", error_type="ntstatus")
            return -1
        profile = int(buf.value)
        if profile not in (0, 1, 2):
            logger.warning(
                "quiet_state_failed", api="wnf", error_type="unexpected_profile"
            )
            return -1
        return profile
    except Exception as e:
        logger.warning("quiet_state_failed", api="wnf", error_type=type(e).__name__)
        return -1


def query_quiet_state(
    *, shell32: Any = None, ntdll: Any = None, platform: str | None = None
) -> QuietState:
    """The current quiet state. ``shell32``/``ntdll``/``platform`` are test seams."""
    plat = sys.platform if platform is None else platform
    if plat != "win32":
        logger.debug("quiet_state", quns=-1, focus_assist=-1, result=UNKNOWN.code)
        return UNKNOWN
    try:
        if shell32 is None:
            shell32 = ctypes.WinDLL("shell32")  # type: ignore[attr-defined,unused-ignore]
        if ntdll is None:
            ntdll = ctypes.WinDLL("ntdll")  # type: ignore[attr-defined,unused-ignore]
    except Exception as e:
        logger.warning("quiet_state_failed", api="quns", error_type=type(e).__name__)
        return UNKNOWN
    quns = _read_quns(shell32)
    code = _QUNS_QUIET.get(quns)
    if code is not None:
        state = QuietState(code, True, quns, -1)
    else:
        profile = _read_focus_assist(ntdll)
        if profile in _FOCUS_QUIET:
            state = QuietState(_FOCUS_QUIET[profile], True, quns, profile)
        elif profile == 0:
            state = QuietState("accepts", False, quns, 0)
        else:
            state = QuietState("unknown", False, quns, -1)
    logger.debug(
        "quiet_state",
        quns=state.quns,
        focus_assist=state.focus_assist,
        result=state.code,
    )
    return state
