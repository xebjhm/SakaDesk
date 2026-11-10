"""Year recap payload builder (spec 9; brief task R2).

Turns one person's message facts (:func:`facts.get_person_facts`, every 1:1
room merged) into the JSON payload the recap API serves and the slides render.

Window and phase (all JST):

- ``W(Y)`` = max(Jan 1 of ``Y``, subscription start) .. min(now, Dec 31
  23:59:59). Only facts inside ``W(Y)`` count; slide 8 alone looks at earlier
  years (its "then" side).
- ``phase`` is ``final`` from Jan 1 00:00 of ``Y + 1``, else ``partial``.
  ``christmas_open`` is true from Dec 25 00:00 of ``Y`` or in the final phase.
- Tier by non-promo messages in ``W(Y)``: full >= 150, standard 30-149,
  short 10-29, none < 10 (no slides, no poster).

A message is identified by ``(member_dir, id)``: ids are per room. Message
objects in the payload carry ``member_path`` (the room's display-name path, as
the chat uses it) next to ``id``.

Each message is the hero of at most one slide. Before any slide picks, the
positional candidates of s01 (the first message, with the new-year preference)
and s13 (the last おやすみ, or her final message when she graduated in ``Y``)
are computed and held. Slides are then selected in this order, each skipping
messages already taken: s12 first (the one sentence is reserved first, but it
skips the held candidates so "the first" / "the last" stay true), then s01 and
s13 (each takes its own candidate), then the other positional picks (s02, s04,
s06), then the rest. A positional pick ("the first おはよう") whose message is
already taken is left out (``None``) rather than replaced by a message that is
not the first. s04's evening message is not positional: it is the free
おやすみ with the latest clock time of night (00:00-04:59 counts as later than
23:59; ties go to the more recent date). Every selection, fallback and skip
writes a ``recap.select`` breadcrumb with ids, codes and scores only -- never
text, names or paths.

"Graduated in ``Y``" uses the person's full facts: ``summary.graduated`` and
the JST year of her very last message overall equals ``Y``.

Text is read lazily: :class:`_Texts` calls :func:`facts.load_texts` at most
once per room, for the text-bearing ids up to the end of the window. The
payload carries only the text a slide displays.

Payloads are cached in the memory-index DB (``recap_cache``), keyed by service,
person (sorted room folders) and year. ``data_hash`` folds every room's
member-index ``data_hash``, the rooms' ``letters.json`` / ``transcriptions.json``
stats, ``phase``, ``christmas_open`` and the JST date of ``now`` (a partial
recap can change daily).

:func:`recap_years` lists the years with a recap (some member's tier above
``none``) for the shelf of yearbooks; it is not cached.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import re
import sqlite3
import time
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import structlog

from backend.services import app_state, profile_images_service
from backend.services.archive_urls import media_url
from backend.services.memories import facts as mf
from backend.services.memories import index as mi
from backend.services.memories import oshi as oshi_mod
from backend.services.memories import selection as sel
from backend.services.memories.facts import Fact
from backend.services.memories.selection import JST

logger = structlog.get_logger(__name__)

RECAP_VERSION = "1"

SLIDE_KEYS = (
    "s01_first",
    "s02_name",
    "s03_clock",
    "s04_greetings",
    "s05_photos",
    "s06_voice",
    "s07_letter",
    "s08_echo",
    "s09_special",
    "s10_you",
    "s11_daisuki",
    "s12_sentence",
    "s13_oyasumi",
)

TIER_FULL = 150
TIER_STANDARD = 30
TIER_SHORT = 10

# Overview role titles, in tie-break order.
TITLE_ORDER = (
    "morning",
    "nickname",
    "longest",
    "voice",
    "night",
    "photos",
    "steady",
    "first",
)

MEDIA = frozenset({"picture", "video"})
MAX_STARS = 600
MAX_WALL = 120
MAX_FRAGMENTS = 24
MAX_PETALS = 15
MAX_BURST_ITEMS = 30
STREAK_MIN = 7
STREAK_MIN_MESSAGES = 30
FLAT_RATIO = 1.3
VOICE_MIN_SECONDS = 4.0
CLIP_SECONDS = 6.0
SINGLE_CLIP_SECONDS = 12.0
LETTER_MIN_CHARS = 60
LETTER_TIE = 0.10
SENTENCE_MIN, SENTENCE_MAX = 8, 60
SENTENCE_SCAN = 200  # messages examined for the one sentence
PHOTO_NEAR = timedelta(minutes=5)
POSTER_NUMBER_MIN = 5  # a poster number below this is "sparse" and skipped
ECHO_KEYWORD_SCORE = 4

# Raw sentence boundaries (spec: 。！？ and newlines). Splitting the raw text
# keeps her characters exactly; ``selection.split_sentences`` NFKC-normalises.
_SENTENCE_RE = re.compile(r"[。！？!?\n]+")
_DAISUKI_RE = re.compile(r"大好き|だいすき|愛してる|ありがとう|感謝")
_JOY_RE = re.compile(r"嬉しい|楽しい|幸せ|またね|これからもよろしく")
_FINAL_WORD_RE = re.compile(r"大好き|ありがとう")
_XMAS_RE = re.compile(r"クリスマス|メリクリ|🎄")
_NICK_DAISUKI_RE = re.compile(r"大好き|だいすき")
ECHO_KEYWORDS = (
    "桜",
    "お花見",
    "花火",
    "夏",
    "浴衣",
    "海",
    "紅葉",
    "雪",
    "クリスマス",
    "サンタ",
    "誕生日",
    "年末",
    "大晦日",
    "あけおめ",
    "バレンタイン",
    "チョコ",
    "ライブ",
    "ツアー",
    "卒業",
    "梅雨",
    "お月見",
    "ハロウィン",
)

Item = tuple[str, Fact]  # (member_dir, fact)
Key = tuple[str, int]  # (member_dir, message id)


# --- pure rules -----------------------------------------------------------------


def phase_flags(year: int, now: datetime) -> tuple[str, bool]:
    """``(phase, christmas_open)`` of the ``year`` recap at ``now`` (aware)."""
    final = now >= datetime(year + 1, 1, 1, tzinfo=JST)
    xmas = final or now >= datetime(year, 12, 25, tzinfo=JST)
    return ("final" if final else "partial"), xmas


def tier_for(nonpromo_count: int) -> str:
    """Tier by her non-promo messages in ``W(Y)``."""
    if nonpromo_count >= TIER_FULL:
        return "full"
    if nonpromo_count >= TIER_STANDARD:
        return "standard"
    if nonpromo_count >= TIER_SHORT:
        return "short"
    return "none"


def _parse_day(raw: str | None) -> date | None:
    try:
        return date.fromisoformat(raw) if raw else None
    except ValueError:
        return None


def recap_window(
    year: int, now: datetime, subscription_start: str | None
) -> tuple[datetime, datetime]:
    """``W(Y)`` as aware datetimes ``(start, end)``; empty when start > end."""
    start = datetime(year, 1, 1, tzinfo=JST)
    sub = _parse_day(subscription_start)
    if sub is not None:
        start = max(start, datetime(sub.year, sub.month, sub.day, tzinfo=JST))
    end = min(now, datetime(year, 12, 31, 23, 59, 59, tzinfo=JST))
    return start, end


def _qualifies(title: str, value: float | None) -> bool:
    if value is None:
        return False
    if title == "steady":
        return value >= STREAK_MIN
    return title == "first" or value > 0


def assign_titles(
    metrics: dict[str, dict[str, float | None]], order: Sequence[str]
) -> dict[str, str | None]:
    """Distinct role titles that are literally true superlatives.

    ``metrics[member][title]`` is higher-is-better. A value qualifies when it
    is not ``None`` and, for counts, above 0; ``steady`` (the longest run of
    consecutive days) qualifies from :data:`STREAK_MIN` days, the threshold s03
    shows a streak at. A member *leads* a title when their qualifying value is
    the top value among all members in ``metrics`` (ties all lead).

    Only leaders can hold a title; each member holds at most one title and each
    title goes to at most one member. Among those pairs the assignment titles
    as many members as possible (a maximum bipartite matching). Ties are broken
    deterministically: members earlier in ``order`` (star order) are titled
    first, and each member tries titles in :data:`TITLE_ORDER`. So the leader
    of a title either holds it or holds another title they truly lead, unless
    a tied co-leader holds it. Members who lead nothing (or whose titles all
    went to tied co-leaders) get ``None``. Logs ``recap.titles`` with counts.
    """
    out: dict[str, str | None] = {k: None for k in order}
    members = [k for k in order if k in metrics]
    leads: dict[str, list[str]] = {k: [] for k in members}
    for t in TITLE_ORDER:
        vals = {
            k: v
            for k in members
            if _qualifies(t, v := metrics[k].get(t)) and v is not None
        }
        if not vals:
            continue
        top = max(vals.values())
        for k in members:
            if vals.get(k) == top:
                leads[k].append(t)
    holder: dict[str, str] = {}  # title -> member

    def augment(k: str, seen: set[str]) -> bool:
        for t in leads[k]:
            if t in seen:
                continue
            seen.add(t)
            if t not in holder or augment(holder[t], seen):
                holder[t] = k
                return True
        return False

    for k in members:
        augment(k, set())
    for t, k in holder.items():
        out[k] = t
    logger.info(
        "recap.titles",
        members=len(members),
        leaders=sum(1 for k in members if leads[k]),
        titled=len(holder),
    )
    return out


def _log(
    slide: str,
    rule: str,
    *,
    score: float | None = None,
    fallback: str | None = None,
    message_id: int | None = None,
) -> None:
    logger.info(
        "recap.select",
        slide=slide,
        rule=rule,
        score=score,
        fallback=fallback,
        message_id=message_id,
    )


def _iso(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _spread(seq: Sequence[Any], k: int) -> list[Any]:
    """At most ``k`` items picked evenly over ``seq`` (order kept)."""
    n = len(seq)
    if n <= k:
        return list(seq)
    if k <= 1:
        return [seq[-1]] if k == 1 else []
    return [seq[round(i * (n - 1) / (k - 1))] for i in range(k)]


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_RE.split(text) if s.strip()]


def _key(item: Item) -> Key:
    return item[0], item[1].id


def _media_url(service: str, media_file: str | None) -> str | None:
    if not media_file:
        return None
    parts = [p for p in media_file.replace("\\", "/").split("/") if p]
    return media_url(service, parts) if parts else None


# --- context --------------------------------------------------------------------


class _Texts:
    """Lazy per-room text loader: one :func:`facts.load_texts` call per room.

    Blocking; only used inside the composer thread.
    """

    def __init__(self, service_data_dir: Path, wanted: dict[str, set[int]]):
        self._sdir = service_data_dir
        self._wanted = wanted
        self._rooms: dict[str, dict[int, str]] = {}
        self.loads = 0

    def get(self, rel: str, mid: int) -> str:
        room = self._rooms.get(rel)
        if room is None:
            room = mf.load_texts(self._sdir, self._sdir / rel, self._wanted.get(rel))
            self._rooms[rel] = room
            self.loads += 1
        return room.get(mid, "")


@dataclass(frozen=True)
class _Ctx:
    service: str
    sdir: Path
    summary: mi.MemberSummary
    year: int
    now: datetime
    phase: str
    christmas_open: bool
    start: datetime
    end: datetime
    window: tuple[Item, ...]  # facts in W(Y), promo included
    earlier: tuple[Item, ...]  # facts of years before Y
    all_facts: tuple[Item, ...]
    texts: _Texts
    paths: dict[str, str]  # member_dir -> display path
    avatars: dict[str, str | None]
    rooms: dict[str, mi.MemberIndex]
    fav_at: dict[int, str]
    letters: tuple[tuple[datetime, str], ...]
    sub_start: date | None
    last_overall: date | None  # JST date of her very last message, any year
    used: set[Key] = field(default_factory=set)
    held: set[Key] = field(default_factory=set)  # s01/s13 candidates

    # helpers

    def text(self, item: Item) -> str:
        rel, f = item
        return self.texts.get(rel, f.id) if f.chars > 0 else ""

    def nonpromo(self) -> list[Item]:
        return [i for i in self.window if not i[1].is_promo]

    def words(self) -> list[Item]:
        """Non-promo messages with their own text."""
        return [i for i in self.window if not i[1].is_promo and i[1].chars > 0]

    def free(self, item: Item) -> bool:
        return _key(item) not in self.used

    def take(self, item: Item) -> None:
        self.used.add(_key(item))

    def message(self, item: Item | None, *, text: bool = True) -> dict | None:
        if item is None:
            return None
        rel, f = item
        own = self.text(item) if text else ""
        caption: str | None = None
        if text and f.type in MEDIA and f.caption_id is not None:
            caption = self.texts.get(rel, f.caption_id) or None
        return {
            "id": f.id,
            "ts": _iso(f.ts),
            "type": f.type,
            "text": own or None,
            "media_url": _media_url(self.service, f.media_file) if text else None,
            "caption": caption,
            "avatar_url": self.avatars.get(rel) if text else None,
            "member_path": self.paths.get(rel),
        }

    def photo_near(self, item: Item, *, same_day: bool = False) -> str | None:
        """Media URL of her non-promo picture near ``item`` (same room)."""
        rel, f = item
        pics = [
            p
            for p in self.window
            if p[0] == rel
            and p[1].type == "picture"
            and not p[1].is_promo
            and p[1].media_file
        ]
        if same_day:
            pics = [p for p in pics if p[1].jst_date == f.jst_date]
            if not pics:
                return None
            best = max(
                pics, key=lambda p: (p[1].photo_score or 0, -abs(p[1].ts - f.ts))
            )
        else:
            pics = [p for p in pics if abs(p[1].ts - f.ts) <= PHOTO_NEAR]
            if not pics:
                return None
            best = min(pics, key=lambda p: abs(p[1].ts - f.ts))
        return _media_url(self.service, best[1].media_file)


def _slide(key: str, data: dict, fallback: str | None = None) -> dict:
    return {"key": key, "fallback": fallback, "data": data}


def _first_free(ctx: _Ctx, items: Iterable[Item]) -> Item | None:
    for i in items:
        if ctx.free(i):
            return i
    return None


def _positional(ctx: _Ctx, slide: str, rule: str, item: Item | None) -> Item | None:
    """Take ``item`` if free; a taken positional pick is left out, never replaced."""
    if item is None:
        _log(slide, rule, fallback="none")
        return None
    if not ctx.free(item):
        _log(slide, rule, fallback="taken", message_id=item[1].id)
        return None
    ctx.take(item)
    _log(slide, rule, score=item[1].importance, message_id=item[1].id)
    return item


# --- slides ---------------------------------------------------------------------


def _s01_candidate(ctx: _Ctx) -> tuple[Item | None, str, bool, bool]:
    """``(pick, rule, joined_this_year, new_year_midnight)`` of slide 1."""
    msgs = ctx.nonpromo()
    joined = ctx.start > datetime(ctx.year, 1, 1, tzinfo=JST)
    if not msgs:
        return None, "first", joined, False
    midnight = [
        i
        for i in msgs
        if (i[1].jst_date.month, i[1].jst_date.day) == (1, 1)
        and i[1].hour == 0
        and i[1].minute < 30
    ]
    new_year = bool(midnight) and not joined
    pick = midnight[0] if new_year else msgs[0]
    rule = "new_year_midnight" if new_year else "first"
    return pick, rule, joined, new_year


def _s01_first(ctx: _Ctx) -> dict | None:
    slide = "s01_first"
    pick, rule, joined, new_year = _s01_candidate(ctx)
    if pick is None:
        _log(slide, "skip", fallback="skip")
        return None
    got = _positional(ctx, slide, rule, pick)
    if got is None:
        _log(slide, "skip", fallback="skip")
        return None
    data = {
        "message": ctx.message(got),
        "joined_this_year": joined,
        "new_year_midnight": new_year,
    }
    return _slide(slide, data, "joined_this_year" if joined else None)


def _fragments(ctx: _Ctx, items: Sequence[Item], pattern: re.Pattern[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for i in items:
        for s in _sentences(ctx.text(i)):
            if pattern.search(s) and s not in seen:
                seen.add(s)
                out.append(s)
    return out


def _s02_name(ctx: _Ctx) -> dict | None:
    slide = "s02_name"
    words = ctx.words()
    nick = [i for i in words if i[1].has_nickname]
    mode, fallback = "nickname", None
    pattern: re.Pattern[str] = re.compile(re.escape(sel.NICKNAME_TOKEN))
    pool = nick
    if not nick:
        pool = [i for i in words if i[1].has_greeting("daisuki")]
        mode, fallback, pattern = "daisuki", "daisuki", _NICK_DAISUKI_RE
    if not pool:
        _log(slide, "skip", fallback="skip")
        return None
    first = _positional(ctx, slide, f"{mode}_first", pool[0])
    anchor = pool[0][1].jst_date
    others = [i for i in pool[1:] if i[1].jst_date != anchor]
    # The latest on another day; prefer another month when the latest shares
    # the first one's month.
    other_month = [i for i in others if i[1].jst_date.month != anchor.month]
    last_pick = (other_month or others)[-1] if others else None
    last = _positional(ctx, slide, f"{mode}_last", last_pick)
    frags = _spread(_fragments(ctx, pool, pattern), MAX_FRAGMENTS)
    data: dict[str, Any] = {
        "mode": mode,
        "count": len(pool),
        "first": ctx.message(first),
        "last": ctx.message(last),
        "fragments": frags,
        "single": len(pool) == 1,
    }
    if len(pool) == 1:
        fallback = fallback or "single"
    return _slide(slide, data, fallback)


def _s03_clock(ctx: _Ctx) -> dict | None:
    slide = "s03_clock"
    msgs = ctx.nonpromo()
    if not msgs:
        _log(slide, "skip", fallback="skip")
        return None
    hist = [0] * 24
    for _, f in msgs:
        hist[f.hour] += 1
    peak = max(range(24), key=lambda h: (hist[h], h))  # ties -> later hour
    stars = [
        {"h": f.hour, "m": f.minute, "type": f.type}
        for _, f in _spread(msgs, MAX_STARS)
    ]
    reps = sorted(
        (i for i in ctx.words() if i[1].hour == peak and i[1].importance is not None),
        key=lambda i: (i[1].importance or 0, i[1].ts),
        reverse=True,
    )
    rep = _first_free(ctx, reps)
    if rep is not None:
        ctx.take(rep)
    _log(
        slide,
        "peak_hour",
        score=rep[1].importance if rep else None,
        fallback=None if rep else "none",
        message_id=rep[1].id if rep else None,
    )
    data: dict[str, Any] = {
        "stars": stars,
        "peak_hour": peak,
        "representative": ctx.message(rep),
        "longest_streak": None,
    }
    if len(msgs) >= STREAK_MIN_MESSAGES:
        streak = mf.longest_streak(f.jst_date for _, f in ctx.window)
        if streak >= STREAK_MIN:
            data["longest_streak"] = streak
    fallback = None
    mean = len(msgs) / 24
    if hist[peak] / mean < FLAT_RATIO:
        bands = {
            "night": sum(hist[h] for h in (*range(17, 24), *range(0, 5))),
            "noon": sum(hist[h] for h in range(11, 17)),
            "morning": sum(hist[h] for h in range(5, 11)),
        }
        data["band"] = max(bands, key=lambda b: bands[b])
        fallback = "flat"
        _log(slide, "band", fallback=fallback)
    return _slide(slide, data, fallback)


def _s04_greetings(ctx: _Ctx) -> dict | None:
    slide = "s04_greetings"
    words = ctx.words()
    fallback: str | None = None
    ohayo = [i for i in words if i[1].has_greeting("ohayo")]
    morning: Item | None
    if ohayo:
        morning = _positional(ctx, slide, "first_ohayo", ohayo[0])
    else:
        early = [i for i in words if 5 <= i[1].hour <= 10]
        morning = _positional(ctx, slide, "first_morning", early[0] if early else None)
        fallback = "morning"
    oyasumi = [i for i in words if i[1].has_greeting("oyasumi")]
    variant = "oyasumi"
    evening_pool = oyasumi
    if len(oyasumi) < 3:
        alts = {
            v: [i for i in words if i[1].has_greeting(v)]
            for v in ("arigato", "otsukare")
        }
        alt = max(alts, key=lambda v: len(alts[v]))
        if alts[alt]:
            variant, evening_pool = alt, alts[alt]
            fallback = fallback or "variant"
    evening = _latest_at_night(ctx, slide, f"latest_{variant}", evening_pool)
    if morning is None and evening is None:
        _log(slide, "skip", fallback="skip")
        return None
    data = {
        "first_ohayo": ctx.message(morning),
        "latest_oyasumi": ctx.message(evening),
        "oyasumi_count": len(evening_pool) or None,
        "distinct_days": len({i[1].jst_date for i in evening_pool}) or None,
        "variant": variant,
    }
    return _slide(slide, data, fallback)


def _night_minute(f: Fact) -> int:
    """Clock time of night in minutes: 00:00-04:59 sorts after 23:59."""
    return ((f.hour - 5) % 24) * 60 + f.minute


def _latest_at_night(
    ctx: _Ctx, slide: str, rule: str, pool: Sequence[Item]
) -> Item | None:
    """The free message of ``pool`` with the latest clock time of night.

    Ties go to the more recent date. Not positional: a taken message (for
    example s13's おやすみ) is simply skipped.
    """
    free = [i for i in pool if ctx.free(i)]
    if not free:
        _log(slide, rule, fallback="none")
        return None
    pick = max(free, key=lambda i: (_night_minute(i[1]), i[1].ts))
    ctx.take(pick)
    _log(slide, rule, score=_night_minute(pick[1]), message_id=pick[1].id)
    return pick


def _special_days(ctx: _Ctx) -> set[date]:
    days = sel.special_dates(
        ctx.year, ctx.summary.birthday, ctx.summary.subscription_start
    )
    days.update({date(ctx.year, 12, 24), date(ctx.year, 12, 25), date(ctx.year, 1, 1)})
    return days


def _s05_photos(ctx: _Ctx) -> dict | None:
    slide = "s05_photos"
    media = [i for i in ctx.nonpromo() if i[1].type in MEDIA and i[1].media_file]
    if not media:
        _log(slide, "skip", fallback="skip")
        return None
    pictures = [i for i in media if i[1].type == "picture"]
    data: dict[str, Any] = {"burst": [], "burst_caption": None}
    if len(pictures) >= 5:
        data["wall"] = [
            _media_url(ctx.service, i[1].media_file)
            for i in _spread(pictures, MAX_WALL)
        ]
    groups: dict[tuple[str, int], list[Item]] = {}
    for i in media:
        if i[1].burst_id is not None:
            groups.setdefault((i[0], i[1].burst_id), []).append(i)
    in_bursts = sum(len(g) for g in groups.values() if len(g) >= sel.BURST_MIN)
    data["mostly_bursts"] = in_bursts / len(media) >= 0.6
    special = _special_days(ctx)
    scored = []
    for g in groups.values():
        if len(g) < sel.BURST_MIN or not all(ctx.free(i) for i in g):
            continue
        score = (
            len(g)
            + 5 * any(i[1].favorited for i in g)
            + 3 * any(i[1].caption_id is not None for i in g)
            + 2 * (g[0][1].jst_date in special)
        )
        scored.append((score, g[0][1].ts, g))
    fallback = None
    if scored:
        score, _, burst = max(scored, key=lambda s: (s[0], s[1]))
        for i in burst:
            ctx.take(i)
        data["burst"] = [ctx.message(i) for i in burst[:MAX_BURST_ITEMS]]
        cap = next((i for i in burst if i[1].caption_id is not None), None)
        if cap is not None:
            data["burst_caption"] = (
                ctx.texts.get(cap[0], cap[1].caption_id or 0) or None
            )
        _log(slide, "burst", score=score, message_id=burst[0][1].id)
    else:
        ranked = sorted(
            (i for i in media if ctx.free(i)),
            key=lambda i: (i[1].photo_score or 0, i[1].ts),
            reverse=True,
        )
        if not ranked:
            _log(slide, "skip", fallback="skip")
            return None
        best = ranked[0]
        ctx.take(best)
        data["best_photo"] = ctx.message(best)
        fallback = "best_photo"
        _log(
            slide,
            "best_photo",
            score=best[1].photo_score,
            fallback=fallback,
            message_id=best[1].id,
        )
    return _slide(slide, data, fallback)


def _segments(ctx: _Ctx, item: Item, end: float) -> list[dict] | None:
    from backend.services.transcription_service import TranscriptionStorage

    rel, f = item
    try:
        result = TranscriptionStorage().load(ctx.sdir / rel, f.id)
    except Exception as e:  # noqa: BLE001 - a transcript is optional
        logger.info("recap.transcript_unreadable", error_type=type(e).__name__)
        return None
    if result is None or result.no_speech:
        return None
    segs = [
        {"start": s.start, "end": s.end, "text": s.text}
        for s in result.segments
        if s.start < end and s.end > 0
    ]
    return segs or None


def _clip(ctx: _Ctx, item: Item, seconds: float) -> dict:
    dur = item[1].duration_s
    end = min(seconds, dur) if dur else seconds
    return {
        "message": ctx.message(item),
        "start": 0,
        "end": end,
        "transcript_segments": _segments(ctx, item, end),
    }


def _s06_voice(ctx: _Ctx) -> dict | None:
    slide = "s06_voice"
    for kind in ("voice", "video"):
        all_kind = [i for i in ctx.nonpromo() if i[1].type == kind and i[1].media_file]
        if all_kind:
            break
    else:
        _log(slide, "skip", fallback="skip")
        return None
    fallback = None if kind == "voice" else "video"
    long_ = [i for i in all_kind if (i[1].duration_s or 0) >= VOICE_MIN_SECONDS]
    clips: list[dict] = []
    if len(long_) >= 3:
        first, latest = long_[0], long_[-1]
        middle = [i for i in long_[1:-1]]
        summer = [i for i in middle if 6 <= i[1].jst_date.month <= 8]
        mid = max(summer or middle, key=lambda i: (i[1].duration_s or 0, i[1].ts))
        for rule, item in (("first", first), ("longest_mid", mid), ("latest", latest)):
            got = _positional(ctx, slide, f"{kind}_{rule}", item)
            if got is not None:
                clips.append(_clip(ctx, got, CLIP_SECONDS))
    else:
        pick = (long_ or all_kind)[-1]
        got = _positional(ctx, slide, f"{kind}_latest_single", pick)
        if got is not None:
            clips.append(_clip(ctx, got, SINGLE_CLIP_SECONDS))
        fallback = fallback or "single"
    if not clips:
        _log(slide, "skip", fallback="skip")
        return None
    data = {"clips": clips, "voice_count": len(all_kind) if kind == "voice" else None}
    return _slide(slide, data, fallback)


def _s07_letter(ctx: _Ctx) -> dict | None:
    slide = "s07_letter"
    pool = [
        i
        for i in ctx.words()
        if i[1].type == "text"
        and i[1].importance is not None
        and i[1].chars >= LETTER_MIN_CHARS
        and ctx.free(i)
    ]
    if not pool:
        _log(slide, "skip", fallback="skip")
        return None
    top = max(i[1].importance or 0 for i in pool)
    near = [i for i in pool if (i[1].importance or 0) >= top - abs(top) * LETTER_TIE]
    pick = max(near, key=lambda i: (i[1].chars, i[1].importance or 0, i[1].ts))
    ctx.take(pick)
    _log(slide, "importance_longest", score=pick[1].importance, message_id=pick[1].id)
    text = ctx.text(pick)
    data = {
        "message": ctx.message(pick),
        "char_count": len(text),
        "photo_url": ctx.photo_near(pick),
    }
    return _slide(slide, data)


def _photo_linked(items: Iterable[Item]) -> set[Key]:
    """Keys of photos and of texts that caption a photo."""
    out: set[Key] = set()
    for rel, f in items:
        if f.type in MEDIA:
            out.add((rel, f.id))
            if f.caption_id is not None:
                out.add((rel, f.caption_id))
    return out


def _keywords(text: str) -> list[str]:
    return [k for k in ECHO_KEYWORDS if k in text]


def _s08_echo(ctx: _Ctx) -> dict | None:
    slide = "s08_echo"
    then_pool = [i for i in ctx.earlier if not i[1].is_promo and i[1].chars > 0]
    now_pool = [i for i in ctx.words() if ctx.free(i)]
    if then_pool and now_pool:
        photos = _photo_linked((*ctx.earlier, *ctx.window))
        by_kw: dict[str, list[tuple[Item, list[str]]]] = {}
        by_md: dict[tuple[int, int], list[tuple[Item, list[str]]]] = {}
        for t in then_pool:
            kws = _keywords(ctx.text(t))
            entry = (t, kws)
            for k in kws:
                by_kw.setdefault(k, []).append(entry)
            by_md.setdefault((t[1].jst_date.month, t[1].jst_date.day), []).append(entry)
        best: tuple[tuple[int, datetime, datetime], Item, Item, str | None] | None = (
            None
        )
        for n in now_pool:
            nf = n[1]
            n_kws = _keywords(ctx.text(n))
            cands: dict[Key, tuple[Item, list[str]]] = {}
            for k in n_kws:
                for e in by_kw.get(k, []):
                    cands[_key(e[0])] = e
            for e in by_md.get((nf.jst_date.month, nf.jst_date.day), []):
                cands[_key(e[0])] = e
            for t, t_kws in cands.values():
                tf = t[1]
                shared = [k for k in n_kws if k in t_kws]
                dh = abs(nf.hour - tf.hour)
                score = (
                    4 * len(shared)
                    + 2 * (min(dh, 24 - dh) <= 1)
                    + (_key(n) in photos and _key(t) in photos)
                    + (
                        (nf.jst_date.month, nf.jst_date.day)
                        == (tf.jst_date.month, tf.jst_date.day)
                    )
                    + (nf.jst_date.year - tf.jst_date.year - 1)
                    + 2 * (nf.favorited or tf.favorited)
                )
                rank = (score, nf.ts, tf.ts)
                if best is None or rank > best[0]:
                    kw = shared[0] if shared and score >= ECHO_KEYWORD_SCORE else None
                    best = (rank, t, n, kw)
        if best is not None:
            (score, _, _), then, now, kw = best
            ctx.take(now)
            ctx.take(then)
            _log(slide, "echo", score=score, message_id=now[1].id)
            data = {
                "then": ctx.message(then),
                "now": ctx.message(now),
                "shared_keyword": kw,
                "years_apart": now[1].jst_date.year - then[1].jst_date.year,
                "mode": "echo",
            }
            return _slide(slide, data)
    # First week of the subscription vs the latest week.
    begin = ctx.sub_start or (ctx.all_facts[0][1].jst_date if ctx.all_facts else None)
    if begin is not None:
        week_end = begin + timedelta(days=6)
        firsts = [
            i
            for i in ctx.all_facts
            if not i[1].is_promo
            and i[1].chars > 0
            and begin <= i[1].jst_date <= week_end
            and i[1].ts <= ctx.end
        ]
        latest_from = (ctx.end - timedelta(days=6)).astimezone(JST).date()
        lasts = [i for i in ctx.words() if i[1].jst_date >= latest_from and ctx.free(i)]
        week_then = _first_free(ctx, firsts)
        week_now = lasts[-1] if lasts else None
        if week_then is not None and week_now is not None and latest_from > week_end:
            ctx.take(week_then)
            ctx.take(week_now)
            _log(slide, "first_week", fallback="first_week", message_id=week_now[1].id)
            data = {
                "then": ctx.message(week_then),
                "now": ctx.message(week_now),
                "shared_keyword": None,
                "years_apart": None,
                "mode": "first_week",
            }
            return _slide(slide, data, "first_week")
    _log(slide, "skip", fallback="skip")
    return None


def _seconds_after_midnight(f: Fact) -> int:
    local = f.jst
    return local.hour * 3600 + local.minute * 60 + local.second


def _stub(ctx: _Ctx, kind: str, item: Item, rule: str, *, seconds: bool) -> dict:
    ctx.take(item)
    _log(
        "s09_special", f"{kind}_{rule}", score=item[1].importance, message_id=item[1].id
    )
    return {
        "kind": kind,
        "message": ctx.message(item),
        "seconds_after_midnight": _seconds_after_midnight(item[1]) if seconds else None,
        "sealed": False,
    }


def _day_stub(ctx: _Ctx, kind: str, day: date, *, early: bool) -> dict | None:
    msgs = [i for i in ctx.nonpromo() if i[1].jst_date == day and ctx.free(i)]
    if not msgs:
        return None
    if early:
        first10 = [i for i in msgs if i[1].hour == 0 and i[1].minute < 10]
        if first10:
            return _stub(ctx, kind, first10[0], "midnight", seconds=True)
    words = [i for i in msgs if i[1].importance is not None]
    if words:
        best = max(words, key=lambda i: (i[1].importance or 0, i[1].ts))
        return _stub(ctx, kind, best, "importance", seconds=False)
    return _stub(ctx, kind, msgs[0], "first", seconds=False)


def _s09_special(ctx: _Ctx) -> dict | None:
    slide = "s09_special"
    stubs: list[dict] = []
    bday = _parse_day(ctx.summary.birthday)
    if bday is not None:
        stub = _day_stub(
            ctx, "birthday", sel._safe_date(ctx.year, bday.month, bday.day), early=True
        )
        if stub:
            stubs.append(stub)
        else:
            _log(slide, "birthday_none", fallback="none")
    if not ctx.christmas_open:
        stubs.append(
            {
                "kind": "christmas",
                "message": None,
                "seconds_after_midnight": None,
                "sealed": True,
            }
        )
        _log(slide, "christmas_sealed", fallback="sealed")
    else:
        lo = datetime(ctx.year, 12, 24, 18, tzinfo=JST)
        hi = datetime(ctx.year, 12, 25, 23, 59, 59, tzinfo=JST)
        eve = [i for i in ctx.nonpromo() if lo <= i[1].ts <= hi and ctx.free(i)]
        keyed = [i for i in eve if _XMAS_RE.search(ctx.text(i))]
        pool = keyed or eve
        pick = pool[0] if pool else None
        if pick is not None:
            stubs.append(
                _stub(
                    ctx,
                    "christmas",
                    pick,
                    "keyword" if keyed else "first",
                    seconds=False,
                )
            )
        else:
            _log(slide, "christmas_none", fallback="none")
    ny = [
        i
        for i in ctx.nonpromo()
        if i[1].jst_date == date(ctx.year, 1, 1)
        and i[1].hour == 0
        and i[1].minute < 10
        and ctx.free(i)
    ]
    if ny:
        stubs.append(_stub(ctx, "newyear", ny[0], "midnight", seconds=True))
    else:
        _log(slide, "newyear_none", fallback="none")
    if ctx.sub_start is not None and ctx.sub_start.year < ctx.year:
        day = sel._safe_date(ctx.year, ctx.sub_start.month, ctx.sub_start.day)
        stub = _day_stub(ctx, "anniversary", day, early=False)
        if stub:
            stubs.append(stub)
        else:
            _log(slide, "anniversary_none", fallback="none")
    if not stubs:
        _log(slide, "skip", fallback="skip")
        return None
    return _slide(slide, {"stubs": stubs})


def _s10_you(ctx: _Ctx) -> dict:
    slide = "s10_you"
    y_start = datetime(ctx.year, 1, 1, tzinfo=JST)
    # (when, item, recorded): ``recorded`` is True only when a real favourite time
    # was logged and parsed; otherwise ``when`` is the message time, a placement
    # proxy that must never be presented as the moment the star was given.
    favs: list[tuple[datetime, Item, bool]] = []
    for item in ctx.all_facts:
        if not item[1].favorited:
            continue
        logged = ctx.fav_at.get(item[1].id)
        when = item[1].ts
        recorded = False
        if logged:
            parsed: datetime | None = None
            with contextlib.suppress(ValueError):
                parsed = datetime.fromisoformat(logged.replace("Z", "+00:00"))
            if parsed is not None and parsed.tzinfo is not None:
                when = parsed
                recorded = True
            else:
                _log(slide, "fav_at_unparsed", message_id=item[1].id)
        if y_start <= when <= ctx.end:
            favs.append((when, item, recorded))
    favs.sort(key=lambda x: (x[0], x[1][1].id))
    letters = [
        {
            "date": created.astimezone(JST).date().isoformat(),
            "first_line": next(
                (ln.strip() for ln in text.splitlines() if ln.strip()), ""
            ),
        }
        for created, text in ctx.letters
        if y_start <= created <= ctx.end
    ]
    if not favs and not letters:
        _log(slide, "invite", fallback="invite")
        return _slide(slide, {"invite": True}, "invite")
    first = None
    if favs:
        when, item, recorded = favs[0]
        first = ctx.message(item, text=False)
        if first is not None:
            first["favorited_at"] = _iso(when) if recorded else None
    _log(
        slide,
        "favorites_letters",
        score=len(favs) + len(letters),
        message_id=favs[0][1][1].id if favs else None,
    )
    data = {
        "favorites_count": len(favs) or None,
        "first_favorite": first,
        "letters_count": len(letters) or None,
        "letters": letters,
        "invite": False,
    }
    return _slide(slide, data)


def _s11_daisuki(ctx: _Ctx) -> dict | None:
    slide = "s11_daisuki"
    words = ctx.words()
    matched = [i for i in words if _DAISUKI_RE.search(ctx.text(i))]
    variant, fallback = None, None
    patterns = [_DAISUKI_RE]
    if len(matched) < 3:
        matched = [
            i
            for i in words
            if _DAISUKI_RE.search(ctx.text(i)) or _JOY_RE.search(ctx.text(i))
        ]
        variant, fallback = "joy", "joy"
        patterns.append(_JOY_RE)
    if not matched:
        _log(slide, "skip", fallback="skip")
        return None
    petals: list[dict] = []
    seen: set[str] = set()
    for i in matched:
        for s in _sentences(ctx.text(i)):
            if any(p.search(s) for p in patterns) and s not in seen:
                seen.add(s)
                petals.append({"text": s, "date": i[1].jst_date.isoformat()})
    petals = _spread(petals, MAX_PETALS)

    def tier(i: Item) -> int:
        word = bool(_FINAL_WORD_RE.search(ctx.text(i)))
        return 2 if word and i[1].has_nickname else 1 if word else 0

    ranked = sorted(
        (i for i in matched if ctx.free(i)),
        key=lambda i: (tier(i), i[1].importance or 0, i[1].ts),
        reverse=True,
    )
    final = ranked[0] if ranked else None
    if final is not None:
        ctx.take(final)
        _log(
            slide,
            f"final_tier{tier(final)}",
            score=final[1].importance,
            fallback=fallback,
            message_id=final[1].id,
        )
    else:
        _log(slide, "final", fallback="none")
    data = {"petals": petals, "final": ctx.message(final), "variant": variant}
    return _slide(slide, data, fallback)


def _s12_sentence(ctx: _Ctx) -> dict | None:
    slide = "s12_sentence"
    pool = [
        i
        for i in ctx.words()
        if i[1].importance is not None and ctx.free(i) and _key(i) not in ctx.held
    ]
    if not pool:
        _log(slide, "skip", fallback="skip")
        return None
    special = _special_days(ctx)
    repeats = sel.sentence_counts(ctx.text(i) for i in pool)
    stars = [i for i in pool if i[1].favorited]
    for rule, group in (("star", stars), ("importance", pool)):
        ranked = sorted(
            group, key=lambda i: (i[1].importance or 0, i[1].ts), reverse=True
        )
        for item in ranked[:SENTENCE_SCAN]:
            best: tuple[int, int, str] | None = None
            for s in _sentences(ctx.text(item)):
                if not SENTENCE_MIN <= len(s) <= SENTENCE_MAX:
                    continue
                msg = sel.Msg(item[1].id, item[1].ts, "text", s, item[1].favorited)
                score = sel.importance(
                    msg,
                    special=item[1].jst_date in special,
                    repeated=repeats.get(sel.normalize(s).strip(), 0) >= sel.REPEAT_MIN,
                )
                cand = (score, len(s), s)
                if best is None or cand[:2] > best[:2]:
                    best = cand
            if best is None:
                continue
            ctx.take(item)
            _log(slide, rule, score=best[0], message_id=item[1].id)
            data = {
                "sentence": best[2],
                "message_id": item[1].id,
                "member_path": ctx.paths.get(item[0]),
                "ts": _iso(item[1].ts),
                "photo_url": ctx.photo_near(item, same_day=True),
            }
            return _slide(slide, data)
    _log(slide, "skip", fallback="skip")
    return None


def _graduated_in_year(ctx: _Ctx) -> bool:
    """She graduated and her very last message (any year) is in ``Y``."""
    return (
        ctx.summary.graduated
        and ctx.last_overall is not None
        and ctx.last_overall.year == ctx.year
    )


def _s13_candidate(ctx: _Ctx) -> tuple[Item | None, str, str | None]:
    """``(pick, rule, fallback)`` of slide 13."""
    final = ctx.phase == "final"
    fallback = None
    if _graduated_in_year(ctx):
        pool = ctx.nonpromo()
        rule = "graduated_last"
    else:
        pool = [i for i in ctx.words() if i[1].has_greeting("oyasumi")]
        rule = "last_oyasumi" if final else "latest_oyasumi"
        if not pool:
            pool = [i for i in ctx.words() if i[1].type == "text"]
            rule, fallback = "last_text", "last_text"
    return (pool[-1] if pool else None), rule, fallback


def _s13_oyasumi(ctx: _Ctx) -> dict | None:
    slide = "s13_oyasumi"
    final = ctx.phase == "final"
    graduated = _graduated_in_year(ctx)
    pick, rule, fallback = _s13_candidate(ctx)
    got = _positional(ctx, slide, rule, pick)
    if got is None:
        _log(slide, "skip", fallback="skip")
        return None
    data = {"message": ctx.message(got), "final": final, "graduated": graduated}
    return _slide(slide, data, fallback)


# --- poster ---------------------------------------------------------------------


def _avatar_change(ctx: _Ctx) -> tuple[str, str] | None:
    """(old url, new url) of the latest chat-icon change in ``Y``, if any."""
    latest: tuple[str, str, str] | None = None
    for rel, idx in ctx.rooms.items():
        entries = [e for e in idx.avatar_changes if e.get("kind") == "thumbnail"]
        for prev, cur in zip(entries, entries[1:]):
            seen = _parse_ts(cur.get("first_seen"))
            if seen is None or seen.astimezone(JST).year != ctx.year or seen > ctx.end:
                continue
            urls = [
                media_url(
                    ctx.service,
                    [
                        *rel.split("/"),
                        "profile_images",
                        *str(e.get("file") or "").split("/"),
                    ],
                )
                for e in (prev, cur)
            ]
            stamp = _iso(seen)
            if latest is None or stamp > latest[0]:
                latest = (stamp, urls[0], urls[1])
    return (latest[1], latest[2]) if latest else None


def _parse_ts(raw: Any) -> datetime | None:
    if not isinstance(raw, str):
        return None
    try:
        ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def _poster(ctx: _Ctx, slides: dict[str, dict], years: int | None) -> dict:
    words = ctx.words()
    pictures = [i for i in ctx.nonpromo() if i[1].type == "picture" and i[1].media_file]
    best = max(pictures, key=lambda i: (i[1].photo_score or 0, i[1].ts), default=None)
    counts = {
        "nickname": sum(1 for i in words if i[1].has_nickname),
        "oyasumi": sum(1 for i in words if i[1].has_greeting("oyasumi")),
        "photos": len(pictures),
        "voice": sum(1 for i in ctx.nonpromo() if i[1].type == "voice"),
        "daisuki": sum(1 for i in words if i[1].has_greeting("daisuki")),
    }
    numbers = [
        {"key": k, "count": v} for k, v in counts.items() if v >= POSTER_NUMBER_MIN
    ][:3]
    smr: list[Item] = []
    if len(pictures) >= 3:
        mid_ts = pictures[0][1].ts + (pictures[-1][1].ts - pictures[0][1].ts) / 2
        mid = min(pictures[1:-1], key=lambda i: abs(i[1].ts - mid_ts))
        smr = [pictures[0], mid, pictures[-1]]
    s12 = slides.get("s12_sentence")
    s09 = slides.get("s09_special")
    s10 = slides["s10_you"]["data"]
    change = _avatar_change(ctx)
    logger.info(
        "recap.poster",
        numbers=len(numbers),
        best_photo_id=best[1].id if best else None,
        avatar_changed=change is not None,
    )
    return {
        "best_photo": ctx.message(best),
        "sentence": s12["data"] if s12 else None,
        "numbers": numbers,
        "stubs": s09["data"]["stubs"] if s09 else [],
        "start_mid_recent": [ctx.message(i) for i in smr],
        "favorites_count": s10.get("favorites_count") or None,
        "letters_count": s10.get("letters_count") or None,
        "avatar_changed": change is not None,
        "avatar_old_url": change[0] if change else None,
        "avatar_new_url": change[1] if change else None,
        "years_together": years,
    }


# --- composition ----------------------------------------------------------------

# Selection order (see the module docstring); output order is SLIDE_KEYS.
_ORDER: tuple[tuple[str, Callable[[_Ctx], dict | None]], ...] = (
    ("s12_sentence", _s12_sentence),
    ("s01_first", _s01_first),
    ("s13_oyasumi", _s13_oyasumi),
    ("s02_name", _s02_name),
    ("s04_greetings", _s04_greetings),
    ("s06_voice", _s06_voice),
    ("s09_special", _s09_special),
    ("s03_clock", _s03_clock),
    ("s05_photos", _s05_photos),
    ("s07_letter", _s07_letter),
    ("s08_echo", _s08_echo),
    ("s11_daisuki", _s11_daisuki),
    ("s10_you", _s10_you),
)


def _years_together(sub_start: date | None, year: int) -> int | None:
    if sub_start is None or sub_start.year > year:
        return None
    return year - sub_start.year + 1


def _member_block(ctx: _Ctx) -> dict:
    s = ctx.summary
    newest = s.member_dirs[-1]
    return {
        "id": s.member_ids[0],
        "name": s.name,
        "avatar_url": ctx.avatars.get(newest),
        "graduated": s.graduated,
        "subscription_start": s.subscription_start,
        "years_together": _years_together(ctx.sub_start, ctx.year),
    }


def _compose(ctx: _Ctx, tier: str) -> dict:
    """Blocking: select every slide and the poster."""
    member = _member_block(ctx)
    base = {"year": ctx.year, "phase": ctx.phase, "tier": tier, "member": member}
    if tier == "none":
        return {**base, "slides": [], "poster": None}
    for pick in (_s01_candidate(ctx)[0], _s13_candidate(ctx)[0]):
        if pick is not None:
            ctx.held.add(_key(pick))
    built: dict[str, dict] = {}
    for key, fn in _ORDER:
        slide = fn(ctx)
        if slide is not None:
            built[key] = slide
    slides = [built[k] for k in SLIDE_KEYS if k in built]
    poster = _poster(ctx, built, member["years_together"])
    return {**base, "slides": slides, "poster": poster}


def _display_path(service_data_dir: Path, rel: str) -> str:
    return f"{service_data_dir.name}/{rel}"


def _read_letters(
    service: str,
    service_data_dir: Path,
    rels: Sequence[str],
    member_ids: Sequence[str] = (),
) -> list[tuple[datetime, str]]:
    from backend.api.chat_features import read_local_letters

    out: list[tuple[datetime, str]] = []
    output_dir = service_data_dir.parent
    for n, rel in enumerate(rels):
        outcome, letters, _, _ = read_local_letters(
            output_dir, service_data_dir / rel, service, rel.split("/")
        )
        for letter in letters:
            created = _parse_ts(letter.created_at)
            if created is not None:
                out.append((created, letter.text))
        if outcome == "invalid":
            logger.warning(
                "recap.letters_invalid",
                member_id=member_ids[n] if n < len(member_ids) else None,
                room_index=n,
            )
    return out


def _avatars(service_data_dir: Path, rels: Sequence[str]) -> dict[str, str | None]:
    output_dir = service_data_dir.parent
    return {
        rel: profile_images_service.local_urls(
            output_dir, service_data_dir / rel, _display_path(service_data_dir, rel)
        ).get("thumbnail_local")
        for rel in rels
    }


def _fav_times(service: str, ids: list[int]) -> dict[int, str]:
    try:
        return app_state.favorited_at(service, ids)
    except sqlite3.Error as e:
        logger.warning("recap.favorite_log_unreadable", error_type=type(e).__name__)
        return {}


def _window_split(
    tagged: Sequence[Item], year: int, start: datetime, end: datetime
) -> tuple[list[Item], list[Item]]:
    window = [i for i in tagged if start <= i[1].ts <= end]
    earlier = [i for i in tagged if i[1].jst_date.year < year]
    return window, earlier


# --- cache ----------------------------------------------------------------------

_CACHE_SCHEMA = (
    "CREATE TABLE IF NOT EXISTS recap_cache (service TEXT, person_key TEXT, "
    "year INTEGER, data_hash TEXT, payload TEXT, "
    "PRIMARY KEY(service, person_key, year))"
)


def _person_key(summary: mi.MemberSummary) -> str:
    return "|".join(sorted(summary.member_dirs))


def _stat(path: Path) -> str:
    try:
        st = path.stat()
    except OSError:
        return "-"
    return f"{st.st_size}:{st.st_mtime_ns}"


def _data_hash(
    service_data_dir: Path,
    rooms: dict[str, mi.MemberIndex],
    phase: str,
    christmas_open: bool,
    now: datetime,
) -> str:
    parts = [RECAP_VERSION, str(service_data_dir), phase, str(christmas_open)]
    parts.append(now.astimezone(JST).date().isoformat())
    for rel in sorted(rooms):
        d = service_data_dir / rel
        parts += [
            rel,
            rooms[rel].data_hash,
            _stat(d / "letters.json"),
            _stat(d / "transcriptions.json"),
        ]
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def _cache_get(service: str, person: str, year: int, data_hash: str) -> dict | None:
    try:
        with contextlib.closing(mi._connect()) as c:
            c.execute(_CACHE_SCHEMA)
            row = c.execute(
                "SELECT data_hash, payload FROM recap_cache "
                "WHERE service=? AND person_key=? AND year=?",
                (service, person, year),
            ).fetchone()
        if row and row[0] == data_hash:
            payload = json.loads(row[1])
            return payload if isinstance(payload, dict) else None
    except (sqlite3.Error, ValueError) as e:
        logger.warning("recap.cache_read_failed", error_type=type(e).__name__)
    return None


def _cache_put(
    service: str, person: str, year: int, data_hash: str, payload: dict
) -> None:
    try:
        with contextlib.closing(mi._connect()) as c, c:
            c.execute(_CACHE_SCHEMA)
            c.execute(
                "INSERT OR REPLACE INTO recap_cache"
                "(service, person_key, year, data_hash, payload) VALUES (?,?,?,?,?)",
                (
                    service,
                    person,
                    year,
                    data_hash,
                    json.dumps(payload, ensure_ascii=False),
                ),
            )
    except sqlite3.Error as e:
        logger.warning("recap.cache_write_failed", error_type=type(e).__name__)


# --- public API -----------------------------------------------------------------


def _build_sync(
    service: str,
    service_data_dir: Path,
    summary: mi.MemberSummary,
    year: int,
    now: datetime,
    tagged: list[Item],
    rooms: dict[str, mi.MemberIndex],
) -> dict:
    phase, xmas = phase_flags(year, now)
    start, end = recap_window(year, now, summary.subscription_start)
    window, earlier = _window_split(tagged, year, start, end)
    tier = tier_for(sum(1 for _, f in window if not f.is_promo))
    upto = [i for i in tagged if i[1].ts <= end]
    wanted: dict[str, set[int]] = {}
    for rel, f in upto:
        if f.chars > 0:
            wanted.setdefault(rel, set()).add(f.id)
        if f.caption_id is not None:
            wanted.setdefault(rel, set()).add(f.caption_id)
    rels = list(summary.member_dirs)
    fav_ids = sorted({f.id for _, f in tagged if f.favorited})
    ctx = _Ctx(
        service=service,
        sdir=service_data_dir,
        summary=summary,
        year=year,
        now=now,
        phase=phase,
        christmas_open=xmas,
        start=start,
        end=end,
        window=tuple(window),
        earlier=tuple(earlier),
        all_facts=tuple(upto),
        texts=_Texts(service_data_dir, wanted),
        paths={rel: _display_path(service_data_dir, rel) for rel in rels},
        avatars=_avatars(service_data_dir, rels),
        rooms=rooms,
        fav_at=_fav_times(service, fav_ids) if tier != "none" else {},
        letters=tuple(
            _read_letters(service, service_data_dir, rels, summary.member_ids)
        )
        if tier != "none"
        else (),
        sub_start=_parse_day(summary.subscription_start),
        last_overall=tagged[-1][1].jst_date if tagged else None,
    )
    payload = _compose(ctx, tier)
    logger.info(
        "recap.build",
        service=service,
        member_id=summary.member_ids[0] if summary.member_ids else None,
        year=year,
        phase=phase,
        tier=tier,
        rooms=len(rels),
        facts=len(window),
        slides=len(payload["slides"]),
        text_loads=ctx.texts.loads,
    )
    return payload


async def _room_indexes(
    service_data_dir: Path, summary: mi.MemberSummary
) -> dict[str, mi.MemberIndex]:
    return {
        rel: await mi.get_member_index(service_data_dir, service_data_dir / rel)
        for rel in summary.member_dirs
    }


async def build_member_recap(
    service: str,
    service_data_dir: Path,
    summary: mi.MemberSummary,
    year: int,
    *,
    now: datetime,
) -> dict:
    """The per-member recap payload (shared payload contract) for ``year``.

    ``summary`` is the person (all their 1:1 rooms); ``now`` must be aware.
    Facts come only from :func:`facts.get_person_facts`; the selection runs in
    a worker thread. Cached in ``recap_cache`` (see the module docstring).
    """
    started = time.perf_counter()
    member_id = summary.member_ids[0] if summary.member_ids else None
    rooms = await _room_indexes(service_data_dir, summary)
    phase, xmas = phase_flags(year, now)
    cacheable = all(idx.data_hash for idx in rooms.values())
    person = _person_key(summary)
    data_hash = ""
    if cacheable:
        data_hash = await asyncio.to_thread(
            _data_hash, service_data_dir, rooms, phase, xmas, now
        )
        hit = await asyncio.to_thread(_cache_get, service, person, year, data_hash)
        if hit is not None:
            logger.info("recap.cache", outcome="hit", member_id=member_id, year=year)
            return hit
    logger.info(
        "recap.cache",
        outcome="miss" if cacheable else "uncacheable",
        member_id=member_id,
        year=year,
    )
    tagged = await mf.get_person_facts(service_data_dir, summary)
    payload = await asyncio.to_thread(
        _build_sync, service, service_data_dir, summary, year, now, tagged, rooms
    )
    if cacheable:
        await asyncio.to_thread(_cache_put, service, person, year, data_hash, payload)
    logger.info(
        "recap.built",
        member_id=member_id,
        year=year,
        elapsed_ms=round((time.perf_counter() - started) * 1000),
    )
    return payload


@dataclass(frozen=True)
class _MemberStats:
    tier: str
    metrics: dict[str, float | None]
    favorites: int
    oyasumi: int
    first: Item | None


def _member_stats(
    summary: mi.MemberSummary, tagged: list[Item], year: int, now: datetime
) -> _MemberStats:
    start, end = recap_window(year, now, summary.subscription_start)
    window = [i for i in tagged if start <= i[1].ts <= end]
    nonpromo = [i for i in window if not i[1].is_promo]
    words = [i for i in nonpromo if i[1].chars > 0]
    sub = _parse_day(summary.subscription_start)
    metrics: dict[str, float | None] = {
        "morning": sum(1 for i in words if i[1].has_greeting("ohayo")),
        "nickname": sum(1 for i in words if i[1].has_nickname),
        "longest": max((i[1].chars for i in words), default=0),
        "voice": sum(1 for i in nonpromo if i[1].type == "voice"),
        "night": sum(1 for i in nonpromo if 21 <= i[1].hour <= 23),
        "photos": sum(1 for i in nonpromo if i[1].type == "picture"),
        "steady": mf.longest_streak(i[1].jst_date for i in window),
        "first": -sub.toordinal() if sub else None,
    }
    return _MemberStats(
        tier=tier_for(len(nonpromo)),
        metrics=metrics,
        favorites=sum(1 for i in window if i[1].favorited),
        oyasumi=sum(1 for i in words if i[1].has_greeting("oyasumi")),
        first=nonpromo[0] if nonpromo else None,
    )


async def build_members_overview(
    service: str, service_data_dir: Path, year: int, *, now: datetime
) -> dict:
    """The multi-member opening payload: tiers, oshi, distinct role titles.

    Lists every person with at least one non-promo message in their ``W(Y)``.
    Titles go only to members with a recap (tier above ``none``); only title
    keys are returned, never ranks or values.
    """
    phase, xmas = phase_flags(year, now)
    summaries = await mi.list_members(service_data_dir)
    oshi = await oshi_mod.oshi_names(service)
    stats: list[tuple[mi.MemberSummary, _MemberStats]] = []
    for s in summaries:
        tagged = await mf.get_person_facts(service_data_dir, s)
        st = await asyncio.to_thread(_member_stats, s, tagged, year, now)
        if st.first is not None:
            stats.append((s, st))
    order = [s.member_ids[0] for s, _ in stats]
    eligible = {s.member_ids[0]: st.metrics for s, st in stats if st.tier != "none"}
    titles = assign_titles(eligible, [k for k in order if k in eligible])
    members = [
        {
            "member_path": _display_path(service_data_dir, s.member_dirs[0]),
            "member_id": s.member_ids[0],
            "name": s.name,
            "tier": st.tier,
            "oshi": s.name_norm in oshi,
            "title_key": f"recap.titles.{titles[s.member_ids[0]]}"
            if titles.get(s.member_ids[0])
            else None,
        }
        for s, st in stats
    ]
    # oshi -> the fan's ★ count -> subscription age; never message volume.
    star = sorted(
        enumerate(stats),
        key=lambda e: (
            e[1][0].name_norm not in oshi,
            -e[1][1].favorites,
            _parse_day(e[1][0].subscription_start) or date.max,
            e[0],
        ),
    )
    firsts = [(st.first, s) for s, st in stats if st.first is not None]
    first = min(firsts, key=lambda x: (x[0][1].ts, x[0][1].id)) if firsts else None
    oyasumi_total = sum(st.oyasumi for _, st in stats)
    logger.info(
        "recap.overview",
        service=service,
        year=year,
        phase=phase,
        members=len(members),
        titled=sum(1 for t in titles.values() if t),
    )
    return {
        "year": year,
        "phase": phase,
        "christmas_open": xmas,
        "members": members,
        "opening": {
            "star_order": [e[1][0].member_ids[0] for e in star],
            "first_message": {
                "member_id": first[1].member_ids[0],
                "ts": _iso(first[0][1].ts),
            }
            if first
            else None,
            "oyasumi_total": oyasumi_total or None,
        },
    }


def _recap_years_of(
    summary: mi.MemberSummary, tagged: list[Item], now: datetime
) -> set[int]:
    """JST years whose ``W(Y)`` holds enough of her non-promo messages for a recap."""
    counts: dict[int, int] = {}
    windows: dict[int, tuple[datetime, datetime]] = {}
    for _, f in tagged:
        if f.is_promo:
            continue
        y = f.jst_date.year
        if y not in windows:
            windows[y] = recap_window(y, now, summary.subscription_start)
        start, end = windows[y]
        if start <= f.ts <= end:
            counts[y] = counts.get(y, 0) + 1
    return {y for y, c in counts.items() if tier_for(c) != "none"}


async def recap_years(service_data_dir: Path, *, now: datetime) -> list[int]:
    """The shelf of yearbooks: JST years in which at least one member has a recap.

    A year is listed when some member's tier for it is above ``none`` (the same
    window and count as :func:`build_members_overview`). Ascending; the current
    year is included once it qualifies (the frontend decides when it opens).
    """
    years: set[int] = set()
    summaries = await mi.list_members(service_data_dir)
    for s in summaries:
        tagged = await mf.get_person_facts(service_data_dir, s)
        years |= await asyncio.to_thread(_recap_years_of, s, tagged, now)
    out = sorted(years)
    logger.info("recap.years", members=len(summaries), count=len(out))
    return out


__all__ = [
    "SLIDE_KEYS",
    "assign_titles",
    "build_member_recap",
    "build_members_overview",
    "phase_flags",
    "recap_window",
    "recap_years",
    "tier_for",
]
