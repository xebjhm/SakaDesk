"""
Chat Features API for SakaDesk.

Provides endpoints for:
- Sent letters (live API and local archive)
- Subscription streak
- Message dates for calendar
"""

import asyncio
import json
import re
import structlog
import aiohttp
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Dict

from pysaka import Client
from pysaka.credentials import get_token_manager
from backend.services.platform import (
    is_test_mode,
    get_settings_path,
    get_session_dir,
    get_default_output_dir,
)
from backend.services.service_utils import (
    get_service_display_name,
    get_service_enum,
    validate_service,
)
from backend.services.archive_urls import (
    MISSING,
    ArchiveReadError,
    archive_file_ok,
    media_url,
    parse_iso,
    read_archive_json,
)

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


# pysaka (>= 0.4.5) writes letter images as letters/<id>.<ext>; nothing else is served.
LETTER_IMAGE_FILE = re.compile(r"letters/[0-9]+\.[A-Za-z0-9]{1,5}")


class LocalLetter(BaseModel):
    id: int
    text: str
    created_at: str
    image_url: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None


class LocalLettersResponse(BaseModel):
    letters: List[LocalLetter]


def _positive_int(value: object) -> Optional[int]:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return None
    return value


def _read_local_letters(
    output_dir: Path, member_dir: Path, service: str, member_parts: list[str]
) -> tuple[str, list[LocalLetter], int, int]:
    """Read ``<member_dir>/letters.json``.

    Returns ``(outcome, letters, skipped, bad_images)``: outcome is ``missing``
    (no file), ``invalid`` (unreadable, oversized, outside the output directory
    or not ``{"letters": [...]}``), ``empty`` or ``found``. Entries without an
    integer id or a parseable ``created_at`` are skipped and counted.
    ``image_url`` is set only for a canonical ``letters/<id>.<ext>`` file that
    exists inside the output directory; images that fail the containment or
    filesystem check are counted in ``bad_images``. Letters come back oldest
    first.
    """
    try:
        data = read_archive_json(output_dir, member_dir / "letters.json")
    except ArchiveReadError:
        return "invalid", [], 0, 0
    if data is MISSING:
        return "missing", [], 0, 0
    raw = data.get("letters") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return "invalid", [], 0, 0
    bad_images = 0
    dated: list[tuple[datetime, LocalLetter]] = []
    skipped = 0
    for entry in raw:
        if not isinstance(entry, dict):
            skipped += 1
            continue
        letter_id = entry.get("id")
        created_at = entry.get("created_at")
        created = parse_iso(created_at)
        if (
            isinstance(letter_id, bool)
            or not isinstance(letter_id, int)
            or not isinstance(created_at, str)
            or created is None
        ):
            skipped += 1
            continue
        image_file = entry.get("image_file")
        image_url = None
        if isinstance(image_file, str) and LETTER_IMAGE_FILE.fullmatch(image_file):
            try:
                if archive_file_ok(output_dir, member_dir / image_file):
                    image_url = media_url(
                        service, [*member_parts, *image_file.split("/")]
                    )
            except ArchiveReadError:
                bad_images += 1
        text = entry.get("text")
        dated.append(
            (
                created,
                LocalLetter(
                    id=letter_id,
                    text=text if isinstance(text, str) else "",
                    created_at=created_at,
                    image_url=image_url,
                    width=_positive_int(entry.get("width")),
                    height=_positive_int(entry.get("height")),
                ),
            )
        )
    dated.sort(key=lambda pair: pair[0])
    letters = [letter for _, letter in dated]
    return ("found" if letters else "empty"), letters, skipped, bad_images


def _local_date(timestamp: str) -> Optional[str]:
    """Bucket an ISO message timestamp by LOCAL calendar date (YYYY-MM-DD).

    SD-FE-CORE-02 (Theme C): message bubbles render local time
    (``new Date(ts).getFullYear()/getMonth()/getDate()``), and the calendar
    aligns its dots/jumps to that same local date. The stored timestamps are UTC
    (``...Z``), so bucketing by the raw ``timestamp[:10]`` prefix put dots on the
    wrong day near midnight for any user not on UTC. Convert to the machine's
    local timezone (same zone as the webview) before slicing the date.

    Falls back to the raw ``YYYY-MM-DD`` prefix if the timestamp can't be parsed,
    so a malformed value still buckets somewhere rather than being dropped.
    """
    if not timestamp:
        return None
    try:
        # ``fromisoformat`` accepts "+00:00" in all supported versions; normalize
        # a trailing "Z" for the same behavior on 3.10.
        normalized = timestamp.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is not None:
            # astimezone() with no argument converts to the local timezone.
            dt = dt.astimezone()
        return dt.strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        return timestamp[:10] or None


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


async def _get_client_and_session(service: str):
    """Get pysaka client and aiohttp session with auth for given service."""
    if is_test_mode():
        raise HTTPException(status_code=503, detail="Not available in test mode")

    # Validate service
    try:
        validate_service(service)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    group = get_service_enum(service)
    session = None
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
        if session:
            await session.close()
        raise
    except Exception as e:
        if session:
            await session.close()
        logger.error(f"Failed to create client: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/letters/{group_id}", response_model=LettersResponse)
async def get_letters(group_id: int, service: str, count: int = 200):
    """
    Fetch user's sent letters to a member.

    Uses pysaka.Client.get_letters() to fetch from the official API.

    Args:
        group_id: The member's group ID.
        service: The service ID (e.g., 'hinatazaka46').
        count: Maximum number of letters to fetch.
    """
    client, session = await _get_client_and_session(service)

    try:
        letters_data = await client.get_letters(session, group_id, count=count)

        if letters_data:
            # Log shape only: values hold letter text, signed URLs and tokens.
            logger.debug(
                "letters_api_response",
                count=len(letters_data),
                first_item_keys=(
                    sorted(letters_data[0]) if isinstance(letters_data[0], dict) else []
                ),
            )

        letters = []
        for letter in letters_data:
            # API uses 'text' for content and 'file' for image
            content = letter.get("text") or letter.get("content") or ""
            image = letter.get("file") or letter.get("image")

            letters.append(
                Letter(
                    id=letter.get("id", 0),
                    content=content,
                    created_at=letter.get("created_at", ""),
                    updated_at=letter.get("updated_at", ""),
                    image=image,
                    thumbnail=letter.get("thumbnail"),
                )
            )

        return LettersResponse(letters=letters, total=len(letters))

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch letters for group {group_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch letters: {str(e)}"
        )
    finally:
        await session.close()


@router.get("/letters_local", response_model=LocalLettersResponse)
async def get_letters_local(service: str, path: str):
    """The user's sent letters to one member, from the local archive only.

    ``path`` is the member directory relative to the output directory (as in
    ``/api/content/messages_by_path``) and must lie inside this service's
    folder. A missing or unreadable ``letters.json`` gives an empty list. A
    path that escapes the output directory, or that cannot be resolved (a
    symlink loop or another filesystem error), is rejected with 403.
    Logs one ``letters_local`` breadcrumb per request: outcome and counts,
    never letter text, names or paths. It is a warning for an ``invalid`` file
    or when any letter image failed the containment or filesystem check.
    """
    from backend.api.content import get_output_dir, validate_path_within_dir

    try:
        display_name = get_service_display_name(service)
    except ValueError:
        logger.warning("letters_local", outcome="bad_service")
        raise HTTPException(status_code=400, detail="Invalid service")
    output_dir = get_output_dir()
    try:
        member_dir = validate_path_within_dir(output_dir, path)
    except HTTPException as e:
        logger.warning(
            "letters_local", outcome="rejected", service=service, status=e.status_code
        )
        raise
    except (RuntimeError, OSError):
        # A symlink loop or filesystem error while resolving: the error text
        # carries the path, so it is dropped and only the status is logged.
        logger.warning("letters_local", outcome="rejected", service=service, status=403)
        raise HTTPException(status_code=403, detail="Access denied") from None
    try:
        parts = list(member_dir.relative_to(output_dir.resolve()).parts)
    except ValueError:
        parts = []
    if not parts or parts[0] != display_name:
        logger.warning("letters_local", outcome="wrong_service", service=service)
        raise HTTPException(status_code=400, detail="Path is not in this service")
    outcome, letters, skipped, bad_images = await asyncio.to_thread(
        _read_local_letters, output_dir, member_dir, service, parts[1:]
    )
    log = logger.warning if outcome == "invalid" or bad_images > 0 else logger.info
    log(
        "letters_local",
        outcome=outcome,
        service=service,
        count=len(letters),
        skipped=skipped,
        bad_images=bad_images,
    )
    return LocalLettersResponse(letters=letters)


@router.get("/streak/{group_id}", response_model=StreakResponse)
async def get_streak(group_id: int, service: str):
    """
    Fetch subscription streak for a member.

    Uses pysaka.Client.get_subscription_streak() to fetch consecutive days.

    Args:
        group_id: The member's group ID.
        service: The service ID (e.g., 'hinatazaka46').
    """
    client, session = await _get_client_and_session(service)

    try:
        streak_data = await client.get_subscription_streak(session, group_id)

        logger.debug(f"Streak API response: {streak_data}")

        if not streak_data:
            return StreakResponse(days=0, is_active=False)

        # API uses 'current' for consecutive days and 'current_start_at_date' for start date
        days = streak_data.get("current") or streak_data.get("consecutive_day") or 0

        # If current > 0, user is actively subscribed
        is_active = days > 0

        return StreakResponse(
            days=days,
            is_active=is_active,
            start_date=streak_data.get("current_start_at_date")
            or streak_data.get("start_date"),
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
    from backend.api.content import validate_path_within_dir

    output_dir = _get_output_dir()
    # API-I2: reject path traversal before touching disk (parallels the
    # content.py endpoints), else ../ escapes read a messages.json anywhere.
    full_path = validate_path_within_dir(output_dir, member_path)

    if not full_path.exists():
        raise HTTPException(status_code=404, detail="Path not found")

    date_counts: Dict[str, int] = defaultdict(int)

    # Check if this is a group path (has subdirectories with messages.json)
    # or a member path (has messages.json directly)
    msg_file = full_path / "messages.json"

    if msg_file.exists():
        # Single member path
        try:
            with open(msg_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                for msg in data.get("messages", []):
                    # Bucket by LOCAL date to match the message bubbles / calendar
                    # (SD-FE-CORE-02), not the raw UTC prefix.
                    date_str = _local_date(msg.get("timestamp", ""))
                    if date_str:
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
                with open(member_msg_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for msg in data.get("messages", []):
                        date_str = _local_date(msg.get("timestamp", ""))
                        if date_str:
                            date_counts[date_str] += 1
            except Exception as e:
                logger.warning(f"Error reading {member_msg_file}: {e}")

    # Convert to sorted list
    dates = [DateCount(date=d, count=c) for d, c in sorted(date_counts.items())]

    return MessageDatesResponse(dates=dates, total_dates=len(dates))


class MarkRoomReadRemoteRequest(BaseModel):
    service: str
    group_id: int = Field(gt=0)


@router.post("/mark-room-read-remote")
async def mark_room_read_remote(req: MarkRoomReadRemoteRequest):
    """Clear a room's unread on the OFFICIAL mobile app — opt-in 'sync read to phone'.

    Fire-and-forget: a no-op unless the ``sync_read_to_phone`` setting is on, and
    any error is swallowed so it never blocks opening a conversation. Triggered
    only when the user opens a room (background sync never calls this).
    """
    from backend.services.settings_store import load_config

    # Test mode must never fire a live mutation against the official app.
    if is_test_mode():
        return {"ok": True, "skipped": True}

    config = await load_config()
    if not config.get("sync_read_to_phone"):
        return {"ok": True, "skipped": True}

    # Resolve the service up front so a bad id surfaces as a 400 rather than being
    # swallowed into a success-shaped {"ok": false} by the catch-all below.
    try:
        group = get_service_enum(req.service)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        token_data = get_token_manager().load_session(group.value)
        if not token_data or not token_data.get("access_token"):
            # Breadcrumb: the most common silent failure (opted into phone sync
            # but the session is missing/expired). The service rail's disconnect
            # badge is the user-facing surface for this; the log aids diagnostics.
            logger.warning(
                "mark_room_read_remote skipped: no valid session",
                service=req.service,
                group_id=req.group_id,
            )
            return {"ok": False}

        client = Client(
            group=group,
            access_token=token_data["access_token"],
            cookies=token_data.get("cookies"),
            auth_dir=str(get_session_dir()),
        )
        async with aiohttp.ClientSession() as session:
            ok = await client.mark_group_read(session, req.group_id)
        logger.info(
            "Marked room read on official app",
            service=req.service,
            group_id=req.group_id,
            ok=ok,
        )
        return {"ok": ok}
    except Exception as e:
        logger.warning(
            "mark_room_read_remote failed",
            service=req.service,
            group_id=req.group_id,
            error=str(e),
        )
        return {"ok": False}
