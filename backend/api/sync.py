"""
Sync API endpoints using thread-safe SyncProgress tracker.
Supports per-service progress tracking for multi-service sync.
"""

from typing import Optional

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from pysaka import RefreshFailedError, SessionExpiredError
from backend.services import session_alert
from backend.services.sync_service import SyncService
from backend.services.service_utils import validate_service
from backend.services.shutdown_state import is_shutting_down
from backend.services.sync_coordinator import (
    KIND_VERIFY,
    RESULT_ALREADY_RUNNING,
    RESULT_SHUTTING_DOWN,
    get_coordinator,
)
from backend.services.sync_launcher import launch
from backend.services.tray_tooltip import schedule_refresh
from backend.api.progress import progress_manager

logger = structlog.get_logger(__name__)

router = APIRouter()

# Lazy-initialized sync services per service
_sync_services: dict[str, SyncService] = {}


def get_sync_service(service: str) -> SyncService:
    """Get or create SyncService for a service."""
    if service not in _sync_services:
        _sync_services[service] = SyncService(service=service)
    return _sync_services[service]


async def run_sync_task(service: str, include_inactive: bool, force_resync: bool):
    """Run one sync in the background and feed its result to session_alert.

    Only a sync that completed (``start_sync`` returned True) counts: it calls
    ``session_alert.clear_unless_expired`` (resets strikes and cooldown and
    removes a ``refresh_failed`` mark; an ``expired`` mark stays, because pysaka
    reads a persistent 401/403 as "no groups"). A no-op (already running, not
    configured) or a swallowed generic failure logs
    ``sync_session_success_skipped`` instead.
    """
    sync_service = get_sync_service(service)
    progress = progress_manager.get(service)
    try:
        completed = await sync_service.start_sync(include_inactive, force_resync)
        if completed:
            await session_alert.clear_unless_expired(service)
        else:
            logger.info(
                "sync_session_success_skipped", service=service, reason="not_completed"
            )
    except SessionExpiredError:
        logger.warning("sync_failed", service=service, reason="session_expired")
        progress.error("SESSION_EXPIRED")
        await session_alert.report(service, "expired")
    except RefreshFailedError:
        logger.error("sync_failed", service=service, reason="refresh_failed")
        progress.error("REFRESH_FAILED")
        await session_alert.report(service, "refresh_failed")
    except Exception as e:
        logger.error(f"Background sync error for {service}: {e}")
        progress.error(str(e))
    finally:
        # New messages change the tray tooltip's unread total. Scheduled in the
        # background so it never delays (or fails) the sync result.
        if not is_shutting_down():
            schedule_refresh()


async def run_verify_task(service: str):
    """Background wrapper for verify-and-fix."""
    sync_service = get_sync_service(service)
    progress = progress_manager.get(service)
    try:
        await sync_service.verify_and_fix_media()
    except SessionExpiredError:
        logger.warning(f"Verify failed for {service}: Session expired")
        progress.error("SESSION_EXPIRED")
        await session_alert.report(service, "expired")
    except RefreshFailedError:
        logger.error(f"Verify failed for {service}: All refresh attempts failed")
        progress.error("REFRESH_FAILED")
        await session_alert.report(service, "refresh_failed")
    except Exception as e:
        logger.error(f"Background verify error for {service}: {e}")
        progress.error(str(e))


def _enqueue_response(service: str, result, running_detail: str) -> dict:
    """Map a coordinator result onto the HTTP answer of /start and /verify."""
    if result.result == RESULT_SHUTTING_DOWN:
        raise HTTPException(status_code=503, detail="Application is shutting down")
    if result.result == RESULT_ALREADY_RUNNING:
        # 400 + "already running": the frontend attaches its poller to the run.
        raise HTTPException(status_code=400, detail=running_detail)
    return {"status": result.result, "service": service, "position": result.position}


@router.post("/start")
async def start_sync(
    service: str = Query(..., description="Service to sync"),
    # Default True: lapsed subscriptions must still be fetched so their status
    # flips to offline; a False default left them "online" forever.
    include_inactive: bool = True,
    force_resync: bool = False,
):
    """Enqueue a sync (spec 2026-11-10 S1): ``status`` is ``started``, ``queued``
    (with ``position``) or ``already_queued``; a running one answers 400."""
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    result = launch(
        service,
        include_inactive=include_inactive,
        force_resync=force_resync,
        origin="api",
    )
    return _enqueue_response(service, result, f"Sync already running for {service}")


@router.post("/verify")
async def verify_media(service: str = Query(..., description="Service to verify")):
    """Enqueue Verify & Fix. It waits behind a running sync (user decision,
    2026-11-10) instead of being refused."""
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    # C1c: the coordinator refuses new writers once shutdown has begun. The job
    # runs as a tracked task (C1b) registered on the SyncService, so /cancel and
    # the shutdown barrier reach it (SD-BE-SVC-02).
    result = get_coordinator().enqueue(service, kind=KIND_VERIFY, origin="api")
    return _enqueue_response(
        service, result, f"Sync/verify already running for {service}"
    )


class StartAllRequest(BaseModel):
    services: list[str]
    blocking: bool = False


@router.post("/start-all")
async def start_all(body: StartAllRequest):
    """Enqueue several services as one sequence, in the fixed service order
    (乃木坂46, 櫻坂46, 日向坂46, Yodel). Returns ``{sequence_id, results}``."""
    if not body.services:
        raise HTTPException(status_code=400, detail="No services given")
    for service in body.services:
        try:
            validate_service(service)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid service: {service}")
    if is_shutting_down():
        raise HTTPException(status_code=503, detail="Application is shutting down")
    return get_coordinator().start_sequence(
        body.services, blocking=body.blocking, origin="api"
    )


@router.get("/queue")
async def get_queue():
    """The sync queue: ``running``, ``queued`` and the current/last ``sequence``."""
    return get_coordinator().snapshot()


@router.get("/progress")
async def get_progress(
    service: str = Query(None, description="Service to get progress for"),
):
    """Get sync progress. If service is provided, returns that service's progress.
    Otherwise returns progress for all services."""
    if service:
        try:
            validate_service(service)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid service: {service}")
        return progress_manager.get(service).get_status()

    # Return all services' progress
    return {"services": progress_manager.get_all_status()}


@router.post("/cancel")
async def cancel_sync(
    service: Optional[str] = Query(None, description="Service to cancel"),
    sequence: Optional[str] = Query(None, description="Sequence id to cancel"),
):
    """Cancel a service's job (running or queued) or a whole sequence.

    A running job gets a real ``task.cancel()`` and is awaited until it stops
    writing (SVC-C1), so a later ``/start`` cannot overlap it. ``sequence``
    drops that sequence's queued jobs and cancels its running one; jobs of other
    origins stay queued.
    """
    coordinator = get_coordinator()
    if sequence is not None:
        outcome = await coordinator.cancel_sequence(sequence)
        logger.warning("sync_cancel_requested", target="sequence", outcome=outcome)
        return {"status": outcome, "sequence": sequence}
    if service is None:
        raise HTTPException(status_code=422, detail="service or sequence is required")
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    outcome = await coordinator.cancel_service(service)
    if outcome == "not_running":
        return {"status": "not_running", "service": service}
    progress_manager.get(service).reset()
    logger.warning("sync_cancel_requested", target="service", service=service)
    return {"status": "cancelled", "service": service}


@router.get("/next_interval")
async def get_next_interval(
    service: str = Query(..., description="Service to calculate interval for"),
):
    """Get the next adaptive sync interval in minutes.

    Uses time-of-day and activity patterns to return a smart interval.
    Falls back to the configured fixed interval when adaptive sync is off.
    """
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    from backend.services.adaptive_sync import next_interval_minutes
    from backend.services.settings_store import load_config

    settings = await load_config()
    interval = next_interval_minutes(settings)

    return {"interval_minutes": round(interval, 1)}


@router.get("/check")
async def check_new(service: str = Query(..., description="Service to check")):
    """Lightweight check for new messages."""
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    try:
        sync_service = get_sync_service(service)
        new_msgs = await sync_service.check_new_messages()
        return {"new_messages": new_msgs}
    except Exception as e:
        logger.error("Failed to check for new messages", service=service, error=str(e))
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.post("/older")
async def sync_older(
    service: str = Query(..., description="Service to sync older messages"),
    group_id: str = Query(...),
    member_id: str = Query(...),
    limit: int = 50,
):
    """Fetch older messages for a specific member."""
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    try:
        sync_service = get_sync_service(service)
        count = await sync_service.sync_older_messages(group_id, member_id, limit)
        return {"count": count}
    except Exception as e:
        logger.error(
            "Failed to sync older messages",
            service=service,
            group_id=group_id,
            member_id=member_id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail="An internal error occurred")
