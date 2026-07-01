"""Guard: the test run must never resolve to the real user data dir.

If this fails, tests can read/write the developer's real ~/.SakaDesk — which has
polluted it before (auth_mode=mobile) and can wipe saved window geometry. The
project-root conftest.py sets SAKADESK_DATA_DIR to a temp dir to prevent this.
"""

from pathlib import Path

from backend.services.platform import get_app_data_dir, get_settings_path


def test_data_dir_is_isolated_from_real_home():
    app_dir = get_app_data_dir()
    real = Path.home() / ".SakaDesk"
    assert app_dir != real
    assert real not in app_dir.parents


def test_settings_path_not_under_real_home():
    real = Path.home() / ".SakaDesk"
    assert real not in get_settings_path().parents
