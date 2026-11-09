"""Archive totals (messages, photos, first message time) for the first-sync toast.

Counts the chat messages the app shows (``message_visibility``), the photos
among them (``type == "picture"``) and the earliest message time, over every
member's ``messages.json`` under the output folder::

    output_dir/{service}/messages/{group_id} {group}/{member_id} {member}/messages.json

Group chats keep one file per member, so each member's posts count once.
Blogs are not counted. Per-file totals are cached on the file's stat key
(``messages_cache.StatCache``), so a repeat request re-reads only files a sync
changed. Timestamps are compared as strings: the archive writes them in one
UTC ISO 8601 format. Logs carry counts and error types only: paths contain
member names.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import structlog

from backend.services.message_visibility import is_hidden_message
from backend.services.messages_cache import StatCache

logger = structlog.get_logger(__name__)

#: Every member's message file, relative to the output folder.
MESSAGE_FILES = "*/messages/*/*/messages.json"


@dataclass(frozen=True)
class FileStats:
    """Totals of one ``messages.json``."""

    messages: int
    photos: int
    first_at: Optional[str]


@dataclass(frozen=True)
class ArchiveStats:
    """Totals of the whole archive, plus how many files were read and skipped."""

    messages: int
    photos: int
    first_message_at: Optional[str]
    files: int
    skipped: int


def summarize_messages(data: Any) -> FileStats:
    """Totals of one parsed file; rows that are not dicts and hidden messages are not counted."""
    rows = data.get("messages") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return FileStats(0, 0, None)
    messages = 0
    photos = 0
    first: Optional[str] = None
    for row in rows:
        if not isinstance(row, dict) or is_hidden_message(row):
            continue
        messages += 1
        if row.get("type") == "picture":
            photos += 1
        timestamp = row.get("timestamp")
        if (
            isinstance(timestamp, str)
            and timestamp
            and (first is None or timestamp < first)
        ):
            first = timestamp
    return FileStats(messages, photos, first)


_CACHE = StatCache()


def collect_archive_stats(output_dir: Path) -> ArchiveStats:
    """Walk the output folder (blocking: call through ``asyncio.to_thread``)."""
    if not output_dir.is_dir():
        logger.info("archive_stats_skipped", reason="no_output_dir")
        return ArchiveStats(0, 0, None, 0, 0)
    messages = photos = files = skipped = 0
    first: Optional[str] = None
    for path in sorted(output_dir.glob(MESSAGE_FILES)):
        try:
            stats = _CACHE.get(path, summarize_messages)
        except (
            OSError,
            ValueError,
        ) as err:  # unreadable or not JSON (JSONDecodeError is a ValueError)
            skipped += 1
            logger.warning("archive_stats_file_skipped", error_type=type(err).__name__)
            continue
        files += 1
        messages += stats.messages
        photos += stats.photos
        if stats.first_at and (first is None or stats.first_at < first):
            first = stats.first_at
    return ArchiveStats(messages, photos, first, files, skipped)
