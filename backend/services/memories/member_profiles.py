"""Per-service member birthday cache for Memories.

Stored at ``<service_data_dir>/memories/member_profiles.json`` as
``{"updated_at": iso, "birthdays": {normalized_name: "YYYY-MM-DD"}}``.
"""

import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import aiohttp
import structlog

from pysaka import Group
from pysaka.blog import get_scraper

from backend.services.memories.names import normalize_member_name
from backend.services.service_utils import get_service_enum

logger = structlog.get_logger(__name__)

_FILE_NAME = "member_profiles.json"
_REFRESH_INTERVAL = timedelta(days=7)
_SUPPORTED = (Group.HINATAZAKA46, Group.SAKURAZAKA46, Group.NOGIZAKA46)


def _is_supported(service: str) -> bool:
    """Single source of truth: does ``service`` have a pysaka blog scraper?"""
    try:
        return get_service_enum(service) in _SUPPORTED
    except ValueError:
        return False


def _scraper_for(service: str, session: aiohttp.ClientSession) -> Any:
    """Return the pysaka blog scraper for a supported ``service``."""
    return get_scraper(get_service_enum(service), session)


def _profiles_path(service_data_dir: Path) -> Path:
    return service_data_dir / "memories" / _FILE_NAME


def _is_fresh(path: Path, now: datetime) -> bool:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        updated = datetime.fromisoformat(data["updated_at"])
        if updated.tzinfo is None:
            updated = updated.replace(tzinfo=timezone.utc)
    except (OSError, ValueError, KeyError, TypeError):
        return False
    return timedelta(0) <= now - updated < _REFRESH_INTERVAL


def _write_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(
        dir=path.parent, prefix=".member_profiles.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


async def refresh_member_profiles(
    service: str,
    service_data_dir: Path,
    *,
    now: datetime | None = None,
    force: bool = False,
) -> bool:
    """Refresh the birthday cache; return True when the file was written."""
    now = now or datetime.now(timezone.utc)
    path = _profiles_path(service_data_dir)

    if not _is_supported(service):
        logger.info("member_profiles_skipped", service=service, reason="unsupported")
        return False

    if not force and _is_fresh(path, now):
        logger.info("member_profiles_skipped", service=service, reason="fresh")
        return False

    try:
        async with aiohttp.ClientSession() as session:
            raw = await _scraper_for(service, session).get_member_birthdays()
        if not raw:
            # Keep the old file and leave it stale so the next sync retries.
            logger.info("member_profiles_skipped", service=service, reason="empty")
            return False
        birthdays = {normalize_member_name(k): v for k, v in raw.items()}
        _write_atomic(path, {"updated_at": now.isoformat(), "birthdays": birthdays})
    except Exception as e:  # keep the old file on any failure
        logger.warning(
            "member_profiles_failed", service=service, error_type=type(e).__name__
        )
        return False

    logger.info("member_profiles_refreshed", service=service, count=len(birthdays))
    return True


def load_birthdays(service_data_dir: Path) -> dict[str, str]:
    """Return normalized name -> "YYYY-MM-DD"; ``{}`` when missing or corrupt."""
    path = _profiles_path(service_data_dir)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        birthdays = data["birthdays"]
        return {str(k): str(v) for k, v in birthdays.items()}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        logger.warning("member_profiles_unreadable")
        return {}
