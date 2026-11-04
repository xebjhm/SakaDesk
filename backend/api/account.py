"""Account API: the user's own archived nickname and avatar history.

Reads only the local archive that pysaka (>= 0.4.5) writes under
``<output_dir>/<service folder>/account/``: ``profile.json`` (``name``,
``updated_at``) and ``profile_images/index.json`` (``images[{kind, file, url,
first_seen}]``). The ``url`` there is a signed CDN URL: it is never returned or
logged. Avatars are served through the media route instead.
"""

import asyncio
import json
from pathlib import Path
from typing import List, Optional

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pysaka.utils import sanitize_name

from backend.services.archive_urls import media_url, parse_iso
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


def _read_json(path: Path) -> tuple[bool, object]:
    """``(ok, data)``; ok is False when the file cannot be read or parsed."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return True, json.load(f)
    except (OSError, ValueError):
        return False, None


def _canonical_avatar_file(file: str) -> bool:
    """True for exactly ``thumbnail/<sanitized name>``, the only shape pysaka writes."""
    prefix = AVATAR_KIND + "/"
    if not file.startswith(prefix):
        return False
    name = file[len(prefix) :]
    return bool(name) and name not in (".", "..") and sanitize_name(name) == name


def _read_profile(
    account_dir: Path, service: str
) -> tuple[str, Optional[str], list[AccountAvatar], int]:
    """Returns ``(outcome, name, avatars oldest first, skipped)``.

    outcome: ``missing`` (neither file), ``invalid`` (a file exists but cannot
    be parsed; whatever the other file holds is still returned), ``found`` or
    ``empty``. Index entries of another kind are ignored; thumbnail entries with
    a non-canonical or missing file or an unparseable ``first_seen`` are skipped.
    """
    profile_file = account_dir / "profile.json"
    index_file = account_dir / "profile_images" / "index.json"
    has_profile, has_index = profile_file.is_file(), index_file.is_file()
    if not has_profile and not has_index:
        return "missing", None, [], 0
    invalid = False
    name: Optional[str] = None
    if has_profile:
        ok, data = _read_json(profile_file)
        if not ok or not isinstance(data, dict):
            invalid = True
        else:
            raw_name = data.get("name")
            name = raw_name if isinstance(raw_name, str) and raw_name else None
    dated = []
    skipped = 0
    if has_index:
        ok, index = _read_json(index_file)
        images = index.get("images") if ok and isinstance(index, dict) else None
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
                or not (account_dir / "profile_images" / file).is_file()
            ):
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
    return outcome, name, avatars, skipped


@router.get("/profile", response_model=AccountProfileResponse)
async def get_account_profile(service: str):
    """The user's nickname and avatar history for one service, from the local archive.

    Logs one ``account_profile`` breadcrumb (outcome and counts; never the
    nickname or any URL).
    """
    from backend.api.content import get_output_dir

    try:
        display_name = get_service_display_name(service)
    except ValueError:
        logger.warning("account_profile", outcome="bad_service")
        raise HTTPException(status_code=400, detail="Invalid service")
    account_dir = get_output_dir() / display_name / "account"
    outcome, name, avatars, skipped = await asyncio.to_thread(
        _read_profile, account_dir, service
    )
    log = logger.warning if outcome == "invalid" else logger.info
    log(
        "account_profile",
        outcome=outcome,
        service=service,
        avatars=len(avatars),
        skipped=skipped,
        has_name=name is not None,
    )
    return AccountProfileResponse(name=name, avatars=avatars)
