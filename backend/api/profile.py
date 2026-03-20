"""
Profile API for SakaDesk
Handles user profile information like nickname.
"""
import structlog
import aiohttp
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from pysaka import Client
from pysaka.credentials import get_token_manager

from backend.services.platform import get_session_dir
from backend.services.service_utils import get_service_enum, validate_service
from backend.services.settings_store import (
    load_config as _store_load,
    update_config as _store_update,
)

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/api/profile", tags=["profile"])


class ProfileResponse(BaseModel):
    nickname: Optional[str] = None
    error: Optional[str] = None


@router.get("", response_model=ProfileResponse)
async def get_profile(service: str):
    """
    Get the user's profile (nickname) for a specific service.

    First checks if nickname is cached in settings.
    If not, fetches from the API and caches it.

    Args:
        service: The service to get profile for (e.g., 'hinatazaka46').
    """
    try:
        validate_service(service)
    except ValueError as e:
        return ProfileResponse(error=str(e))

    config = await _store_load()

    # Return cached nickname if available (per-service)
    user_nicknames = config.get("user_nicknames", {})
    cached_nickname = user_nicknames.get(service)
    if cached_nickname:
        return ProfileResponse(nickname=cached_nickname)

    # Fetch from API
    try:
        tm = get_token_manager()
        group = get_service_enum(service)
        session_data = tm.load_session(group.value)

        if not session_data or not session_data.get('access_token'):
            return ProfileResponse(error="Not authenticated")

        client = Client(
            group=group,
            access_token=session_data['access_token'],
            refresh_token=session_data.get('refresh_token'),
            cookies=session_data.get('cookies'),
            auth_dir=str(get_session_dir())
        )

        async with aiohttp.ClientSession() as session:
            profile = await client.get_profile(session)

            # API returns 'name' field, not 'nickname'
            if profile and profile.get('name'):
                nickname = profile['name']
                # Cache in settings (per-service) via atomic update
                def _cache_nickname(cfg: dict) -> None:
                    if "user_nicknames" not in cfg:
                        cfg["user_nicknames"] = {}
                    cfg["user_nicknames"][service] = nickname

                await _store_update(_cache_nickname)
                logger.info(f"Fetched and cached user nickname for {service}: {nickname}")
                return ProfileResponse(nickname=nickname)
            else:
                logger.warning(f"Profile API returned no name for {service}. Response: {profile}")
                return ProfileResponse(error="No name in profile")

    except Exception as e:
        logger.error(f"Failed to fetch profile for {service}: {e}")
        return ProfileResponse(error=str(e))


@router.post("/refresh", response_model=ProfileResponse)
async def refresh_profile(service: str):
    """
    Force refresh the user's profile from the API for a specific service.
    Clears cached nickname and fetches fresh data.

    Args:
        service: The service to refresh profile for (e.g., 'hinatazaka46').
    """
    try:
        validate_service(service)
    except ValueError as e:
        return ProfileResponse(error=str(e))

    # Clear cached nickname for this service via atomic update
    def _clear_nickname(config: dict) -> None:
        user_nicknames = config.get("user_nicknames", {})
        if service in user_nicknames:
            del user_nicknames[service]
            config["user_nicknames"] = user_nicknames

    await _store_update(_clear_nickname)

    # Now fetch fresh
    return await get_profile(service)
