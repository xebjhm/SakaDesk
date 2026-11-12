"""Shared, LLM-free selection rules for Memories (spec 3.3). Pure functions."""

from __future__ import annotations

import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from bisect import bisect_left
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import structlog

from backend.services.memories.lexicon import (
    CAPTION_BONUS_WORDS,
    DAISUKI_ADDRESS_RE,
    DAISUKI_THIRD_PARTY_RE,
    DATE_HEADING_RE,
    EMOTION_WORDS,
    GREETING_BITS,
    GREETING_RES,
    NICKNAME_TOKEN,
    PROMO_WORDS_RE,
    PURE_GREETING_RE,
    QA_ANSWER_RE,
    QA_LETTER_RE,
    QA_LINE_RE,
    QA_MIN_LINES,
    QA_MIN_PAIRS,
    QA_NUMBERED_RE,
    RAW_SENTENCE_SPLIT_RE,
    SENTENCE_SPLIT_RE,
    TIME_RE,
    URL_RE,
    WELCOME_RE,
)

logger = structlog.get_logger(__name__)

JST = ZoneInfo("Asia/Tokyo")
BURST_GAP = timedelta(minutes=10)
BURST_MIN = 3
CAPTION_WINDOW = timedelta(minutes=3)
MEDIA_TYPES = frozenset({"picture", "video"})
# Year recap unlock month-days (spec 9.3), JST: the current year's recap opens
# on Dec 1 and its Christmas stub on Dec 25. ``recap.phase_flags`` and
# ``notify_rules.recap_occasions`` read these; the frontend's
# ``recap/availability`` mirrors them.
RECAP_OPEN_MD = (12, 1)
RECAP_CHRISTMAS_MD = (12, 25)
# Subscription welcome (see :func:`welcome_ids`): the opening = the first
# ``WELCOME_FIRST_N`` messages from an anchor, or those within
# ``WELCOME_WINDOW`` of it. The subscription-day anchor must fall within
# ``WELCOME_ANCHOR_DAYS`` of the start day's 00:00 JST. In the archive the
# welcome is always the anchor message itself (2025-11-01, 16 rooms: sent
# 00:04-00:13 JST, 0-15 min before any companion message), so N stays 1: a
# sparse room's 2nd or 3rd message can be days later and in her own words.
WELCOME_FIRST_N = 1
WELCOME_WINDOW = timedelta(minutes=30)
WELCOME_ANCHOR_DAYS = timedelta(days=2)
# The welcome block's automatic follow-up line(s) (「%%%といっぱいお話ししたいんだ」,
# sent ~15 min after the welcome): the next message in the room, a server id at
# most this far from the previous flagged one, within WELCOME_WINDOW of the
# welcome. Strictly consecutive (1): every follow-up in the archive is
# welcome id + 1, while her own next message is hundreds of ids away.
WELCOME_FOLLOW_ID_GAP = 1


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


def is_welcome_text(text: str) -> bool:
    """The text reads like a subscription welcome (``lexicon.WELCOME_RE``)."""
    return bool(WELCOME_RE.search(normalize(text)))


def welcome_ids(msgs: Sequence[Msg], sub_start: date | None = None) -> set[int]:
    """Ids of the automatic welcome messages a room sends at subscription.

    ``msgs`` are sorted by ``(ts, id)``. A welcome is a ``text`` message that
    matches :func:`is_welcome_text` AND sits at an opening: among the first
    :data:`WELCOME_FIRST_N` messages from an anchor, or within
    :data:`WELCOME_WINDOW` of the anchor. The anchors are the room's first
    message and, when ``sub_start`` is known, the first message at or after
    ``sub_start`` 00:00 JST if it falls within :data:`WELCOME_ANCHOR_DAYS`
    (the archive can begin before the subscription). On the stored
    subscription start day itself (JST), a matching ``text`` is a welcome at
    any time of day: the welcome can arrive hours after her first messages
    that day. Both conditions keep
    false positives low: she may thank for 登録 in her own words later on, and
    the opening can hold her own greeting without the phrase.

    A welcome's automatic follow-up line is flagged too, without the phrase,
    when it is the room's next message (a chain continues from the last
    flagged one), a ``text``, its server id is at most
    :data:`WELCOME_FOLLOW_ID_GAP` above the previous flagged id, and it was
    sent within :data:`WELCOME_WINDOW` of the welcome. Server ids are one
    sequence for every message, so a consecutive id means nothing (no fan
    reply, no other message) came in between: it is the same burst.
    """
    anchors: set[int] = {0} if msgs else set()
    if sub_start is not None and msgs:
        begin = datetime.combine(sub_start, time(0), tzinfo=JST)
        i = bisect_left([m.ts for m in msgs], begin)
        if i < len(msgs) and msgs[i].ts < begin + WELCOME_ANCHOR_DAYS:
            anchors.add(i)
    out: set[int] = set()
    if sub_start is not None:
        # The subscription start day itself: the welcome can come hours after
        # her first messages that day (an archive that began the day before).
        out.update(
            m.id
            for m in msgs
            if m.type == "text"
            and jst(m.ts).date() == sub_start
            and is_welcome_text(m.text)
        )
    for a in sorted(anchors):
        limit = msgs[a].ts + WELCOME_WINDOW
        for k in range(a, len(msgs)):
            m = msgs[k]
            if k - a >= WELCOME_FIRST_N and m.ts > limit:
                break
            if m.type == "text" and is_welcome_text(m.text):
                out.add(m.id)
    for k, m in enumerate(msgs):
        if m.id not in out or (k > 0 and msgs[k - 1].id in out):
            continue  # only start from the head of a flagged run
        limit = m.ts + WELCOME_WINDOW
        prev = m
        for nxt in msgs[k + 1 :]:
            if (
                nxt.type != "text"
                or not 0 < nxt.id - prev.id <= WELCOME_FOLLOW_ID_GAP
                or nxt.ts > limit
            ):
                break
            out.add(nxt.id)
            prev = nxt
    return out


def is_qa(text: str) -> bool:
    """A Q&A post: at least :data:`QA_MIN_LINES` question lines (``Q…`` or a
    numbered question), or at least :data:`QA_MIN_PAIRS` ✉ question lines and
    as many ➡ answer lines. Line-based on NFKC text (``lexicon.QA_*``)."""
    lines = normalize(text).splitlines()
    q = sum(1 for ln in lines if QA_LINE_RE.match(ln))
    numbered = sum(1 for ln in lines if QA_NUMBERED_RE.match(ln))
    if q >= QA_MIN_LINES or numbered >= QA_MIN_LINES:
        return True
    letters = sum(1 for ln in lines if QA_LETTER_RE.match(ln))
    answers = sum(1 for ln in lines if QA_ANSWER_RE.match(ln))
    return letters >= QA_MIN_PAIRS and answers >= QA_MIN_PAIRS


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
    """Every greeting class present in ``text`` (multi-label, for counting).

    Includes the derived ``daisuki_you`` (:func:`is_addressed_daisuki`).
    """
    t = normalize(text)
    found = {name for name, p in GREETING_RES.items() if p.search(t)}
    if "daisuki" in found and is_addressed_daisuki(text):
        found.add("daisuki_you")
    return frozenset(found)


def is_addressed_daisuki(text: str) -> bool:
    """大好き said to the fan: one NFKC sentence (:func:`split_sentences`) holds
    大好き or a variant, ``%%%`` / きみ / 君 / あなた (never みんな), and no
    third-party object such as 「Xちゃん(のこと)が大好き」 or a 「title」."""
    daisuki = GREETING_RES["daisuki"]
    for s in split_sentences(text):
        if (
            daisuki.search(s)
            and DAISUKI_ADDRESS_RE.search(s)
            and not DAISUKI_THIRD_PARTY_RE.search(s)
        ):
            return True
    return False


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
