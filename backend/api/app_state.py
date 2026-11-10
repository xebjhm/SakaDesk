"""HTTP endpoints exposing the app_state SQLite store to the frontend."""

from typing import Any

import structlog
from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel

from backend.services import app_state
from backend.services.tray_tooltip import schedule_refresh_debounced
from backend.services.unread_summary import READ_STATE_KEY_PREFIX

router = APIRouter()
logger = structlog.get_logger(__name__)

MAX_TRANSLATION_KEYS = 100
"""Most distinct cache keys one ``GET /translations`` lookup may request."""


# Handlers await the a* wrappers so the blocking SQLite work runs off the event
# loop (SD-BE-SVC-10 wiring), rather than stalling every concurrent request.
@router.get("/prefs")
async def get_prefs() -> dict[str, Any]:
    """Frontend prefs. Backend-internal ``memories_*`` keys are never returned."""
    prefs = await app_state.aget_prefs()
    return {k: v for k, v in prefs.items() if not app_state.is_internal_pref(k)}


@router.patch("/prefs")
async def patch_prefs(patch: dict[str, Any] = Body(...)) -> dict[str, bool]:
    """Merge ``patch`` into prefs. A patch naming any internal ``memories_*``
    key is refused as a whole (400) and nothing is written."""
    internal = [k for k in patch if app_state.is_internal_pref(k)]
    if internal:
        logger.warning(
            "app_state_internal_prefs_refused", source="patch", count=len(internal)
        )
        raise HTTPException(status_code=400, detail="internal_pref_key")
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
    if path.startswith(READ_STATE_KEY_PREFIX):
        # The sidebar's read state changed; the tray tooltip's unread total is
        # computed from these rows, so refresh it (bursts coalesce).
        schedule_refresh_debounced()
    return {"ok": True}


@router.get("/conversation-all")
async def get_all_conversations() -> dict[str, Any]:
    return await app_state.aget_all_conversations()


@router.get("/translations")
async def get_translations(keys: str = "") -> dict[str, str]:
    """Look up cached translations for a comma-separated list of ``keys``.

    Several keys per call let the UI batch the lookups of all visible bubbles.
    Duplicates and empty entries are ignored; more than
    ``MAX_TRANSLATION_KEYS`` distinct keys answers 422. Unknown keys are simply
    absent from the result.
    """
    wanted = list(dict.fromkeys(k for k in keys.split(",") if k))
    if len(wanted) > MAX_TRANSLATION_KEYS:
        logger.warning(
            "translations_lookup_rejected",
            count=len(wanted),
            max=MAX_TRANSLATION_KEYS,
        )
        raise HTTPException(
            status_code=422,
            detail=f"At most {MAX_TRANSLATION_KEYS} keys per request",
        )
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
