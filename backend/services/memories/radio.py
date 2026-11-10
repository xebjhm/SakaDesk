"""The voice radio: programs, the member list and the cassettes (spec 11).

Voices only (video audio is not on the radio). Promo voices are included: a
voice is her voice, and the promo flag comes from nearby text (this matches
the binder's count cards). Every function answers for one person
(``member``) or, with ``member=None``, for every person of the service.

Programs (:data:`PROGRAMS`; JST hour bands from spec 3.4, which partition the
day):

- ``oyasumi`` -- voices at 21:00-04:59 (after midnight counts as night);
  ``ohayo`` -- 05:00-09:59; ``otsukare`` -- 10:00-20:59. Each in the
  :func:`daily_order` shuffle, seeded by the *broadcast day*
  (:func:`broadcast_day`): the JST date shifted back by
  :data:`BROADCAST_ROLLOVER_HOUR` (5) hours, so the day rolls over at 05:00
  JST, the first non-night hour, and tonight's おやすみ order stays the same
  from 21:00 through 04:59. A new broadcast day gives a new order.
- ``chrono`` -- every voice of ``year`` (default: the scope's first year),
  oldest first.
- ``favorites`` -- favourited voices, oldest first.
- ``oyasumi_clips`` -- clips around transcript segments whose NFKC text
  matches ``lexicon.GREETING_RES["oyasumi"]`` (``transcripts.keyword_hits``),
  oldest first. A clip is the segment padded by :data:`CLIP_PAD_S` (start
  clamped at 0, end clamped to the voice's ``duration_s`` when known; a window
  left empty by the clamp is dropped). Clips of one voice that overlap or
  touch are merged into one track carrying all their segments.

API:

- ``program_of(fact)`` -- the hour band of a fact (pure).
- ``broadcast_day(now)`` -- the broadcast day (``YYYY-MM-DD``) of ``now``.
- ``daily_order(items, *, day, program, scope)`` -- a shuffled copy, seeded by
  ``sha256(f"{day}|{program}|{scope}")``.
- ``async radio_members(service, sdir)`` -- ``{"total_seconds", "members":
  [{"member_path", "member_id", "name", "avatar_url", "oshi", "voices",
  "seconds"}]}``: people with at least one voice, oshi first, then
  ``seconds`` descending. ``seconds`` / ``total_seconds`` are ``None`` when
  no voice has a known length. Cached (view ``radio_members``, key ``all``).
- ``async radio_program(service, sdir, *, program, member, year, now)`` --
  ``{"program", "programs", "years", "tracks": [{"message", "start", "end",
  "has_transcript", "segments"}]}``. ``programs`` lists the programs with
  tracks in this scope (in :data:`PROGRAMS` order); ``years`` the JST years
  with voices. Regular tracks play ``0 .. duration_s`` (``end`` ``None`` when
  unknown) with ``segments`` ``None``; clip tracks carry the clip window and
  ``segments`` = the matching segment(s). ``year`` only applies to ``chrono``
  and is ignored (treated as ``None``) for every other program. The text-free
  part is cached (view ``radio_program``, key ``<scope>:<program>:<year>``,
  hash over room hashes, ``transcripts_stat`` and the broadcast day, so each
  day replaces the row instead of adding one). Clip rows store each clip's
  segment indexes (text-free); after the cache read the segments are re-found
  by index and attached, and the texts are attached. Each room's
  ``transcriptions.json`` is read once per cache miss. An unknown
  ``program`` is ``ValueError``.
- ``async radio_cassettes(service, sdir, *, member)`` -- ``{"cassettes":
  [{"year", "voices", "seconds", "color"}]}``, oldest first. ``color`` is
  ``album_colors.month_color`` over that year's month colours
  (``album_colors.month_colors_for``), ``None`` when it has none. Cached
  (view ``radio_cassettes``, key = scope, hash over room hashes,
  ``people.media_dir_mtimes`` and ``album_colors.COLORS_VERSION``, so a
  year's colour fills in once its pictures arrive).

``scope`` is ``people.person_key`` or ``"all"``; it is never logged, nor is
any text, name, room or path. Logs: ``memories_radio`` once per call
(``view=members|program|cassettes`` plus counts; the program call adds
``program``, ``count``, ``with_transcript``, ``year``, ``scoped``) and
``memories_skip`` (``view=radio``) for ``empty_program`` and
``clip_missing`` (a cached clip whose segment index no longer points at a
matching segment).
"""

from __future__ import annotations

import asyncio
import hashlib
import random
from collections.abc import Sequence
from datetime import datetime, timedelta
from pathlib import Path
from typing import TypeVar

import structlog

from backend.services.memories import album_colors, people
from backend.services.memories import index as mi
from backend.services.memories import transcripts
from backend.services.memories.facts import Fact
from backend.services.memories.lexicon import GREETING_RES
from backend.services.memories.selection import JST, normalize
from backend.services.memories.view_cache import cached_view, view_hash

logger = structlog.get_logger(__name__)

PROGRAMS = ("oyasumi", "ohayo", "otsukare", "chrono", "favorites", "oyasumi_clips")
NIGHT_HOURS = {21, 22, 23, 0, 1, 2, 3, 4}
MORNING_HOURS = range(5, 10)
RADIO_VERSION = 1
CLIP_PATTERN = GREETING_RES["oyasumi"]
CLIP_PAD_S = 0.3
BROADCAST_ROLLOVER_HOUR = 5
# Windows closer than this (float noise from the padding) count as touching.
TOUCH_EPS_S = 1e-6

VIEW_MEMBERS = "radio_members"
VIEW_PROGRAM = "radio_program"
VIEW_CASSETTES = "radio_cassettes"

_Tagged = tuple[str, Fact]
# room, fact, window start, window end, segment indexes
_Clip = tuple[str, Fact, float, float, tuple[int, ...]]
_Loaded = dict[str, dict[int, list[dict]]]  # room -> message id -> segments
T = TypeVar("T")


# --- pure ------------------------------------------------------------------------------


def program_of(f: Fact) -> str:
    """The hour-band program of ``f`` (JST hour)."""
    if f.hour in NIGHT_HOURS:
        return "oyasumi"
    if f.hour in MORNING_HOURS:
        return "ohayo"
    return "otsukare"


def broadcast_day(now: datetime) -> str:
    """The broadcast day of ``now``: the JST date, rolling over at 05:00 JST."""
    shifted = now.astimezone(JST) - timedelta(hours=BROADCAST_ROLLOVER_HOUR)
    return shifted.date().isoformat()


def daily_order(items: Sequence[T], *, day: str, program: str, scope: str) -> list[T]:
    """A copy of ``items`` shuffled by ``sha256(f"{day}|{program}|{scope}")``."""
    seed = int(hashlib.sha256(f"{day}|{program}|{scope}".encode()).hexdigest()[:16], 16)
    out = list(items)
    random.Random(seed).shuffle(out)
    return out


def _seconds(facts: Sequence[Fact]) -> float | None:
    known = [f.duration_s for f in facts if f.duration_s is not None]
    return round(sum(known), 3) if known else None


def _voices(tagged: Sequence[_Tagged]) -> list[_Tagged]:
    return [t for t in tagged if t[1].type == "voice"]


def _rgb(hex_color: str) -> album_colors.RGB:
    return (
        int(hex_color[1:3], 16),
        int(hex_color[3:5], 16),
        int(hex_color[5:7], 16),
    )


def _buckets(
    voices: Sequence[_Tagged],
    clips: Sequence[_Clip],
    *,
    year: int | None,
    day: str,
    scope: str,
) -> dict[str, list]:
    """``program -> items`` (``_Tagged`` or, for clips, ``_Clip``). Pure."""
    out: dict[str, list] = {
        band: daily_order(
            [t for t in voices if program_of(t[1]) == band],
            day=day,
            program=band,
            scope=scope,
        )
        for band in ("oyasumi", "ohayo", "otsukare")
    }
    out["chrono"] = [t for t in voices if t[1].jst_date.year == year]
    out["favorites"] = [t for t in voices if t[1].favorited]
    out["oyasumi_clips"] = list(clips)
    return out


# --- transcripts ----------------------------------------------------------------------


def _load_rooms(sdir: Path, ids_by_room: dict[str, set[int]]) -> _Loaded:
    """One ``segments_for`` (one sidecar read) per room. Blocking."""
    return {
        room: transcripts.segments_for(sdir, room, ids)
        for room, ids in sorted(ids_by_room.items())
    }


def _load_voice_segments(sdir: Path, voices: Sequence[_Tagged]) -> _Loaded:
    """Segments of every transcribed voice, one sidecar read per room. Blocking."""
    ids_by_room: dict[str, set[int]] = {}
    for room, f in voices:
        ids_by_room.setdefault(room, set()).add(f.id)
    return _load_rooms(sdir, ids_by_room)


def _merge(
    windows: list[tuple[float, float, int]],
) -> list[tuple[float, float, tuple[int, ...]]]:
    """Merge windows that overlap or touch; ``(start, end, segment indexes)``. Pure."""
    out: list[tuple[float, float, tuple[int, ...]]] = []
    for start, end, i in sorted(windows):
        if out and start <= out[-1][1] + TOUCH_EPS_S:
            s0, e0, idx = out[-1]
            out[-1] = (s0, max(e0, end), (*idx, i))
        else:
            out.append((start, end, (i,)))
    return out


def _clips(voices: Sequence[_Tagged], loaded: _Loaded) -> list[_Clip]:
    """Keyword clips of the transcribed voices, oldest first. Pure."""
    facts = {(room, f.id): f for room, f in voices}
    order = {(room, f.id): n for n, (room, f) in enumerate(voices)}
    out: list[_Clip] = []
    for room, by_id in loaded.items():
        windows: dict[int, list[tuple[float, float, int]]] = {}
        for mid, i in transcripts.keyword_hits(by_id, CLIP_PATTERN):
            seg, f = by_id[mid][i], facts[(room, mid)]
            start = max(0.0, seg["start"] - CLIP_PAD_S)
            end = seg["end"] + CLIP_PAD_S
            if f.duration_s is not None:
                end = min(end, f.duration_s)
            if end > start:
                windows.setdefault(mid, []).append((start, end, i))
        for mid, wins in windows.items():
            f = facts[(room, mid)]
            out.extend((room, f, a, b, idx) for a, b, idx in _merge(wins))
    out.sort(key=lambda c: (order[(c[0], c[1].id)], c[2]))
    return out


def _clip_tracks_ids(tracks: Sequence[dict]) -> dict[str, set[int]]:
    ids_by_room: dict[str, set[int]] = {}
    for t in tracks:
        ids_by_room.setdefault(t["message"]["room"], set()).add(t["message"]["id"])
    return ids_by_room


def _attach_segments(tracks: list[dict], loaded: _Loaded) -> list[dict]:
    """Clip tracks with ``segments`` re-found by index. Pure.

    A track whose index no longer points at a matching segment is dropped.
    ``segment_indexes`` (a cache-only field) is removed from the result.
    """
    out: list[dict] = []
    for t in tracks:
        segs = loaded.get(t["message"]["room"], {}).get(t["message"]["id"], [])
        idx = t["segment_indexes"]
        picked = [
            segs[i]
            for i in idx
            if i < len(segs) and CLIP_PATTERN.search(normalize(segs[i]["text"]))
        ]
        if idx and len(picked) == len(idx):
            kept = {k: v for k, v in t.items() if k != "segment_indexes"}
            out.append({**kept, "segments": picked})
    return out


# --- members -------------------------------------------------------------------------


async def radio_members(service: str, sdir: Path) -> dict:
    """Voices per person, oshi first, then by seconds (see the module docstring)."""
    persons, _, hashes = await people.album_scope(sdir, None)
    oshi = await people.oshi_rooms(service, persons)
    data_hash = view_hash(RADIO_VERSION, hashes, sorted(oshi))

    async def build() -> dict:
        counted: list[tuple[mi.MemberSummary, int, float | None]] = []
        for s in persons:
            voices = [f for _, f in _voices(await people.scope_facts(sdir, [s]))]
            if voices:
                counted.append((s, len(voices), _seconds(voices)))
        counted.sort(key=lambda c: (c[0].name_norm not in oshi, -(c[2] or 0.0)))
        avatars = await people.avatar_timelines_for(
            sdir, {people.person_key(s): s for s, _, _ in counted}
        )
        rows = [
            {
                "member_path": people.chat_path(sdir, s.member_dirs[-1]),
                "member_id": s.member_ids[-1] if s.member_ids else None,
                "name": s.name,
                "avatar_url": avatars[people.person_key(s)].current,
                "oshi": s.name_norm in oshi,
                "voices": n,
                "seconds": sec,
            }
            for s, n, sec in counted
        ]
        known = [sec for _, _, sec in counted if sec is not None]
        return {
            "total_seconds": round(sum(known), 3) if known else None,
            "members": rows,
        }

    body = await cached_view(sdir, VIEW_MEMBERS, "all", data_hash, build)
    logger.info(
        "memories_radio",
        view="members",
        members=len(body["members"]),
        oshi=len(oshi),
    )
    return body


# --- programs ------------------------------------------------------------------------


def _track(
    service: str,
    sdir: Path,
    room: str,
    f: Fact,
    avatar: people.AvatarTimeline,
    *,
    start: float,
    end: float | None,
    has_transcript: bool,
) -> dict:
    return {
        "message": people.message_ref(service, sdir, room, f, avatar=avatar),
        "start": start,
        "end": end,
        "has_transcript": has_transcript,
        "segments": None,
    }


async def radio_program(
    service: str,
    sdir: Path,
    *,
    program: str,
    member: mi.MemberSummary | None,
    year: int | None,
    now: datetime,
) -> dict:
    """One program's tracks for one person or everyone (see the module docstring)."""
    if program not in PROGRAMS:
        raise ValueError("unknown program")
    persons, scope, hashes = await people.album_scope(sdir, member)
    rooms = [room for s in persons for room in s.member_dirs]
    if program != "chrono":
        year = None  # only the chronological program has a year
    stat = await asyncio.to_thread(transcripts.transcripts_stat, sdir, rooms)
    day = broadcast_day(now)
    data_hash = view_hash(RADIO_VERSION, hashes, stat, day)
    built: list[_Loaded] = []  # the build's sidecar reads, reused for the attach

    async def build() -> dict:
        voices = _voices(await people.scope_facts(sdir, persons))
        loaded = await asyncio.to_thread(_load_voice_segments, sdir, voices)
        built.append(loaded)
        transcribed = {(room, mid) for room, by_id in loaded.items() for mid in by_id}
        clips = await asyncio.to_thread(_clips, voices, loaded)
        years = sorted({f.jst_date.year for _, f in voices})
        chosen = year if year is not None else (years[0] if years else None)
        buckets = _buckets(voices, clips, year=chosen, day=day, scope=scope)
        # chrono has tracks whenever some year has voices (the cassette picks it)
        programs = [p for p in PROGRAMS if (voices if p == "chrono" else buckets[p])]
        items = buckets[program]
        room_person = {room: s for s in persons for room in s.member_dirs}
        used = {room_person[i[0]] for i in items}
        avatars = await people.avatar_timelines_for(
            sdir, {people.person_key(s): s for s in used}
        )

        def avatar(room: str) -> people.AvatarTimeline:
            return avatars[people.person_key(room_person[room])]

        if program == "oyasumi_clips":
            tracks = [
                {
                    **_track(
                        service,
                        sdir,
                        room,
                        f,
                        avatar(room),
                        start=start,
                        end=end,
                        has_transcript=True,
                    ),
                    "segment_indexes": list(idx),
                }
                for room, f, start, end, idx in items
            ]
        else:
            tracks = [
                _track(
                    service,
                    sdir,
                    room,
                    f,
                    avatar(room),
                    start=0,
                    end=f.duration_s,
                    has_transcript=(room, f.id) in transcribed,
                )
                for room, f in items
            ]
        return {
            "program": program,
            "programs": programs,
            "years": years,
            "tracks": tracks,
        }

    key = f"{scope}:{program}:{year}"
    body = await cached_view(sdir, VIEW_PROGRAM, key, data_hash, build)
    if program == "oyasumi_clips" and body["tracks"]:
        loaded = (
            built[0]
            if built
            else await asyncio.to_thread(
                _load_rooms, sdir, _clip_tracks_ids(body["tracks"])
            )
        )
        kept = _attach_segments(body["tracks"], loaded)
        if len(kept) < len(body["tracks"]):
            logger.warning(
                "memories_skip",
                view="radio",
                reason="clip_missing",
                count=len(body["tracks"]) - len(kept),
            )
        body["tracks"] = kept
    await people.attach_texts(sdir, [t["message"] for t in body["tracks"]])
    years = body["years"]
    shown_year = (
        (year if year is not None else (years[0] if years else None))
        if program == "chrono"
        else None
    )
    if not body["tracks"]:
        logger.info("memories_skip", view="radio", reason="empty_program")
    logger.info(
        "memories_radio",
        view="program",
        program=program,
        count=len(body["tracks"]),
        with_transcript=sum(1 for t in body["tracks"] if t["has_transcript"]),
        year=shown_year,
        scoped=member is not None,
    )
    return body


# --- cassettes -------------------------------------------------------------------------


async def radio_cassettes(
    service: str, sdir: Path, *, member: mi.MemberSummary | None
) -> dict:
    """One tape per JST year with voices, oldest first (see the module docstring)."""
    persons, scope, hashes = await people.album_scope(sdir, member)
    data_hash = view_hash(
        RADIO_VERSION,
        hashes,
        await people.media_dir_mtimes(sdir, persons),
        album_colors.COLORS_VERSION,
    )

    async def build() -> dict:
        by_year: dict[int, list[Fact]] = {}
        for _, f in _voices(await people.scope_facts(sdir, persons)):
            by_year.setdefault(f.jst_date.year, []).append(f)
        colors: dict[str, str | None] = {}
        if by_year:
            colors = (await album_colors.month_colors_for(service, sdir, member))[
                "colors"
            ]
        cassettes = []
        for y in sorted(by_year):
            rgbs = [
                _rgb(c)
                for month, c in sorted(colors.items())
                if month.startswith(f"{y:04d}-") and c
            ]
            cassettes.append(
                {
                    "year": y,
                    "voices": len(by_year[y]),
                    "seconds": _seconds(by_year[y]),
                    "color": album_colors.month_color(rgbs),
                }
            )
        return {"cassettes": cassettes}

    body = await cached_view(sdir, VIEW_CASSETTES, scope, data_hash, build)
    logger.info(
        "memories_radio",
        view="cassettes",
        count=len(body["cassettes"]),
        colored=sum(1 for c in body["cassettes"] if c["color"] is not None),
        scoped=member is not None,
    )
    return body


__all__ = [
    "MORNING_HOURS",
    "NIGHT_HOURS",
    "PROGRAMS",
    "RADIO_VERSION",
    "broadcast_day",
    "daily_order",
    "program_of",
    "radio_cassettes",
    "radio_members",
    "radio_program",
]
