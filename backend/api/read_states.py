"""Read state API endpoints for tracking message read progress."""
from typing import Any, Dict, List

from fastapi import APIRouter
from pydantic import BaseModel

from backend.services.search_service import get_search_service

router = APIRouter()


class ReadStateEntry(BaseModel):
    service: str
    group_id: int
    member_id: int
    last_read_id: int = 0
    read_count: int = 0
    revealed_ids: List[int] = []


@router.get("")
async def get_all_read_states():
    svc = get_search_service()
    return await svc.get_all_read_states()


@router.put("")
async def upsert_read_state(entry: ReadStateEntry):
    svc = get_search_service()
    await svc.upsert_read_state(
        entry.service, entry.group_id, entry.member_id,
        entry.last_read_id, entry.read_count, entry.revealed_ids,
    )
    return {"status": "ok"}


@router.post("/batch")
async def batch_upsert_read_states(entries: List[ReadStateEntry]):
    svc = get_search_service()
    dicts = [e.model_dump() for e in entries]
    count = await svc.batch_upsert_read_states(dicts)
    return {"status": "ok", "count": count}
