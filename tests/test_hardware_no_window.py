"""Regression test: GPU probing must not flash a console window on Windows.

`detect_hardware()` is polled by the frontend, so `_detect_nvidia_gpu()` runs
`nvidia-smi` many times per minute. On the windowed GUI build (no console),
each `subprocess.run` without CREATE_NO_WINDOW spawns a visible console window
that flashes -- so the flag MUST be passed on Windows.
"""

import os
import subprocess
from unittest.mock import MagicMock, patch

from backend.services import hardware


def test_detect_nvidia_gpu_suppresses_console_window():
    fake = MagicMock(returncode=1, stdout="")
    with patch.object(hardware.subprocess, "run", return_value=fake) as mock_run:
        hardware._detect_nvidia_gpu()

    assert mock_run.called
    creationflags = mock_run.call_args.kwargs.get("creationflags", 0)
    if os.name == "nt":
        assert creationflags & subprocess.CREATE_NO_WINDOW, (
            "nvidia-smi must run with CREATE_NO_WINDOW on Windows to avoid a "
            "flashing console window"
        )


def test_detect_hardware_caches_and_does_not_respawn_nvidia_smi():
    """detect_hardware() is called by frequently-polled endpoints (readiness
    every few seconds, hardware-suggestion), so it must CACHE its probe --
    otherwise nvidia-smi is re-spawned on every poll (the root cause of the
    repeated console-window flashes, not just the missing CREATE_NO_WINDOW)."""
    hardware._hw_cache = None  # reset the process cache for a clean measurement
    fake = MagicMock(returncode=1, stdout="")
    with patch.object(hardware.subprocess, "run", return_value=fake) as mock_run:
        r1 = hardware.detect_hardware()
        r2 = hardware.detect_hardware()

    assert r1 == r2
    assert mock_run.call_count == 1, (
        f"nvidia-smi must run once and be cached; ran {mock_run.call_count}x"
    )


def test_detect_hardware_force_rebuilds_cache():
    """force=True must re-probe (e.g. after a GPU runtime install)."""
    hardware._hw_cache = None
    fake = MagicMock(returncode=1, stdout="")
    with patch.object(hardware.subprocess, "run", return_value=fake) as mock_run:
        hardware.detect_hardware()
        hardware.detect_hardware(force=True)

    assert mock_run.call_count == 2
