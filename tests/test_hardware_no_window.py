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
