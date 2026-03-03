"""Search API endpoints for fuzzy message search."""
from fastapi import APIRouter, Query
from backend.services.search_service import get_search_service

router = APIRouter()


@router.get("")
async def search_messages(
    q: str = Query(..., min_length=1, max_length=200, description="Search query"),
    service: str = Query(None, description="Filter by service (single, for nickname resolution)"),
    group_id: int = Query(None, description="Filter by talk room ID"),
    member_id: int = Query(None, description="Filter by member ID"),
    services: str = Query(None, description="Filter by services (comma-separated, OR logic)"),
    member_ids: str = Query(None, description="Filter by member IDs (comma-separated, OR logic, legacy)"),
    member_filters: str = Query(None, description="Filter by service:member_id pairs (comma-separated, OR logic)"),
    exact_only: bool = Query(False, description="Exact match only - skip pronunciation/reading matching"),
    exclude_unread: bool = Query(False, description="Exclude unread messages (requires read_states)"),
    date_from: str = Query(None, description="Filter messages after this ISO date"),
    date_to: str = Query(None, description="Filter messages before this ISO date"),
    content_type: str = Query("all", description="Content type filter: all, messages, blogs"),
    limit: int = Query(50, ge=1, le=200, description="Max results"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
):
    # Parse comma-separated lists
    services_list = [s.strip() for s in services.split(",") if s.strip()] if services else None
    member_ids_list = [int(m.strip()) for m in member_ids.split(",") if m.strip()] if member_ids else None

    # Parse service:member_id pairs (e.g. "hinatazaka46:58,sakurazaka46:12")
    member_filters_list = None
    if member_filters:
        member_filters_list = []
        for pair in member_filters.split(","):
            pair = pair.strip()
            if ":" in pair:
                svc_id, mid = pair.split(":", 1)
                member_filters_list.append((svc_id.strip(), int(mid.strip())))

    svc = get_search_service()
    return await svc.search(
        q, service, group_id, member_id, limit, offset,
        services=services_list,
        member_ids=member_ids_list,
        member_filters=member_filters_list,
        exact_only=exact_only,
        exclude_unread=exclude_unread,
        date_from=date_from,
        date_to=date_to,
        content_type=content_type,
    )


@router.get("/status")
async def search_status():
    svc = get_search_service()
    return await svc.get_status()


@router.post("/rebuild")
async def rebuild_index():
    svc = get_search_service()
    await svc.rebuild()
    return {"status": "started"}


@router.get("/members")
async def get_members():
    """Get all indexed members and services for filter autocomplete."""
    svc = get_search_service()
    return await svc.get_members()
