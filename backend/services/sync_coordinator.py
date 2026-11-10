"""One backend queue for every sync and verify job (spec 2026-11-10, S1).

Before this module, each service synced on its own: the first-launch "one service
at a time" sequence lived only in the frontend, while the AutoSyncScheduler, the
tray and the startup effect launched services in parallel. The dialog then showed
one service while others downloaded, and the progress and ETA had nothing to do
with the real work.

:class:`SyncCoordinator` runs **one job at a time across all services**
(:data:`MAX_CONCURRENT_JOBS`). Every writer path enqueues here: ``POST
/api/sync/start`` and ``/verify`` (through :mod:`backend.services.sync_launcher`),
the scheduler and the tray. A *sequence* (``POST /api/sync/start-all``) is an
ordered batch, in :data:`SERVICE_SYNC_ORDER`, that the frontend displays from
:meth:`SyncCoordinator.snapshot`. While a sequence runs the scheduler does not
launch (``auto_sync_tick reason=sequence_active``), and when it ends the
scheduler is woken so its next wait starts from there.

Progress stays per service (``progress_manager``). A queued service reports
``state: "queued"`` with ``queue_position``; a service that is busy (its job runs,
or an earlier job of it is queued) keeps its current progress until its next job
starts.

Breadcrumbs (ids and codes only): ``sync_queue`` (action ``enqueued`` /
``started`` / ``finished`` / ``deduped`` / ``dropped`` / ``cancelled`` /
``job_failed``) and ``sync_sequence`` (action ``started`` / ``joined`` /
``finished`` / ``cancelled``).
"""

from __future__ import annotations

import asyncio
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Coroutine, Iterable, Optional

import structlog

from backend.api.progress import ProgressManager, progress_manager
from backend.services.background_tasks import track_background_task
from backend.services.shutdown_state import is_shutting_down

logger = structlog.get_logger(__name__)

# One job at a time across all services (user decision, 2026-11-10).
MAX_CONCURRENT_JOBS = 1

# Order of a sequence (user decision, 2026-11-10): 乃木坂46, 櫻坂46, 日向坂46, Yodel.
SERVICE_SYNC_ORDER: tuple[str, ...] = (
    "nogizaka46",
    "sakurazaka46",
    "hinatazaka46",
    "yodel",
)

RESULT_STARTED = "started"
RESULT_QUEUED = "queued"
RESULT_ALREADY_RUNNING = "already_running"
RESULT_ALREADY_QUEUED = "already_queued"
RESULT_SHUTTING_DOWN = "shutting_down"

KIND_SYNC = "sync"
KIND_VERIFY = "verify"


def order_services(services: Iterable[str]) -> list[str]:
    """``services`` deduplicated, in :data:`SERVICE_SYNC_ORDER`; unknown ones last, in input order."""
    unique = list(dict.fromkeys(services))
    known = [s for s in SERVICE_SYNC_ORDER if s in unique]
    return known + [s for s in unique if s not in SERVICE_SYNC_ORDER]


@dataclass
class SyncJob:
    service: str
    kind: str = KIND_SYNC
    include_inactive: bool = True
    force_resync: bool = False
    origin: str = "api"
    sequence_id: Optional[str] = None
    # The tracker already shows this job (queued or starting); else it is
    # reset when the job starts, because another job of the service owned it.
    owns_progress: bool = False
    # start_phase("starting") already ran at enqueue (the slot was free).
    progress_started: bool = False


@dataclass
class EnqueueResult:
    result: str
    position: Optional[int] = None


@dataclass
class SyncSequence:
    id: str
    services: list[str]
    blocking: bool
    origin: str
    state: str = "running"
    completed: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    cancelled: bool = False


RunJobFn = Callable[[SyncJob], Coroutine[Any, Any, None]]
RegisterTaskFn = Callable[[SyncJob, "asyncio.Task[Any]"], None]
CancelRunningFn = Callable[[str], Awaitable[None]]
SequenceEndFn = Callable[[SyncSequence], None]


async def _default_run_job(job: SyncJob) -> None:
    # Imported lazily: backend.api.sync imports the launcher, which imports this.
    from backend.api import sync as sync_api

    if job.kind == KIND_VERIFY:
        await sync_api.run_verify_task(job.service)
    else:
        await sync_api.run_sync_task(
            job.service, job.include_inactive, job.force_resync
        )


def _default_register_task(job: SyncJob, task: "asyncio.Task[Any]") -> None:
    # /cancel reaches the job through SyncService._task (real task.cancel()).
    from backend.api import sync as sync_api

    sync_api.get_sync_service(job.service)._task = task


async def _default_cancel_running(service: str) -> None:
    from backend.api import sync as sync_api

    await sync_api.get_sync_service(service).cancel()


def _default_sequence_end(sequence: SyncSequence) -> None:
    from backend.services.auto_sync_scheduler import wake_scheduler

    wake_scheduler()


class SyncCoordinator:
    """FIFO queue of sync / verify jobs, run one at a time (see module docstring)."""

    def __init__(
        self,
        *,
        run_job: RunJobFn = _default_run_job,
        register_task: RegisterTaskFn = _default_register_task,
        cancel_running: CancelRunningFn = _default_cancel_running,
        progress: ProgressManager = progress_manager,
        on_sequence_end: SequenceEndFn = _default_sequence_end,
    ) -> None:
        self._run_job = run_job
        self._register_task = register_task
        self._cancel_running = cancel_running
        self._progress = progress
        self._on_sequence_end = on_sequence_end
        self._queue: deque[SyncJob] = deque()
        self._running: Optional[SyncJob] = None
        self._runner: Optional[asyncio.Task[None]] = None
        self._sequence: Optional[SyncSequence] = None
        self._stopping = False

    # --- queries ---------------------------------------------------------

    def sequence_active(self) -> bool:
        """True while a sequence still has a queued or running job."""
        return self._sequence is not None and self._sequence.state == "running"

    def _busy(self, service: str) -> bool:
        return (self._running is not None and self._running.service == service) or any(
            j.service == service for j in self._queue
        )

    def _position(self, job: SyncJob) -> int:
        return list(self._queue).index(job) + 1

    def snapshot(self) -> dict[str, Any]:
        """The queue as ``GET /api/sync/queue`` returns it."""
        running = (
            {
                "service": self._running.service,
                "kind": self._running.kind,
                "origin": self._running.origin,
            }
            if self._running
            else None
        )
        queued = [
            {
                "service": j.service,
                "kind": j.kind,
                "position": i + 1,
                "origin": j.origin,
            }
            for i, j in enumerate(self._queue)
        ]
        seq = self._sequence
        sequence = None
        if seq is not None:
            sequence = {
                "id": seq.id,
                "services": list(seq.services),
                "current_index": self._current_index(seq),
                "blocking": seq.blocking,
                "state": seq.state,
                "completed": list(seq.completed),
                "failed": list(seq.failed),
            }
        return {"running": running, "queued": queued, "sequence": sequence}

    def _current_index(self, seq: SyncSequence) -> int:
        # An adopted or own job's service is always in seq.services.
        if self._running is not None and self._running.sequence_id == seq.id:
            return seq.services.index(self._running.service)
        return min(len(seq.completed) + len(seq.failed), max(len(seq.services) - 1, 0))

    # --- enqueue ---------------------------------------------------------

    def enqueue(
        self,
        service: str,
        *,
        kind: str = KIND_SYNC,
        include_inactive: bool = True,
        force_resync: bool = False,
        origin: str,
        sequence_id: Optional[str] = None,
    ) -> EnqueueResult:
        """Queue a job; start the runner when the slot is free. Never awaits.

        Returns ``started`` (it runs next, nothing ahead of it), ``queued`` (with
        its 1-based ``position``), ``already_running`` / ``already_queued`` (one
        job per service and kind; a queued sync is upgraded to ``force_resync``
        in place), or ``shutting_down``.
        """
        if is_shutting_down():
            return EnqueueResult(RESULT_SHUTTING_DOWN)

        running = self._running
        if running is not None and running.service == service and running.kind == kind:
            self._adopt(running, sequence_id)
            logger.info(
                "sync_queue",
                action="deduped",
                service=service,
                kind=kind,
                origin=origin,
                state="running",
            )
            return EnqueueResult(RESULT_ALREADY_RUNNING)
        for queued in self._queue:
            if queued.service == service and queued.kind == kind:
                if force_resync and kind == KIND_SYNC:
                    queued.force_resync = True
                self._adopt(queued, sequence_id)
                position = self._position(queued)
                logger.info(
                    "sync_queue",
                    action="deduped",
                    service=service,
                    kind=kind,
                    origin=origin,
                    state="queued",
                    position=position,
                )
                return EnqueueResult(RESULT_ALREADY_QUEUED, position)

        job = SyncJob(
            service=service,
            kind=kind,
            include_inactive=include_inactive,
            force_resync=force_resync,
            origin=origin,
            sequence_id=sequence_id,
        )
        busy = self._busy(service)
        progress = self._progress.get(service)
        if self._running is None and not self._queue:
            # The slot is free: reserve it now so later jobs queue behind this one.
            self._running = job
            position = 0
            progress.reset()
            self._start_progress(job)
            job.owns_progress = job.progress_started = True
            result = EnqueueResult(RESULT_STARTED)
        else:
            self._queue.append(job)
            position = self._position(job)
            if not busy:
                progress.reset()
                progress.set_queued(position)
                job.owns_progress = True
            result = EnqueueResult(RESULT_QUEUED, position)
        logger.info(
            "sync_queue",
            action="enqueued",
            service=service,
            kind=kind,
            origin=origin,
            result=result.result,
            position=position,
            sequence_id=sequence_id,
        )
        self._kick()
        return result

    def _adopt(self, job: SyncJob, sequence_id: Optional[str]) -> None:
        if sequence_id is not None and job.sequence_id is None:
            job.sequence_id = sequence_id

    def _runner_idle(self) -> bool:
        return self._runner is None or self._runner.done()

    def _kick(self) -> None:
        if (self._queue or self._running is not None) and self._runner_idle():
            self._runner = asyncio.create_task(self._run(), name="sync_coordinator")

    def _start_progress(self, job: SyncJob) -> None:
        progress = self._progress.get(job.service)
        progress.start_phase("starting", "Starting", 0, 0, "")
        if job.kind == KIND_VERIFY:
            progress.set_detail("Scanning for missing media...")
        else:
            progress.set_detail(
                "Initializing..." + (" (Resyncing)" if job.force_resync else "")
            )

    def _refresh_positions(self) -> None:
        for i, job in enumerate(self._queue):
            if job.owns_progress and not job.progress_started:
                self._progress.get(job.service).set_queued(i + 1)

    # --- sequences -------------------------------------------------------

    def start_sequence(
        self, services: Iterable[str], *, blocking: bool, origin: str
    ) -> dict[str, Any]:
        """Enqueue ``services`` as one sequence in :data:`SERVICE_SYNC_ORDER`.

        A running sequence is joined (its id is returned; ``blocking`` only ever
        upgrades). A job of a listed service that is already queued or running
        (e.g. started by the scheduler) is adopted into the sequence. The
        sequence's ``services`` are kept in execution order.
        """
        ordered = order_services(services)
        seq = self._sequence if self.sequence_active() else None
        if seq is None:
            seq = SyncSequence(
                id=uuid.uuid4().hex[:12], services=[], blocking=blocking, origin=origin
            )
            self._sequence = seq
            action = "started"
        else:
            seq.blocking = seq.blocking or blocking
            action = "joined"
        results: dict[str, str] = {}
        for service in ordered:
            results[service] = self.enqueue(
                service, origin=origin, sequence_id=seq.id
            ).result
            if service not in seq.services and results[service] != RESULT_SHUTTING_DOWN:
                seq.services.append(service)
        seq.services.sort(key=self._execution_rank)
        logger.info(
            "sync_sequence",
            action=action,
            sequence_id=seq.id,
            count=len(seq.services),
            blocking=seq.blocking,
            origin=origin,
        )
        if not self._sequence_has_jobs(seq):
            self._finish_sequence(seq)
        return {"sequence_id": seq.id, "results": results}

    def _execution_rank(self, service: str) -> int:
        seq_id = self._sequence.id if self._sequence else None
        if (
            self._running is not None
            and self._running.service == service
            and self._running.sequence_id == seq_id
        ):
            return 0
        for i, job in enumerate(self._queue):
            if job.service == service and job.sequence_id == seq_id:
                return i + 1
        return -1  # already finished: keep it ahead of the pending ones

    def _sequence_has_jobs(self, seq: SyncSequence) -> bool:
        return (
            self._running is not None and self._running.sequence_id == seq.id
        ) or any(j.sequence_id == seq.id for j in self._queue)

    def _record_sequence_outcome(self, job: SyncJob, outcome: str) -> None:
        seq = self._sequence
        if seq is None or job.sequence_id != seq.id or seq.state != "running":
            return
        (seq.completed if outcome == "complete" else seq.failed).append(job.service)
        if not self._sequence_has_jobs(seq):
            self._finish_sequence(seq)

    def _finish_sequence(self, seq: SyncSequence) -> None:
        # Called only while seq is running: its last job just ended, or it was
        # cancelled / started with no job left.
        seq.state = "cancelled" if seq.cancelled else "complete"
        logger.info(
            "sync_sequence",
            action="finished",
            sequence_id=seq.id,
            outcome=seq.state,
            completed=len(seq.completed),
            failed=len(seq.failed),
        )
        try:
            self._on_sequence_end(seq)
        except Exception as e:
            logger.warning("sync_sequence_end_hook_failed", error_type=type(e).__name__)

    # --- cancel / stop ---------------------------------------------------

    def _drop(self, predicate: Callable[[SyncJob], bool], reason: str) -> list[SyncJob]:
        dropped = [j for j in self._queue if predicate(j)]
        if not dropped:
            return []
        self._queue = deque(j for j in self._queue if not predicate(j))
        for job in dropped:
            if job.owns_progress:
                self._progress.get(job.service).reset()
            logger.info(
                "sync_queue",
                action="dropped",
                service=job.service,
                kind=job.kind,
                reason=reason,
            )
        self._refresh_positions()
        return dropped

    async def cancel_service(self, service: str) -> str:
        """Drop the service's queued jobs and cancel its running one.

        Returns ``cancelled`` or ``not_running``.
        """
        dropped = self._drop(lambda j: j.service == service, reason="cancelled")
        for job in dropped:
            self._record_sequence_outcome(job, "cancelled")
        running = self._running
        if running is not None and running.service == service:
            logger.info(
                "sync_queue", action="cancelled", service=service, kind=running.kind
            )
            await self._cancel_running(service)
            return "cancelled"
        return "cancelled" if dropped else "not_running"

    async def cancel_sequence(self, sequence_id: str) -> str:
        """Cancel a running sequence: drop its queued jobs and cancel its running job.

        Jobs from other origins stay queued. Returns ``cancelled`` or ``not_found``.
        """
        seq = self._sequence
        if seq is None or seq.id != sequence_id or seq.state != "running":
            return "not_found"
        seq.cancelled = True
        logger.info("sync_sequence", action="cancelled", sequence_id=seq.id)
        for job in self._drop(
            lambda j: j.sequence_id == seq.id, reason="sequence_cancelled"
        ):
            seq.failed.append(job.service)
        running = self._running
        if running is not None and running.sequence_id == seq.id:
            await self._cancel_running(running.service)
        elif not self._sequence_has_jobs(seq):
            self._finish_sequence(seq)
        return "cancelled"

    async def stop(self) -> None:
        """Shutdown hook: drop every queued job, then stop the runner.

        The running job itself is drained by the SyncService stop hook.
        """
        self._stopping = True
        self._drop(lambda j: True, reason="shutdown")
        runner = self._runner
        if runner is not None and not runner.done():
            # Cancelling the runner also cancels the job it awaits; the runner
            # then sees _stopping and returns.
            runner.cancel()
            await asyncio.gather(runner, return_exceptions=True)

    async def wait_idle(self) -> None:
        """Wait until the queue is empty and nothing runs (tests, diagnostics)."""
        while not self._runner_idle():
            await asyncio.shield(self._runner)  # type: ignore[arg-type]

    # --- runner ----------------------------------------------------------

    def _outcome(self, job: SyncJob, task: "asyncio.Task[Any]") -> str:
        if task.cancelled():
            return "cancelled"
        status = self._progress.get(job.service).get_status()
        if status["state"] == "complete":
            return "complete"
        if status.get("error_code") == "cancelled":
            return "cancelled"
        return "error"

    async def _run(self) -> None:
        while not self._stopping:
            job = self._running  # reserved by enqueue when the slot was free
            if job is None:
                if not self._queue:
                    return
                if is_shutting_down():
                    self._drop(lambda j: True, reason="shutdown")
                    return
                job = self._queue.popleft()
                self._running = job
                self._refresh_positions()
            if not job.progress_started:
                if not job.owns_progress:
                    self._progress.get(job.service).reset()
                self._start_progress(job)
            logger.info(
                "sync_queue",
                action="started",
                service=job.service,
                kind=job.kind,
                origin=job.origin,
                sequence_id=job.sequence_id,
            )
            t0 = time.monotonic()
            task = track_background_task(
                self._run_job(job), name=f"sync_job_{job.service}_{job.kind}"
            )
            self._register_task(job, task)
            try:
                await task
            except asyncio.CancelledError:
                # The job was cancelled: by /cancel, or by stop() cancelling
                # this runner (the cancellation reaches the awaited job too).
                pass
            except Exception as e:
                logger.error(
                    "sync_queue",
                    action="job_failed",
                    service=job.service,
                    error_type=type(e).__name__,
                )
            self._running = None
            outcome = self._outcome(job, task)
            logger.info(
                "sync_queue",
                action="finished",
                service=job.service,
                kind=job.kind,
                outcome=outcome,
                elapsed=f"{time.monotonic() - t0:.1f}s",
                sequence_id=job.sequence_id,
            )
            self._record_sequence_outcome(job, outcome)


_coordinator: Optional[SyncCoordinator] = None


def get_coordinator() -> SyncCoordinator:
    """The app-wide coordinator (created on first use)."""
    global _coordinator
    if _coordinator is None:
        _coordinator = SyncCoordinator()
    return _coordinator
