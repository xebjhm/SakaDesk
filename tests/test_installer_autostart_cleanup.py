"""Guard: uninstalling must remove the autostart Run value the app writes.

``backend/services/autostart.py`` writes ``HKCU\\...\\Run\\SakaDesk``; the
installer's ``CurUninstallStepChanged(usUninstall)`` has to delete the same value
or an orphan startup entry keeps pointing at the removed exe.
"""

from __future__ import annotations

import re
from pathlib import Path

from backend.services import autostart

_ISS = Path(__file__).resolve().parents[1] / "tooling" / "windows" / "setup.iss"


def _uninstall_step_body() -> str:
    source = _ISS.read_text(encoding="utf-8")
    start = source.index("procedure CurUninstallStepChanged")
    return source[start:]


def test_uninstall_deletes_the_autostart_run_value() -> None:
    body = _uninstall_step_body()
    match = re.search(
        r"RegDeleteValue\(\s*HKCU\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)", body
    )
    assert match, "setup.iss must call RegDeleteValue(HKCU, <Run key>, <value>)"
    assert match.group(1) == autostart.RUN_KEY
    assert match.group(2) == autostart.VALUE_NAME


def test_autostart_cleanup_runs_in_the_usuninstall_step_not_behind_the_prompt() -> None:
    body = _uninstall_step_body()
    first_step = body.index("CurUninstallStep = usUninstall")
    second_step = body.index("CurUninstallStep = usPostUninstall")
    assert first_step < body.index("RegDeleteValue") < second_step
