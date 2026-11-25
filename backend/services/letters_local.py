"""The user's sent letters to one member, read from the local archive.

pysaka writes ``<member_dir>/letters.json`` (and ``letters/<id>.<ext>``
images). This is the one reader of that file: the chat's
``GET /api/chat/letters_local`` route and the Memories services both call
:func:`read_local_letters`, so services never import ``backend.api``.
"""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Optional

from pydantic import BaseModel

from backend.services.archive_urls import (
    MISSING,
    ArchiveReadError,
    archive_file_ok,
    media_url,
    parse_iso,
    read_archive_json,
)

# pysaka (>= 0.4.5) writes letter images as letters/<id>.<ext>; nothing else is served.
LETTER_IMAGE_FILE = re.compile(r"letters/[0-9]+\.[A-Za-z0-9]{1,5}")


class LocalLetter(BaseModel):
    id: int
    text: str
    created_at: str
    image_url: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None


def _positive_int(value: object) -> Optional[int]:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return None
    return value


def read_local_letters(
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
