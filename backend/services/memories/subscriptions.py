"""Archive of the earliest subscription start per member group.

Stored at ``<service_data_dir>/memories/subscriptions.json`` as
``{"groups": {"<gid>": {"earliest_start": "YYYY-MM-DD", "last_checked": "YYYY-MM-DD"}}}``.
The API only reports the *current* streak start, so the earliest value ever
seen is kept: a later streak (after a lapse) never moves it forward.
"""

import json
import os
import tempfile
from datetime import date
from pathlib import Path
from typing import Any

import structlog

from pysaka import RefreshFailedError, SessionExpiredError

logger = structlog.get_logger(__name__)

_FILE_NAME = "subscriptions.json"


def _path(service_data_dir: Path) -> Path:
    return service_data_dir / "memories" / _FILE_NAME


def _read_groups(path: Path) -> dict[str, dict[str, str]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        groups = data["groups"]
    except FileNotFoundError:
        return {}
    except (OSError, ValueError, KeyError, TypeError) as e:
        logger.warning("subscription_starts_unreadable", error_type=type(e).__name__)
        return {}
    return groups if isinstance(groups, dict) else {}


def _write_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".subscriptions.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def load_subscription_starts(service_data_dir: Path) -> dict[str, str]:
    """Return ``{group_id: earliest_start}`` for every archived group."""
    out: dict[str, str] = {}
    for gid, entry in _read_groups(_path(service_data_dir)).items():
        start = entry.get("earliest_start") if isinstance(entry, dict) else None
        if isinstance(start, str):
            out[str(gid)] = start
    return out


def _parse_start(streak: Any) -> str | None:
    if not isinstance(streak, dict):
        return None
    raw = streak.get("current_start_at_date")
    if not isinstance(raw, str):
        return None
    try:
        return date.fromisoformat(raw).isoformat()
    except ValueError:
        return None


async def archive_subscription_starts(
    client: Any,
    session: Any,
    group_ids: list[int],
    service_data_dir: Path,
    *,
    today: date,
) -> int:
    """Record the earliest subscription start per group; return groups checked.

    Each group is checked at most once per ``today``. Auth errors propagate;
    any other per-group failure is logged and skipped.
    """
    path = _path(service_data_dir)
    groups = _read_groups(path)
    today_s = today.isoformat()
    checked = updated = skipped = 0

    for gid in group_ids:
        key = str(gid)
        entry = groups.get(key)
        if isinstance(entry, dict) and entry.get("last_checked") == today_s:
            skipped += 1
            continue
        checked += 1
        try:
            streak = await client.get_subscription_streak(session, gid)
        except (SessionExpiredError, RefreshFailedError):
            raise
        except Exception as e:
            logger.warning(
                "subscription_start_failed",
                group_id=gid,
                error_type=type(e).__name__,
            )
            continue
        start = _parse_start(streak)
        if start is None:
            logger.info("subscription_start_missing", group_id=gid)
            continue
        previous = entry.get("earliest_start") if isinstance(entry, dict) else None
        earliest = min(start, previous) if isinstance(previous, str) else start
        if earliest != previous:
            updated += 1
        groups[key] = {"earliest_start": earliest, "last_checked": today_s}

    if skipped:
        logger.info("subscription_start_skipped", reason="checked_today", count=skipped)
    if updated or any(
        isinstance(e, dict) and e.get("last_checked") == today_s
        for e in groups.values()
    ):
        try:
            _write_atomic(path, {"groups": groups})
        except OSError as e:
            logger.warning(
                "subscription_starts_write_failed", error_type=type(e).__name__
            )
            return checked
    logger.info("subscription_starts_archived", checked=checked, updated=updated)
    return checked
