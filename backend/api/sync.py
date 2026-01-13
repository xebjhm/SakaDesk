"""
Sync API endpoints using thread-safe SyncProgress tracker.
"""
import structlog
from fastapi import APIRouter, HTTPException
from pyhako import SessionExpiredError
from backend.services.sync_service import SyncService
from backend.api.progress import progress
import asyncio

logger = structlog.get_logger(__name__)

router = APIRouter()
sync_service = SyncService()


async def run_sync_task(include_inactive: bool, force_resync: bool):
    """Wrapper to run sync in background properly."""
    try:
        await sync_service.start_sync(include_inactive, force_resync)
    except SessionExpiredError:
        # Session expired - set specific error for frontend to detect
        logger.warning("Sync failed: Session expired")
        progress.error("SESSION_EXPIRED")
    except Exception as e:
        logger.error(f"Background sync error: {e}")
        progress.error(str(e))


@router.post("/start")
async def start_sync(include_inactive: bool = False, force_resync: bool = False):
    if sync_service.running:
        raise HTTPException(status_code=400, detail="Sync already running")
    
    # Reset progress tracker
    progress.reset()
    progress.start_phase("starting", "Starting", 0, 0, "")
    progress.set_detail("Initializing..." + (" (Resyncing)" if force_resync else ""))
    
    # Create async task properly
    asyncio.create_task(run_sync_task(include_inactive, force_resync))
    
    return {"status": "started"}


@router.get("/progress")
async def get_progress():
    """Get current sync progress (thread-safe)"""
    return progress.get_status()


@router.get("/check")
async def check_new():
    """Lightweight check for new messages."""
    try:
        new_msgs = await sync_service.check_new_messages()
        return {"new_messages": new_msgs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/older")
async def sync_older(group_id: str, member_id: str, limit: int = 50):
    """Fetch older messages for a specific member."""
    try:
        count = await sync_service.sync_older_messages(group_id, member_id, limit)
        return {"count": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
