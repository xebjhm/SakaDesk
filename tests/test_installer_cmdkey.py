"""Hardening #63: the uninstaller runs System32's cmdkey, never one found by name."""

from __future__ import annotations

import re
from pathlib import Path

_ISS = Path(__file__).resolve().parents[1] / "tooling" / "windows" / "setup.iss"


def test_the_uninstaller_runs_cmdkey_from_the_system_folder() -> None:
    source = _ISS.read_text(encoding="utf-8")
    assert "Exec(ExpandConstant('{sys}\\cmdkey.exe')" in source
    assert re.search(r"Exec\(\s*'cmdkey", source) is None
