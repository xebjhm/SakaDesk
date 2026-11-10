"""The album: member counts, monthly polaroid sections and bursts (spec 8).

Every function answers for one person (``member``) or, with ``member=None``,
for every person of the service (全員). ``kind`` filters the album's items:
``all`` = pictures and videos, ``picture`` / ``video`` = one type,
``favorite`` = favourited pictures and videos. Promo items are included
everywhere (it is her real chat); they only lose the cover.

- :func:`album_members` -- ``{"total", "members": [{"member_path",
  "member_id", "name", "avatar_url", "count"}]}``: pictures + videos per
  person (promo included), oshi first, then by count descending. People with
  none are omitted, so a "0" is never shown. ``total`` is the 全員 count.
  Cached text-free (view ``album_members``, key ``all``).
- :func:`choose_cover` (pure) -- the month's cover and its rule, in the spec
  8 order: ``override`` (a valid ``covers.load_cover_overrides`` entry), then
  ``favorite`` (★, oshi rooms first, then the highest ``photo_score``), then
  ``score`` (the highest ``photo_score``), then ``burst`` (the first item of
  the largest burst; bursts are keyed ``(room, burst_id)``), then ``first``
  (time order). Within each rule's list, promo items move to the end, then
  the top 3 are checked with ``screenshot_like`` and the screenshot-like ones
  move to the very end. Ties go to the earlier item.
- :func:`album_months` -- ``{"months": [{"month", "count", "cover",
  "cover_rule", "has_favorites"}]}``, newest first. ``count`` is the month's
  one number. Screenshot-likeness comes from ``album_colors.probes``
  (pictures only). The text-free structure is cached (view ``album_months``,
  key ``<scope>:<kind>``, hash over room hashes, oshi rooms and overrides);
  the cover's text / caption is attached after the cache read.
- :func:`album_month` -- ``{"month", "items", "bursts"}``: the month's items
  in time order with their texts and ``bursts`` = ``[{"burst_id", "room",
  "ids"}]`` for bursts with >= 3 items in the filtered set. Cached text-free
  (view ``album_month``, key ``<scope>:<kind>:<month>``).

``scope`` is ``people.person_key`` or ``"all"``; it is never logged.

Logs (ids, codes, counts and scores only): ``memories_select``
(``view=album_cover``, ``rule``, ``score``, ``fallback``, ``message_id``,
``month``) per month when the months are built, ``memories_skip``
(``view=album_cover``, ``reason=no_cover``) for a month without a cover,
and ``memories_album`` (``months``, ``count``, ``kind``) per request.
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
ALBUM_VERSION = 1
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


def _demote(items: list[_Tagged], screenshot_like: ScreenshotLike) -> list[_Tagged]:
    """Promo to the end, then screenshot-like ones of the top 3 to the very end."""
    ordered = [t for t in items if not t[1].is_promo]
    ordered += [t for t in items if t[1].is_promo]
    head = ordered[:SCREENSHOT_CHECKS]
    shots = [screenshot_like(room, f) for room, f in head]
    if not any(shots):
        return ordered
    kept = [t for t, shot in zip(head, shots) if not shot]
    moved = [t for t, shot in zip(head, shots) if shot]
    return kept + ordered[SCREENSHOT_CHECKS:] + moved


def _burst_heads(cands: Sequence[_Tagged]) -> list[_Tagged]:
    """The first item of every burst, largest burst first (ties: the earlier)."""
    groups: dict[tuple[str, int], list[_Tagged]] = {}
    for t in cands:
        if t[1].burst_id is not None:
            groups.setdefault((t[0], t[1].burst_id), []).append(t)
    heads = [(len(g), min(g, key=_order)) for g in groups.values()]
    heads.sort(key=lambda h: (-h[0], *_order(h[1])))
    return [head for _, head in heads]


def choose_cover(
    cands: list[tuple[str, Fact]],
    *,
    override: tuple[str, int] | None,
    oshi_rooms: set[str],
    screenshot_like: ScreenshotLike,
) -> tuple[tuple[str, Fact], str] | None:
    """The month's cover ``(room, fact)`` and its rule; ``None`` for no candidates.

    See the module docstring for the rule order. ``override`` counts only
    when that ``(room, id)`` is among ``cands``; ``oshi_rooms`` holds rooms.
    """
    if not cands:
        return None
    if override is not None:
        hit = next((t for t in cands if (t[0], t[1].id) == override), None)
        if hit is not None:
            return hit, "override"
    favorites = sorted(
        (t for t in cands if t[1].favorited),
        key=lambda t: (t[0] not in oshi_rooms, -(t[1].photo_score or 0), *_order(t)),
    )
    scored = sorted(
        (t for t in cands if t[1].photo_score is not None),
        key=lambda t: (-(t[1].photo_score or 0), *_order(t)),
    )
    rules: list[tuple[str, list[_Tagged]]] = [
        ("favorite", favorites),
        ("score", scored),
        ("burst", _burst_heads(cands)),
        ("first", sorted(cands, key=_order)),
    ]
    for rule, items in rules:
        if items:
            return _demote(items, screenshot_like)[0], rule
    return None  # pragma: no cover - "first" always has the candidates


# --- members ----------------------------------------------------------------------------


async def album_members(service: str, sdir: Path) -> dict:
    """Pictures + videos per person, oshi first, then by count (see the module docstring)."""
    persons, _, hashes = await album_colors.scope_of(sdir, None)
    oshi = await people.oshi_rooms(service, persons)
    data_hash = view_hash(ALBUM_VERSION, hashes, sorted(oshi))

    async def build() -> dict:
        counted: list[tuple[mi.MemberSummary, int]] = []
        for s in persons:
            tagged = await album_colors.scope_facts(sdir, [s])
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
) -> dict[str, tuple[_Tagged, str] | None]:
    """``month -> choose_cover(...)``. Pure; runs in a worker."""
    return {
        month: choose_cover(
            items,
            override=overrides.get(month),
            oshi_rooms=oshi_rooms,
            screenshot_like=screenshot_like,
        )
        for month, items in months.items()
    }


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


async def _screenshot_check(
    sdir: Path,
    months: dict[str, list[_Tagged]],
    overrides: dict[str, tuple[str, int]],
    oshi_rooms: set[str],
) -> ScreenshotLike:
    """A ``screenshot_like`` backed by probes of the pictures the rules consult."""
    asked: set[str] = set()

    def record(room: str, f: Fact) -> bool:
        mf = people.media_file_for(f)
        if f.type == "picture" and mf is not None:
            asked.add(mf)
        return False

    # the consulted top 3 do not depend on the answers: one dry pass finds them
    await asyncio.to_thread(_covers, months, overrides, oshi_rooms, record)
    found = await album_colors.probes(sdir, sorted(asked))

    def screenshot_like(room: str, f: Fact) -> bool:
        mf = people.media_file_for(f)
        p = found.get(mf) if f.type == "picture" and mf is not None else None
        return p is not None and album_colors.is_screenshot_like(p)

    return screenshot_like


def _months_payload(
    service: str,
    sdir: Path,
    months: dict[str, list[_Tagged]],
    chosen: dict[str, tuple[_Tagged, str] | None],
    avatars: dict[str, people.AvatarTimeline],
) -> dict:
    """The text-free months payload, newest first. Blocking (runs in a worker)."""
    rows = []
    for month in sorted(months, reverse=True):
        items = months[month]
        pick = chosen[month]
        cover = None
        rule = None
        if pick is None:  # pragma: no cover - a listed month always has items
            logger.info("memories_skip", view=VIEW_COVER, reason="no_cover")
        else:
            (room, f), rule = pick
            cover = people.message_ref(service, sdir, room, f, avatar=avatars[room])
            logger.info(
                "memories_select",
                view=VIEW_COVER,
                rule=rule,
                score=f.photo_score,
                fallback=rule in ("burst", "first"),
                message_id=f.id,
                month=month,
            )
        rows.append(
            {
                "month": month,
                "count": len(items),
                "cover": cover,
                "cover_rule": rule,
                "has_favorites": any(f.favorited for _, f in items),
            }
        )
    return {"months": rows}


async def album_months(
    service: str, sdir: Path, *, member: mi.MemberSummary | None, kind: str
) -> dict:
    """The album's monthly sections, newest first (see the module docstring)."""
    _check_kind(kind)
    persons, scope, hashes = await album_colors.scope_of(sdir, member)
    oshi_names = await people.oshi_rooms(service, persons)
    oshi_rooms = {
        r for s in persons if s.name_norm in oshi_names for r in s.member_dirs
    }
    overrides = await covers.load_cover_overrides(sdir, scope)
    data_hash = view_hash(
        ALBUM_VERSION, hashes, sorted(oshi_rooms), sorted(overrides.items())
    )

    async def build() -> dict:
        tagged = await album_colors.scope_facts(sdir, persons)
        months = await asyncio.to_thread(_by_month, tagged, kind)
        check = await _screenshot_check(sdir, months, overrides, oshi_rooms)
        chosen = await asyncio.to_thread(_covers, months, overrides, oshi_rooms, check)
        rooms = {pick[0][0] for pick in chosen.values() if pick is not None}
        avatars = await _avatars_by_room(sdir, persons, rooms)
        return await asyncio.to_thread(
            _months_payload, service, sdir, months, chosen, avatars
        )

    payload = await cached_view(sdir, VIEW_MONTHS, f"{scope}:{kind}", data_hash, build)
    cover_refs = [m["cover"] for m in payload["months"] if m["cover"] is not None]
    await people.attach_texts(sdir, cover_refs)
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
    persons, scope, hashes = await album_colors.scope_of(sdir, member)
    data_hash = view_hash(ALBUM_VERSION, hashes, month)

    async def build() -> dict:
        tagged = await album_colors.scope_facts(sdir, persons)
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
