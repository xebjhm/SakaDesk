"""Cross-screen helpers for Memories: people, rooms, message objects, avatars.

The single home for what every Memories screen (recap, binder, memoir, On This
Day, album, favorites, hub) shares. No FastAPI here: bad input raises
:class:`~backend.services.archive_urls.ArchiveReadError` or ``ValueError`` and
the API maps it to an HTTP status.

Vocabulary:

- A *person* is an :class:`index.MemberSummary`: one member across her 1:1
  rooms (communal rooms are excluded).
- A *room* is a relative POSIX ``member_dir`` from ``summary.member_dirs``,
  e.g. ``messages/34 金村 美玖/58 金村 美玖``.
- ``chat_path`` is the path the chat uses: ``<service display name>/<room>``.
- ``person_key`` = the person's sorted rooms joined by ``|``. It is a cache key
  only and is never logged.

API:

- ``output_dir()``, ``service_data_dir(service, base=None)``,
  ``person_key(summary)``, ``chat_path(sdir, room)``, ``member_id(summary)``
  (the id logs use for a person).
- ``async resolve_person(sdir, member_path)`` -- the person owning the room
  at ``member_path`` (a chat path of any of her rooms), or ``None``.
- ``async oshi_rooms(service, summaries)``, ``sort_people(summaries, oshi)``.
- ``media_url_of(service, media_file)``, ``media_url_for(service, fact)``,
  ``media_file_for(fact)``.
- :class:`AvatarTimeline`, ``avatar_timeline(sdir, room)``,
  ``async avatar_timelines(sdir, summary)``,
  ``async avatar_timelines_for(sdir, persons)`` (several people, bounded
  concurrency), ``current_avatars(sdir, rooms)``.
- ``message_ref(service, sdir, room, fact, *, avatar=None)`` -- the shared
  message object, text-free; ``async attach_texts(sdir, refs)`` fills
  ``text`` / ``caption`` with one ``load_texts`` per room, at most
  :data:`IO_CONCURRENCY` rooms at once.
- ``async service_facts_on(sdir, summaries, *, day=None, month_day=None)``.
- ``async room_hashes(sdir, summary)``.
- ``async album_scope(sdir, member)`` -- ``(persons, scope, room hashes)`` of
  one person or, for ``None``, everyone (``scope`` = ``person_key`` or
  ``"all"``); ``async scope_facts(sdir, persons)`` -- their ``(room, fact)``
  by ``(ts, id, room)``; ``async media_dir_mtimes(sdir, persons)`` -- the
  ``mtime_ns`` of every room's :data:`MEDIA_SUBDIRS` (``-1`` when absent),
  which changes when media repair adds a file without touching
  ``messages.json``.
- ``async letters_of(service, sdir, summary)`` -- ``(room, letter_id, JST
  date)`` of the fan's own letters (never paired with her messages).

Logs carry ids, codes and counts only: never text, names, rooms or paths.
"""

from __future__ import annotations

import asyncio
import hashlib
import sqlite3
from collections import OrderedDict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path

import structlog

from backend.services import app_state, path_resolver, profile_images_service
from backend.services.archive_urls import (
    MEDIA_PREFIX,
    ArchiveReadError,
    media_url,
    parse_iso,
    resolve_within,
)
from backend.services.letters_local import read_local_letters
from backend.services.memories import index as mi
from backend.services.memories import oshi as oshi_mod
from backend.services.memories.facts import (
    Fact,
    get_facts_on,
    get_person_facts,
    load_texts,
)
from backend.services.memories.selection import JST
from backend.services.service_utils import get_service_display_name, validate_service

logger = structlog.get_logger(__name__)

MEDIA_TYPES = frozenset({"picture", "video"})
# pysaka writes a room's media to ``<room>/<type>/<id>.<ext>`` (the folder a
# ``media_file`` points into); these are the album's media folders.
MEDIA_SUBDIRS = ("picture", "video")
# Rooms read at once by attach_texts / avatar_timelines_for (worker threads).
IO_CONCURRENCY = 4


class ForeignServiceError(ArchiveReadError):
    """A member path inside the output dir but in another service's folder."""


# --- service / paths --------------------------------------------------------------


def output_dir() -> Path:
    """The configured archive output directory."""
    return path_resolver.get_output_dir()


def service_data_dir(service: str, base: Path | None = None) -> Path:
    """``<output dir>/<service display name>``; ``ValueError`` for an unknown service.

    ``base`` overrides the output dir (callers that already resolved it).
    """
    validate_service(service)
    root = base if base is not None else output_dir()
    return root / get_service_display_name(service)


def person_key(summary: mi.MemberSummary) -> str:
    """Cache key of a person: her sorted rooms joined by ``|`` (never logged)."""
    return "|".join(sorted(summary.member_dirs))


def service_person_key(service: str, summary: mi.MemberSummary) -> str:
    """A person's key in payloads: :func:`person_key` prefixed with the service,
    so it is unique across services. Never logged."""
    return f"{service}|{person_key(summary)}"


def chat_path(sdir: Path, room: str) -> str:
    """The chat's path of a room: ``<service display name>/<room>``."""
    return f"{sdir.name}/{room}"


def member_id(summary: mi.MemberSummary) -> str | None:
    """Her first room's member id: the log identifier of a person (or ``None``)."""
    return summary.member_ids[0] if summary.member_ids else None


async def resolve_person(sdir: Path, member_path: str) -> mi.MemberSummary | None:
    """The person with a room at ``member_path`` (``<service name>/<room>``).

    ``member_path`` is validated against the output dir (``sdir.parent``, the
    same dir as :func:`output_dir` for a ``service_data_dir`` result) with
    ``resolve_within``: a path that escapes it raises ``ArchiveReadError``; a
    path in another service's folder raises :class:`ForeignServiceError` (a
    subclass). A valid room no person owns gives ``None``.
    """
    root = sdir.parent
    resolved = resolve_within(root, root / member_path)
    try:
        room = resolved.relative_to(sdir.resolve()).as_posix()
    except ValueError:
        raise ForeignServiceError("other service") from None
    summaries = await mi.list_members(sdir)
    found = next((s for s in summaries if room in s.member_dirs), None)
    logger.info(
        "memories_person_resolved",
        found=found is not None,
        rooms=len(found.member_dirs) if found else 0,
        member_id=member_id(found) if found else None,
    )
    return found


# --- oshi / ordering ------------------------------------------------------------------


async def oshi_rooms(service: str, summaries: Iterable[mi.MemberSummary]) -> set[str]:
    """``name_norm`` of the listed people who are the fan's oshi."""
    names = await oshi_mod.oshi_names(service)
    return {s.name_norm for s in summaries if s.name_norm in names}


def sort_people(
    summaries: Sequence[mi.MemberSummary], oshi: set[str]
) -> list[mi.MemberSummary]:
    """Oshi first, then the :func:`index.list_members` order (stable)."""
    return sorted(summaries, key=lambda s: s.name_norm not in oshi)


# --- media ---------------------------------------------------------------------------


def _media_parts(media_file: str | None) -> list[str]:
    if not media_file:
        return []
    return [p for p in media_file.replace("\\", "/").split("/") if p]


def media_url_of(service: str, media_file: str | None) -> str | None:
    """Media-route URL of a pysaka ``media_file`` (``\\`` normalised), or ``None``."""
    parts = _media_parts(media_file)
    return media_url(service, parts) if parts else None


def media_url_for(service: str, fact: Fact) -> str | None:
    """Media-route URL of a fact's ``media_file``, or ``None``."""
    return media_url_of(service, fact.media_file)


def media_file_for(fact: Fact) -> str | None:
    """The fact's service-relative ``media_file`` with ``/`` separators."""
    parts = _media_parts(fact.media_file)
    return "/".join(parts) if parts else None


# --- avatars ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AvatarTimeline:
    """Her archived chat icons, oldest first, and the current one.

    ``entries`` are ``(first_seen, media url)``; an unknown ``first_seen`` is
    ``None`` and sorts as the oldest.
    """

    entries: tuple[tuple[datetime | None, str], ...]
    current: str | None

    def at(self, when: datetime) -> str | None:
        """Her icon at ``when``.

        The newest entry with ``first_seen <= when``; when none is that old,
        the oldest entry (archiving began after ``when``); with no entries,
        ``current``.
        """
        best: str | None = None
        for seen, url in self.entries:
            if seen is not None and seen <= when:
                best = url
        if best is not None:
            return best
        return self.entries[0][1] if self.entries else self.current


def _timeline_sort_key(entry: tuple[datetime | None, str]) -> tuple[bool, datetime]:
    seen = entry[0]
    return (seen is not None, seen or datetime.min.replace(tzinfo=timezone.utc))


def avatar_timeline(sdir: Path, room: str) -> AvatarTimeline:
    """The archived thumbnails of one room. Blocking.

    Only archived (local) images count; a current icon that was never
    archived is ignored, like :func:`current_avatars`. ``sdir.parent`` is the
    output dir (``sdir`` comes from :func:`service_data_dir`).
    """
    kinds = profile_images_service.list_images(
        sdir.parent, sdir / room, {}, member_rel=chat_path(sdir, room)
    )["kinds"]
    local = [
        e
        for e in kinds.get("thumbnail", [])
        if isinstance(e.get("url"), str) and e["url"].startswith(MEDIA_PREFIX)
    ]
    entries = sorted(
        ((parse_iso(e.get("first_seen")), e["url"]) for e in local),
        key=_timeline_sort_key,
    )
    current = next((e["url"] for e in local if e.get("current")), None)
    return AvatarTimeline(entries=tuple(entries), current=current)


_AVATAR_CACHE_MAX = 64
_avatar_cache: OrderedDict[tuple[str, str, tuple[int, ...]], AvatarTimeline] = (
    OrderedDict()
)


def _index_mtimes(sdir: Path, rooms: Sequence[str]) -> tuple[int, ...]:
    out = []
    for room in rooms:
        path = sdir / room / profile_images_service.DIR_NAME / "index.json"
        try:
            out.append(path.stat().st_mtime_ns)
        except OSError:
            out.append(-1)
    return tuple(out)


def _merge_timelines(sdir: Path, rooms: Sequence[str]) -> AvatarTimeline:
    """Every room's timeline merged; current from the newest room that has one."""
    timelines = [avatar_timeline(sdir, room) for room in rooms]
    entries = sorted((e for t in timelines for e in t.entries), key=_timeline_sort_key)
    current = next((t.current for t in reversed(timelines) if t.current), None)
    return AvatarTimeline(entries=tuple(entries), current=current)


async def avatar_timelines(sdir: Path, summary: mi.MemberSummary) -> AvatarTimeline:
    """Her icons across every room, cached per person and profile-index mtimes."""
    rooms = summary.member_dirs
    mtimes = await asyncio.to_thread(_index_mtimes, sdir, rooms)
    key = (str(sdir), person_key(summary), mtimes)
    hit = _avatar_cache.get(key)
    if hit is not None:
        _avatar_cache.move_to_end(key)
        return hit
    timeline = await asyncio.to_thread(_merge_timelines, sdir, rooms)
    _avatar_cache[key] = timeline
    while len(_avatar_cache) > _AVATAR_CACHE_MAX:
        _avatar_cache.popitem(last=False)
    logger.debug(
        "memories_avatars",
        member_id=member_id(summary),
        count=len(timeline.entries),
    )
    return timeline


async def avatar_timelines_for(
    sdir: Path, persons: dict[str, mi.MemberSummary]
) -> dict[str, AvatarTimeline]:
    """``key -> avatar_timelines(sdir, summary)`` for every entry of ``persons``.

    At most :data:`IO_CONCURRENCY` people are loaded at once; the result keeps
    the keys of ``persons``.
    """
    gate = asyncio.Semaphore(IO_CONCURRENCY)

    async def one(summary: mi.MemberSummary) -> AvatarTimeline:
        async with gate:
            return await avatar_timelines(sdir, summary)

    timelines = await asyncio.gather(*(one(s) for s in persons.values()))
    return dict(zip(persons, timelines))


def current_avatars(sdir: Path, rooms: Sequence[str]) -> dict[str, str | None]:
    """``room -> current archived thumbnail URL`` (or ``None``). Blocking."""
    root = sdir.parent
    return {
        room: profile_images_service.local_urls(
            root, sdir / room, chat_path(sdir, room)
        ).get("thumbnail_local")
        for room in rooms
    }


# --- message objects ---------------------------------------------------------------


def iso_utc(ts: datetime) -> str:
    """``ts`` as the payloads' UTC ISO string (``YYYY-MM-DDTHH:MM:SSZ``)."""
    return ts.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def favorited_at(service: str, ids: list[int], *, view: str) -> dict[int, str]:
    """``app_state.favorited_at``; ``{}`` when the log is unreadable.

    The failure is logged as ``memories_skip`` (``view``,
    ``reason=favorite_log_unreadable``, ``error_type``). Keyed by id alone,
    which is safe: message ids are unique per service (the official API stars
    ``/messages/{id}/favorite`` with no room, and the log is keyed
    ``(service, message_id)``), so ids never collide across rooms.
    """
    try:
        return app_state.favorited_at(service, ids)
    except sqlite3.Error as e:
        logger.warning(
            "memories_skip",
            view=view,
            reason="favorite_log_unreadable",
            error_type=type(e).__name__,
        )
        return {}


def message_ref(
    service: str,
    sdir: Path,
    room: str,
    fact: Fact,
    *,
    avatar: AvatarTimeline | None = None,
) -> dict:
    """The shared message object for ``fact``, with ``text`` / ``caption`` ``None``.

    ``caption_id`` is the paired text's id when it differs from the message's
    own id (used by :func:`attach_texts`), else ``None``. Text-free, so it can
    be cached (``view_cache``).
    """
    caption_id = (
        fact.caption_id
        if fact.type in MEDIA_TYPES
        and fact.caption_id is not None
        and fact.caption_id != fact.id
        else None
    )
    return {
        "id": fact.id,
        "room": room,
        "member_path": chat_path(sdir, room),
        "service": service,
        "ts": iso_utc(fact.ts),
        "type": fact.type,
        "text": None,
        "caption": None,
        "caption_id": caption_id,
        "media_url": media_url_for(service, fact),
        "media_file": media_file_for(fact),
        "duration_s": fact.duration_s,
        "favorited": fact.favorited,
        "avatar_url": avatar.at(fact.ts) if avatar is not None else None,
    }


async def attach_texts(sdir: Path, refs: list[dict]) -> None:
    """Fill ``text`` and ``caption`` of ``refs`` in place.

    Every ref must belong to ``sdir``'s service: refs are grouped by room
    only, and two services can share a relative room path, so a caller that
    mixes services calls this once per service with its own ``sdir``.
    One ``load_texts`` per room (in a worker, at most
    :data:`IO_CONCURRENCY` rooms at once), for the refs' own ids and
    caption ids only. An empty text becomes ``None``. Refs whose id (or
    caption id) is not in ``messages.json`` keep ``None`` and are counted in
    one ``memories_skip`` (``view=attach_texts``, ``reason=text_missing``).
    """
    by_room: dict[str, list[dict]] = {}
    for ref in refs:
        by_room.setdefault(ref["room"], []).append(ref)
    gate = asyncio.Semaphore(IO_CONCURRENCY)

    async def fill(room: str, group: list[dict]) -> int:
        ids = {r["id"] for r in group}
        ids |= {r["caption_id"] for r in group if r.get("caption_id") is not None}
        async with gate:
            texts = await asyncio.to_thread(load_texts, sdir, sdir / room, ids)
        missing = 0
        for r in group:
            own = texts.get(r["id"])
            cap_id = r.get("caption_id")
            cap = texts.get(cap_id) if cap_id is not None else None
            if own is None or (cap_id is not None and cap is None):
                missing += 1
            r["text"] = own or None
            r["caption"] = cap or None
        return missing

    counts = await asyncio.gather(*(fill(room, g) for room, g in by_room.items()))
    missing = sum(counts)
    if missing:
        logger.info(
            "memories_skip", view="attach_texts", reason="text_missing", count=missing
        )


# --- date facts / hashes ---------------------------------------------------------------


def _sorted_room_facts(
    tagged: list[tuple[mi.MemberSummary, str, Fact]],
) -> list[tuple[mi.MemberSummary, str, Fact]]:
    tagged.sort(key=lambda t: (t[2].ts, t[2].id, t[1]))
    return tagged


async def service_facts_on(
    sdir: Path,
    summaries: Iterable[mi.MemberSummary],
    *,
    day: date | None = None,
    month_day: str | None = None,
) -> list[tuple[mi.MemberSummary, str, Fact]]:
    """``(person, room, fact)`` on ``day`` or ``month_day`` for every room of every person.

    Sorted by ``(ts, id, room)`` off the event loop. ``ValueError`` unless
    exactly one of ``day`` / ``month_day`` is given.
    """
    if (day is None) == (month_day is None):
        raise ValueError("pass exactly one of day or month_day")
    tagged: list[tuple[mi.MemberSummary, str, Fact]] = []
    for s in summaries:
        for room in s.member_dirs:
            facts = await get_facts_on(sdir, sdir / room, day=day, month_day=month_day)
            tagged.extend((s, room, f) for f in facts)
    return await asyncio.to_thread(_sorted_room_facts, tagged)


async def room_hashes(sdir: Path, summary: mi.MemberSummary) -> str:
    """Short hash over every room's member-index ``data_hash`` (16 hex chars)."""
    hashes = [
        (await mi.get_member_index(sdir, sdir / room)).data_hash
        for room in summary.member_dirs
    ]
    return hashlib.sha256("|".join(hashes).encode("utf-8")).hexdigest()[:16]


async def album_scope(
    sdir: Path, member: mi.MemberSummary | None
) -> tuple[list[mi.MemberSummary], str, list[str]]:
    """``(persons, scope, room hashes)`` of one person or of everyone (``"all"``)."""
    persons = [member] if member is not None else await mi.list_members(sdir)
    scope = person_key(member) if member is not None else "all"
    hashes = [await room_hashes(sdir, s) for s in persons]
    return persons, scope, hashes


def _by_ts_id_room(t: tuple[str, Fact]) -> tuple[datetime, int, str]:
    return t[1].ts, t[1].id, t[0]


def _sorted_scope(tagged: list[tuple[str, Fact]]) -> list[tuple[str, Fact]]:
    tagged.sort(key=_by_ts_id_room)
    return tagged


async def scope_facts(
    sdir: Path,
    persons: Sequence[mi.MemberSummary],
    start: date | None = None,
    end: date | None = None,
    *,
    types: Iterable[str] | None = None,
) -> list[tuple[str, Fact]]:
    """``(room, fact)`` of every room of ``persons``, by ``(ts, id, room)``.

    ``start`` / ``end`` (JST dates, inclusive) and ``types`` narrow the query.
    """
    tagged: list[tuple[str, Fact]] = []
    for s in persons:
        tagged.extend(await get_person_facts(sdir, s, start, end, types=types))
    if len(persons) > 1:
        tagged = await asyncio.to_thread(_sorted_scope, tagged)
    return tagged


def _media_dir_mtimes(sdir: Path, rooms: Sequence[str]) -> tuple[int, ...]:
    out = []
    for room in rooms:
        for sub in MEDIA_SUBDIRS:
            try:
                out.append((sdir / room / sub).stat().st_mtime_ns)
            except OSError:
                out.append(-1)
    return tuple(out)


async def media_dir_mtimes(
    sdir: Path, persons: Sequence[mi.MemberSummary]
) -> tuple[int, ...]:
    """``mtime_ns`` of each room's media folders (``-1`` if absent), in a worker."""
    rooms = [room for s in persons for room in s.member_dirs]
    return await asyncio.to_thread(_media_dir_mtimes, sdir, rooms)


# --- letters -------------------------------------------------------------------------


def _letters_sync(
    service: str, sdir: Path, summary: mi.MemberSummary
) -> list[tuple[datetime, str, int]]:
    out: list[tuple[datetime, str, int]] = []
    invalid = 0
    for room in summary.member_dirs:
        outcome, letters, _, _ = read_local_letters(
            sdir.parent, sdir / room, service, room.split("/")
        )
        if outcome == "invalid":
            invalid += 1
        for letter in letters:
            created = parse_iso(letter.created_at)
            if created is not None:  # always parseable: the reader skips others
                out.append((created, room, letter.id))
    if invalid:
        logger.warning(
            "memories_skip",
            view="letters",
            reason="invalid",
            count=invalid,
            member_id=member_id(summary),
        )
    out.sort()
    return out


async def letters_of(
    service: str, sdir: Path, summary: mi.MemberSummary
) -> list[tuple[str, int, date]]:
    """``(room, letter_id, JST date)`` of the fan's letters to her, oldest first.

    ``missing`` and ``empty`` files give nothing; an ``invalid`` file gives
    nothing for that room plus ``memories_skip`` (``view=letters``,
    ``reason=invalid``).
    """
    dated = await asyncio.to_thread(_letters_sync, service, sdir, summary)
    return [(room, lid, ts.astimezone(JST).date()) for ts, room, lid in dated]


__all__ = [
    "AvatarTimeline",
    "MEDIA_SUBDIRS",
    "album_scope",
    "media_dir_mtimes",
    "scope_facts",
    "ForeignServiceError",
    "attach_texts",
    "avatar_timeline",
    "avatar_timelines",
    "avatar_timelines_for",
    "chat_path",
    "current_avatars",
    "favorited_at",
    "iso_utc",
    "letters_of",
    "media_file_for",
    "media_url_for",
    "media_url_of",
    "member_id",
    "message_ref",
    "oshi_rooms",
    "output_dir",
    "person_key",
    "resolve_person",
    "room_hashes",
    "service_data_dir",
    "service_facts_on",
    "sort_people",
]
