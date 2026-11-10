"""Sync coordinator: one job at a time across services (spec 2026-11-10 S1)."""

import asyncio
from typing import Optional

import pytest
import pytest_asyncio

from backend.api.progress import ProgressManager
from backend.services import sync_coordinator as sc
from backend.services.sync_coordinator import SyncCoordinator, order_services

pytestmark = pytest.mark.asyncio


class Harness:
    """Fake job runner: each job blocks until released, and records overlap."""

    def __init__(self) -> None:
        self.progress = ProgressManager()
        self.started: list[tuple[str, str]] = []
        self.active = 0
        self.max_active = 0
        self.gates: dict[str, asyncio.Event] = {}
        self.outcome: dict[str, str] = {}
        self.sequence_ends: list[str] = []
        self.tasks: dict[str, asyncio.Task] = {}

    async def run_job(self, job) -> None:
        self.started.append((job.service, job.kind))
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            gate = self.gates.setdefault(job.service, asyncio.Event())
            await gate.wait()
            gate.clear()
            if self.outcome.get(job.service, "complete") == "complete":
                self.progress.get(job.service).complete()
            else:
                self.progress.get(job.service).error("boom")
        finally:
            self.active -= 1

    def register_task(self, job, task) -> None:
        self.tasks[job.service] = task

    async def cancel_running(self, service: str) -> None:
        task = self.tasks[service]
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    def release(self, service: str) -> None:
        self.gates.setdefault(service, asyncio.Event()).set()

    def coordinator(self) -> SyncCoordinator:
        return SyncCoordinator(
            run_job=self.run_job,
            register_task=self.register_task,
            cancel_running=self.cancel_running,
            progress=self.progress,
            on_sequence_end=lambda seq: self.sequence_ends.append(seq.state),
        )


async def _settle() -> None:
    for _ in range(10):
        await asyncio.sleep(0)


@pytest_asyncio.fixture
async def h():
    harness = Harness()
    yield harness
    # Never leave a job blocked on its gate (a failing test would hang teardown).
    for _ in range(5):
        for gate in harness.gates.values():
            gate.set()
        for task in harness.tasks.values():
            if not task.done():
                task.cancel()
        await _settle()


async def test_jobs_run_one_after_another(h):
    c = h.coordinator()
    assert c.enqueue("hinatazaka46", origin="api").result == "started"
    second = c.enqueue("nogizaka46", origin="scheduler")
    assert (second.result, second.position) == ("queued", 1)
    await _settle()
    assert h.started == [("hinatazaka46", "sync")]
    assert h.progress.get("nogizaka46").get_status()["state"] == "queued"
    assert h.progress.get("nogizaka46").get_status()["queue_position"] == 1

    h.release("hinatazaka46")
    await _settle()
    assert h.started == [("hinatazaka46", "sync"), ("nogizaka46", "sync")]
    h.release("nogizaka46")
    await c.wait_idle()
    assert h.max_active == 1


async def test_started_job_shows_starting_at_once(h):
    c = h.coordinator()
    c.enqueue("hinatazaka46", origin="api", force_resync=True)
    status = h.progress.get("hinatazaka46").get_status()
    assert status["state"] == "running" and status["phase"] == "starting"
    assert "Resyncing" in status["detail"]
    h.release("hinatazaka46")
    await c.wait_idle()


async def test_dedup_running_and_queued(h):
    c = h.coordinator()
    c.enqueue("hinatazaka46", origin="api")
    c.enqueue("nogizaka46", origin="api")
    assert c.enqueue("hinatazaka46", origin="scheduler").result == "already_running"
    dup = c.enqueue("nogizaka46", origin="scheduler", force_resync=True)
    assert (dup.result, dup.position) == ("already_queued", 1)
    assert c.snapshot()["queued"] == [
        {"service": "nogizaka46", "kind": "sync", "position": 1, "origin": "api"}
    ]
    assert c._queue[0].force_resync is True  # upgraded in place
    h.release("hinatazaka46")
    h.release("nogizaka46")
    await c.wait_idle()


async def test_verify_waits_behind_a_sync_of_the_same_service(h):
    c = h.coordinator()
    c.enqueue("hinatazaka46", origin="api")
    h.progress.get("hinatazaka46").start_phase(
        "syncing", "Collecting Metadata", 2, 50, "members"
    )
    run_id = h.progress.get("hinatazaka46").get_status()["run_id"]
    res = c.enqueue("hinatazaka46", kind="verify", origin="api")
    assert res.result == "queued"
    # The running sync's progress is not clobbered by the queued verify.
    status = h.progress.get("hinatazaka46").get_status()
    assert status["phase"] == "syncing" and status["run_id"] == run_id

    h.release("hinatazaka46")
    await _settle()
    assert h.started[-1] == ("hinatazaka46", "verify")
    status = h.progress.get("hinatazaka46").get_status()
    assert status["run_id"] == run_id + 1 and status["phase"] == "starting"
    h.release("hinatazaka46")
    await c.wait_idle()


async def test_cancel_queued_job_never_runs(h):
    c = h.coordinator()
    c.enqueue("hinatazaka46", origin="api")
    c.enqueue("nogizaka46", origin="api")
    assert await c.cancel_service("nogizaka46") == "cancelled"
    assert h.progress.get("nogizaka46").get_status()["state"] == "idle"
    h.release("hinatazaka46")
    await c.wait_idle()
    assert h.started == [("hinatazaka46", "sync")]


async def test_cancel_running_job_moves_on(h):
    c = h.coordinator()
    c.enqueue("hinatazaka46", origin="api")
    c.enqueue("nogizaka46", origin="api")
    await _settle()
    assert await c.cancel_service("hinatazaka46") == "cancelled"
    await _settle()
    assert h.started[-1] == ("nogizaka46", "sync")
    assert await c.cancel_service("yodel") == "not_running"
    h.release("nogizaka46")
    await c.wait_idle()


async def test_queue_positions_drop_as_jobs_finish(h):
    c = h.coordinator()
    c.enqueue("hinatazaka46", origin="api")
    c.enqueue("nogizaka46", origin="api")
    c.enqueue("sakurazaka46", origin="api")
    assert h.progress.get("sakurazaka46").get_status()["queue_position"] == 2
    h.release("hinatazaka46")
    await _settle()
    assert h.progress.get("sakurazaka46").get_status()["queue_position"] == 1
    h.release("nogizaka46")
    h.release("sakurazaka46")
    await c.wait_idle()


@pytest.mark.filterwarnings("ignore")
def test_order_services_uses_the_fixed_order():
    assert order_services(["yodel", "hinatazaka46", "nogizaka46", "sakurazaka46"]) == [
        "nogizaka46",
        "sakurazaka46",
        "hinatazaka46",
        "yodel",
    ]
    assert order_services(["future", "yodel", "nogizaka46", "other"]) == [
        "nogizaka46",
        "yodel",
        "future",
        "other",
    ]


async def test_sequence_runs_in_fixed_order_and_reports_progress(h):
    c = h.coordinator()
    out = c.start_sequence(
        ["yodel", "hinatazaka46", "nogizaka46"], blocking=True, origin="api"
    )
    assert out["results"] == {
        "nogizaka46": "started",
        "hinatazaka46": "queued",
        "yodel": "queued",
    }
    seq = c.snapshot()["sequence"]
    assert seq["id"] == out["sequence_id"]
    assert seq["services"] == ["nogizaka46", "hinatazaka46", "yodel"]
    assert (seq["current_index"], seq["blocking"], seq["state"]) == (0, True, "running")
    assert c.sequence_active()

    h.release("nogizaka46")
    await _settle()
    assert c.snapshot()["sequence"]["current_index"] == 1
    h.outcome["hinatazaka46"] = "error"
    h.release("hinatazaka46")
    await _settle()
    h.release("yodel")
    await c.wait_idle()

    seq = c.snapshot()["sequence"]
    assert seq["state"] == "complete"
    assert seq["completed"] == ["nogizaka46", "yodel"] and seq["failed"] == [
        "hinatazaka46"
    ]
    assert not c.sequence_active()
    assert h.sequence_ends == ["complete"]
    assert [s for s, _ in h.started] == ["nogizaka46", "hinatazaka46", "yodel"]


async def test_sequence_adopts_a_running_scheduler_job(h):
    c = h.coordinator()
    c.enqueue("yodel", origin="scheduler")
    out = c.start_sequence(["nogizaka46", "yodel"], blocking=True, origin="api")
    assert out["results"] == {"nogizaka46": "queued", "yodel": "already_running"}
    seq = c.snapshot()["sequence"]
    # Execution order: the adopted running job first.
    assert seq["services"] == ["yodel", "nogizaka46"] and seq["current_index"] == 0
    h.release("yodel")
    h.release("nogizaka46")
    await c.wait_idle()
    assert c.snapshot()["sequence"]["completed"] == ["yodel", "nogizaka46"]


async def test_cancel_sequence_drops_only_its_jobs(h):
    c = h.coordinator()
    out = c.start_sequence(["nogizaka46", "sakurazaka46"], blocking=True, origin="api")
    c.enqueue("yodel", origin="scheduler")
    await _settle()
    assert await c.cancel_sequence(out["sequence_id"]) == "cancelled"
    await _settle()
    assert c.snapshot()["sequence"]["state"] == "cancelled"
    assert h.sequence_ends == ["cancelled"]
    assert h.started[-1] == ("yodel", "sync")  # the scheduler job survives
    assert await c.cancel_sequence("nope") == "not_found"
    h.release("yodel")
    await c.wait_idle()
    assert [s for s, _ in h.started] == ["nogizaka46", "yodel"]


async def test_second_start_all_joins_the_running_sequence(h):
    c = h.coordinator()
    first = c.start_sequence(["nogizaka46"], blocking=False, origin="api")
    second = c.start_sequence(["nogizaka46", "yodel"], blocking=True, origin="api")
    assert second["sequence_id"] == first["sequence_id"]
    seq = c.snapshot()["sequence"]
    assert seq["services"] == ["nogizaka46", "yodel"] and seq["blocking"] is True
    h.release("nogizaka46")
    h.release("yodel")
    await c.wait_idle()


async def test_failed_job_does_not_stop_the_queue(h):
    c = h.coordinator()

    async def explode(job):
        if job.service == "hinatazaka46":
            raise RuntimeError("boom")
        await h.run_job(job)

    c._run_job = explode
    c.enqueue("hinatazaka46", origin="api")
    c.enqueue("nogizaka46", origin="api")
    await _settle()
    h.release("nogizaka46")
    await c.wait_idle()
    assert h.started == [("nogizaka46", "sync")]


async def test_shutdown_refuses_and_drops(h, monkeypatch):
    c = h.coordinator()
    c.enqueue("hinatazaka46", origin="api")
    c.enqueue("nogizaka46", origin="api")
    await _settle()  # the runner is inside the hinatazaka46 job
    monkeypatch.setattr(sc, "is_shutting_down", lambda: True)
    assert c.enqueue("yodel", origin="api").result == "shutting_down"
    await c.stop()
    assert c.snapshot()["queued"] == []
    assert c.snapshot()["running"] is None
    assert h.progress.get("nogizaka46").get_status()["state"] == "idle"
    assert h.tasks["hinatazaka46"].cancelled()  # the job was stopped with the runner


async def test_runner_drops_queue_when_shutdown_begins(h, monkeypatch):
    c = h.coordinator()
    c.enqueue("hinatazaka46", origin="api")
    c.enqueue("nogizaka46", origin="api")
    await _settle()
    monkeypatch.setattr(sc, "is_shutting_down", lambda: True)
    h.release("hinatazaka46")
    await c.wait_idle()
    assert h.started == [("hinatazaka46", "sync")]


async def test_outcome_cancelled_from_progress_error_code(h):
    c = h.coordinator()
    ends: list[Optional[str]] = []

    async def cancelled_run(job):
        h.progress.get(job.service).error("CANCELLED")

    c._run_job = cancelled_run
    c.start_sequence(["nogizaka46"], blocking=True, origin="api")
    c._on_sequence_end = lambda seq: ends.append(seq.state)
    await c.wait_idle()
    assert c.snapshot()["sequence"]["failed"] == ["nogizaka46"]
    assert ends == ["complete"]


async def test_join_keeps_finished_services_first(h):
    c = h.coordinator()
    c.start_sequence(["nogizaka46", "sakurazaka46"], blocking=False, origin="api")
    h.release("nogizaka46")
    await _settle()
    c.start_sequence(["yodel"], blocking=False, origin="api")
    assert c.snapshot()["sequence"]["services"] == [
        "nogizaka46",
        "sakurazaka46",
        "yodel",
    ]
    h.release("sakurazaka46")
    h.release("yodel")
    await c.wait_idle()


async def test_sequence_end_hook_failure_is_logged_not_raised(h):
    c = h.coordinator()

    def broken(seq):
        raise RuntimeError("wake failed")

    c._on_sequence_end = broken
    c.start_sequence(["nogizaka46"], blocking=True, origin="api")
    h.release("nogizaka46")
    await c.wait_idle()
    assert c.snapshot()["sequence"]["state"] == "complete"


async def test_cancel_sequence_with_only_queued_jobs_ends_it_at_once(h):
    c = h.coordinator()
    c.enqueue("yodel", origin="scheduler")
    out = c.start_sequence(["nogizaka46"], blocking=True, origin="api")
    assert await c.cancel_sequence(out["sequence_id"]) == "cancelled"
    assert c.snapshot()["sequence"]["state"] == "cancelled"
    assert h.sequence_ends == ["cancelled"]
    # Cancelling again is a no-op on a finished sequence.
    assert await c.cancel_sequence(out["sequence_id"]) == "not_found"
    h.release("yodel")
    await c.wait_idle()


async def test_cancel_service_of_a_sequence_counts_as_failed(h):
    c = h.coordinator()
    c.start_sequence(["nogizaka46", "sakurazaka46"], blocking=True, origin="api")
    assert await c.cancel_service("sakurazaka46") == "cancelled"
    h.release("nogizaka46")
    await c.wait_idle()
    seq = c.snapshot()["sequence"]
    assert (seq["completed"], seq["failed"], seq["state"]) == (
        ["nogizaka46"],
        ["sakurazaka46"],
        "complete",
    )


async def test_start_sequence_while_shutting_down_finishes_empty(h, monkeypatch):
    c = h.coordinator()
    monkeypatch.setattr(sc, "is_shutting_down", lambda: True)
    out = c.start_sequence(["nogizaka46"], blocking=True, origin="api")
    assert out["results"] == {"nogizaka46": "shutting_down"}
    seq = c.snapshot()["sequence"]
    assert seq["services"] == [] and seq["state"] == "complete"


async def test_default_hooks_reach_the_service_and_the_scheduler(monkeypatch):
    from unittest.mock import AsyncMock, MagicMock

    svc = MagicMock()
    svc.cancel = AsyncMock()
    monkeypatch.setattr("backend.api.sync.get_sync_service", lambda service: svc)
    woken: list[bool] = []
    monkeypatch.setattr(
        "backend.services.auto_sync_scheduler.wake_scheduler",
        lambda: woken.append(True) or True,
    )

    await sc._default_cancel_running("yodel")
    sc._default_sequence_end(
        sc.SyncSequence(id="x", services=[], blocking=False, origin="api")
    )

    svc.cancel.assert_awaited_once()
    assert woken == [True]


@pytest.mark.filterwarnings("ignore")
def test_get_coordinator_is_a_singleton():
    assert sc.get_coordinator() is sc.get_coordinator()
