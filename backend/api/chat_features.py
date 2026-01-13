"""
Chat Features API for HakoDesk.

Provides endpoints for:
- Sent letters
- Subscription streak
- (Future: media gallery metadata, calendar dates)
"""

import logging
import aiohttp
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Any

from pyhako import Client, Group
from pyhako.credentials import TokenManager
from backend.services.platform import is_test_mode

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger(__name__)


class Letter(BaseModel):
    id: int
    content: str
    created_at: str
    updated_at: str
    image: Optional[str] = None
    thumbnail: Optional[str] = None


class LettersResponse(BaseModel):
    letters: List[Letter]
    total: int


class StreakResponse(BaseModel):
    days: int
    is_active: bool
    start_date: Optional[str] = None


async def _get_client_and_session():
    """Get pyhako client and aiohttp session with auth."""
    if is_test_mode():
        raise HTTPException(status_code=503, detail="Not available in test mode")

    try:
        tm = TokenManager()
        token_data = tm.load_session(Group.HINATAZAKA46.value)

        if not token_data or not token_data.get('access_token'):
            raise HTTPException(status_code=401, detail="Not authenticated")

        connector = aiohttp.TCPConnector(limit=5)
        session = aiohttp.ClientSession(connector=connector)

        client = Client(
            group=Group.HINATAZAKA46,
            access_token=token_data.get('access_token'),
            refresh_token=token_data.get('refresh_token'),
            cookies=token_data.get('cookies'),
            app_id=token_data.get('x-talk-app-id'),
            user_agent=token_data.get('user-agent'),
        )

        return client, session

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create client: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/letters/{group_id}", response_model=LettersResponse)
async def get_letters(group_id: int, count: int = 200):
    """
    Fetch user's sent letters to a member.

    Uses pyhako.Client.get_letters() to fetch from the official API.
    """
    client, session = await _get_client_and_session()

    try:
        letters_data = await client.get_letters(session, group_id, count=count)

        letters = []
        for letter in letters_data:
            letters.append(Letter(
                id=letter.get('id', 0),
                content=letter.get('content', ''),
                created_at=letter.get('created_at', ''),
                updated_at=letter.get('updated_at', ''),
                image=letter.get('image'),
                thumbnail=letter.get('thumbnail'),
            ))

        return LettersResponse(letters=letters, total=len(letters))

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch letters for group {group_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch letters: {str(e)}")
    finally:
        await session.close()


@router.get("/streak/{group_id}", response_model=StreakResponse)
async def get_streak(group_id: int):
    """
    Fetch subscription streak for a member.

    Uses pyhako.Client.get_subscription_streak() to fetch consecutive days.
    """
    client, session = await _get_client_and_session()

    try:
        streak_data = await client.get_subscription_streak(session, group_id)

        if not streak_data:
            return StreakResponse(days=0, is_active=False)

        return StreakResponse(
            days=streak_data.get('consecutive_day', 0),
            is_active=streak_data.get('is_active', False),
            start_date=streak_data.get('start_date'),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch streak for group {group_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch streak: {str(e)}")
    finally:
        await session.close()
