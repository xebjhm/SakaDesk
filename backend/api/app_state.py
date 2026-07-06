"""HTTP endpoints exposing the app_state SQLite store to the frontend."""

from typing import Any

from fastapi import APIRouter, Body
from pydantic import BaseModel

from backend.services import app_state

router = APIRouter()


@router.get("/prefs")
async def get_prefs() -> dict[str, Any]:
    return app_state.get_prefs()


@router.patch("/prefs")
async def patch_prefs(patch: dict[str, Any] = Body(...)) -> dict[str, bool]:
    app_state.set_prefs(patch)
    return {"ok": True}


@router.get("/conversation")
async def get_conversation(path: str) -> dict[str, Any]:
    return app_state.get_conversation(path)


@router.patch("/conversation")
async def patch_conversation(
    path: str, patch: dict[str, Any] = Body(...)
) -> dict[str, bool]:
    app_state.set_conversation(path, patch)
    return {"ok": True}


@router.get("/translations")
async def get_translations(keys: str = "") -> dict[str, str]:
    wanted = [k for k in keys.split(",") if k]
    return app_state.get_translations(wanted)


@router.patch("/translations")
async def patch_translations(items: dict[str, Any] = Body(...)) -> dict[str, bool]:
    app_state.put_translations({k: str(v) for k, v in items.items()})
    return {"ok": True}


class MigrateDump(BaseModel):
    prefs: dict[str, Any] = {}
    conversations: dict[str, Any] = {}
    translations: dict[str, str] = {}


@router.get("/migrate")
async def migrate_status() -> dict[str, bool]:
    return {"migrated": app_state.is_migrated()}


@router.post("/migrate")
async def migrate(dump: MigrateDump) -> dict[str, bool]:
    app_state.migrate_dump(dump.model_dump())
    return {"migrated": app_state.is_migrated()}
