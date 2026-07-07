"""Tests for version API endpoints (GET /api/version, upgrade lifecycle)."""

from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def _reset_version_cache():
    """Reset the module-level cache and upgrade state between tests."""
    import backend.api.version as v

    v._cache = {
        "last_check": None,
        "latest_version": None,
        "release_url": None,
        "release_notes": None,
        "error": None,
    }
    v._upgrade_state = {
        "state": "idle",
        "progress": 0.0,
        "error": None,
        "version": None,
        "installer_path": None,
    }


class TestGetCurrentVersion:
    """Tests for GET /api/version/current."""

    def test_get_current_version(self):
        """Returns the current app version."""
        response = client.get("/api/version/current")
        assert response.status_code == 200
        data = response.json()
        assert "version" in data
        assert isinstance(data["version"], str)


class TestCheckVersion:
    """Tests for GET /api/version."""

    def setup_method(self):
        _reset_version_cache()

    @patch("backend.api.version._fetch_latest_release")
    def test_check_version_no_update(self, mock_fetch):
        """Returns no update when latest == current."""
        from backend.version import APP_VERSION

        mock_fetch.return_value = {
            "last_check": datetime.now(timezone.utc),
            "latest_version": APP_VERSION.lstrip("v"),
            "release_url": "https://github.com/test",
            "release_notes": "notes",
            "error": None,
        }
        response = client.get("/api/version")
        assert response.status_code == 200
        data = response.json()
        assert data["current_version"] == APP_VERSION
        assert data["update_available"] is False

    @patch("backend.api.version._fetch_latest_release")
    def test_check_version_update_available(self, mock_fetch):
        """Returns update_available when a newer version exists."""
        mock_fetch.return_value = {
            "last_check": datetime.now(timezone.utc),
            "latest_version": "99.99.99",
            "release_url": "https://github.com/test",
            "release_notes": "big update",
            "error": None,
        }
        response = client.get("/api/version")
        assert response.status_code == 200
        data = response.json()
        assert data["update_available"] is True
        assert data["latest_version"] == "99.99.99"
        assert data["release_url"] == "https://github.com/test"

    @patch("backend.api.version._fetch_latest_release")
    def test_check_version_with_error(self, mock_fetch):
        """Returns error when fetch fails."""
        mock_fetch.return_value = {
            "last_check": datetime.now(timezone.utc),
            "latest_version": None,
            "release_url": None,
            "release_notes": None,
            "error": "Rate limited - try again later",
        }
        response = client.get("/api/version")
        assert response.status_code == 200
        data = response.json()
        assert data["update_available"] is False
        assert data["error"] == "Rate limited - try again later"


class TestErrorCacheTTL:
    """Tests for shorter error cache duration."""

    def setup_method(self):
        _reset_version_cache()

    def test_error_cache_expires_after_5_minutes(self):
        """Error responses use a shorter cache TTL than successes."""
        import backend.api.version as v

        # Simulate a cached error from 6 minutes ago
        v._cache["last_check"] = datetime.now(timezone.utc) - timedelta(minutes=6)
        v._cache["error"] = "Request timed out"
        v._cache["latest_version"] = None

        # Cache should be stale — _fetch_latest_release would re-fetch
        # We verify by checking the TTL logic directly
        from backend.api.version import ERROR_CACHE_DURATION

        cache_age = datetime.now(timezone.utc) - v._cache["last_check"]
        assert cache_age > ERROR_CACHE_DURATION

    def test_success_cache_survives_5_minutes(self):
        """Successful responses use the full 1-hour cache."""
        import backend.api.version as v

        v._cache["last_check"] = datetime.now(timezone.utc) - timedelta(minutes=6)
        v._cache["error"] = None
        v._cache["latest_version"] = "1.0.0"

        from backend.api.version import CACHE_DURATION

        cache_age = datetime.now(timezone.utc) - v._cache["last_check"]
        assert cache_age < CACHE_DURATION

    def test_force_bypasses_fresh_cache(self):
        """The manual 'Check for updates' (force=True) skips the cache and does a
        live fetch even when a fresh cached result exists; the automatic
        (force=False) path returns the cache without any network call. This is
        the fix for 'open app before a release -> manual check never detects it'."""
        import asyncio
        from unittest.mock import AsyncMock, MagicMock, patch

        import backend.api.version as v

        # Fresh cache (checked just now) holding an OLD latest version.
        v._cache["last_check"] = datetime.now(timezone.utc)
        v._cache["latest_version"] = "0.3.0"
        v._cache["error"] = None

        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "tag_name": "v0.3.1",
            "html_url": "u",
            "body": "notes",
        }
        session = AsyncMock()
        session.get = AsyncMock(return_value=resp)
        cm = MagicMock()
        cm.__aenter__ = AsyncMock(return_value=session)
        cm.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.api.version.httpx.AsyncClient", return_value=cm):
            # Automatic check: fresh cache returned, no network call.
            cached = asyncio.run(v._fetch_latest_release(force=False))
            assert cached["latest_version"] == "0.3.0"
            session.get.assert_not_called()

            # Manual check: bypasses the cache, hits GitHub, updates the version.
            fresh = asyncio.run(v._fetch_latest_release(force=True))
            assert fresh["latest_version"] == "0.3.1"
            session.get.assert_called_once()


class TestUpgradeStatus:
    """Tests for GET /api/version/upgrade/status."""

    def setup_method(self):
        _reset_version_cache()

    def test_upgrade_status_idle(self):
        """Returns idle state when no upgrade is in progress."""
        response = client.get("/api/version/upgrade/status")
        assert response.status_code == 200
        data = response.json()
        assert data["state"] == "idle"
        assert data["progress"] == 0.0

    def test_upgrade_status_reflects_state(self):
        """Returns current upgrade state."""
        import backend.api.version as v

        v._upgrade_state["state"] = "downloading"
        v._upgrade_state["progress"] = 50.0
        v._upgrade_state["version"] = "1.0.0"
        response = client.get("/api/version/upgrade/status")
        data = response.json()
        assert data["state"] == "downloading"
        assert data["progress"] == 50.0
        assert data["version"] == "1.0.0"


class TestStartUpgrade:
    """Tests for POST /api/version/upgrade/start."""

    def setup_method(self):
        _reset_version_cache()

    @patch("backend.api.version.is_upgrade_supported", return_value=False)
    def test_start_upgrade_not_supported(self, mock_supported):
        """Returns error when upgrade is not supported on the platform."""
        response = client.post("/api/version/upgrade/start")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert "not supported" in data["error"].lower()

    @patch("backend.api.version.is_upgrade_supported", return_value=True)
    @patch("backend.api.version._fetch_latest_release")
    def test_start_upgrade_no_version(self, mock_fetch, mock_supported):
        """Returns error when no version is available."""
        mock_fetch.return_value = {
            "last_check": datetime.now(timezone.utc),
            "latest_version": None,
            "release_url": None,
            "release_notes": None,
            "error": "No releases found",
        }
        response = client.post("/api/version/upgrade/start")
        data = response.json()
        assert data["success"] is False

    @patch("backend.api.version.is_upgrade_supported", return_value=True)
    def test_start_upgrade_already_downloading(self, mock_supported):
        """Returns error when upgrade is already in progress."""
        import backend.api.version as v

        v._upgrade_state["state"] = "downloading"
        response = client.post("/api/version/upgrade/start")
        data = response.json()
        assert data["success"] is False
        assert "already in progress" in data["error"].lower()

    @patch("backend.api.version.is_upgrade_supported", return_value=True)
    @patch("backend.api.version._fetch_latest_release")
    def test_start_upgrade_already_up_to_date(self, mock_fetch, mock_supported):
        """Returns error when already on the latest version."""
        from backend.version import APP_VERSION

        mock_fetch.return_value = {
            "last_check": datetime.now(timezone.utc),
            "latest_version": APP_VERSION.lstrip("v"),
            "release_url": "https://github.com/test",
            "release_notes": "same version",
            "error": None,
        }
        response = client.post("/api/version/upgrade/start")
        data = response.json()
        assert data["success"] is False
        assert "up to date" in data["error"].lower()

    @patch("backend.api.version.is_upgrade_supported", return_value=True)
    @patch("backend.api.version._fetch_latest_release")
    def test_start_upgrade_success(self, mock_fetch, mock_supported):
        """Successfully starts an upgrade."""
        mock_fetch.return_value = {
            "last_check": datetime.now(timezone.utc),
            "latest_version": "2.0.0",
            "release_url": "https://github.com/test",
            "release_notes": "new version",
            "error": None,
        }
        response = client.post("/api/version/upgrade/start")
        data = response.json()
        assert data["success"] is True
        assert data["version"] == "2.0.0"

    @patch("backend.api.version.is_upgrade_supported", return_value=True)
    @patch("backend.api.version._fetch_latest_release")
    def test_start_upgrade_rolls_back_state_on_no_version(
        self, mock_fetch, mock_supported
    ):
        """SD-BE-API-06: on an early-return error the state must roll back to
        idle, not stay stuck at 'downloading' (which would wedge every later
        start with 'Upgrade already in progress')."""
        import backend.api.version as v

        mock_fetch.return_value = {
            "last_check": datetime.now(timezone.utc),
            "latest_version": None,
            "release_url": None,
            "release_notes": None,
            "error": "No releases found",
        }
        response = client.post("/api/version/upgrade/start")
        assert response.json()["success"] is False
        # The claimed "downloading" state was rolled back.
        assert v._upgrade_state["state"] == "idle"

    @patch("backend.api.version.is_upgrade_supported", return_value=True)
    @patch("backend.api.version._fetch_latest_release")
    def test_start_upgrade_rolls_back_state_when_up_to_date(
        self, mock_fetch, mock_supported
    ):
        """SD-BE-API-06: the 'already up to date' early return also rolls back."""
        from backend.version import APP_VERSION
        import backend.api.version as v

        mock_fetch.return_value = {
            "last_check": datetime.now(timezone.utc),
            "latest_version": APP_VERSION.lstrip("v"),
            "release_url": "https://github.com/test",
            "release_notes": "same",
            "error": None,
        }
        response = client.post("/api/version/upgrade/start")
        assert response.json()["success"] is False
        assert v._upgrade_state["state"] == "idle"

    @patch("backend.api.version.is_upgrade_supported", return_value=True)
    def test_start_upgrade_second_concurrent_start_is_rejected(self, mock_supported):
        """SD-BE-API-06: the guard and the state write must not be separated by
        an await. We simulate the race by making the version fetch check the
        state DURING its await -- the state must already read 'downloading' by
        then, so a concurrent request observes the claim and is rejected before
        a second download is scheduled."""
        import asyncio

        import backend.api.version as v

        observed = {}

        async def fake_fetch(force: bool = False):
            # This runs at the first await inside start_upgrade. By this point
            # the state must already be claimed (SD-BE-API-06 fix); a racing
            # request arriving now would see "downloading" and bail.
            observed["state_during_fetch"] = v._upgrade_state["state"]
            second = client.post("/api/version/upgrade/start")
            observed["second_response"] = second.json()
            await asyncio.sleep(0)
            return {
                "last_check": datetime.now(timezone.utc),
                "latest_version": "2.0.0",
                "release_url": "https://github.com/test",
                "release_notes": "new",
                "error": None,
            }

        with patch("backend.api.version._fetch_latest_release", side_effect=fake_fetch):
            with patch("backend.api.version._download_and_prepare_upgrade"):
                response = client.post("/api/version/upgrade/start")

        assert response.json()["success"] is True
        # The state was already claimed before the first await.
        assert observed["state_during_fetch"] == "downloading"
        # The concurrent second start observed the claim and was rejected.
        assert observed["second_response"]["success"] is False
        assert "already in progress" in observed["second_response"]["error"].lower()

    def test_start_upgrade_rejects_during_shutdown(self):
        """C1c: refuse to spawn the upgrade-download writer once shutdown has
        begun -- otherwise it would still be running (and writing the
        installer into the data dir) after data_lock.release()."""
        from backend.services import shutdown_state

        shutdown_state.begin_shutdown()
        try:
            with patch(
                "backend.api.version._download_and_prepare_upgrade"
            ) as mock_download:
                response = client.post("/api/version/upgrade/start")

            data = response.json()
            assert data["success"] is False
            assert "shutting down" in data["error"].lower()
            mock_download.assert_not_called()
        finally:
            shutdown_state.reset_for_tests()

    @patch("backend.api.version.is_upgrade_supported", return_value=True)
    @patch("backend.api.version._fetch_latest_release")
    def test_start_upgrade_schedules_download_when_not_shutting_down(
        self, mock_fetch, mock_supported
    ):
        """Control for test_start_upgrade_rejects_during_shutdown: outside of
        shutdown, the endpoint still schedules the download background task
        as before."""
        from backend.services import shutdown_state

        assert shutdown_state.is_shutting_down() is False

        mock_fetch.return_value = {
            "last_check": datetime.now(timezone.utc),
            "latest_version": "2.0.0",
            "release_url": "https://github.com/test",
            "release_notes": "new version",
            "error": None,
        }
        with patch(
            "backend.api.version._download_and_prepare_upgrade"
        ) as mock_download:
            response = client.post("/api/version/upgrade/start")

        data = response.json()
        assert data["success"] is True
        assert data["version"] == "2.0.0"
        mock_download.assert_called_once()


class TestInstallUpgrade:
    """Tests for POST /api/version/upgrade/install."""

    def setup_method(self):
        _reset_version_cache()

    def test_install_upgrade_wrong_state(self):
        """Returns error when not in 'ready' state."""
        response = client.post("/api/version/upgrade/install")
        data = response.json()
        assert data["success"] is False
        assert "idle" in data["error"]

    def test_install_upgrade_no_installer(self):
        """Returns error when installer path is missing."""
        import backend.api.version as v

        v._upgrade_state["state"] = "ready"
        v._upgrade_state["installer_path"] = None
        response = client.post("/api/version/upgrade/install")
        data = response.json()
        assert data["success"] is False
        assert "not found" in data["error"].lower()

    @patch("backend.api.version.launch_installer", return_value=True)
    def test_install_upgrade_success(self, mock_launch, tmp_path):
        """Successfully launches installer when ready."""
        import backend.api.version as v

        # Capture the scheduled exit coroutine and close it (never run it) so we
        # don't os._exit the test process and don't leak an un-awaited coroutine.
        scheduled = []

        def capture(coro):
            scheduled.append(coro)
            coro.close()
            return MagicMock()

        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        v._upgrade_state["state"] = "ready"
        v._upgrade_state["installer_path"] = installer
        with patch("backend.api.version.asyncio.create_task", side_effect=capture):
            response = client.post("/api/version/upgrade/install")
        data = response.json()
        assert data["success"] is True
        assert len(scheduled) == 1

    @patch("backend.api.version.launch_installer", return_value=False)
    def test_install_upgrade_failure(self, mock_launch, tmp_path):
        """Returns error when installer launch fails."""
        import backend.api.version as v

        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        v._upgrade_state["state"] = "ready"
        v._upgrade_state["installer_path"] = installer
        response = client.post("/api/version/upgrade/install")
        data = response.json()
        assert data["success"] is False


class TestQuiesceWorkersBeforeExit:
    """SD-BE-SVC-01: the write barrier + index-worker kill must run BEFORE
    ``os._exit(0)`` on the upgrade path, so the installer never races an
    orphaned worker holding _internal DLLs (which rolls back the upgrade)."""

    def setup_method(self):
        from backend.services import shutdown_state

        shutdown_state.reset_for_tests()

    def teardown_method(self):
        from backend.services import shutdown_state

        shutdown_state.reset_for_tests()

    def test_quiesce_runs_barrier_and_kills_children(self):
        """The helper flags shutdown, drains writers, terminates every
        multiprocessing child, and releases the data lock."""
        import asyncio
        from unittest.mock import AsyncMock, MagicMock

        import backend.api.version as v
        from backend.services import shutdown_state

        child = MagicMock()
        release = MagicMock()

        with patch("backend.main.quiesce_writers", new=AsyncMock()) as mock_quiesce:
            with patch("backend.main.data_lock") as mock_lock:
                mock_lock.release = release
                with patch("multiprocessing.active_children", return_value=[child]):
                    asyncio.run(v._quiesce_workers_before_exit())

        # Shutdown flag set so no new writer can spawn.
        assert shutdown_state.is_shutting_down() is True
        # Writer barrier drained.
        mock_quiesce.assert_awaited_once()
        # Every child worker terminated + joined (the DLL-holding index worker).
        child.terminate.assert_called_once()
        child.join.assert_called_once()
        # Data lock released for the incoming instance.
        release.assert_called_once()

    def test_delayed_exit_quiesces_before_os_exit(self, tmp_path):
        """End-to-end: install schedules an exit coroutine that awaits the
        barrier and only THEN calls os._exit(0) -- never the reverse order."""
        import asyncio
        from unittest.mock import AsyncMock

        import backend.api.version as v

        v._upgrade_state["state"] = "ready"
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        v._upgrade_state["installer_path"] = installer

        order = []

        captured = {}

        def capture_task(coro):
            captured["coro"] = coro

            # Close the un-run coroutine so pytest doesn't warn; we run it
            # explicitly below with the barrier mocked.
            class _Dummy:
                def __init__(self, c):
                    self._c = c

            return _Dummy(coro)

        async def fake_quiesce():
            order.append("quiesce")

        def fake_exit(code):
            order.append(("exit", code))
            raise SystemExit(code)  # stop the coroutine like os._exit would

        with patch("backend.api.version.launch_installer", return_value=True):
            with patch(
                "backend.api.version.asyncio.create_task", side_effect=capture_task
            ):
                resp = client.post("/api/version/upgrade/install")

        assert resp.json()["success"] is True

        # Now run the captured _delayed_exit coroutine with sleep/barrier/exit
        # all stubbed, and assert the ordering.
        with patch("backend.api.version.asyncio.sleep", new=AsyncMock()):
            with patch(
                "backend.api.version._quiesce_workers_before_exit",
                side_effect=fake_quiesce,
            ):
                with patch("backend.api.version.os._exit", side_effect=fake_exit):
                    try:
                        asyncio.run(captured["coro"])
                    except SystemExit:
                        pass

        assert order == ["quiesce", ("exit", 0)]


class TestCancelUpgrade:
    """Tests for POST /api/version/upgrade/cancel."""

    def setup_method(self):
        _reset_version_cache()

    @patch("backend.api.version.cleanup_upgrade_files")
    def test_cancel_upgrade(self, mock_cleanup):
        """Cancelling resets state to idle."""
        import backend.api.version as v

        v._upgrade_state["state"] = "downloading"
        v._upgrade_state["progress"] = 50.0
        response = client.post("/api/version/upgrade/cancel")
        data = response.json()
        assert data["success"] is True
        assert v._upgrade_state["state"] == "idle"
        assert v._upgrade_state["progress"] == 0.0
        mock_cleanup.assert_called_once()


class TestParseVersion:
    """Tests for version parsing and comparison helpers.

    XREPO-10 / SD-BE-API-21: the parser must handle suffixed tags
    (0.3.3-hotfix1, v0.4.0-rc1) instead of collapsing them to (0, 0, 0),
    order a pre-release below the same final release, and keep plain X.Y.Z
    numeric ordering (0.3.10 > 0.3.9) correct.
    """

    def test_parse_version_with_v_prefix(self):
        from backend.api.version import _parse_version

        assert _parse_version("v1.2.3") == (1, 2, 3, 1)

    def test_parse_version_without_prefix(self):
        from backend.api.version import _parse_version

        assert _parse_version("0.5.1") == (0, 5, 1, 1)

    def test_parse_version_invalid(self):
        # A tag with no leading numeric component at all is unparseable and
        # sorts below everything (it must never be offered as an update).
        from backend.api.version import _parse_version

        assert _parse_version("invalid") == (0, 0, 0, 0)

    def test_parse_version_double_digit_patch(self):
        # 0.3.10 must parse to (0, 3, 10), not be mangled by string compare.
        from backend.api.version import _parse_version

        assert _parse_version("0.3.10") == (0, 3, 10, 1)

    def test_parse_version_prerelease_suffix(self):
        # A hyphenated pre-release suffix keeps its numeric core but is ranked
        # as a pre-release (release_rank 0 < a final release's 1).
        from backend.api.version import _parse_version

        assert _parse_version("0.3.3-hotfix1") == (0, 3, 3, 0)
        assert _parse_version("v0.4.0-rc1") == (0, 4, 0, 0)

    def test_parse_version_pep440_prerelease_suffix(self):
        # PEP 440 style dev/rc suffixes (0.3.2.dev0, 0.4.0rc1) also parse to
        # their numeric core, ranked as pre-releases.
        from backend.api.version import _parse_version

        assert _parse_version("0.3.2.dev0") == (0, 3, 2, 0)
        assert _parse_version("0.4.0rc1") == (0, 4, 0, 0)

    def test_parse_version_missing_components(self):
        # Fewer than three components pad with zeros.
        from backend.api.version import _parse_version

        assert _parse_version("1") == (1, 0, 0, 1)
        assert _parse_version("1.2") == (1, 2, 0, 1)

    def test_is_newer_true(self):
        from backend.api.version import _is_newer

        assert _is_newer("1.1.0", "1.0.0") is True

    def test_is_newer_false_same(self):
        from backend.api.version import _is_newer

        assert _is_newer("1.0.0", "1.0.0") is False

    def test_is_newer_false_older(self):
        from backend.api.version import _is_newer

        assert _is_newer("0.9.0", "1.0.0") is False

    def test_is_newer_double_digit_patch(self):
        # 0.3.10 IS newer than 0.3.9 (the regression a naive string compare hits).
        from backend.api.version import _is_newer

        assert _is_newer("0.3.10", "0.3.9") is True
        assert _is_newer("0.3.9", "0.3.10") is False

    def test_prerelease_not_newer_than_final(self):
        # A published pre-release of the SAME X.Y.Z is NOT offered over the
        # installed final release; and the final release IS newer than the rc.
        from backend.api.version import _is_newer

        assert _is_newer("0.4.0-rc1", "0.4.0") is False
        assert _is_newer("0.4.0", "0.4.0-rc1") is True

    def test_prerelease_of_higher_version_is_newer(self):
        # A pre-release of a strictly higher version is still an upgrade.
        from backend.api.version import _is_newer

        assert _is_newer("0.5.0-rc1", "0.4.0") is True

    def test_current_prerelease_does_not_loop(self):
        # If the CURRENT (installed) version carries a pre-release suffix, the
        # matching final release is newer (offered once) but the same
        # pre-release is not "newer" than itself (no perpetual update prompt).
        from backend.api.version import _is_newer

        assert _is_newer("0.3.2", "0.3.2.dev0") is True
        assert _is_newer("0.3.2.dev0", "0.3.2.dev0") is False
