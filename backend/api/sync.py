"""
Sync API endpoints using thread-safe SyncProgress tracker.
Supports per-service progress tracking for multi-service sync.
"""
import structlog
from fastapi import APIRouter, HTTPException, Query
from pyhako import SessionExpiredError
from backend.services.sync_service import SyncService
from backend.services.service_utils import validate_service, get_all_services
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
    except Exception as e:
        logger.error(f"Background sync error for {service}: {e}")
        progress.error(str(e))


@router.post("/start")
async def start_sync(
    service: str = Query(..., description="Service to sync"),
    include_inactive: bool = False,
    force_resync: bool = False
):
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    sync_service = get_sync_service(service)
    if sync_service.running:
        raise HTTPException(status_code=400, detail=f"Sync already running for {service}")

    # Get per-service progress tracker
    progress = progress_manager.get(service)
    progress.reset()
    progress.start_phase("starting", "Starting", 0, 0, "")
    progress.set_detail("Initializing..." + (" (Resyncing)" if force_resync else ""))

    asyncio.create_task(run_sync_task(service, include_inactive, force_resync))

    return {"status": "started", "service": service}


@router.get("/progress")
async def get_progress(service: str = Query(None, description="Service to get progress for")):
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
async def cancel_sync(service: str = Query(..., description="Service to cancel sync for")):
    """Cancel a running sync by resetting the running flag.

    Note: This is a force-cancel that resets state. The actual background task
    may still be running but will be ignored. Use sparingly for stuck syncs.
    """
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    sync_service = get_sync_service(service)
    if not sync_service.running:
        return {"status": "not_running", "service": service}

    # Force reset the running flag and progress
    sync_service.running = False
    progress_manager.get(service).reset()
    logger.warning(f"Sync cancelled for {service} by user request")

    return {"status": "cancelled", "service": service}


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
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/older")
async def sync_older(
    service: str = Query(..., description="Service to sync older messages"),
    group_id: str = Query(...),
    member_id: str = Query(...),
    limit: int = 50
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
        raise HTTPException(status_code=500, detail=str(e))
