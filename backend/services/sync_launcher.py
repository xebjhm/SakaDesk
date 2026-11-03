"""Shared sync launch used by the HTTP API, the auto-sync scheduler and the tray.

``launch_sync`` is the single place that starts a background sync: it applies
the shutdown guard and the already-running guard, resets the per-service
progress tracker and spawns ``run_sync_task``. The ``POST /api/sync/start``
endpoint maps its result onto HTTP responses; the scheduler and the tray act on
the result directly.
"""

from __future__ import annotations

import asyncio

import structlog

from backend.api.progress import progress_manager
from backend.services.shutdown_state import is_shutting_down

logger = structlog.get_logger(__name__)

LAUNCH_STARTED = "started"
LAUNCH_ALREADY_RUNNING = "already_running"
LAUNCH_SHUTTING_DOWN = "shutting_down"


async def launch_sync(
    service: str,
    *,
    include_inactive: bool = True,
    force_resync: bool = False,
    origin: str,
) -> str:
    """Start a background sync for ``service``.

    Args:
        service: A validated service id.
        include_inactive: Fetch lapsed subscriptions too, so their status flips
            to offline (default True, as for ``POST /api/sync/start``).
        force_resync: Re-fetch everything instead of resuming.
        origin: Who asked: ``"api"``, ``"scheduler"`` or ``"tray"``. Logged only.

    Returns:
        ``"started"``, ``"already_running"`` or ``"shutting_down"``. The result is
        logged as ``sync_launch`` (service, origin, result).
    """
    # Imported lazily: backend.api.sync imports this module.
    from backend.api import sync as sync_api

    result = _launch(sync_api, service, include_inactive, force_resync)
    logger.info("sync_launch", service=service, origin=origin, result=result)
    return result


def _launch(sync_api, service: str, include_inactive: bool, force_resync: bool) -> str:
    # C1c: refuse to spawn a NEW writer once shutdown has begun -- a sync
    # started after this point would still be running (and writing) after
    # quiesce_writers()/data_lock.release(), escaping the barrier entirely.
    if is_shutting_down():
        return LAUNCH_SHUTTING_DOWN

    sync_service = sync_api.get_sync_service(service)
    if sync_service.running:
        return LAUNCH_ALREADY_RUNNING

    progress = progress_manager.get(service)
    progress.reset()
    progress.start_phase("starting", "Starting", 0, 0, "")
    progress.set_detail("Initializing..." + (" (Resyncing)" if force_resync else ""))

    # Register the running task on the service so /cancel can target it with a
    # real task.cancel() (SVC-C1). start_sync also captures this via
    # asyncio.current_task(); assigning here closes the schedule-delay gap so a
    # cancel arriving before the coroutine first runs still finds the task.
    task = asyncio.create_task(
        sync_api.run_sync_task(service, include_inactive, force_resync)
    )
    sync_service._task = task
    return LAUNCH_STARTED
