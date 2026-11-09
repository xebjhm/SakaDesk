"""Per-service member birthday cache for Memories.

Stored at ``<service_data_dir>/memories/member_profiles.json`` as
``{"updated_at": iso, "last_attempt_at": iso, "birthdays": {normalized_name: "YYYY-MM-DD"}}``.

- ``updated_at``: the last scrape that returned birthdays. Fresh for 7 days.
- ``last_attempt_at``: the last scrape attempt of any outcome. An empty or
  failed scrape is retried only after 24 h (no scraping on every sync).
- ``birthdays``: merged across scrapes. New values win, and nothing is
  dropped, so a partial scrape never loses members found earlier.
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
_RETRY_INTERVAL = timedelta(hours=24)
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


def _read(path: Path) -> dict[str, Any]:
    """The stored file as a dict; ``{}`` when missing or corrupt."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as e:
        logger.warning("member_profiles_unreadable", error_type=type(e).__name__)
        return {}
    return data if isinstance(data, dict) else {}


def _parse_time(raw: Any) -> datetime | None:
    if not isinstance(raw, str):
        return None
    try:
        ts = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def _within(raw: Any, now: datetime, interval: timedelta) -> bool:
    ts = _parse_time(raw)
    return ts is not None and timedelta(0) <= now - ts < interval


def _birthdays_of(data: dict[str, Any]) -> dict[str, str]:
    raw = data.get("birthdays")
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items()}


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
    """Refresh the birthday cache; return True when new birthdays were stored.

    Skips when the data is fresh (7 days) or the last attempt was under 24 h
    ago (unless ``force``). Every attempt records ``last_attempt_at``; an
    empty or failed scrape keeps the old birthdays and ``updated_at``.
    """
    now = now or datetime.now(timezone.utc)
    path = _profiles_path(service_data_dir)

    if not _is_supported(service):
        logger.info("member_profiles_skipped", service=service, reason="unsupported")
        return False

    old = _read(path)
    if not force and _within(old.get("updated_at"), now, _REFRESH_INTERVAL):
        logger.info("member_profiles_skipped", service=service, reason="fresh")
        return False
    if not force and _within(old.get("last_attempt_at"), now, _RETRY_INTERVAL):
        logger.info("member_profiles_skipped", service=service, reason="backoff")
        return False

    previous = _birthdays_of(old)
    record: dict[str, Any] = {
        "updated_at": old.get("updated_at"),
        "last_attempt_at": now.isoformat(),
        "birthdays": previous,
    }
    raw: dict[str, str] | None = None
    try:
        async with aiohttp.ClientSession() as session:
            raw = await _scraper_for(service, session).get_member_birthdays()
    except Exception as e:  # keep the old birthdays on any failure
        logger.warning(
            "member_profiles_failed", service=service, error_type=type(e).__name__
        )

    stored = False
    kept = 0
    if raw:
        fresh = {normalize_member_name(k): v for k, v in raw.items()}
        record["birthdays"] = {**previous, **fresh}
        record["updated_at"] = now.isoformat()
        kept = len(set(previous) - set(fresh))  # earlier names this scrape missed
        stored = True
    elif raw is not None:
        logger.info("member_profiles_skipped", service=service, reason="empty")

    try:
        _write_atomic(path, record)
    except OSError as e:
        logger.warning(
            "member_profiles_write_failed", service=service, error_type=type(e).__name__
        )
        return False
    if stored:
        logger.info(
            "member_profiles_refreshed",
            service=service,
            count=len(record["birthdays"]),
            scraped=len(raw or {}),
            kept=kept,
        )
    return stored


def load_birthdays(service_data_dir: Path) -> dict[str, str]:
    """Return normalized name -> "YYYY-MM-DD"; ``{}`` when missing or corrupt."""
    path = _profiles_path(service_data_dir)
    if not path.exists():
        logger.debug("member_profiles_missing")
        return {}
    return _birthdays_of(_read(path))
