"""Shared, LLM-free selection rules for Memories (spec 3.3). Pure functions."""

from __future__ import annotations

import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import structlog

from backend.services.memories.lexicon import (
    CAPTION_BONUS_WORDS,
    DATE_HEADING_RE,
    EMOTION_WORDS,
    GREETING_BITS,
    GREETING_RES,
    NICKNAME_TOKEN,
    PROMO_WORDS_RE,
    PURE_GREETING_RE,
    RAW_SENTENCE_SPLIT_RE,
    SENTENCE_SPLIT_RE,
    TIME_RE,
    URL_RE,
)

logger = structlog.get_logger(__name__)

JST = ZoneInfo("Asia/Tokyo")
BURST_GAP = timedelta(minutes=10)
BURST_MIN = 3
CAPTION_WINDOW = timedelta(minutes=3)
MEDIA_TYPES = frozenset({"picture", "video"})


@dataclass(frozen=True)
class Msg:
    id: int
    ts: datetime  # aware UTC
    type: str
    text: str
    favorited: bool = False


def normalize(text: str) -> str:
    """NFKC-normalise so full-width ASCII / digits match the lexicon."""
    return unicodedata.normalize("NFKC", text)


def jst(ts: datetime) -> datetime:
    """Convert an aware datetime to JST; naive input is a bug, not a guess."""
    if ts.tzinfo is None or ts.utcoffset() is None:
        raise ValueError("jst() requires a timezone-aware datetime")
    return ts.astimezone(JST)


def is_promo(text: str) -> bool:
    t = normalize(text)
    if URL_RE.search(t):
        return True
    # DISTINCT promo words: one word repeated is still one signal.
    hits = len(set(PROMO_WORDS_RE.findall(t)))
    if hits >= 2 or (hits == 1 and len(t) > 80):
        return True
    if len(TIME_RE.findall(t)) >= 3:
        return True
    return DATE_HEADING_RE.search(t) is not None


def greeting_class(text: str) -> str | None:
    """Single label for slot assignment: the first matching class in lexicon order.

    Use :func:`greeting_classes` / :func:`greeting_mask` for counting, where a
    message such as "おやすみ、大好きだよ" counts for every class it contains.
    """
    t = normalize(text)
    for name, pattern in GREETING_RES.items():
        if pattern.search(t):
            return name
    return None


def greeting_classes(text: str) -> frozenset[str]:
    """Every greeting class present in ``text`` (multi-label, for counting)."""
    t = normalize(text)
    return frozenset(name for name, p in GREETING_RES.items() if p.search(t))


def greeting_mask(text: str) -> int:
    """:func:`greeting_classes` as a bitmask (``lexicon.GREETING_BITS``)."""
    mask = 0
    for name in greeting_classes(text):
        mask |= GREETING_BITS[name]
    return mask


def classes_from_mask(mask: int) -> frozenset[str]:
    """Inverse of :func:`greeting_mask`."""
    return frozenset(name for name, bit in GREETING_BITS.items() if mask & bit)


def split_sentences(text: str) -> list[str]:
    """NFKC sentences split at 。！？ and newlines; stripped, empty ones dropped."""
    return [s.strip() for s in SENTENCE_SPLIT_RE.split(normalize(text)) if s.strip()]


def raw_sentences(text: str) -> list[str]:
    """Sentences of RAW text, as written, split at 。！？!? and newlines.

    Not normalised (her words are shown as written); stripped, empty ones
    dropped.
    """
    return [s.strip() for s in RAW_SENTENCE_SPLIT_RE.split(text) if s.strip()]


REPEAT_MIN = 3


def is_repeated(sentences: Sequence[str], counts: Mapping[str, int]) -> bool:
    """True when repeated sentences make up at least half of the message.

    ``counts`` holds, per sentence, how many of her messages in the year
    contain it. A sentence is repeated at ``REPEAT_MIN`` (3) or more. The
    half-of-the-characters rule keeps a long, unique message that merely ends
    with a stock "おやすみ" from being penalised, while a template message
    with a tiny unique tail still is.
    """
    total = sum(len(s) for s in sentences)
    if total == 0:
        return False
    rep = sum(len(s) for s in sentences if counts.get(s, 0) >= REPEAT_MIN)
    return rep * 2 >= total


def sentence_counts(texts: Iterable[str]) -> dict[str, int]:
    """Per sentence, the number of ``texts`` containing it (once per text)."""
    out: dict[str, int] = {}
    for text in texts:
        for s in set(split_sentences(text)):
            out[s] = out.get(s, 0) + 1
    return out


def is_pure_greeting(text: str) -> bool:
    return PURE_GREETING_RE.match(normalize(text).strip()) is not None


def has_nickname(text: str) -> bool:
    return NICKNAME_TOKEN in normalize(text)


def _has_emotion(text: str) -> bool:
    return any(w in text for w in EMOTION_WORDS)


def importance(msg: Msg, *, special: bool = False, repeated: bool = False) -> int:
    """chars + 300 fav + 80 nickname + 100 emotion + 150 special - 200 greeting - 300 repeated."""
    t = normalize(msg.text)
    score = len(msg.text)
    score += 300 if msg.favorited else 0
    score += 80 if has_nickname(t) else 0
    score += 100 if _has_emotion(t) else 0
    score += 150 if special else 0
    score -= 200 if is_pure_greeting(msg.text) else 0
    score -= 300 if repeated else 0
    return score


def find_bursts(items: Sequence[Msg]) -> list[list[Msg]]:
    """Runs of >= 3 photos/videos, each <= 10 min after the previous one.

    The caller passes one member's media; ``Msg`` carries no member field.
    """
    media = sorted(
        (m for m in items if m.type in MEDIA_TYPES), key=lambda m: (m.ts, m.id)
    )
    bursts: list[list[Msg]] = []
    run: list[Msg] = []
    for m in media:
        if run and m.ts - run[-1].ts > BURST_GAP:
            if len(run) >= BURST_MIN:
                bursts.append(run)
            run = []
        run.append(m)
    if len(run) >= BURST_MIN:
        bursts.append(run)
    return bursts


def _window(photo: Msg, burst: Sequence[Msg] | None) -> tuple[datetime, datetime]:
    if burst:
        return (
            min(m.ts for m in burst) - CAPTION_WINDOW,
            max(m.ts for m in burst) + CAPTION_WINDOW,
        )
    return photo.ts - CAPTION_WINDOW, photo.ts + CAPTION_WINDOW


def _nearest(
    photo: Msg, texts: Sequence[Msg], burst: Sequence[Msg] | None
) -> Msg | None:
    lo, hi = _window(photo, burst)
    near = [t for t in texts if t.text.strip() and lo <= t.ts <= hi]
    if not near:
        return None
    return min(near, key=lambda t: (abs(t.ts - photo.ts), t.id))


def caption_for(
    photo: Msg, texts: Sequence[Msg], burst: Sequence[Msg] | None = None
) -> Msg | None:
    """Nearest non-promo text within +-3 min (whole burst +-3 min for bursts)."""
    return _nearest(photo, [t for t in texts if not is_promo(t.text)], burst)


def photo_is_promo(
    photo: Msg, texts: Sequence[Msg], burst: Sequence[Msg] | None = None
) -> bool:
    """A photo is promo when its nearest paired text is promo."""
    nearest = _nearest(photo, texts, burst)
    return nearest is not None and is_promo(nearest.text)


def photo_score(
    photo: Msg, caption: Msg | None, *, last_in_burst: bool, holiday: bool
) -> int:
    score = 500 if photo.favorited else 0
    if caption is not None:
        score += 150
        cap = normalize(caption.text)
        if any(w in cap for w in CAPTION_BONUS_WORDS):
            score += 80
    score += 100 if last_in_burst else 0
    if holiday or 20 <= jst(photo.ts).hour < 24:
        score += 80
    return score


def _safe_date(year: int, month: int, day: int) -> date:
    try:
        return date(year, month, day)
    except ValueError:  # Feb 29 in a non-leap year
        return date(year, month, 28)


def special_dates(year: int, birthday: str | None, sub_start: str | None) -> set[date]:
    """Her birthday and the day after, 12/31, and the subscription anniversary in ``year``.

    ``birthday`` / ``sub_start`` are ``YYYY-MM-DD`` strings; unparsable values are ignored.
    """
    out = {date(year, 12, 31)}
    for field_name, raw, with_next in (
        ("birthday", birthday, True),
        ("subscription_start", sub_start, False),
    ):
        if not raw:
            continue
        try:
            d = date.fromisoformat(raw)
        except ValueError:
            logger.warning("special_date_unparsable", field=field_name)
            continue
        day = _safe_date(year, d.month, d.day)
        out.add(day)
        if with_next:
            out.add(day + timedelta(days=1))
    return out
