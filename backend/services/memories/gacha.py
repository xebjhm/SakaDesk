"""回憶扭蛋, the memory gacha (spec 12): 3 pulls per JST day, rarity, history.

Every pull draws one of her messages from the whole service. The draw is
deterministic per JST day: the same salt, service, day and pull index give
the same message, also after a restart (the salt lives in ``app_state``).

Pool (:func:`build_pool`): every non-promo fact of every person in the
service that is text with an importance score, or a picture / video / voice
with a media file. Promo is never in the pool.

Rarity (:func:`classify`; first match wins; SR never applies to promo):

- ``sr`` / ``midnight`` -- 00:00-00:05 JST (the ``moment.midnight`` rule);
  ``birthday`` -- her birthday's JST date (``cards.parse_birthday``; Feb 29
  is Feb 28 in non-leap years); ``sub_anniversary`` -- the fan's
  subscription anniversary (``cards.anniversary_date`` of
  ``binder.subscription_start``, k >= 1); ``last_message`` -- a graduated
  person's last fact, only when that fact is not promo, so 「最後のメッセージ」
  is literally her last.
- ``r`` / ``nickname``, ``favorite``, ``voice``.
- ``n`` / ``photo`` (picture, video) or ``message``.

Draw (:func:`draw`, pure; all randomness is here and in the seed):

- The tier is rolled first with :data:`TIER_ODDS`. An empty tier falls to the
  next lower tier, then upward (``memories_select`` ``fallback=tier_empty``).
- Within the tier, a weighted choice with :func:`weight`
  (``1 + min(9, score / 200)``; :func:`score_of`). Candidates are sorted by
  ``(room, id)`` first, so read order never matters.
- The seed is :func:`seed_for` = ``sha256(salt|service|jst_date|pull_index)``.
- No repeats: messages pulled in the last :data:`RECENT_DAYS` JST days
  (today included) are left out while at least :data:`MIN_POOL_AFTER_RECENT`
  others remain (:func:`exclude_recent`; else ``fallback=repeat_allowed``).

API:

- ``async build_pool(service, sdir, *, today)`` -- the candidates. The
  text-free part (keys, rarity, reason, score) is cached (view
  ``gacha_pool``, key ``all``, hash over every room hash and ``today``, which
  moves the anniversary years).
- ``async gacha_state(service, sdir, *, now)`` -- ``{"available",
  "pulls_left", "max_pulls", "today", "history"}``. ``history`` is newest
  first (at most :data:`HISTORY_LIMIT`, today included); ``today`` is
  today's pulls by index. A pull is ``{"jst_date", "pull_index", "rarity",
  "reason", "pulled_at", "message"}``. A pulled message no longer in the
  archive keeps its row with a message whose ``type``, ``ts`` and ``text``
  are ``None`` (a date-only card). ``pulls_left`` may be 0: the UI shows
  「また明日」, never the number.
- ``async pull(service, sdir, *, now)`` -- ``{"pull", "pulls_left"}``, or
  ``None`` when no pulls are left (also when a racing click took the last
  one). With an empty pool: ``{"pull": None, "pulls_left": n}``.

Logs carry ids, codes, counts and scores only: never the salt, a seed, text,
names, rooms or paths. ``memories_gacha`` once per call (``op=pool|state|
pull``); ``memories_select`` (``view=gacha``) for each fallback;
``memories_skip`` (``view=gacha``, ``reason=pull_missing``).
"""

from __future__ import annotations

import hashlib
import random
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

import structlog

from backend.services.memories import binder, people
from backend.services.memories import index as mi
from backend.services.memories import user_store
from backend.services.memories.cards import (
    MessageKey,
    anniversary_date,
    parse_birthday,
)
from backend.services.memories.facts import Fact
from backend.services.memories.selection import JST
from backend.services.memories.view_cache import cached_view, view_hash

logger = structlog.get_logger(__name__)

GACHA_VERSION = 1
MAX_PULLS = 3
HISTORY_LIMIT = 60
RECENT_DAYS = 30
MIN_POOL_AFTER_RECENT = 10
# Tier odds, rolled in this order; the tiers' fallback order is sr -> r -> n.
TIER_ODDS = (("sr", 0.03), ("r", 0.17), ("n", 0.80))
TIERS = tuple(t for t, _ in TIER_ODDS)
MIDNIGHT_LAST_MINUTE = 5
SCORE_PER_WEIGHT = 200
MAX_EXTRA_WEIGHT = 9
VOICE_BASE_SCORE = 100
# A leap year, so a Feb 29 birthday is a valid base for ``anniversary_date``.
_LEAP_BASE_YEAR = 2000

VIEW_POOL = "gacha_pool"
_EVENT = "memories_gacha"
_WORDS = frozenset({"text"})
_PHOTOS = people.MEDIA_TYPES
_MEDIA = _PHOTOS | {"voice"}


@dataclass(frozen=True)
class Candidate:
    room: str
    fact: Fact
    rarity: str
    reason: str
    score: float


# --- pure ------------------------------------------------------------------------------


def eligible(f: Fact) -> bool:
    """In the pool: non-promo text with importance, or media with a file."""
    if f.is_promo:
        return False
    if f.type in _WORDS:
        return f.importance is not None
    return f.type in _MEDIA and f.media_file is not None


def score_of(f: Fact) -> float:
    """Importance for words, photo score for media, ``100 + seconds`` for voice."""
    if f.type == "voice":
        return VOICE_BASE_SCORE + (f.duration_s or 0.0)
    if f.type in _PHOTOS:
        return f.photo_score or 0
    return f.importance or 0


def weight(score: float | None) -> float:
    """``1 + min(9, score / 200)``; a missing or negative score weighs 1."""
    return 1 + min(MAX_EXTRA_WEIGHT, max(0.0, score or 0.0) / SCORE_PER_WEIGHT)


def _birthday_on(md: tuple[int, int], year: int) -> date:
    return anniversary_date(date(_LEAP_BASE_YEAR, *md), year - _LEAP_BASE_YEAR)


def anniversaries_of(start: date | None, today: date) -> frozenset[date]:
    """Subscription anniversaries k = 1 .. up to ``today``'s year."""
    if start is None:
        return frozenset()
    return frozenset(
        anniversary_date(start, k) for k in range(1, today.year - start.year + 1)
    )


def classify(
    fact: Fact,
    *,
    birthday_md: tuple[int, int] | None,
    anniversaries: frozenset[date],
    last_key: MessageKey | None,
    room: str,
) -> tuple[str, str]:
    """``(rarity, reason)`` of ``fact`` (see the module docstring). Pure."""
    if not fact.is_promo:
        if fact.hour == 0 and fact.minute <= MIDNIGHT_LAST_MINUTE:
            return "sr", "midnight"
        if birthday_md is not None and fact.jst_date == _birthday_on(
            birthday_md, fact.jst_date.year
        ):
            return "sr", "birthday"
        if fact.jst_date in anniversaries:
            return "sr", "sub_anniversary"
        if last_key is not None and last_key == MessageKey(room, fact.id):
            return "sr", "last_message"
    if fact.has_nickname:
        return "r", "nickname"
    if fact.favorited:
        return "r", "favorite"
    if fact.type == "voice":
        return "r", "voice"
    if fact.type in _PHOTOS:
        return "n", "photo"
    return "n", "message"


def seed_for(salt: str, service: str, jst_date: date, pull_index: int) -> int:
    """The draw seed. Never log it, nor the salt."""
    raw = f"{salt}|{service}|{jst_date.isoformat()}|{pull_index}"
    return int(hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16], 16)


def _roll(rng: random.Random) -> str:
    x = rng.random()
    acc = 0.0
    for tier, p in TIER_ODDS[:-1]:
        acc += p
        if x < acc:
            return tier
    return TIERS[-1]  # the rest; also absorbs float rounding of the odds' sum


def draw(pool: Sequence[Candidate], seed: int) -> Candidate | None:
    """One candidate for ``seed``, or ``None`` for an empty pool (see the module docstring)."""
    return _pick(pool, seed) if pool else None


def _pick(pool: Sequence[Candidate], seed: int) -> Candidate:
    """:func:`draw` for a non-empty ``pool``."""
    ordered = sorted(pool, key=lambda c: (c.room, c.fact.id))
    by_tier = {t: [c for c in ordered if c.rarity == t] for t in TIERS}
    rng = random.Random(seed)
    rolled = _roll(rng)
    i = TIERS.index(rolled)
    order = list(TIERS[i:]) + list(reversed(TIERS[:i]))  # down first, then up
    tier = next(t for t in order if by_tier[t])
    if tier != rolled:
        logger.info(
            "memories_select",
            view="gacha",
            fallback="tier_empty",
            rolled=rolled,
            tier=tier,
        )
    cands = by_tier[tier]
    return rng.choices(cands, weights=[weight(c.score) for c in cands])[0]


def exclude_recent(
    pool: Sequence[Candidate], recent: set[tuple[str, int]]
) -> tuple[list[Candidate], bool]:
    """``(pool without recent pulls, True)`` while it keeps >= 10, else ``(pool, False)``."""
    kept = [c for c in pool if (c.room, c.fact.id) not in recent]
    if len(kept) == len(pool):
        return list(pool), False
    if len(kept) >= MIN_POOL_AFTER_RECENT:
        return kept, True
    logger.info(
        "memories_select",
        view="gacha",
        fallback="repeat_allowed",
        count=len(pool),
        recent=len(pool) - len(kept),
    )
    return list(pool), False


# --- pool -------------------------------------------------------------------------------


def _classify_person(
    s: mi.MemberSummary, tagged: Sequence[tuple[str, Fact]], today: date
) -> list[dict]:
    last = tagged[-1] if s.graduated and tagged else None
    last_key = MessageKey(last[0], last[1].id) if last is not None else None
    bday = parse_birthday(s.birthday)
    anniv = anniversaries_of(binder.subscription_start(s), today)
    out = []
    for room, f in tagged:
        if not eligible(f):
            continue
        rarity, reason = classify(
            f, birthday_md=bday, anniversaries=anniv, last_key=last_key, room=room
        )
        out.append(
            {
                "room": room,
                "id": f.id,
                "rarity": rarity,
                "reason": reason,
                "score": score_of(f),
            }
        )
    return out


async def _load(
    sdir: Path, today: date
) -> tuple[list[Candidate], dict[tuple[str, int], Fact], dict[str, mi.MemberSummary]]:
    """``(pool, every fact by (room, id), room -> person)``."""
    persons, _, hashes = await people.album_scope(sdir, None)
    tagged_by_person = [(s, await people.scope_facts(sdir, [s])) for s in persons]

    async def build() -> dict:
        items: list[dict] = []
        for s, tagged in tagged_by_person:
            items.extend(_classify_person(s, tagged, today))
        return {"items": items}

    data_hash = view_hash(GACHA_VERSION, hashes, today.isoformat())
    body = await cached_view(sdir, VIEW_POOL, "all", data_hash, build)
    facts = {(room, f.id): f for _, tagged in tagged_by_person for room, f in tagged}
    pool = [
        Candidate(it["room"], facts[key], it["rarity"], it["reason"], it["score"])
        for it in body["items"]
        if (key := (it["room"], it["id"])) in facts
    ]
    room_person = {room: s for s in persons for room in s.member_dirs}
    return pool, facts, room_person


def _log_pool(pool: Sequence[Candidate]) -> None:
    tiers = Counter(c.rarity for c in pool)
    logger.info(
        _EVENT,
        op="pool",
        count=len(pool),
        sr=tiers["sr"],
        r=tiers["r"],
        n=tiers["n"],
    )


async def build_pool(service: str, sdir: Path, *, today: date) -> list[Candidate]:
    """The service's gacha candidates on JST ``today`` (see the module docstring)."""
    pool, _, _ = await _load(sdir, today)
    _log_pool(pool)
    return pool


async def recent_keys(service: str, *, today: date) -> set[tuple[str, int]]:
    """``(room, id)`` pulled in the last :data:`RECENT_DAYS` JST days, today included."""
    since = today - timedelta(days=RECENT_DAYS - 1)
    return await user_store.agacha_recent_keys(service, since=since)


# --- payloads ---------------------------------------------------------------------------


def _missing_ref(service: str, sdir: Path, room: str, message_id: int) -> dict:
    """A date-only message object for a pull no longer in the archive."""
    return {
        "id": message_id,
        "room": room,
        "member_path": people.chat_path(sdir, room),
        "service": service,
        "ts": None,
        "type": None,
        "text": None,
        "caption": None,
        "caption_id": None,
        "media_url": None,
        "media_file": None,
        "duration_s": None,
        "favorited": False,
        "avatar_url": None,
    }


async def _pull_payloads(
    service: str,
    sdir: Path,
    pulls: Sequence[user_store.GachaPull],
    facts: dict[tuple[str, int], Fact],
    room_person: dict[str, mi.MemberSummary],
) -> list[dict]:
    """Pull payloads with texts attached (one ``attach_texts``, so one read per room)."""
    used = {
        room_person[p.room]
        for p in pulls
        if (p.room, p.message_id) in facts and p.room in room_person
    }
    avatars = await people.avatar_timelines_for(
        sdir, {people.person_key(s): s for s in used}
    )
    out: list[dict] = []
    found: list[dict] = []
    missing = 0
    for p in pulls:
        f = facts.get((p.room, p.message_id))
        if f is None:
            missing += 1
            ref = _missing_ref(service, sdir, p.room, p.message_id)
        else:
            avatar = avatars[people.person_key(room_person[p.room])]
            ref = people.message_ref(service, sdir, p.room, f, avatar=avatar)
            found.append(ref)
        out.append(
            {
                "jst_date": p.jst_date.isoformat(),
                "pull_index": p.pull_index,
                "rarity": p.rarity,
                "reason": p.reason,
                "pulled_at": people.iso_utc(p.pulled_at),
                "message": ref,
            }
        )
    if missing:
        logger.info("memories_skip", view="gacha", reason="pull_missing", count=missing)
    await people.attach_texts(sdir, found)
    return out


async def gacha_state(service: str, sdir: Path, *, now: datetime) -> dict:
    """Today's pulls, the pulls left and the history (see the module docstring)."""
    today = now.astimezone(JST).date()
    pool, facts, room_person = await _load(sdir, today)
    _log_pool(pool)
    history_rows = await user_store.agacha_history(service, limit=HISTORY_LIMIT)
    history = await _pull_payloads(service, sdir, history_rows, facts, room_person)
    today_iso = today.isoformat()
    todays = sorted(
        (p for p in history if p["jst_date"] == today_iso),
        key=lambda p: p["pull_index"],
    )
    left = max(0, MAX_PULLS - len(todays))
    logger.info(
        _EVENT,
        op="state",
        available=bool(pool),
        pulls_left=left,
        today=len(todays),
        history=len(history),
    )
    return {
        "available": bool(pool),
        "pulls_left": left,
        "max_pulls": MAX_PULLS,
        "today": todays,
        "history": history,
    }


async def pull(service: str, sdir: Path, *, now: datetime) -> dict | None:
    """Draw and record the next pull of the JST day (see the module docstring)."""
    today = now.astimezone(JST).date()
    done = await user_store.agacha_pulls_on(service, today)
    if len(done) >= MAX_PULLS:
        logger.info(_EVENT, op="pull", outcome="no_pulls_left", count=len(done))
        return None
    pull_index = len(done)
    pool, facts, room_person = await _load(sdir, today)
    _log_pool(pool)
    if not pool:
        logger.info(_EVENT, op="pull", outcome="skipped", reason="empty_pool")
        return {"pull": None, "pulls_left": MAX_PULLS - pull_index}
    candidates, _ = exclude_recent(pool, await recent_keys(service, today=today))
    salt = await user_store.agacha_salt()
    picked = _pick(candidates, seed_for(salt, service, today, pull_index))
    row = await user_store.arecord_gacha_pull(
        service,
        today,
        room=picked.room,
        message_id=picked.fact.id,
        rarity=picked.rarity,
        reason=picked.reason,
        now=now,
        max_pulls=MAX_PULLS,
    )
    if row is None:
        logger.info(_EVENT, op="pull", outcome="no_pulls_left", reason="race_lost")
        return None
    (payload,) = await _pull_payloads(service, sdir, [row], facts, room_person)
    logger.info(
        _EVENT,
        op="pull",
        outcome="drawn",
        pull_index=row.pull_index,
        rarity=row.rarity,
        reason=row.reason,
        score=picked.score,
        message_id=row.message_id,
    )
    return {"pull": payload, "pulls_left": MAX_PULLS - (row.pull_index + 1)}


__all__ = [
    "GACHA_VERSION",
    "HISTORY_LIMIT",
    "MAX_PULLS",
    "MIN_POOL_AFTER_RECENT",
    "RECENT_DAYS",
    "TIER_ODDS",
    "Candidate",
    "anniversaries_of",
    "build_pool",
    "classify",
    "draw",
    "eligible",
    "exclude_recent",
    "gacha_state",
    "pull",
    "recent_keys",
    "score_of",
    "seed_for",
    "weight",
]
