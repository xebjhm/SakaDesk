"""Search API endpoints for fuzzy message search."""
from fastapi import APIRouter, Query
from backend.services.search_service import get_search_service

router = APIRouter()


@router.get("")
async def search_messages(
    q: str = Query(..., min_length=1, max_length=200, description="Search query"),
    service: str = Query(None, description="Filter by service"),
    group_id: int = Query(None, description="Filter by talk room ID"),
    member_id: int = Query(None, description="Filter by member ID"),
    limit: int = Query(50, ge=1, le=200, description="Max results"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
):
    svc = get_search_service()
    return await svc.search(q, service, group_id, member_id, limit, offset)


@router.get("/status")
async def search_status():
    svc = get_search_service()
    return await svc.get_status()


@router.post("/rebuild")
async def rebuild_index():
    svc = get_search_service()
    await svc.rebuild()
    return {"status": "started"}
