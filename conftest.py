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


import keyring  # noqa: E402
import keyring.backend  # noqa: E402
import keyring.errors  # noqa: E402
import pytest  # noqa: E402


class _InMemoryKeyring(keyring.backend.KeyringBackend):
    """Dict-backed keyring so the suite NEVER touches the OS credential store.

    The suite once ran against the real Windows Credential Manager: two
    unmocked /api/translation/configure tests overwrote and then deleted the
    developer's real ``pysaka:llm_provider_api_key`` entry on every run. Only
    the storage is fake; pysaka's real KeyringStore/TokenManager code stays in
    play on top of it.
    """

    priority = 1  # type: ignore[assignment]

    def __init__(self) -> None:
        super().__init__()
        self._store: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self._store.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self._store[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        try:
            del self._store[(service, username)]
        except KeyError:
            raise keyring.errors.PasswordDeleteError(
                f"no credential for {service}/{username}"
            ) from None


@pytest.fixture(autouse=True)
def _isolate_keyring(monkeypatch, tmp_path_factory):
    """A fresh in-memory keyring per test; nothing can reach the real one.

    Three layers keep the developer's credentials out of reach:

    1. ``keyring.set_keyring`` installs an in-memory backend, so ordinary
       ``keyring.get_password`` / ``set_password`` calls never leave the process.
    2. pysaka's ``KeyringStore.delete`` also builds
       ``keyrings.alt.file.PlaintextKeyring()`` itself and deletes from it,
       bypassing the backend above. ``PlaintextKeyring`` and
       ``EncryptedKeyring`` in ``keyrings.alt.file`` are therefore replaced by
       factories that return this test's in-memory store.
    3. ``XDG_DATA_HOME``, ``XDG_CONFIG_HOME``, ``LOCALAPPDATA`` and
       ``APPDATA`` point into a per-test temp folder, so even a file keyring
       constructed some other way could only write there.

    The previous backend is restored afterwards. Also drops the AI key-status
    cache (a module-level read-through cache over the keyring) so no test sees
    another test's key. Imported lazily (see below).
    """
    import keyrings.alt.file

    fake_home = tmp_path_factory.mktemp("keyring_home")
    for var in ("XDG_DATA_HOME", "XDG_CONFIG_HOME", "LOCALAPPDATA", "APPDATA"):
        monkeypatch.setenv(var, str(fake_home))

    original = keyring.get_keyring()
    store = _InMemoryKeyring()
    keyring.set_keyring(store)
    monkeypatch.setattr(keyrings.alt.file, "PlaintextKeyring", lambda: store)
    monkeypatch.setattr(keyrings.alt.file, "EncryptedKeyring", lambda: store)
    try:
        from backend.api import translation

        translation._invalidate_key_status_cache()
        yield
        translation._invalidate_key_status_cache()
    finally:
        keyring.set_keyring(original)


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


@pytest.fixture(autouse=True)
def _reset_reject_log_throttle():
    """A fresh reject-log budget per test (security audit 2026-11-13).

    The API guard's reject logs are rate limited per minute across the whole
    process; without a reset, earlier tests' 401s would use up the budget and
    hide the breadcrumbs later tests assert on. Imported lazily (see above).
    """
    from backend.services import log_throttle

    log_throttle.reject_logs.reset()
    yield
