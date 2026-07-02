"""Project-root pytest bootstrap — imported before any test module.

Isolate the whole test run from the real user data dir. Without this,
tests that exercise the settings store write the developer's real
``~/.SakaDesk`` (it has written ``auth_mode=mobile`` before and could wipe the
saved window geometry). Setting the env var here — at conftest import, before
any ``backend`` module resolves ``get_app_data_dir()`` / caches
``get_settings_path()`` — guarantees everything resolves to a throwaway temp dir.
"""

import os
import tempfile

os.environ.setdefault("SAKADESK_DATA_DIR", tempfile.mkdtemp(prefix="sakadesk-tests-"))
