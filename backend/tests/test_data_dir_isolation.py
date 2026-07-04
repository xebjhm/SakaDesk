"""Guard: the test run must never resolve to the real user data dir.

If this fails, tests can read/write the developer's real ~/.SakaDesk — which has
polluted it before (auth_mode=mobile) and can wipe saved window geometry. The
project-root conftest.py sets SAKADESK_DATA_DIR to a temp dir to prevent this.
"""

import os
import subprocess
import sys
from pathlib import Path

from backend.services.platform import get_app_data_dir, get_settings_path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def test_data_dir_is_isolated_from_real_home():
    app_dir = get_app_data_dir()
    real = Path.home() / ".SakaDesk"
    assert app_dir != real
    assert real not in app_dir.parents


def test_settings_path_not_under_real_home():
    real = Path.home() / ".SakaDesk"
    assert real not in get_settings_path().parents


def test_log_dir_respects_data_dir_override(tmp_path):
    """backend.main must write logs under SAKADESK_DATA_DIR, not the real data dir.

    main.py computes the log directory inline at import time (before the platform
    module is importable), so it needs its own copy of get_app_data_dir()'s
    precedence. A fresh interpreter -- with SAKADESK_DATA_DIR set and home /
    LOCALAPPDATA sandboxed to temp dirs so a fall-through can't touch real user
    data -- must land debug.log under the override, never under LOCALAPPDATA\\SakaDesk
    or ~/.SakaDesk. Regression guard: the inline block used to ignore
    SAKADESK_DATA_DIR entirely, mixing isolated/test logs into real user data.
    """
    data_dir = tmp_path / "data"
    localappdata = tmp_path / "localappdata"
    home = tmp_path / "home"
    for d in (data_dir, localappdata, home):
        d.mkdir()

    env = {
        **os.environ,
        "SAKADESK_DATA_DIR": str(data_dir),
        "LOCALAPPDATA": str(localappdata),
        "USERPROFILE": str(home),
        "HOME": str(home),
        "PYTHONPATH": str(PROJECT_ROOT),
    }

    result = subprocess.run(
        [sys.executable, "-c", "import backend.main"],
        env=env,
        capture_output=True,
        text=True,
        timeout=180,
    )

    assert result.returncode == 0, (
        f"importing backend.main failed (rc={result.returncode})\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
    # Logs land under the override...
    assert (data_dir / "logs" / "debug.log").exists(), (
        "debug.log was not written under the SAKADESK_DATA_DIR override; "
        "main.py's inline log-dir block ignored it.\n"
        f"stderr:\n{result.stderr}"
    )
    # ...and never under the LOCALAPPDATA or home fall-throughs.
    assert not (localappdata / "SakaDesk" / "logs").exists()
    assert not (home / ".SakaDesk" / "logs").exists()
