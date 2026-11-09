"""Archive totals for the first-sync toast: GET /api/archive/stats."""

import asyncio
from typing import Optional

import structlog
from fastapi import APIRouter
from pydantic import BaseModel

from backend.api import content
from backend.services.archive_stats import collect_archive_stats, summarize_messages
from backend.services.platform import is_test_mode

router = APIRouter(prefix="/api/archive", tags=["archive"])
logger = structlog.get_logger(__name__)


class ArchiveStatsResponse(BaseModel):
    messages: int
    photos: int
    #: Earliest shown chat message (ISO 8601, UTC as archived); None for an empty archive.
    first_message_at: Optional[str] = None


@router.get("/stats", response_model=ArchiveStatsResponse)
async def get_archive_stats() -> ArchiveStatsResponse:
    """Shown chat messages, the photos among them and the earliest message time.

    In test mode the totals come from the chat fixtures (``backend.fixtures.test_data``), like
    the other archive-reading endpoints, so e2e runs never read a real archive.
    """
    if is_test_mode():
        from backend.fixtures.test_data import TEST_MESSAGES

        fixture = summarize_messages({"messages": TEST_MESSAGES})
        logger.info(
            "archive_stats",
            source="fixture",
            messages=fixture.messages,
            photos=fixture.photos,
        )
        return ArchiveStatsResponse(
            messages=fixture.messages,
            photos=fixture.photos,
            first_message_at=fixture.first_at,
        )

    stats = await asyncio.to_thread(collect_archive_stats, content.get_output_dir())
    logger.info(
        "archive_stats",
        source="archive",
        messages=stats.messages,
        photos=stats.photos,
        files=stats.files,
        skipped=stats.skipped,
    )
    return ArchiveStatsResponse(
        messages=stats.messages,
        photos=stats.photos,
        first_message_at=stats.first_message_at,
    )
