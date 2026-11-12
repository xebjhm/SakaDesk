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

# The app lifespan starts a background auto-sync scheduler; tests that create
# TestClient(app) must never spawn real syncs. Set here so both tests/ and
# backend/tests/ runs are covered. A test that wants the scheduler removes this
# variable with monkeypatch.delenv (see tests/test_auto_sync_scheduler.py).
os.environ.setdefault("SAKADESK_DISABLE_AUTO_SYNC", "1")

# TestClient always sends Host: testserver and no launch token. This flag (and
# only this flag) makes the API guard accept that host without a token; the
# packaged app never sets it (backend/services/api_auth.py, audit 2026-11-13).
os.environ.setdefault("SAKADESK_TEST_CLIENT", "1")


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _isolate_diagnostics_disk_usage(monkeypatch):
    """A fresh disk-usage tracker per test, and a walk that touches nothing.

    ``GET /api/diagnostics`` (and ``/disk-usage``) start a background walk of
    the configured output folder. Any test that hits them must never walk a
    real archive nor leave that thread running into the next test, so every
    test gets its own tracker and a no-op walk; teardown waits for the thread.
    ``backend/tests/test_diagnostics_disk_usage.py`` overrides this fixture to
    keep the real walk on its temp folders. Imported lazily so the
    ``tests/conftest.py`` module mocks are in place before ``backend`` loads.
    """
    from backend.api import diagnostics

    tracker = diagnostics._DiskUsageTracker()
    monkeypatch.setattr(diagnostics, "_disk_usage_tracker", tracker)
    monkeypatch.setattr(
        diagnostics, "_walk_disk_usage", lambda _path: diagnostics.DiskWalkResult()
    )
    yield tracker
    tracker.wait_idle(5)


@pytest.fixture(autouse=True)
def _isolate_sync_coordinator():
    """A fresh app-wide sync coordinator per test (spec 2026-11-10 S1).

    Its queue and running slot are process state: a test that patches the job
    runner away would otherwise leave a reserved slot that makes every later
    launch answer ``already_running``. Imported lazily (see above).
    """
    from backend.services import sync_coordinator

    sync_coordinator._coordinator = None
    yield
    sync_coordinator._coordinator = None
