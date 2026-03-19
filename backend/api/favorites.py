"""
Favorites API for SakaDesk.

Handles adding/removing messages from server-side favorites.
Also updates local messages.json for instant feedback.
"""

import json
import structlog
import aiohttp
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from pyzaka import Client
from pyzaka.credentials import get_token_manager
from backend.services.platform import get_settings_path, get_session_dir, is_test_mode, get_default_output_dir
from backend.services.service_utils import get_service_enum, validate_service

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
            with open(settings_path, 'r', encoding='utf-8') as f:
                settings = json.load(f)
                path_str = settings.get("output_dir")
                if path_str:
                    return Path(path_str)
        except Exception:
            pass
    return get_default_output_dir()


def _update_local_favorite(message_id: int, is_favorite: bool) -> bool:
    """
    Update is_favorite in local messages.json files.

    Searches through all member directories to find the message.
    Returns True if found and updated.
    """
    output_dir = _get_output_dir()

    # Search through all service/messages/group/member directories
    for service_dir in output_dir.iterdir():
        if not service_dir.is_dir():
            continue

        messages_dir = service_dir / "messages"
        if not messages_dir.exists():
            continue

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
                    with open(msg_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)

                    messages = data.get('messages', [])
                    found = False

                    for msg in messages:
                        if msg.get('id') == message_id:
                            msg['is_favorite'] = is_favorite
                            found = True
                            break

                    if found:
                        with open(msg_file, 'w', encoding='utf-8') as f:
                            json.dump(data, f, ensure_ascii=False, indent=2)
                        logger.info(f"Updated local favorite: msg={message_id}, is_favorite={is_favorite}")
                        return True

                except Exception as e:
                    logger.warning(f"Error updating {msg_file}: {e}")
                    continue

    logger.warning(f"Message {message_id} not found in local files")
    return False


async def _get_client_and_session(service: str):
    """Get pyzaka client and aiohttp session with auth for given service."""
    if is_test_mode():
        raise HTTPException(status_code=503, detail="Favorites not available in test mode")

    # Validate service
    try:
        validate_service(service)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    group = get_service_enum(service)

    try:
        tm = get_token_manager()
        token_data = tm.load_session(group.value)

        if not token_data or not token_data.get('access_token'):
            raise HTTPException(status_code=401, detail="Not authenticated")

        connector = aiohttp.TCPConnector(limit=5)
        session = aiohttp.ClientSession(connector=connector)

        client = Client(
            group=group,
            access_token=token_data.get('access_token'),
            refresh_token=token_data.get('refresh_token'),
            cookies=token_data.get('cookies'),
            app_id=token_data.get('x-talk-app-id'),
            user_agent=token_data.get('user-agent'),
            auth_dir=str(get_session_dir())
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
            # Update local cache
            _update_local_favorite(message_id, True)
            return FavoriteResponse(
                success=True,
                message_id=message_id,
                is_favorite=True
            )
        else:
            return FavoriteResponse(
                success=False,
                message_id=message_id,
                is_favorite=False,
                error="Server returned failure"
            )

    except Exception as e:
        logger.error(f"Failed to add favorite: {e}")
        return FavoriteResponse(
            success=False,
            message_id=message_id,
            is_favorite=False,
            error=str(e)
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
            # Update local cache
            _update_local_favorite(message_id, False)
            return FavoriteResponse(
                success=True,
                message_id=message_id,
                is_favorite=False
            )
        else:
            return FavoriteResponse(
                success=False,
                message_id=message_id,
                is_favorite=True,
                error="Server returned failure"
            )

    except Exception as e:
        logger.error(f"Failed to remove favorite: {e}")
        return FavoriteResponse(
            success=False,
            message_id=message_id,
            is_favorite=True,
            error=str(e)
        )
    finally:
        await session.close()
