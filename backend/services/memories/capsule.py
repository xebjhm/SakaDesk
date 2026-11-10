"""時光膠囊, the fan's capsule notes (spec 14.4).

The fan writes a sticky note on a day or on a card. Notes are the fan's own
words, stored only in ``app_state.db`` (``user_store``); they are never shown
as hers, never cached and never logged.

Anchors:

- ``day``: ``anchor_date`` is the JST date the note is about (for the service).
- ``card``: ``member_path`` (the chat path of the person's newest room at write
  time), ``card_key`` (``cards.Card.key``, :data:`CARD_KEY_RE`) and
  ``anchor_date`` = the card's date. A card note is found again through any of
  the person's rooms.

The fan can always read and edit a note on its anchor: it is not sealed.

Resurfacing: a note resurfaces on every yearly anniversary of the JST date it
was **written** (``created_at``), starting one year later; a note written on
Feb 29 resurfaces on Feb 28 in non-leap years (``user_store.
notes_created_on_month_day``, the ``cards.anniversary_date`` rule). It comes
back with her message of the **anchor** day: her best words of that date
(``on_this_day.pick_year`` over ``people.service_facts_on(day=anchor_date)``),
from the card's person for a card anchor, else oshi first, then importance.
Without words that day the note resurfaces alone. ``years_ago`` = this JST
year minus the JST year written (>= 1); the frontend's literal label is
「{{count}}年前のあなたが書いたメモ」. Nothing says she saw or answered the note.

API:

- :data:`MAX_CHARS` (2000), :data:`HUB_LIMIT` (1, the hub shows one note).
- ``async notes_for_anchor(service, sdir, *, day, member, card_key)`` ->
  ``{"notes": [note]}``; exactly one of ``day`` or ``member`` + ``card_key``.
  A note is ``{"id", "anchor": {"kind", "date", "card_key"}, "body",
  "created_at", "updated_at"}`` (UTC ISO times). The day list holds day notes
  only.
- ``async create_note(service, sdir, *, anchor, body, now)`` -> note;
  ``async update_note(service, sdir, *, note_id, body, now)`` -> note or
  ``None`` (unknown id or another service's); ``async delete_note(service,
  sdir, *, note_id)`` -> whether it existed. ``anchor`` is ``{"kind": "day",
  "date"}`` or ``{"kind": "card", "member", "card_key", "date"}``.
- ``async resurfacing(service, sdir, *, month_day, now, limit=None)`` ->
  ``{"notes": [{"note", "years_ago", "message", "member_path", "name"}]}``,
  oldest written first. ``message`` is the shared message object (with her words) or
  ``None``; ``member_path`` / ``name`` are the message's person, for a card
  anchor its person even without a message, else ``None``. ``limit`` keeps
  the first ``limit`` notes (the hub passes :data:`HUB_LIMIT`).
- ``async due_notes(service, today) -> list[user_store.CapsuleNote]`` -- the
  M4 hook: the notes due on JST ``today`` (same set and order as
  :func:`resurfacing`), a pure query with no message attached. M4's
  notification calls it.

Errors: :class:`CapsuleError` (a ``ValueError``) with ``code`` ``bad_note``
(a body that is not a string, empty after stripping or over
:data:`MAX_CHARS`), ``bad_anchor`` or ``unknown_member``. A card ``member``
path that escapes the output dir or belongs to another service raises
``archive_urls.ArchiveReadError`` / ``people.ForeignServiceError`` from
``people.resolve_person``. A ``sqlite3.Error`` from the store propagates.

Logs (ids, codes and counts only; never the body): ``memories_capsule`` with
``op=list|create|update|delete|resurface`` plus ``count``, ``note_id`` and
``chars``; ``memories_skip`` (``view=capsule``, ``reason=no_message|
card_person_missing``, ``note_id``).
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Mapping, Sequence
from datetime import date, datetime
from pathlib import Path

import structlog

from backend.services.archive_urls import ArchiveReadError
from backend.services.memories import index as mi
from backend.services.memories import people, user_store
from backend.services.memories.facts import Fact
from backend.services.memories.on_this_day import parse_month_day, pick_year
from backend.services.memories.selection import JST

logger = structlog.get_logger(__name__)

MAX_CHARS = 2000
HUB_LIMIT = 1
CARD_KEY_RE = re.compile(r"[a-z0-9_.@-]{1,80}")
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
VIEW = "capsule"
_EVENT = "memories_capsule"
_DAY_KEYS = frozenset({"kind", "date"})
_CARD_KEYS = frozenset({"kind", "member", "card_key", "date"})

_Tagged = tuple[mi.MemberSummary, str, Fact]


class CapsuleError(ValueError):
    """A rejected note or anchor; ``code`` is the API's detail."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def clean_body(body: object) -> str:
    """The stripped body; ``CapsuleError("bad_note")`` unless 1..MAX_CHARS chars."""
    if not isinstance(body, str):
        raise CapsuleError("bad_note")
    text = body.strip()
    if not 1 <= len(text) <= MAX_CHARS:
        raise CapsuleError("bad_note")
    return text


def parse_date(raw: object) -> date:
    """A ``YYYY-MM-DD`` date; ``CapsuleError("bad_anchor")`` otherwise."""
    if not isinstance(raw, str) or not DATE_RE.fullmatch(raw):
        raise CapsuleError("bad_anchor")
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise CapsuleError("bad_anchor") from None


def valid_card_key(raw: object) -> bool:
    return isinstance(raw, str) and CARD_KEY_RE.fullmatch(raw) is not None


def note_payload(note: user_store.CapsuleNote) -> dict:
    """The API's note object (the fan's own text; never cache it)."""
    return {
        "id": note.id,
        "anchor": {
            "kind": note.anchor_kind,
            "date": note.anchor_date.isoformat(),
            "card_key": note.card_key,
        },
        "body": note.body,
        "created_at": note.created_at.isoformat(),
        "updated_at": note.updated_at.isoformat(),
    }


def _room_paths(sdir: Path, person: mi.MemberSummary) -> list[str]:
    return [people.chat_path(sdir, room) for room in person.member_dirs]


async def notes_for_anchor(
    service: str,
    sdir: Path,
    *,
    day: date | None,
    member: mi.MemberSummary | None,
    card_key: str | None,
) -> dict:
    """The notes on one anchor, oldest first (see the module docstring)."""
    if day is not None and (member is not None or card_key is not None):
        raise CapsuleError("bad_anchor")
    if day is not None:
        notes = [
            n
            for n in await user_store.anotes_on_date(service, day)
            if n.anchor_kind == "day"
        ]
    elif member is not None and card_key is not None and valid_card_key(card_key):
        notes = await user_store.anotes_for_card(
            service, _room_paths(sdir, member), card_key
        )
    else:
        raise CapsuleError("bad_anchor")
    logger.info(_EVENT, op="list", count=len(notes), kind="day" if day else "card")
    return {"notes": [note_payload(n) for n in notes]}


async def _parse_anchor(
    sdir: Path, anchor: object
) -> tuple[str, date, str | None, str | None]:
    """``(kind, anchor_date, member_path, card_key)`` of a create request."""
    if not isinstance(anchor, Mapping):
        raise CapsuleError("bad_anchor")
    kind = anchor.get("kind")
    if kind == "day" and set(anchor) == _DAY_KEYS:
        return "day", parse_date(anchor["date"]), None, None
    if kind != "card" or set(anchor) != _CARD_KEYS:
        raise CapsuleError("bad_anchor")
    day = parse_date(anchor["date"])
    member, key = anchor["member"], anchor["card_key"]
    if not isinstance(member, str) or not valid_card_key(key):
        raise CapsuleError("bad_anchor")
    person = await people.resolve_person(sdir, member)
    if person is None:
        raise CapsuleError("unknown_member")
    return "card", day, people.chat_path(sdir, person.member_dirs[-1]), key


async def create_note(
    service: str, sdir: Path, *, anchor: object, body: object, now: datetime
) -> dict:
    """Store a new note on ``anchor`` (see the module docstring)."""
    text = clean_body(body)
    kind, day, member_path, card_key = await _parse_anchor(sdir, anchor)
    note = await user_store.aadd_note(
        service,
        anchor_kind=kind,
        anchor_date=day,
        member_path=member_path,
        card_key=card_key,
        body=text,
        now=now,
    )
    logger.info(_EVENT, op="create", note_id=note.id, chars=len(text), kind=kind)
    return note_payload(note)


async def update_note(
    service: str, sdir: Path, *, note_id: int, body: object, now: datetime
) -> dict | None:
    """Replace a note's body; ``None`` for an unknown id or another service's."""
    del sdir  # notes are keyed by the service name
    text = clean_body(body)
    note = await user_store.aupdate_note(service, note_id, text, now=now)
    logger.info(
        _EVENT, op="update", note_id=note_id, chars=len(text), found=note is not None
    )
    return note_payload(note) if note is not None else None


async def delete_note(service: str, sdir: Path, *, note_id: int) -> bool:
    """Delete a note; whether it existed in ``service``."""
    del sdir  # notes are keyed by the service name
    found = await user_store.adelete_note(service, note_id)
    logger.info(_EVENT, op="delete", note_id=note_id, found=found)
    return found


async def due_notes(service: str, today: date) -> list[user_store.CapsuleNote]:
    """The notes due on JST ``today`` (the M4 hook; no message attached).

    M4's notification calls this. Same set and order as :func:`resurfacing`
    for today's month-day; a ``sqlite3.Error`` propagates.
    """
    return await user_store.anotes_created_on_month_day(
        service, today.strftime("%m-%d"), before_year=today.year
    )


async def _card_person(
    sdir: Path, note: user_store.CapsuleNote
) -> mi.MemberSummary | None:
    """The card note's person, or ``None`` (logged) when she no longer resolves."""
    person: mi.MemberSummary | None = None
    if note.member_path is not None:
        try:
            person = await people.resolve_person(sdir, note.member_path)
        except ArchiveReadError:  # also ForeignServiceError
            person = None
    if person is None:
        logger.info(
            "memories_skip", view=VIEW, reason="card_person_missing", note_id=note.id
        )
    return person


def _best_words(tagged: Sequence[_Tagged], oshi: set[str]) -> _Tagged | None:
    preview, _ = pick_year(tagged, oshi)
    return preview[0] if preview else None


async def resurfacing(
    service: str,
    sdir: Path,
    *,
    month_day: str,
    now: datetime,
    limit: int | None = None,
) -> dict:
    """The notes resurfacing on ``month_day`` this JST year (module docstring).

    ``limit`` keeps only the first ``limit`` notes before any message is
    picked, so her words are read for the shown notes only. ``ValueError``
    for an invalid ``month_day``.
    """
    parse_month_day(month_day)
    year = now.astimezone(JST).year
    notes = await user_store.anotes_created_on_month_day(
        service, month_day, before_year=year
    )
    if limit is not None:
        notes = notes[:limit]
    summaries = await mi.list_members(sdir) if notes else []
    oshi = await people.oshi_rooms(service, summaries) if notes else set()
    picks: dict[tuple[date, str | None], _Tagged | None] = {}
    avatars: dict[str, people.AvatarTimeline] = {}
    items: list[dict] = []
    refs: list[dict] = []
    for note in notes:
        person: mi.MemberSummary | None = None
        if note.anchor_kind == "card":
            person = await _card_person(sdir, note)
            persons = [person] if person is not None else []
        else:
            persons = summaries
        key = (note.anchor_date, people.person_key(person) if person else None)
        if key not in picks:
            tagged = (
                await people.service_facts_on(sdir, persons, day=note.anchor_date)
                if persons
                else []
            )
            picks[key] = await asyncio.to_thread(_best_words, tagged, oshi)
        pick = picks[key]
        item: dict = {
            "note": note_payload(note),
            "years_ago": year - note.created_at.astimezone(JST).year,
            "message": None,
            "member_path": None,
            "name": None,
        }
        if pick is None:
            logger.info(
                "memories_skip", view=VIEW, reason="no_message", note_id=note.id
            )
            if person is not None:
                item["member_path"] = people.chat_path(sdir, person.member_dirs[-1])
                item["name"] = person.name
        else:
            who, room, fact = pick
            pkey = people.person_key(who)
            if pkey not in avatars:
                avatars[pkey] = await people.avatar_timelines(sdir, who)
            message = people.message_ref(
                service, sdir, room, fact, avatar=avatars[pkey]
            )
            refs.append(message)
            item.update(
                message=message,
                member_path=people.chat_path(sdir, room),
                name=who.name,
            )
        items.append(item)
    if refs:
        await people.attach_texts(sdir, refs)
    logger.info(_EVENT, op="resurface", count=len(items))
    return {"notes": items}


__all__ = [
    "CARD_KEY_RE",
    "HUB_LIMIT",
    "MAX_CHARS",
    "CapsuleError",
    "clean_body",
    "create_note",
    "delete_note",
    "due_notes",
    "note_payload",
    "notes_for_anchor",
    "parse_date",
    "resurfacing",
    "update_note",
    "valid_card_key",
]
