"""HTTP endpoints exposing the app_state SQLite store to the frontend."""

from typing import Any

from fastapi import APIRouter, Body
from pydantic import BaseModel

from backend.services import app_state

router = APIRouter()


# Handlers await the a* wrappers so the blocking SQLite work runs off the event
# loop (SD-BE-SVC-10 wiring), rather than stalling every concurrent request.
@router.get("/prefs")
async def get_prefs() -> dict[str, Any]:
    return await app_state.aget_prefs()


@router.patch("/prefs")
async def patch_prefs(patch: dict[str, Any] = Body(...)) -> dict[str, bool]:
    await app_state.aset_prefs(patch)
    return {"ok": True}


@router.get("/conversation")
async def get_conversation(path: str) -> dict[str, Any]:
    return await app_state.aget_conversation(path)


@router.patch("/conversation")
async def patch_conversation(
    path: str, patch: dict[str, Any] = Body(...)
) -> dict[str, bool]:
    await app_state.aset_conversation(path, patch)
    return {"ok": True}


@router.get("/conversation-all")
async def get_all_conversations() -> dict[str, Any]:
    return await app_state.aget_all_conversations()


@router.get("/translations")
async def get_translations(keys: str = "") -> dict[str, str]:
    wanted = [k for k in keys.split(",") if k]
    return await app_state.aget_translations(wanted)


@router.patch("/translations")
async def patch_translations(items: dict[str, Any] = Body(...)) -> dict[str, bool]:
    await app_state.aput_translations({k: str(v) for k, v in items.items()})
    return {"ok": True}


@router.post("/translations/clear")
async def clear_translations() -> dict[str, bool]:
    await app_state.aclear_translations()
    return {"ok": True}


class MigrateDump(BaseModel):
    prefs: dict[str, Any] = {}
    conversations: dict[str, Any] = {}
    translations: dict[str, str] = {}


@router.get("/migrate")
async def migrate_status() -> dict[str, bool]:
    return {"migrated": await app_state.ais_migrated()}


@router.post("/migrate")
async def migrate(dump: MigrateDump) -> dict[str, bool]:
    await app_state.amigrate_dump(dump.model_dump())
    return {"migrated": await app_state.ais_migrated()}
