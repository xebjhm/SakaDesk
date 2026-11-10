"""Shared sync launch used by the HTTP API, the auto-sync scheduler and the tray.

``launch_sync`` is the single place that starts a background sync. Since the
sync coordinator (spec 2026-11-10, S1) it enqueues the sync in
:mod:`backend.services.sync_coordinator`, which runs one job at a time across all
services and applies the shutdown guard and the one-job-per-service dedup. The
``POST /api/sync/start`` endpoint maps the result onto HTTP responses; the
scheduler and the tray act on the result directly.
"""

from __future__ import annotations

import structlog

from backend.services.sync_coordinator import (
    RESULT_ALREADY_QUEUED,
    RESULT_ALREADY_RUNNING,
    RESULT_QUEUED,
    RESULT_SHUTTING_DOWN,
    RESULT_STARTED,
    EnqueueResult,
    get_coordinator,
)

logger = structlog.get_logger(__name__)

LAUNCH_STARTED = RESULT_STARTED
LAUNCH_QUEUED = RESULT_QUEUED
LAUNCH_ALREADY_RUNNING = RESULT_ALREADY_RUNNING
LAUNCH_ALREADY_QUEUED = RESULT_ALREADY_QUEUED
LAUNCH_SHUTTING_DOWN = RESULT_SHUTTING_DOWN

# Results that mean "a sync of this service will run (or runs) because of this call".
LAUNCH_ACCEPTED = frozenset({LAUNCH_STARTED, LAUNCH_QUEUED})


def launch(
    service: str,
    *,
    include_inactive: bool = True,
    force_resync: bool = False,
    origin: str,
) -> EnqueueResult:
    """Enqueue a sync for ``service`` and return the coordinator's result.

    Args:
        service: A validated service id.
        include_inactive: Fetch lapsed subscriptions too, so their status flips
            to offline (default True, as for ``POST /api/sync/start``).
        force_resync: Re-fetch everything instead of resuming.
        origin: Who asked: ``"api"``, ``"scheduler"`` or ``"tray"``. Logged only.

    Returns:
        The :class:`EnqueueResult` (``started``, ``queued`` with its position,
        ``already_running``, ``already_queued`` or ``shutting_down``). Logged as
        ``sync_launch`` (service, origin, result, position).
    """
    result = get_coordinator().enqueue(
        service,
        include_inactive=include_inactive,
        force_resync=force_resync,
        origin=origin,
    )
    logger.info(
        "sync_launch",
        service=service,
        origin=origin,
        result=result.result,
        position=result.position,
    )
    return result


async def launch_sync(
    service: str,
    *,
    include_inactive: bool = True,
    force_resync: bool = False,
    origin: str,
) -> str:
    """:func:`launch`, returning only the result string (scheduler and tray)."""
    return launch(
        service,
        include_inactive=include_inactive,
        force_resync=force_resync,
        origin=origin,
    ).result
