"""Tests for backend/services/auto_sync_scheduler.py."""

import asyncio
from unittest.mock import patch

import pytest
from structlog.testing import capture_logs

from backend.services import auto_sync_scheduler as scheduler_module
from backend.services import shutdown_state
from backend.services.auto_sync_scheduler import (
    AutoSyncScheduler,
    scheduler_allowed_in_env,
)

SVC = "hinatazaka46"


class _Harness:
    """Fake sleep/settings/auth/launch; stops the loop after `ticks` ticks."""

    def __init__(
        self, settings, *, ticks=1, authed=True, launch_result="started", previous=None
    ):
        self.settings = settings
        self.previous = previous
        self.ticks = ticks
        self.authed = authed
        self.launch_result = launch_result
        self.sleeps: list[float] = []
        self.launches: list[tuple] = []
        self.done = asyncio.Event()

    async def sleep(self, seconds):
        self.sleeps.append(seconds)
        # The (ticks+1)-th sleep means `ticks` full ticks were processed.
        if len(self.sleeps) > self.ticks:
            self.done.set()
            await asyncio.sleep(3600)  # parked until cancelled
        await asyncio.sleep(0)

    async def load_settings(self):
        if isinstance(self.settings, Exception):
            raise self.settings
        return self.settings

    async def is_authenticated(self, service):
        if isinstance(self.authed, Exception):
            raise self.authed
        return self.authed

    async def launch(self, service, **kwargs):
        self.launches.append((service, kwargs))
        return self.launch_result

    def scheduler(self, services=(SVC,)):
        return AutoSyncScheduler(
            list(services),
            sleep=self.sleep,
            load_settings=self.load_settings,
            is_authenticated=self.is_authenticated,
            launch=self.launch,
            previous_error_code=lambda service: self.previous,
        )

    async def run(self, services=(SVC,)):
        sched = self.scheduler(services)
        sched.start()
        await asyncio.wait_for(self.done.wait(), timeout=5)
        await sched.stop()


def _settings(**over):
    base = {
        "auto_sync_enabled": True,
        "adaptive_sync_enabled": False,
        "sync_interval_minutes": 15,
        "is_configured": True,
    }
    base.update(over)
    return base


def _ticks(logs):
    return [e for e in logs if e["event"] == "auto_sync_tick"]


@pytest.fixture(autouse=True)
def _restore_shutdown_flag():
    yield
    shutdown_state.reset_for_tests()
    scheduler_module._active = None


@pytest.mark.asyncio
async def test_first_tick_waits_full_interval_then_launches():
    h = _Harness(_settings(sync_interval_minutes=15))
    with capture_logs() as logs:
        await h.run()
    assert h.sleeps[0] == 15 * 60
    assert h.launches == [(SVC, {"origin": "scheduler"})]
    tick = _ticks(logs)[0]
    assert tick["service"] == SVC
    assert tick["reason"] == "started"
    assert tick["next_minutes"] == 15.0


@pytest.mark.asyncio
async def test_launch_already_running_is_the_reason():
    h = _Harness(_settings(), launch_result="already_running")
    with capture_logs() as logs:
        await h.run()
    assert _ticks(logs)[0]["reason"] == "already_running"


@pytest.mark.asyncio
async def test_disabled_does_not_launch():
    h = _Harness(_settings(auto_sync_enabled=False))
    with capture_logs() as logs:
        await h.run()
    assert h.launches == []
    assert _ticks(logs)[0]["reason"] == "disabled"


@pytest.mark.asyncio
async def test_not_configured_does_not_launch():
    h = _Harness(_settings(is_configured=False))
    with capture_logs() as logs:
        await h.run()
    assert h.launches == []
    assert _ticks(logs)[0]["reason"] == "not_configured"


@pytest.mark.asyncio
async def test_not_authenticated_does_not_launch():
    h = _Harness(_settings(), authed=False)
    with capture_logs() as logs:
        await h.run()
    assert h.launches == []
    assert _ticks(logs)[0]["reason"] == "not_authenticated"


@pytest.mark.asyncio
async def test_disabled_wins_over_not_configured():
    h = _Harness(_settings(auto_sync_enabled=False, is_configured=False), authed=False)
    with capture_logs() as logs:
        await h.run()
    assert _ticks(logs)[0]["reason"] == "disabled"


@pytest.mark.asyncio
async def test_shutting_down_wins_and_exits_loop():
    shutdown_state.begin_shutdown()
    h = _Harness(_settings(auto_sync_enabled=False), ticks=5)
    sched = h.scheduler()
    with capture_logs() as logs:
        sched.start()
        await asyncio.wait_for(asyncio.gather(*sched._tasks.values()), timeout=5)
    assert _ticks(logs)[0]["reason"] == "shutting_down"
    assert h.launches == []
    assert len(h.sleeps) == 1  # loop exited, no second wait
    await sched.stop()


@pytest.mark.asyncio
async def test_launch_reporting_shutting_down_exits_loop():
    h = _Harness(_settings(), ticks=5, launch_result="shutting_down")
    sched = h.scheduler()
    sched.start()
    await asyncio.wait_for(asyncio.gather(*sched._tasks.values()), timeout=5)
    assert len(h.sleeps) == 1
    await sched.stop()


@pytest.mark.asyncio
async def test_adaptive_interval_uses_calculator():
    h = _Harness(_settings(adaptive_sync_enabled=True, sync_interval_minutes=99))
    with patch(
        "backend.services.adaptive_sync.calculate_next_sync_interval",
        side_effect=[6.0, 8.0],
    ):
        await h.run()
    assert h.sleeps[0] == 6.0 * 60
    assert h.sleeps[1] == 8.0 * 60


@pytest.mark.asyncio
async def test_fixed_interval_ignores_adaptive_calculator():
    h = _Harness(_settings(sync_interval_minutes=42), ticks=2)
    await h.run()
    assert h.sleeps[:3] == [42 * 60, 42 * 60, 42 * 60]


@pytest.mark.asyncio
async def test_exception_logs_failed_and_loop_continues():
    h = _Harness(_settings(sync_interval_minutes=15), ticks=2)
    calls = {"n": 0}
    real_launch = h.launch

    async def flaky_launch(service, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom with secret detail")
        return await real_launch(service, **kwargs)

    h.launch = flaky_launch
    with capture_logs() as logs:
        await h.run()
    failed = [e for e in logs if e["event"] == "auto_sync_failed"]
    assert failed == [
        {
            "event": "auto_sync_failed",
            "log_level": "error",
            "service": SVC,
            "error_type": "RuntimeError",
        }
    ]
    assert "boom" not in str(failed)
    # second iteration still launched
    assert len(h.launches) == 1
    assert h.sleeps[:2] == [15 * 60, 15 * 60]


@pytest.mark.asyncio
async def test_settings_failure_is_survived_with_default_interval():
    h = _Harness(OSError("disk"), ticks=1)
    with capture_logs() as logs:
        await h.run()
    assert any(e["event"] == "auto_sync_failed" for e in logs)
    assert h.sleeps[0] == 15 * 60  # fallback default


@pytest.mark.asyncio
async def test_auth_check_error_is_survived():
    h = _Harness(_settings(), authed=ValueError("x"), ticks=1)
    with capture_logs() as logs:
        await h.run()
    assert h.launches == []
    assert [e["error_type"] for e in logs if e["event"] == "auto_sync_failed"] == [
        "ValueError"
    ]


@pytest.mark.asyncio
async def test_one_task_per_service():
    h = _Harness(_settings(), ticks=1)
    sched = h.scheduler(["hinatazaka46", "sakurazaka46"])
    sched.start()
    assert set(sched._tasks) == {"hinatazaka46", "sakurazaka46"}
    await asyncio.sleep(0.05)
    await sched.stop()
    assert sched._tasks == {}


@pytest.mark.asyncio
async def test_start_is_idempotent():
    h = _Harness(_settings(), ticks=1)
    sched = h.scheduler()
    sched.start()
    first = dict(sched._tasks)
    sched.start()
    assert sched._tasks == first
    await sched.stop()


@pytest.mark.asyncio
async def test_stop_cancels_cleanly_and_is_idempotent():
    h = _Harness(_settings(), ticks=100)
    sched = h.scheduler()
    sched.start()
    await asyncio.sleep(0.01)
    tasks = list(sched._tasks.values())
    await sched.stop()
    assert all(t.done() for t in tasks)
    await sched.stop()  # no error the second time


@pytest.mark.asyncio
async def test_default_is_authenticated_uses_auth_service():
    from backend.services.auto_sync_scheduler import _default_is_authenticated

    with patch(
        "backend.api.auth.auth_service.get_status",
        return_value={"authenticated": True},
    ) as gs:
        assert await _default_is_authenticated(SVC) is True
        gs.assert_called_once_with(SVC)
    with patch(
        "backend.api.auth.auth_service.get_status",
        return_value={"authenticated": False, "token_expired": True},
    ):
        assert await _default_is_authenticated(SVC) is False
    with patch("backend.api.auth.auth_service.get_status", return_value={}):
        assert await _default_is_authenticated(SVC) is False


def test_scheduler_allowed_in_env(monkeypatch):
    monkeypatch.delenv("SAKADESK_DISABLE_AUTO_SYNC", raising=False)
    monkeypatch.setattr("backend.services.platform.TEST_MODE", False)
    assert scheduler_allowed_in_env() is True
    monkeypatch.setenv("SAKADESK_DISABLE_AUTO_SYNC", "1")
    assert scheduler_allowed_in_env() is False
    monkeypatch.delenv("SAKADESK_DISABLE_AUTO_SYNC")
    monkeypatch.setattr("backend.services.platform.TEST_MODE", True)
    assert scheduler_allowed_in_env() is False


def test_lifespan_skips_scheduler_under_pytest():
    """the root conftest sets SAKADESK_DISABLE_AUTO_SYNC, so the lifespan does not start it."""
    from fastapi.testclient import TestClient

    from backend.main import app

    with patch("backend.services.auto_sync_scheduler.AutoSyncScheduler.start") as st:
        with TestClient(app):
            pass
    st.assert_not_called()


def test_lifespan_starts_and_stops_scheduler_when_opted_in(monkeypatch):
    from fastapi.testclient import TestClient

    import backend.main as main_mod

    monkeypatch.delenv("SAKADESK_DISABLE_AUTO_SYNC", raising=False)
    monkeypatch.setattr("backend.services.platform.TEST_MODE", False)
    order: list[str] = []

    async def fake_quiesce():
        order.append("quiesce")

    async def fake_stop(self):
        order.append("stop")

    monkeypatch.setattr(main_mod, "quiesce_writers", fake_quiesce)
    with (
        patch(
            "backend.services.auto_sync_scheduler.AutoSyncScheduler.start",
            autospec=True,
        ) as st,
        patch(
            "backend.services.auto_sync_scheduler.AutoSyncScheduler.stop",
            fake_stop,
        ),
        patch.object(main_mod.data_lock, "release"),
        TestClient(main_mod.app),
    ):
        st.assert_called_once()
    assert order == ["stop", "quiesce"]
    shutdown_state.reset_for_tests()


@pytest.mark.asyncio
async def test_tick_logs_the_previous_runs_error_code():
    h = _Harness(_settings(), previous="session_expired")
    with capture_logs() as logs:
        await h.run()
    assert _ticks(logs)[0]["previous_error_code"] == "session_expired"


@pytest.mark.asyncio
async def test_tick_has_no_previous_error_code_after_a_clean_run():
    h = _Harness(_settings())
    with capture_logs() as logs:
        await h.run()
    assert "previous_error_code" not in _ticks(logs)[0]


def test_default_previous_error_code_reads_the_progress_tracker():
    from backend.api.progress import progress_manager
    from backend.services.auto_sync_scheduler import _default_previous_error_code

    tracker = progress_manager.get("previous-error-svc")
    tracker.reset()
    assert _default_previous_error_code("previous-error-svc") is None
    tracker.error("SESSION_EXPIRED")
    assert _default_previous_error_code("previous-error-svc") == "session_expired"
    tracker.error("something odd")
    assert _default_previous_error_code("previous-error-svc") == "unknown"


@pytest.mark.asyncio
@pytest.mark.parametrize("minutes", [0, -5, 0.2])
async def test_interval_is_clamped_to_one_minute(minutes):
    h = _Harness(_settings(sync_interval_minutes=minutes), ticks=2)
    await h.run()
    assert h.sleeps[:3] == [60, 60, 60]


@pytest.mark.asyncio
async def test_interval_clamp_also_applies_to_the_adaptive_calculator():
    h = _Harness(_settings(adaptive_sync_enabled=True))
    with patch(
        "backend.services.adaptive_sync.calculate_next_sync_interval",
        side_effect=[0.0, 0.0],
    ):
        await h.run()
    assert h.sleeps[0] == 60


class _WakeHarness:
    """A scheduler whose sleep blocks until cancelled, with swappable settings."""

    def __init__(self, settings):
        self.settings = settings
        self.fail_settings = False
        self.sleeps: list[float] = []
        self.launches: list[str] = []

    async def sleep(self, seconds):
        self.sleeps.append(seconds)
        await asyncio.sleep(3600)

    async def load_settings(self):
        if self.fail_settings:
            raise OSError("disk")
        return self.settings

    async def is_authenticated(self, service):
        return True

    async def launch(self, service, **kwargs):
        self.launches.append(service)
        return "started"

    def scheduler(self):
        return AutoSyncScheduler(
            [SVC],
            sleep=self.sleep,
            load_settings=self.load_settings,
            is_authenticated=self.is_authenticated,
            launch=self.launch,
            previous_error_code=lambda service: None,
        )


async def _until(predicate):
    for _ in range(200):
        if predicate():
            return
        await asyncio.sleep(0.005)
    raise AssertionError("condition not reached")


@pytest.mark.asyncio
async def test_wake_ends_the_wait_and_rereads_the_settings_without_a_tick():
    h = _WakeHarness(_settings(sync_interval_minutes=60))
    sched = h.scheduler()
    with capture_logs() as logs:
        sched.start()
        await _until(lambda: len(h.sleeps) == 1)
        assert h.sleeps == [3600]
        h.settings = _settings(sync_interval_minutes=1)
        sched.wake()
        await _until(lambda: len(h.sleeps) == 2)
        await sched.stop()
    assert h.sleeps == [3600, 60]
    assert h.launches == []  # a wake re-arms the wait; it is not a tick
    assert _ticks(logs) == []
    (wake,) = [e for e in logs if e["event"] == "auto_sync_wake"]
    assert wake["service"] == SVC
    assert wake["next_minutes"] == 1.0


@pytest.mark.asyncio
async def test_wake_twice_in_a_row_keeps_working():
    h = _WakeHarness(_settings())
    sched = h.scheduler()
    sched.start()
    await _until(lambda: len(h.sleeps) == 1)
    sched.wake()
    await _until(lambda: len(h.sleeps) == 2)
    sched.wake()
    await _until(lambda: len(h.sleeps) == 3)
    await sched.stop()


@pytest.mark.asyncio
async def test_wake_before_start_and_after_stop_is_a_noop():
    h = _WakeHarness(_settings())
    sched = h.scheduler()
    sched.wake()
    sched.start()
    await _until(lambda: len(h.sleeps) == 1)
    await sched.stop()
    sched.wake()
    assert len(h.sleeps) == 1


@pytest.mark.asyncio
async def test_wake_survives_a_settings_failure_on_rewake():
    h = _WakeHarness(_settings(sync_interval_minutes=30))
    sched = h.scheduler()
    with capture_logs() as logs:
        sched.start()
        await _until(lambda: len(h.sleeps) == 1)

        h.fail_settings = True
        sched.wake()
        await _until(lambda: any(e["event"] == "auto_sync_failed" for e in logs))
        h.fail_settings = False
        await _until(lambda: len(h.sleeps) == 2)
        await sched.stop()
    assert h.sleeps[1] == 30 * 60  # last known fixed interval, loop carries on


@pytest.mark.asyncio
async def test_wake_scheduler_wakes_the_running_scheduler():
    from backend.services.auto_sync_scheduler import wake_scheduler

    h = _WakeHarness(_settings())
    sched = h.scheduler()
    with capture_logs() as logs:
        assert wake_scheduler() is False  # none running
        sched.start()
        await _until(lambda: len(h.sleeps) == 1)
        assert wake_scheduler() is True
        await _until(lambda: len(h.sleeps) == 2)
        await sched.stop()
        assert wake_scheduler() is False  # stopped again
    assert [e["woken"] for e in logs if e["event"] == "auto_sync_wake_requested"] == [
        False,
        True,
        False,
    ]
