"""Account API: the user's own archived nickname and avatar history.

Reads only the local archive that pysaka (>= 0.4.5) writes under
``<output_dir>/<service folder>/account/``: ``profile.json`` (``name``,
``updated_at``) and ``profile_images/index.json`` (``images[{kind, file, url,
first_seen}]``). The ``url`` there is a signed CDN URL: it is never returned or
logged. Avatars are served through the media route instead.
"""

import asyncio
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pysaka.utils import sanitize_name

from backend.services.archive_urls import (
    MISSING,
    ArchiveReadError,
    archive_file_ok,
    media_url,
    parse_iso,
    read_archive_json,
    resolve_within,
)
from backend.services.service_utils import get_service_display_name

router = APIRouter(prefix="/api/account", tags=["account"])
logger = structlog.get_logger(__name__)

AVATAR_KIND = "thumbnail"


class AccountAvatar(BaseModel):
    url: str
    first_seen: str


class AccountProfileResponse(BaseModel):
    name: Optional[str] = None
    avatars: List[AccountAvatar]


def _canonical_avatar_file(file: str) -> bool:
    """True for exactly ``thumbnail/<sanitized name>``, the only shape pysaka writes."""
    prefix = AVATAR_KIND + "/"
    if not file.startswith(prefix):
        return False
    name = file[len(prefix) :]
    return bool(name) and name not in (".", "..") and sanitize_name(name) == name


def _read_profile(
    output_dir: Path, account_dir: Path, service: str
) -> tuple[str, Optional[str], list[AccountAvatar], int, int]:
    """Returns ``(outcome, name, avatars oldest first, skipped, bad_images)``.

    outcome: ``missing`` (neither file), ``invalid`` (a file exists but cannot
    be read or parsed, is oversized, or resolves outside the output directory;
    whatever the other file holds is still returned), ``found`` or ``empty``.
    Index entries of another kind are ignored; thumbnail entries with a
    non-canonical, missing or unsafe file or an unparseable ``first_seen`` are
    skipped. ``bad_images`` counts the skipped avatars whose file failed the
    containment or filesystem check (a subset of ``skipped``).
    """
    profile_file = account_dir / "profile.json"
    index_file = account_dir / "profile_images" / "index.json"
    invalid = False
    name: Optional[str] = None
    try:
        profile = read_archive_json(output_dir, profile_file)
    except ArchiveReadError:
        profile, invalid = MISSING, True
    try:
        index = read_archive_json(output_dir, index_file)
    except ArchiveReadError:
        index, invalid = MISSING, True
    if profile is MISSING and index is MISSING and not invalid:
        return "missing", None, [], 0, 0
    if profile is not MISSING:
        if not isinstance(profile, dict):
            invalid = True
        else:
            raw_name = profile.get("name")
            name = raw_name if isinstance(raw_name, str) and raw_name else None
    dated: list[tuple[datetime, AccountAvatar]] = []
    skipped = 0
    bad_images = 0
    if index is not MISSING:
        images = index.get("images") if isinstance(index, dict) else None
        if not isinstance(images, list):
            invalid = True
            images = []
        for entry in images:
            if not isinstance(entry, dict):
                skipped += 1
                continue
            if entry.get("kind") != AVATAR_KIND:
                continue
            file, first_seen = entry.get("file"), entry.get("first_seen")
            seen = parse_iso(first_seen)
            if (
                not isinstance(file, str)
                or not _canonical_avatar_file(file)
                or not isinstance(first_seen, str)
                or seen is None
            ):
                skipped += 1
                continue
            try:
                present = archive_file_ok(
                    output_dir, account_dir / "profile_images" / file
                )
            except ArchiveReadError:
                present = False
                bad_images += 1
            if not present:
                skipped += 1
                continue
            url = media_url(service, ["account", "profile_images", *file.split("/")])
            dated.append((seen, AccountAvatar(url=url, first_seen=first_seen)))
    dated.sort(key=lambda pair: pair[0])
    avatars = [avatar for _, avatar in dated]
    if invalid:
        outcome = "invalid"
    elif name or avatars:
        outcome = "found"
    else:
        outcome = "empty"
    return outcome, name, avatars, skipped, bad_images


@router.get("/profile", response_model=AccountProfileResponse)
async def get_account_profile(service: str):
    """The user's nickname and avatar history for one service, from the local archive.

    Logs one ``account_profile`` breadcrumb (outcome and counts, including
    ``bad_images``; never the nickname or any URL). It is a warning for an
    ``invalid`` file or when any avatar image failed the containment or
    filesystem check.
    """
    from backend.api.content import get_output_dir

    try:
        display_name = get_service_display_name(service)
    except ValueError:
        logger.warning("account_profile", outcome="bad_service")
        raise HTTPException(status_code=400, detail="Invalid service")
    output_dir = get_output_dir()
    try:
        account_dir = resolve_within(output_dir, output_dir / display_name / "account")
        outcome, name, avatars, skipped, bad_images = await asyncio.to_thread(
            _read_profile, output_dir, account_dir, service
        )
    except ArchiveReadError:
        outcome, name, avatars, skipped, bad_images = "invalid", None, [], 0, 0
    log = logger.warning if outcome == "invalid" or bad_images > 0 else logger.info
    log(
        "account_profile",
        outcome=outcome,
        service=service,
        avatars=len(avatars),
        skipped=skipped,
        bad_images=bad_images,
        has_name=name is not None,
    )
    return AccountProfileResponse(name=name, avatars=avatars)
