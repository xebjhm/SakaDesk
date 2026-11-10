"""The fan's own Memories state in ``app_state.db`` (never in the archive).

The only module that touches ``memories_capsule_notes``,
``memories_cover_overrides`` and ``memories_gacha_pulls`` (created by
``app_state`` migration step 1), plus the ``memories_gacha_salt`` pref.

- Functions here are blocking; async callers use the ``a*`` wrappers, which
  hop to a worker thread via ``asyncio.to_thread``.
- Times are stored as UTC ISO strings and returned as aware UTC datetimes.
  ``now`` arguments must be aware.
- Every write logs ``memories_user_store`` with ``op`` and ids / counts only.
  Note bodies, paths, rooms, scopes and the salt are never logged.
- A ``sqlite3.Error`` is logged (``outcome=error``, ``error_type``) and
  re-raised: user data is never silently dropped.
"""

from __future__ import annotations

import asyncio
import calendar
import json
import re
import secrets
import sqlite3
from collections.abc import Iterator, Sequence
from contextlib import closing, contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timezone

import structlog

from backend.services import app_state
from backend.services.memories.selection import JST

logger = structlog.get_logger(__name__)

SALT_PREF = "memories_gacha_salt"
_SALT_RE = re.compile(r"^[0-9a-f]{16}$")
_MONTH_DAY_RE = re.compile(r"^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")
_EVENT = "memories_user_store"
HISTORY_MAX = 200


@dataclass(frozen=True)
class CapsuleNote:
    id: int
    service: str
    anchor_kind: str
    anchor_date: date
    member_path: str | None
    card_key: str | None
    body: str
    created_at: datetime  # aware UTC
    updated_at: datetime  # aware UTC


@dataclass(frozen=True)
class GachaPull:
    service: str
    jst_date: date
    pull_index: int
    room: str
    message_id: int
    rarity: str
    reason: str
    pulled_at: datetime  # aware UTC


# ----------------------------------------------------------------- helpers


@contextmanager
def _db(op: str) -> Iterator[sqlite3.Connection]:
    """One connection + transaction; logs and re-raises ``sqlite3.Error``."""
    try:
        with closing(app_state.connect()) as c, c:
            yield c
    except sqlite3.Error as exc:
        logger.error(_EVENT, op=op, outcome="error", error_type=type(exc).__name__)
        raise


def _utc_iso(now: datetime) -> str:
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must be timezone-aware")
    return now.astimezone(timezone.utc).isoformat()


def _from_iso(s: str) -> datetime:
    return datetime.fromisoformat(s).astimezone(timezone.utc)


_NOTE_COLS = (
    "id, service, anchor_kind, anchor_date, member_path, card_key, body, "
    "created_at, updated_at"
)
_PULL_COLS = (
    "service, jst_date, pull_index, room, message_id, rarity, reason, pulled_at"
)


def _note(row: tuple) -> CapsuleNote:
    return CapsuleNote(
        id=row[0],
        service=row[1],
        anchor_kind=row[2],
        anchor_date=date.fromisoformat(row[3]),
        member_path=row[4],
        card_key=row[5],
        body=row[6],
        created_at=_from_iso(row[7]),
        updated_at=_from_iso(row[8]),
    )


def _pull(row: tuple) -> GachaPull:
    return GachaPull(
        service=row[0],
        jst_date=date.fromisoformat(row[1]),
        pull_index=row[2],
        room=row[3],
        message_id=row[4],
        rarity=row[5],
        reason=row[6],
        pulled_at=_from_iso(row[7]),
    )


# ----------------------------------------------------------------- notes


def add_note(
    service: str,
    *,
    anchor_kind: str,
    anchor_date: date,
    member_path: str | None = None,
    card_key: str | None = None,
    body: str,
    now: datetime,
) -> CapsuleNote:
    """Insert a capsule note. Validation of ``body`` belongs to the caller."""
    ts = _utc_iso(now)
    with _db("note_add") as c:
        cur = c.execute(
            "INSERT INTO memories_capsule_notes(service, anchor_kind, anchor_date, "
            "member_path, card_key, body, created_at, updated_at) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (
                service,
                anchor_kind,
                anchor_date.isoformat(),
                member_path,
                card_key,
                body,
                ts,
                ts,
            ),
        )
        note_id = int(cur.lastrowid or 0)
    logger.info(
        _EVENT, op="note_add", service=service, note_id=note_id, chars=len(body)
    )
    return CapsuleNote(
        id=note_id,
        service=service,
        anchor_kind=anchor_kind,
        anchor_date=anchor_date,
        member_path=member_path,
        card_key=card_key,
        body=body,
        created_at=_from_iso(ts),
        updated_at=_from_iso(ts),
    )


def update_note(
    service: str, note_id: int, body: str, *, now: datetime
) -> CapsuleNote | None:
    """Replace a note's body. ``None`` when the id is unknown in ``service``."""
    ts = _utc_iso(now)
    with _db("note_update") as c:
        cur = c.execute(
            "UPDATE memories_capsule_notes SET body=?, updated_at=? WHERE id=? AND service=?",
            (body, ts, note_id, service),
        )
        row = (
            c.execute(
                f"SELECT {_NOTE_COLS} FROM memories_capsule_notes WHERE id=?",
                (note_id,),
            ).fetchone()
            if cur.rowcount
            else None
        )
    logger.info(
        _EVENT,
        op="note_update",
        service=service,
        note_id=note_id,
        chars=len(body),
        outcome="updated" if row else "not_found",
    )
    return _note(row) if row else None


def delete_note(service: str, note_id: int) -> bool:
    with _db("note_delete") as c:
        cur = c.execute(
            "DELETE FROM memories_capsule_notes WHERE id=? AND service=?",
            (note_id, service),
        )
        deleted = cur.rowcount > 0
    logger.info(
        _EVENT,
        op="note_delete",
        service=service,
        note_id=note_id,
        outcome="deleted" if deleted else "not_found",
    )
    return deleted


def notes_on_date(service: str, day: date) -> list[CapsuleNote]:
    """Notes anchored on ``day`` (JST date), oldest first."""
    with _db("note_read") as c:
        rows = c.execute(
            f"SELECT {_NOTE_COLS} FROM memories_capsule_notes "
            "WHERE service=? AND anchor_date=? ORDER BY created_at, id",
            (service, day.isoformat()),
        ).fetchall()
    return [_note(r) for r in rows]


def notes_for_card(
    service: str, member_path_rooms: Sequence[str], card_key: str
) -> list[CapsuleNote]:
    """Card notes whose stored ``member_path`` is any of the person's rooms."""
    rooms = list(member_path_rooms)
    if not rooms:
        return []
    q = ",".join("?" * len(rooms))
    with _db("note_read") as c:
        rows = c.execute(
            f"SELECT {_NOTE_COLS} FROM memories_capsule_notes "
            f"WHERE service=? AND anchor_kind='card' AND card_key=? AND member_path IN ({q}) "
            "ORDER BY created_at, id",
            (service, card_key, *rooms),
        ).fetchall()
    return [_note(r) for r in rows]


def notes_created_on_month_day(
    service: str, month_day: str, *, before_year: int
) -> list[CapsuleNote]:
    """Notes written on JST ``month_day`` (``MM-DD``) of a year before ``before_year``.

    In a non-leap ``before_year``, ``02-28`` also returns notes written on Feb 29.
    Oldest first.
    """
    if not _MONTH_DAY_RE.match(month_day):
        raise ValueError("month_day must be MM-DD")
    wanted = {month_day}
    if month_day == "02-28" and not calendar.isleap(before_year):
        wanted.add("02-29")
    # Coarse SQL bound (UTC start of before_year in JST), exact filter in Python.
    bound = datetime(before_year, 1, 1, tzinfo=JST).astimezone(timezone.utc).isoformat()
    with _db("note_read") as c:
        rows = c.execute(
            f"SELECT {_NOTE_COLS} FROM memories_capsule_notes "
            "WHERE service=? AND created_at < ? ORDER BY created_at, id",
            (service, bound),
        ).fetchall()
    notes = [_note(r) for r in rows]
    return [
        n
        for n in notes
        if n.created_at.astimezone(JST).year < before_year
        and n.created_at.astimezone(JST).strftime("%m-%d") in wanted
    ]


# ----------------------------------------------------------------- covers


def cover_overrides(service_dir: str, scope: str) -> dict[str, tuple[str, int]]:
    """``month -> (room, message_id)`` for one album scope."""
    with _db("cover_read") as c:
        rows = c.execute(
            "SELECT month, room, message_id FROM memories_cover_overrides "
            "WHERE service_dir=? AND scope=?",
            (service_dir, scope),
        ).fetchall()
    return {m: (room, mid) for m, room, mid in rows}


def set_cover_override(
    service_dir: str,
    scope: str,
    month: str,
    room: str,
    message_id: int,
    *,
    now: datetime,
) -> None:
    ts = _utc_iso(now)
    with _db("cover_set") as c:
        c.execute(
            "INSERT INTO memories_cover_overrides(service_dir, scope, month, room, "
            "message_id, set_at) VALUES(?,?,?,?,?,?) "
            "ON CONFLICT(service_dir, scope, month) DO UPDATE SET "
            "room=excluded.room, message_id=excluded.message_id, set_at=excluded.set_at",
            (service_dir, scope, month, room, message_id, ts),
        )
    logger.info(_EVENT, op="cover_set", message_id=message_id)


def clear_cover_override(service_dir: str, scope: str, month: str) -> bool:
    with _db("cover_clear") as c:
        cur = c.execute(
            "DELETE FROM memories_cover_overrides WHERE service_dir=? AND scope=? AND month=?",
            (service_dir, scope, month),
        )
        cleared = cur.rowcount > 0
    logger.info(_EVENT, op="cover_clear", outcome="cleared" if cleared else "not_found")
    return cleared


# ----------------------------------------------------------------- gacha


def _read_salt(c: sqlite3.Connection) -> tuple[bool, str | None]:
    """``(row_exists, valid_salt_or_None)`` for the salt pref."""
    row = c.execute("SELECT value FROM prefs WHERE key=?", (SALT_PREF,)).fetchone()
    if not row:
        return False, None
    try:
        value = json.loads(row[0])
    except (TypeError, ValueError):
        return True, None
    return True, value if isinstance(value, str) and _SALT_RE.match(value) else None


def gacha_salt() -> str:
    """The per-install gacha salt (16 hex chars), created once in ``prefs``.

    The common path is a plain read; only a missing, non-JSON or malformed
    value takes the write lock (``BEGIN IMMEDIATE``, re-checked under the
    lock so racing callers mint exactly one salt). Never log the result.
    """
    with _db("salt") as c:
        _, salt = _read_salt(c)
        if salt is not None:
            return salt
    with _db("salt") as c:
        c.execute("BEGIN IMMEDIATE")
        existed, salt = _read_salt(c)
        if salt is not None:
            return salt
        salt = secrets.token_hex(8)
        c.execute(
            "INSERT INTO prefs(key, value) VALUES(?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (SALT_PREF, json.dumps(salt)),
        )
    logger.info(_EVENT, op="salt_reset" if existed else "salt_create")
    return salt


def gacha_pulls_on(service: str, jst_date: date) -> list[GachaPull]:
    """The day's pulls, by ``pull_index``."""
    with _db("gacha_read") as c:
        rows = c.execute(
            f"SELECT {_PULL_COLS} FROM memories_gacha_pulls "
            "WHERE service=? AND jst_date=? ORDER BY pull_index",
            (service, jst_date.isoformat()),
        ).fetchall()
    return [_pull(r) for r in rows]


def gacha_history(service: str, *, limit: int) -> list[GachaPull]:
    """Newest first (by JST date, then pull index); ``limit`` is clamped to 1..200."""
    limit = max(1, min(HISTORY_MAX, limit))
    with _db("gacha_read") as c:
        rows = c.execute(
            f"SELECT {_PULL_COLS} FROM memories_gacha_pulls WHERE service=? "
            "ORDER BY jst_date DESC, pull_index DESC LIMIT ?",
            (service, limit),
        ).fetchall()
    return [_pull(r) for r in rows]


def gacha_recent_keys(service: str, *, since: date) -> set[tuple[str, int]]:
    """``(room, message_id)`` of pulls on or after JST ``since``."""
    with _db("gacha_read") as c:
        rows = c.execute(
            "SELECT room, message_id FROM memories_gacha_pulls "
            "WHERE service=? AND jst_date>=?",
            (service, since.isoformat()),
        ).fetchall()
    return {(room, mid) for room, mid in rows}


def record_gacha_pull(
    service: str,
    jst_date: date,
    *,
    room: str,
    message_id: int,
    rarity: str,
    reason: str,
    now: datetime,
    max_pulls: int,
    expected_index: int | None = None,
) -> GachaPull | None:
    """Insert the next pull of the day, or ``None`` when it was not recorded.

    ``None`` means ``max_pulls`` are used, or (with ``expected_index``) the
    day's pull count is no longer ``expected_index``: another pull was
    recorded since the caller read the count, so its draw is stale and the
    caller re-reads and re-draws. ``BEGIN IMMEDIATE`` serialises the count +
    check + insert, so two racing clicks can neither both take the last pull
    nor record a draw made for an index that another click already took.
    """
    if max_pulls <= 0:
        raise ValueError("max_pulls must be positive")
    ts = _utc_iso(now)
    day = jst_date.isoformat()
    with _db("gacha_pull") as c:
        c.execute("BEGIN IMMEDIATE")
        (count,) = c.execute(
            "SELECT COUNT(*) FROM memories_gacha_pulls WHERE service=? AND jst_date=?",
            (service, day),
        ).fetchone()
        stale = expected_index is not None and count != expected_index
        if count >= max_pulls or stale:
            pull = None
        else:
            c.execute(
                f"INSERT INTO memories_gacha_pulls({_PULL_COLS}) VALUES(?,?,?,?,?,?,?,?)",
                (service, day, count, room, message_id, rarity, reason, ts),
            )
            pull = GachaPull(
                service=service,
                jst_date=jst_date,
                pull_index=count,
                room=room,
                message_id=message_id,
                rarity=rarity,
                reason=reason,
                pulled_at=_from_iso(ts),
            )
    if pull is None:
        logger.info(
            _EVENT,
            op="gacha_pull",
            service=service,
            outcome="no_pulls_left" if count >= max_pulls else "stale_index",
            count=count,
        )
    else:
        logger.info(
            _EVENT,
            op="gacha_pull",
            service=service,
            pull_index=count,
            rarity=rarity,
            outcome="recorded",
        )
    return pull


# ----------------------------------------------------------------- async


async def aadd_note(
    service: str,
    *,
    anchor_kind: str,
    anchor_date: date,
    member_path: str | None = None,
    card_key: str | None = None,
    body: str,
    now: datetime,
) -> CapsuleNote:
    return await asyncio.to_thread(
        lambda: add_note(
            service,
            anchor_kind=anchor_kind,
            anchor_date=anchor_date,
            member_path=member_path,
            card_key=card_key,
            body=body,
            now=now,
        )
    )


async def aupdate_note(
    service: str, note_id: int, body: str, *, now: datetime
) -> CapsuleNote | None:
    return await asyncio.to_thread(lambda: update_note(service, note_id, body, now=now))


async def adelete_note(service: str, note_id: int) -> bool:
    return await asyncio.to_thread(delete_note, service, note_id)


async def anotes_on_date(service: str, day: date) -> list[CapsuleNote]:
    return await asyncio.to_thread(notes_on_date, service, day)


async def anotes_for_card(
    service: str, member_path_rooms: Sequence[str], card_key: str
) -> list[CapsuleNote]:
    return await asyncio.to_thread(notes_for_card, service, member_path_rooms, card_key)


async def anotes_created_on_month_day(
    service: str, month_day: str, *, before_year: int
) -> list[CapsuleNote]:
    return await asyncio.to_thread(
        lambda: notes_created_on_month_day(service, month_day, before_year=before_year)
    )


async def acover_overrides(service_dir: str, scope: str) -> dict[str, tuple[str, int]]:
    return await asyncio.to_thread(cover_overrides, service_dir, scope)


async def aset_cover_override(
    service_dir: str,
    scope: str,
    month: str,
    room: str,
    message_id: int,
    *,
    now: datetime,
) -> None:
    await asyncio.to_thread(
        lambda: set_cover_override(service_dir, scope, month, room, message_id, now=now)
    )


async def aclear_cover_override(service_dir: str, scope: str, month: str) -> bool:
    return await asyncio.to_thread(clear_cover_override, service_dir, scope, month)


async def agacha_salt() -> str:
    return await asyncio.to_thread(gacha_salt)


async def agacha_pulls_on(service: str, jst_date: date) -> list[GachaPull]:
    return await asyncio.to_thread(gacha_pulls_on, service, jst_date)


async def agacha_history(service: str, *, limit: int) -> list[GachaPull]:
    return await asyncio.to_thread(lambda: gacha_history(service, limit=limit))


async def agacha_recent_keys(service: str, *, since: date) -> set[tuple[str, int]]:
    return await asyncio.to_thread(lambda: gacha_recent_keys(service, since=since))


async def arecord_gacha_pull(
    service: str,
    jst_date: date,
    *,
    room: str,
    message_id: int,
    rarity: str,
    reason: str,
    now: datetime,
    max_pulls: int,
    expected_index: int | None = None,
) -> GachaPull | None:
    return await asyncio.to_thread(
        lambda: record_gacha_pull(
            service,
            jst_date,
            room=room,
            message_id=message_id,
            rarity=rarity,
            reason=reason,
            now=now,
            max_pulls=max_pulls,
            expected_index=expected_index,
        )
    )


__all__ = [
    "HISTORY_MAX",
    "SALT_PREF",
    "CapsuleNote",
    "GachaPull",
    "aadd_note",
    "aclear_cover_override",
    "acover_overrides",
    "add_note",
    "adelete_note",
    "agacha_history",
    "agacha_pulls_on",
    "agacha_recent_keys",
    "agacha_salt",
    "anotes_created_on_month_day",
    "anotes_for_card",
    "anotes_on_date",
    "arecord_gacha_pull",
    "aset_cover_override",
    "aupdate_note",
    "clear_cover_override",
    "cover_overrides",
    "delete_note",
    "gacha_history",
    "gacha_pulls_on",
    "gacha_recent_keys",
    "gacha_salt",
    "notes_created_on_month_day",
    "notes_for_card",
    "notes_on_date",
    "record_gacha_pull",
    "set_cover_override",
    "update_note",
]
