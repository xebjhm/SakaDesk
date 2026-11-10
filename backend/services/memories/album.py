"""The album: member counts, monthly polaroid sections and bursts (spec 8).

Every function answers for one person (``member``) or, with ``member=None``,
for every person of the service (全員). ``kind`` filters the album's items:
``all`` = pictures and videos, ``picture`` / ``video`` = one type,
``favorite`` = favourited pictures and videos. Promo items are included
everywhere (it is her real chat); they only lose the cover.

- :func:`album_members` -- ``{"total", "members": [{"member_path",
  "member_id", "name", "avatar_url", "count", "oshi"}]}``: pictures + videos
  per person (promo included), oshi first (``oshi`` marks them), then by count
  descending. People with
  none are omitted, so a "0" is never shown. ``total`` is the 全員 count.
  Cached text-free (view ``album_members``, key ``all``).
- :func:`choose_cover` (pure) -- the month's cover and its rule, in the spec
  8 order: ``override`` (a valid ``covers.load_cover_overrides`` entry), then
  ``favorite`` (★, oshi rooms first, then the highest ``photo_score``), then
  ``score`` (the highest ``photo_score``), then ``burst`` (the first item of
  the largest burst; bursts are keyed ``(room, burst_id)``), then ``first``
  (time order). Ties go to the earlier item. A valid override always wins;
  otherwise promo and screenshot-like items are a last resort across the
  whole chain: the chain runs over the clean items first and over the
  demoted ones only when no clean item exists. ``screenshot_like`` is asked
  about the top 3 non-promo items of every rule list (deduplicated).
- :func:`album_months` -- ``{"months": [{"month", "count", "cover",
  "cover_rule", "cover_color", "has_favorites"}]}``, newest first.
  ``count`` is the month's one number. Screenshot-likeness and
  ``cover_color`` (the cover picture's probe colour, ``#rrggbb``; ``None``
  for a video or an unreadable picture; it tints the month band) come from
  ``album_colors.probes``, pictures only. The text-free structure is cached
  (view ``album_months``, key ``<scope>:<kind>``, hash over room hashes,
  media-dir mtimes, oshi rooms and overrides); the cover's text / caption is
  attached after the cache read.
- :func:`album_month` -- ``{"month", "items", "bursts"}``: the month's items
  in time order with their texts and ``bursts`` = ``[{"burst_id", "room",
  "ids"}]`` for bursts with >= 3 items in the filtered set. Cached text-free
  (view ``album_month``, key ``<scope>:<kind>:<month>``).

``scope`` is ``people.person_key`` or ``"all"``; it is never logged.

Logs (ids, codes, counts and scores only): ``memories_select``
(``view=album_cover``, ``rule``, ``score``, ``fallback``, ``message_id``,
``month``; ``fallback`` = a burst / first / promo / screenshot cover) per
month when the months are built, and ``memories_album`` (``months``,
``count``, ``kind``) and ``memories_album_month`` per request.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Sequence
from datetime import datetime
from pathlib import Path

import structlog

from backend.services.memories import album_colors, covers, people
from backend.services.memories import index as mi
from backend.services.memories.facts import Fact
from backend.services.memories.timeline import MONTH_RE, month_of
from backend.services.memories.view_cache import cached_view, view_hash

logger = structlog.get_logger(__name__)

VIEW_COVER = "album_cover"
VIEW_MEMBERS = "album_members"
VIEW_MONTHS = "album_months"
VIEW_MONTH = "album_month"
# Bump on any rule or payload change (the album cache hashes have it).
ALBUM_VERSION = 3
KINDS = frozenset({"all", "picture", "video", "favorite"})
SCREENSHOT_CHECKS = 3
BURST_MIN = 3

_Tagged = tuple[str, Fact]
ScreenshotLike = Callable[[str, Fact], bool]


def _order(t: _Tagged) -> tuple[datetime, int, str]:
    return t[1].ts, t[1].id, t[0]


def _check_kind(kind: str) -> None:
    if kind not in KINDS:
        raise ValueError("kind must be all, picture, video or favorite")


def keep(f: Fact, kind: str) -> bool:
    """Whether ``f`` belongs to the album filtered by ``kind``."""
    if f.type not in people.MEDIA_TYPES:
        return False
    if kind == "favorite":
        return f.favorited
    return kind == "all" or f.type == kind


# --- covers ---------------------------------------------------------------------------


def _burst_heads(cands: Sequence[_Tagged]) -> list[_Tagged]:
    """The first item of every burst, largest burst first (ties: the earlier)."""
    groups: dict[tuple[str, int], list[_Tagged]] = {}
    for t in cands:
        if t[1].burst_id is not None:
            groups.setdefault((t[0], t[1].burst_id), []).append(t)
    heads = [(len(g), min(g, key=_order)) for g in groups.values()]
    heads.sort(key=lambda h: (-h[0], *_order(h[1])))
    return [head for _, head in heads]


def _rule_lists(
    cands: Sequence[_Tagged], oshi_rooms: set[str]
) -> list[tuple[str, list[_Tagged]]]:
    """``[(rule, ordered items)]`` for favorite, score, burst and first."""
    favorites = sorted(
        (t for t in cands if t[1].favorited),
        key=lambda t: (t[0] not in oshi_rooms, -(t[1].photo_score or 0), *_order(t)),
    )
    scored = sorted(
        (t for t in cands if t[1].photo_score is not None),
        key=lambda t: (-(t[1].photo_score or 0), *_order(t)),
    )
    return [
        ("favorite", favorites),
        ("score", scored),
        ("burst", _burst_heads(cands)),
        ("first", sorted(cands, key=_order)),
    ]


def _chain(
    cands: Sequence[_Tagged], oshi_rooms: set[str]
) -> tuple[_Tagged, str] | None:
    """The first item of the first non-empty rule list, or ``None``."""
    for rule, items in _rule_lists(cands, oshi_rooms):
        if items:
            return items[0], rule
    return None


def choose_cover(
    cands: list[tuple[str, Fact]],
    *,
    override: tuple[str, int] | None,
    oshi_rooms: set[str],
    screenshot_like: ScreenshotLike,
) -> tuple[tuple[str, Fact], str] | None:
    """The month's cover ``(room, fact)`` and its rule; ``None`` for no candidates.

    A valid ``override`` (its ``(room, id)`` is among ``cands``) always wins,
    promo or not. Otherwise the rule chain runs over the clean candidates
    first; promo and screenshot-like items are a last resort, used only when
    no clean candidate exists (the same chain then runs over them).
    ``screenshot_like`` is asked once for each of the top 3 non-promo items of
    every rule list (deduplicated); the asked set does not depend on the
    answers. ``oshi_rooms`` holds rooms.
    """
    if not cands:
        return None
    if override is not None:
        hit = next((t for t in cands if (t[0], t[1].id) == override), None)
        if hit is not None:
            return hit, "override"
    nonpromo = [t for t in cands if not t[1].is_promo]
    asked: dict[tuple[str, int], bool] = {}
    for _, items in _rule_lists(nonpromo, oshi_rooms):
        for room, f in items[:SCREENSHOT_CHECKS]:
            if (room, f.id) not in asked:
                asked[(room, f.id)] = screenshot_like(room, f)
    clean = [t for t in nonpromo if not asked.get((t[0], t[1].id), False)]
    clean_keys = {(t[0], t[1].id) for t in clean}
    demoted = [t for t in cands if (t[0], t[1].id) not in clean_keys]
    return _chain(clean, oshi_rooms) or _chain(demoted, oshi_rooms)


# --- members ----------------------------------------------------------------------------


async def album_members(service: str, sdir: Path) -> dict:
    """Pictures + videos per person, oshi first, then by count (see the module docstring)."""
    persons, _, hashes = await people.album_scope(sdir, None)
    oshi = await people.oshi_rooms(service, persons)
    data_hash = view_hash(ALBUM_VERSION, hashes, sorted(oshi))

    async def build() -> dict:
        counted: list[tuple[mi.MemberSummary, int]] = []
        for s in persons:
            tagged = await people.scope_facts(sdir, [s])
            n = sum(1 for _, f in tagged if keep(f, "all"))
            if n:
                counted.append((s, n))
        counted.sort(key=lambda c: (c[0].name_norm not in oshi, -c[1]))
        avatars = await people.avatar_timelines_for(
            sdir, {people.person_key(s): s for s, _ in counted}
        )
        rows = [
            {
                "member_path": people.chat_path(sdir, s.member_dirs[-1]),
                "member_id": s.member_ids[-1] if s.member_ids else None,
                "name": s.name,
                "avatar_url": avatars[people.person_key(s)].current,
                "count": n,
                "oshi": s.name_norm in oshi,
            }
            for s, n in counted
        ]
        total = sum(n for _, n in counted)
        logger.info(
            "memories_album_members", members=len(rows), total=total, oshi=len(oshi)
        )
        return {"total": total, "members": rows}

    return await cached_view(sdir, VIEW_MEMBERS, "all", data_hash, build)


# --- months ------------------------------------------------------------------------------


def _by_month(tagged: Sequence[_Tagged], kind: str) -> dict[str, list[_Tagged]]:
    """``month -> filtered items`` in time order. Pure; runs in a worker."""
    out: dict[str, list[_Tagged]] = {}
    for t in tagged:
        if keep(t[1], kind):
            out.setdefault(month_of(t[1].jst_date), []).append(t)
    return out


def _covers(
    months: dict[str, list[_Tagged]],
    overrides: dict[str, tuple[str, int]],
    oshi_rooms: set[str],
    screenshot_like: ScreenshotLike,
) -> dict[str, tuple[_Tagged, str]]:
    """``month -> choose_cover(...)`` (every listed month has items). Pure."""
    out: dict[str, tuple[_Tagged, str]] = {}
    for month, items in months.items():
        pick = choose_cover(
            items,
            override=overrides.get(month),
            oshi_rooms=oshi_rooms,
            screenshot_like=screenshot_like,
        )
        if pick is not None:
            out[month] = pick
    return out


def _room_people(persons: Sequence[mi.MemberSummary]) -> dict[str, mi.MemberSummary]:
    return {room: s for s in persons for room in s.member_dirs}


async def _avatars_by_room(
    sdir: Path, persons: Sequence[mi.MemberSummary], rooms: set[str]
) -> dict[str, people.AvatarTimeline]:
    """``room -> her avatar timeline`` for the people owning ``rooms``."""
    owners = _room_people(persons)
    needed = {people.person_key(owners[r]): owners[r] for r in rooms}
    timelines = await people.avatar_timelines_for(sdir, needed)
    return {r: timelines[people.person_key(owners[r])] for r in rooms}


_Probes = dict[str, album_colors.ImageProbe | None]


def _picture_file(f: Fact) -> str | None:
    """The service-relative file of a picture (``None`` for a video or no file)."""
    return people.media_file_for(f) if f.type == "picture" else None


def _probe_of(found: _Probes, f: Fact) -> album_colors.ImageProbe | None:
    mf = _picture_file(f)
    return found.get(mf) if mf is not None else None


async def _consulted_probes(
    sdir: Path,
    months: dict[str, list[_Tagged]],
    overrides: dict[str, tuple[str, int]],
    oshi_rooms: set[str],
) -> _Probes:
    """Probes of every picture ``choose_cover`` asks ``screenshot_like`` about."""
    asked: set[str] = set()

    def record(room: str, f: Fact) -> bool:
        mf = _picture_file(f)
        if mf is not None:
            asked.add(mf)
        return False

    # the asked set does not depend on the answers: one dry pass finds it
    await asyncio.to_thread(_covers, months, overrides, oshi_rooms, record)
    return await album_colors.probes(sdir, sorted(asked))


def _screenshot_fn(found: _Probes) -> ScreenshotLike:
    def screenshot_like(room: str, f: Fact) -> bool:
        p = _probe_of(found, f)
        return p is not None and album_colors.is_screenshot_like(p)

    return screenshot_like


def _months_payload(
    service: str,
    sdir: Path,
    months: dict[str, list[_Tagged]],
    chosen: dict[str, tuple[_Tagged, str]],
    avatars: dict[str, people.AvatarTimeline],
    found: _Probes,
) -> dict:
    """The text-free months payload, newest first. Blocking (runs in a worker)."""
    shot = _screenshot_fn(found)
    rows = []
    for month in sorted(months, reverse=True):
        items = months[month]
        (room, f), rule = chosen[month]
        probe = _probe_of(found, f)
        logger.info(
            "memories_select",
            view=VIEW_COVER,
            rule=rule,
            score=f.photo_score,
            fallback=rule in ("burst", "first") or f.is_promo or shot(room, f),
            message_id=f.id,
            month=month,
        )
        rows.append(
            {
                "month": month,
                "count": len(items),
                "cover": people.message_ref(
                    service, sdir, room, f, avatar=avatars[room]
                ),
                "cover_rule": rule,
                "cover_color": (
                    album_colors.hex_of(probe.rgb)
                    if probe is not None and probe.rgb is not None
                    else None
                ),
                "has_favorites": any(t[1].favorited for t in items),
            }
        )
    return {"months": rows}


async def album_months(
    service: str, sdir: Path, *, member: mi.MemberSummary | None, kind: str
) -> dict:
    """The album's monthly sections, newest first (see the module docstring)."""
    _check_kind(kind)
    persons, scope, hashes = await people.album_scope(sdir, member)
    oshi_names = await people.oshi_rooms(service, persons)
    oshi_rooms = {
        r for s in persons if s.name_norm in oshi_names for r in s.member_dirs
    }
    overrides = await covers.load_cover_overrides(sdir, scope)
    data_hash = view_hash(
        ALBUM_VERSION,
        hashes,
        await people.media_dir_mtimes(sdir, persons),
        sorted(oshi_rooms),
        sorted(overrides.items()),
    )

    async def build() -> dict:
        tagged = await people.scope_facts(sdir, persons)
        months = await asyncio.to_thread(_by_month, tagged, kind)
        found = await _consulted_probes(sdir, months, overrides, oshi_rooms)
        chosen = await asyncio.to_thread(
            _covers, months, overrides, oshi_rooms, _screenshot_fn(found)
        )
        # the cover tint: probe covers the rules did not ask about (cached)
        extra = [
            mf
            for (_, f), _ in chosen.values()
            if (mf := _picture_file(f)) is not None and mf not in found
        ]
        found.update(await album_colors.probes(sdir, extra))
        rooms = {room for (room, _), _ in chosen.values()}
        avatars = await _avatars_by_room(sdir, persons, rooms)
        return await asyncio.to_thread(
            _months_payload, service, sdir, months, chosen, avatars, found
        )

    payload = await cached_view(sdir, VIEW_MONTHS, f"{scope}:{kind}", data_hash, build)
    await people.attach_texts(sdir, [m["cover"] for m in payload["months"]])
    logger.info(
        "memories_album",
        months=len(payload["months"]),
        count=sum(m["count"] for m in payload["months"]),
        kind=kind,
    )
    return payload


# --- one month ------------------------------------------------------------------------------


def _month_payload(
    service: str,
    sdir: Path,
    month: str,
    items: list[_Tagged],
    avatars: dict[str, people.AvatarTimeline],
) -> dict:
    """The text-free month payload. Blocking (runs in a worker)."""
    groups: dict[tuple[str, int], list[_Tagged]] = {}
    for t in items:
        if t[1].burst_id is not None:
            groups.setdefault((t[0], t[1].burst_id), []).append(t)
    bursts = [
        {"burst_id": bid, "room": room, "ids": [f.id for _, f in g]}
        for (room, bid), g in sorted(groups.items(), key=lambda kv: _order(kv[1][0]))
        if len(g) >= BURST_MIN
    ]
    return {
        "month": month,
        "items": [
            people.message_ref(service, sdir, room, f, avatar=avatars[room])
            for room, f in items
        ],
        "bursts": bursts,
    }


async def album_month(
    service: str,
    sdir: Path,
    month: str,
    *,
    member: mi.MemberSummary | None,
    kind: str,
) -> dict:
    """One month's items and bursts, with texts (see the module docstring)."""
    if not MONTH_RE.match(month):
        raise ValueError("month must be YYYY-MM")
    _check_kind(kind)
    persons, scope, hashes = await people.album_scope(sdir, member)
    data_hash = view_hash(ALBUM_VERSION, hashes, month)

    async def build() -> dict:
        tagged = await people.scope_facts(sdir, persons)
        items = (await asyncio.to_thread(_by_month, tagged, kind)).get(month, [])
        avatars = await _avatars_by_room(sdir, persons, {room for room, _ in items})
        return await asyncio.to_thread(
            _month_payload, service, sdir, month, items, avatars
        )

    key = f"{scope}:{kind}:{month}"
    payload = await cached_view(sdir, VIEW_MONTH, key, data_hash, build)
    await people.attach_texts(sdir, payload["items"])
    logger.info(
        "memories_album_month",
        month=month,
        kind=kind,
        count=len(payload["items"]),
        bursts=len(payload["bursts"]),
    )
    return payload


__all__ = [
    "KINDS",
    "album_members",
    "album_month",
    "album_months",
    "choose_cover",
    "keep",
]
