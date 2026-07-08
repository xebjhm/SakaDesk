"""
Favorites API for SakaDesk.

Handles adding/removing messages from server-side favorites.
Also updates local messages.json for instant feedback.

FAVORITE-READ LIMITATION (revisit later):
    The message service exposes only WRITE endpoints for favorites —
    ``POST/DELETE /v2/messages/{id}/favorite`` — and NO list/read endpoint
    (confirmed against the protocol reference). So favorite *state* can only be
    read back through the timeline's per-message ``is_favorite`` field, which
    means reads are coupled to the sync window: a favorite toggled on another
    device for a message that falls outside the re-fetch window won't reflect
    here until a full re-sync. The local messages.json ``is_favorite`` written
    below is an instant-feedback cache, not an independent source of truth.
    TODO: capture the rooted Android app to learn how the official client reads
    favorite state (dedicated endpoint? push? full re-list?) and sync it that
    way instead of piggybacking on the timeline.
"""

import asyncio
import json
import structlog
import aiohttp
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from pysaka import Client
from pysaka.credentials import get_token_manager
from backend.services.platform import (
    get_settings_path,
    get_session_dir,
    is_test_mode,
    get_default_output_dir,
)
from backend.services.service_utils import (
    get_service_enum,
    validate_service,
    get_service_display_name,
    atomic_write_json,
)

router = APIRouter(prefix="/api/favorites", tags=["favorites"])
logger = structlog.get_logger(__name__)


class FavoriteResponse(BaseModel):
    success: bool
    message_id: int
    is_favorite: bool
    error: Optional[str] = None


def _get_output_dir() -> Path:
    """Get configured output directory."""
    settings_path = get_settings_path()
    if settings_path.exists():
        try:
            with open(settings_path, "r", encoding="utf-8") as f:
                settings = json.load(f)
                path_str = settings.get("output_dir")
                if path_str:
                    return Path(path_str)
        except Exception:
            pass
    return get_default_output_dir()


def _update_local_favorite(message_id: int, is_favorite: bool, service: str) -> bool:
    """
    Update is_favorite in this SERVICE's local messages.json files.

    message_id is only unique per (service, message_id): each service is an
    independent deployment with its own id sequence. Scanning every service and
    matching the first bare id could flip the wrong message on a cross-service
    collision (SD-BE-API-05), so we scope the search to this service's directory.

    Writes are atomic (temp file + os.replace) so a crash mid-write cannot corrupt
    the synced archive (SD-BE-API-02). Returns True if found and updated.

    Blocking I/O — call via ``asyncio.to_thread`` from async handlers.
    """
    output_dir = _get_output_dir()

    # Scope to this service's directory only (named by display name, e.g. 日向坂46).
    try:
        messages_dir = output_dir / get_service_display_name(service) / "messages"
    except ValueError:
        logger.warning(f"Unknown service for local favorite update: {service}")
        return False
    if not messages_dir.exists():
        logger.warning(f"Message {message_id} not found: no messages dir for {service}")
        return False

    for group_dir in messages_dir.iterdir():
        if not group_dir.is_dir():
            continue

        for member_dir in group_dir.iterdir():
            if not member_dir.is_dir():
                continue

            msg_file = member_dir / "messages.json"
            if not msg_file.exists():
                continue

            try:
                with open(msg_file, "r", encoding="utf-8") as f:
                    data = json.load(f)

                messages = data.get("messages", [])
                found = False

                for msg in messages:
                    if msg.get("id") == message_id:
                        msg["is_favorite"] = is_favorite
                        found = True
                        break

                if found:
                    atomic_write_json(msg_file, data)
                    logger.info(
                        f"Updated local favorite: service={service}, "
                        f"msg={message_id}, is_favorite={is_favorite}"
                    )
                    return True

            except Exception as e:
                logger.warning(f"Error updating {msg_file}: {e}")
                continue

    logger.warning(f"Message {message_id} not found in {service} local files")
    return False


async def _get_client_and_session(service: str):
    """Get pysaka client and aiohttp session with auth for given service."""
    if is_test_mode():
        raise HTTPException(
            status_code=503, detail="Favorites not available in test mode"
        )

    # Validate service
    try:
        validate_service(service)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    group = get_service_enum(service)

    try:
        tm = get_token_manager()
        token_data = tm.load_session(group.value)

        if not token_data or not token_data.get("access_token"):
            raise HTTPException(status_code=401, detail="Not authenticated")

        connector = aiohttp.TCPConnector(limit=5)
        session = aiohttp.ClientSession(connector=connector)

        client = Client(
            group=group,
            access_token=token_data.get("access_token"),
            refresh_token=token_data.get("refresh_token"),
            cookies=token_data.get("cookies"),
            app_id=token_data.get("x-talk-app-id"),
            user_agent=token_data.get("user-agent"),
            auth_dir=str(get_session_dir()),
        )

        return client, session

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create client: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{message_id}", response_model=FavoriteResponse)
async def add_favorite(message_id: int, service: str):
    """
    Add a message to favorites (server-side).

    Args:
        message_id: The message ID to favorite.
        service: The service ID (e.g., 'hinatazaka46').
    """
    client, session = await _get_client_and_session(service)

    try:
        success = await client.add_favorite(session, message_id)

        if success:
            # Update local cache (blocking FS scan + write offloaded off the loop)
            await asyncio.to_thread(_update_local_favorite, message_id, True, service)
            return FavoriteResponse(
                success=True, message_id=message_id, is_favorite=True
            )
        else:
            return FavoriteResponse(
                success=False,
                message_id=message_id,
                is_favorite=False,
                error="Server returned failure",
            )

    except Exception as e:
        logger.error(f"Failed to add favorite: {e}")
        return FavoriteResponse(
            success=False, message_id=message_id, is_favorite=False, error=str(e)
        )
    finally:
        await session.close()


@router.delete("/{message_id}", response_model=FavoriteResponse)
async def remove_favorite(message_id: int, service: str):
    """
    Remove a message from favorites (server-side).

    Args:
        message_id: The message ID to unfavorite.
        service: The service ID (e.g., 'hinatazaka46').
    """
    client, session = await _get_client_and_session(service)

    try:
        success = await client.remove_favorite(session, message_id)

        if success:
            # Update local cache (blocking FS scan + write offloaded off the loop)
            await asyncio.to_thread(_update_local_favorite, message_id, False, service)
            return FavoriteResponse(
                success=True, message_id=message_id, is_favorite=False
            )
        else:
            return FavoriteResponse(
                success=False,
                message_id=message_id,
                is_favorite=True,
                error="Server returned failure",
            )

    except Exception as e:
        logger.error(f"Failed to remove favorite: {e}")
        return FavoriteResponse(
            success=False, message_id=message_id, is_favorite=True, error=str(e)
        )
    finally:
        await session.close()
