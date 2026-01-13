"""
Chat Features API for HakoDesk.

Provides endpoints for:
- Sent letters
- Subscription streak
- Message dates for calendar
"""

import json
import structlog
import aiohttp
from collections import defaultdict
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict

from pyhako import Client, Group
from pyhako.credentials import TokenManager
from backend.services.platform import is_test_mode, get_settings_path

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = structlog.get_logger(__name__)


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


class DateCount(BaseModel):
    date: str
    count: int


class MessageDatesResponse(BaseModel):
    dates: List[DateCount]
    total_dates: int


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
    return Path("output")


async def _get_client_and_session():
    """Get pyhako client and aiohttp session with auth."""
    if is_test_mode():
        raise HTTPException(status_code=503, detail="Not available in test mode")

    session = None
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
        if session:
            await session.close()
        raise
    except Exception as e:
        if session:
            await session.close()
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

        # Debug: Log first letter to see actual field names
        if letters_data:
            logger.info(f"Letter API response sample: {letters_data[0]}")

        letters = []
        for letter in letters_data:
            # API uses 'text' for content and 'file' for image
            content = letter.get('text') or letter.get('content') or ''
            image = letter.get('file') or letter.get('image')

            letters.append(Letter(
                id=letter.get('id', 0),
                content=content,
                created_at=letter.get('created_at', ''),
                updated_at=letter.get('updated_at', ''),
                image=image,
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

        # Debug: Log actual response to see field names
        logger.info(f"Streak API response: {streak_data}")

        if not streak_data:
            return StreakResponse(days=0, is_active=False)

        # API uses 'current' for consecutive days and 'current_start_at_date' for start date
        days = streak_data.get('current') or streak_data.get('consecutive_day') or 0

        # If current > 0, user is actively subscribed
        is_active = days > 0

        return StreakResponse(
            days=days,
            is_active=is_active,
            start_date=streak_data.get('current_start_at_date') or streak_data.get('start_date'),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch streak for group {group_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch streak: {str(e)}")
    finally:
        await session.close()


@router.get("/message_dates/{member_path:path}", response_model=MessageDatesResponse)
async def get_message_dates(member_path: str):
    """
    Get dates that have messages for calendar highlighting.

    Returns a list of dates with message counts for the given member path.
    """
    output_dir = _get_output_dir()
    full_path = output_dir / member_path

    if not full_path.exists():
        raise HTTPException(status_code=404, detail="Path not found")

    date_counts: Dict[str, int] = defaultdict(int)

    # Check if this is a group path (has subdirectories with messages.json)
    # or a member path (has messages.json directly)
    msg_file = full_path / "messages.json"

    if msg_file.exists():
        # Single member path
        try:
            with open(msg_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for msg in data.get('messages', []):
                    timestamp = msg.get('timestamp', '')
                    if timestamp:
                        # Extract date (YYYY-MM-DD) from ISO timestamp
                        date_str = timestamp[:10]
                        date_counts[date_str] += 1
        except Exception as e:
            logger.error(f"Error reading messages: {e}")
    else:
        # Group path - iterate over member directories
        for member_dir in full_path.iterdir():
            if not member_dir.is_dir():
                continue
            member_msg_file = member_dir / "messages.json"
            if not member_msg_file.exists():
                continue
            try:
                with open(member_msg_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    for msg in data.get('messages', []):
                        timestamp = msg.get('timestamp', '')
                        if timestamp:
                            date_str = timestamp[:10]
                            date_counts[date_str] += 1
            except Exception as e:
                logger.warning(f"Error reading {member_msg_file}: {e}")

    # Convert to sorted list
    dates = [DateCount(date=d, count=c) for d, c in sorted(date_counts.items())]

    return MessageDatesResponse(dates=dates, total_dates=len(dates))
