"""
Sync API endpoints using thread-safe SyncProgress tracker.
Supports per-service progress tracking for multi-service sync.
"""

import structlog
from fastapi import APIRouter, HTTPException, Query
from pysaka import RefreshFailedError, SessionExpiredError
from backend.services.sync_service import SyncService
from backend.services.service_utils import validate_service
from backend.services.background_tasks import track_background_task
from backend.services.shutdown_state import is_shutting_down
from backend.api.progress import progress_manager
import asyncio

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
    """Wrapper to run sync in background properly."""
    sync_service = get_sync_service(service)
    progress = progress_manager.get(service)
    try:
        await sync_service.start_sync(include_inactive, force_resync)
    except SessionExpiredError:
        logger.warning(f"Sync failed for {service}: Session expired")
        progress.error("SESSION_EXPIRED")
    except RefreshFailedError:
        logger.error(f"Sync failed for {service}: All refresh attempts failed")
        progress.error("REFRESH_FAILED")
    except Exception as e:
        logger.error(f"Background sync error for {service}: {e}")
        progress.error(str(e))


async def run_verify_task(service: str):
    """Background wrapper for verify-and-fix."""
    sync_service = get_sync_service(service)
    progress = progress_manager.get(service)
    try:
        await sync_service.verify_and_fix_media()
    except SessionExpiredError:
        logger.warning(f"Verify failed for {service}: Session expired")
        progress.error("SESSION_EXPIRED")
    except RefreshFailedError:
        logger.error(f"Verify failed for {service}: All refresh attempts failed")
        progress.error("REFRESH_FAILED")
    except Exception as e:
        logger.error(f"Background verify error for {service}: {e}")
        progress.error(str(e))


@router.post("/start")
async def start_sync(
    service: str = Query(..., description="Service to sync"),
    include_inactive: bool = False,
    force_resync: bool = False,
):
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    # C1c: refuse to spawn a NEW writer once shutdown has begun -- a sync
    # started after this point would still be running (and writing) after
    # quiesce_writers()/data_lock.release(), escaping the barrier entirely.
    if is_shutting_down():
        raise HTTPException(status_code=503, detail="Application is shutting down")

    sync_service = get_sync_service(service)
    if sync_service.running:
        raise HTTPException(
            status_code=400, detail=f"Sync already running for {service}"
        )

    # Get per-service progress tracker
    progress = progress_manager.get(service)
    progress.reset()
    progress.start_phase("starting", "Starting", 0, 0, "")
    progress.set_detail("Initializing..." + (" (Resyncing)" if force_resync else ""))

    # Register the running task on the service so /cancel can target it with a
    # real task.cancel() (SVC-C1). start_sync also captures this via
    # asyncio.current_task(); assigning here closes the schedule-delay gap so a
    # cancel arriving before the coroutine first runs still finds the task.
    task = asyncio.create_task(run_sync_task(service, include_inactive, force_resync))
    sync_service._task = task

    return {"status": "started", "service": service}


@router.post("/verify")
async def verify_media(service: str = Query(..., description="Service to verify")):
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    # C1c: see start_sync -- refuse to spawn a new verify writer once
    # shutdown has begun.
    if is_shutting_down():
        raise HTTPException(status_code=503, detail="Application is shutting down")

    sync_service = get_sync_service(service)
    if sync_service.running:
        raise HTTPException(
            status_code=400, detail=f"Sync/verify already running for {service}"
        )

    progress = progress_manager.get(service)
    progress.reset()
    progress.start_phase("starting", "Starting", 0, 0, "")
    progress.set_detail("Scanning for missing media...")

    # C1b: route through track_background_task (not a bare create_task) so
    # drain_background_tasks() -- and thus the shutdown write barrier --
    # covers this writer.
    # SD-BE-SVC-02: register the tracked task on the service so /cancel can
    # target the running verify with a real task.cancel() (verify now claims
    # the same _task/_generation ownership as start_sync). Assigning here also
    # closes the schedule-delay gap so a cancel arriving before the coroutine
    # first runs still finds the task. This serializes verify against a
    # subsequent start_sync -- exactly one writer per member dir at a time.
    task = track_background_task(run_verify_task(service), name="verify_media")
    sync_service._task = task
    return {"status": "started", "service": service}


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
    service: str = Query(..., description="Service to cancel sync for"),
):
    """Cancel a running sync by cancelling its background task and awaiting unwind.

    This performs a real ``task.cancel()`` and waits for the task to finish
    writing/closing files before returning (SVC-C1), so a subsequent ``/start``
    cannot launch a second concurrent sync over the same output directory.
    """
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    sync_service = get_sync_service(service)
    if not sync_service.running and sync_service._task is None:
        return {"status": "not_running", "service": service}

    # Real cancel + await unwind so the task stops writing before we return.
    await sync_service.cancel()
    progress_manager.get(service).reset()
    logger.warning(f"Sync cancelled for {service} by user request")

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

    from backend.services.adaptive_sync import calculate_next_sync_interval
    from backend.services.settings_store import load_config

    settings = await load_config()
    adaptive = settings["adaptive_sync_enabled"]

    if adaptive:
        interval = calculate_next_sync_interval()
    else:
        # Fixed mode: use user's configured interval directly
        interval = float(settings["sync_interval_minutes"])

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
