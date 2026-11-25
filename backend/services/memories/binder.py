"""The 卡冊 photocard binder of one person (spec 5.3).

- :func:`evaluate_person` gathers the inputs of :func:`cards.evaluate`
  (``facts.get_person_facts``, the fan's letters, real avatar changes from
  one person-wide icon sequence deduplicated by content hash, the
  subscription start and her birthday), computes the Christmas / Valentine
  keyword hits with one ``load_texts`` per room (only for facts on 02-14 and
  12-24/25), and evaluates the cards.
- :func:`binder_payload` renders the cards as the text-free ``/memoir/cards``
  payload, built in a worker thread and cached (``view_cache``, view
  ``binder``, key ``person_key``, hash :func:`binder_hash`, which includes
  :data:`cards.CARDS_VERSION`). The memoir list reads each person's
  ``progress`` from it, so one cache serves both views.
- :func:`build_binder` is :func:`binder_payload` with her words attached after
  the cache read (``people.attach_texts``).

Logs (ids, codes, counts and scores only; ``person`` = first member id):

- one ``memories_cards`` per evaluation (``earned``, ``total``, ``hidden``);
- one ``memories_select`` (``view=binder``, ``rule`` = card key, ``score`` =
  the face's importance or photo score, ``fallback``, ``message_id``, plus
  ``year`` for an older year of a stack) per face that came from a fallback;
- ``memories_skip`` (``view=binder``, ``reason``): ``no_face`` (``rule``) for
  an earned card with nothing to show, ``avatar_same_image`` (``count``) for
  cross-room duplicate icon changes, ``avatar_hash_missing`` (``count``) for
  icons without a content hash -- a missing or unreadable file, or a foreign
  (non-archive) URL (they fall back to the URL / one-minute rule),
  ``bad_subscription_start`` for an unparsable start date, and ``face_missing`` (``count``) for message keys the
  payload could not resolve.
"""

from __future__ import annotations

import asyncio
import hashlib
import threading
from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote

import structlog

from backend.services import profile_images_service
from backend.services.archive_urls import (
    ArchiveReadError,
    is_plain_relative,
    resolve_within,
)
from backend.services.memories import cards as cards_mod
from backend.services.memories import index as mi
from backend.services.memories import people
from backend.services.memories.facts import Fact, get_person_facts, load_texts
from backend.services.memories.lexicon import CHRISTMAS_RE, VALENTINE_RE
from backend.services.memories.selection import JST, normalize
from backend.services.memories.view_cache import cached_view, view_hash

logger = structlog.get_logger(__name__)

VIEW = "binder"
_KEYWORDS = (("christmas", CHRISTMAS_RE), ("valentine", VALENTINE_RE))


def _parse_day(raw: str | None) -> date | None:
    try:
        return date.fromisoformat(raw) if raw else None
    except ValueError:
        return None


def _member_id(summary: mi.MemberSummary) -> str | None:
    return summary.member_ids[0] if summary.member_ids else None


def _fact_lookup(inputs: cards_mod.CardInputs) -> dict[cards_mod.MessageKey, Fact]:
    return {cards_mod.MessageKey(room, f.id): f for room, f in inputs.facts}


# People whose bad start was already logged today (``people.person_key``), and
# that JST day. Cleared when the JST day changes, so it never grows past one
# day's people. Callers run on the loop and in workers: guarded by a lock.
_bad_start_lock = threading.Lock()
_bad_start_day: date | None = None
_bad_start_logged: set[str] = set()


def _first_bad_start_today(summary: mi.MemberSummary) -> bool:
    """True the first time today (JST) this person's bad start is seen."""
    global _bad_start_day
    today = datetime.now(JST).date()
    key = people.person_key(summary)
    with _bad_start_lock:
        if _bad_start_day != today:
            _bad_start_day = today
            _bad_start_logged.clear()
        if key in _bad_start_logged:
            return False
        _bad_start_logged.add(key)
        return True


def reset_bad_start_log_for_tests() -> None:
    """Test-only: forget which bad starts were already logged today."""
    global _bad_start_day
    with _bad_start_lock:
        _bad_start_day = None
        _bad_start_logged.clear()


def subscription_start(summary: mi.MemberSummary) -> date | None:
    """The fan's start date; an unparsable one is treated as absent.

    It is ``MemberSummary.subscription_start``: the day of her room's
    subscription welcome when the index found one, else the stored start. Every
    anniversary (cards, 加入紀念日, the hub countdown, the gacha, notifications)
    reads it here, so they all agree on one first day.

    The ``bad_subscription_start`` breadcrumb is logged at most once per
    person per JST day, whichever view, card check or notification asks.
    """
    start = _parse_day(summary.subscription_start)
    if start is None and summary.subscription_start:
        if _first_bad_start_today(summary):
            logger.info(
                "memories_skip",
                view=VIEW,
                person=_member_id(summary),
                reason="bad_subscription_start",
            )
    return start


_SAME_IMAGE_WINDOW = timedelta(minutes=1)
_NO_TIME = datetime.min.replace(tzinfo=timezone.utc)


@dataclass(frozen=True)
class IconEntry:
    """One archived icon of one room, with its file's content hash."""

    room: str
    seen: datetime | None  # first_seen; None when unknown
    url: str
    digest: str | None  # sha256 of the image file; None when unreadable


_DIGEST_CACHE_MAX = 1024
# (path, size, mtime_ns) -> sha256: a cache miss of the binder (any new
# message) must not re-read and re-hash every archived icon.
_digest_cache: OrderedDict[tuple[str, int, int], str] = OrderedDict()
# icon_entries runs in worker threads, possibly several at once
_digest_lock = threading.Lock()


def _plain_parts(value: str) -> bool:
    """True for a non-empty plain relative path with no ``.``/``..``/empty part."""
    if not value or not is_plain_relative(value):
        return False
    return all(p not in ("", ".", "..") for p in value.replace("\\", "/").split("/"))


def _avatar_digest(sdir: Path, room: str, url: str) -> str | None:
    """sha256 of an archived icon given its media URL, or ``None``. Blocking.

    Memoised per file on ``(path, size, mtime_ns)`` (bounded LRU), so an
    unchanged icon is hashed once. A foreign URL, a missing / unreadable
    file, or a room or icon path that would leave the room's icon folder
    (``..``, a drive, a root; security audit 2026-11-13) gives ``None``
    (never memoised).
    """
    marker = f"/{profile_images_service.DIR_NAME}/"
    if marker not in url:
        return None
    rel = unquote(url.split(marker, 1)[1])
    if not (_plain_parts(room) and _plain_parts(rel)):
        return None
    base = sdir / room / profile_images_service.DIR_NAME
    try:
        path = resolve_within(base, base / rel)
        st = path.stat()
        key = (str(path), st.st_size, st.st_mtime_ns)
        with _digest_lock:
            hit = _digest_cache.get(key)
            if hit is not None:
                _digest_cache.move_to_end(key)
                return hit
        data = path.read_bytes()
    except (OSError, ArchiveReadError):
        return None
    digest = hashlib.sha256(data).hexdigest()
    with _digest_lock:
        _digest_cache[key] = digest
        while len(_digest_cache) > _DIGEST_CACHE_MAX:
            _digest_cache.popitem(last=False)
    return digest


def icon_entries(sdir: Path, rooms: Sequence[str]) -> list[IconEntry]:
    """Every room's archived icons with content hashes. Blocking."""
    return [
        IconEntry(room, seen, url, _avatar_digest(sdir, room, url))
        for room in rooms
        for seen, url in people.avatar_timeline(sdir, room).entries
    ]


def _same_image(a: IconEntry, b: IconEntry) -> bool:
    """Same image: by content hash when both have one; else the same URL in
    one room, or first seen no more than a minute apart in two rooms."""
    if a.digest is not None and b.digest is not None:
        return a.digest == b.digest
    if a.room == b.room:
        return a.url == b.url
    if a.seen is None or b.seen is None:
        return False
    return abs(a.seen - b.seen) <= _SAME_IMAGE_WINDOW


def avatar_changes(
    entries: Sequence[IconEntry],
) -> tuple[list[cards_mod.AvatarChange], int]:
    """Her real icon changes across every room; ``(changes, cross-room duplicates)``.

    One person-wide sequence ordered by ``first_seen`` (undated entries first):

    - each room's first entry, and any undated entry, is only a baseline;
    - an entry is a change when its image differs from the person's icon just
      before it (the previous entry in any room, :func:`_same_image`);
    - an image another room already showed since this room's previous entry
      is that room's change archived late, not a new one, whatever the day
      (counted as a duplicate). A room returning to an image it showed
      itself earlier is still a change.
    """
    ordered = sorted(entries, key=lambda e: (e.seen is not None, e.seen or _NO_TIME))
    last_in_room: dict[str, IconEntry] = {}
    history: list[IconEntry] = []
    current: IconEntry | None = None
    out: list[cards_mod.AvatarChange] = []
    dropped = 0
    for e in ordered:
        prev = last_in_room.get(e.room)
        if prev is not None and e.seen is not None and current is not None:
            since = prev.seen
            if _same_image(e, current):
                dropped += current.room != e.room
            elif any(
                h.room != e.room
                and h.seen is not None
                and (since is None or h.seen >= since)
                and _same_image(h, e)
                for h in history
            ):
                dropped += 1
            else:
                out.append(cards_mod.AvatarChange(e.seen, current.url, e.url))
        history.append(e)
        last_in_room[e.room] = e
        current = e
    return out, dropped


async def person_avatar_changes(
    sdir: Path, summary: mi.MemberSummary
) -> list[cards_mod.AvatarChange]:
    """Her real icon changes across rooms (:func:`avatar_changes`), logged."""
    entries = await asyncio.to_thread(icon_entries, sdir, summary.member_dirs)
    unhashed = sum(e.digest is None for e in entries)
    if unhashed:
        # these entries compare by URL / the one-minute rule instead of content
        logger.info(
            "memories_skip",
            view=VIEW,
            reason="avatar_hash_missing",
            person=_member_id(summary),
            count=unhashed,
        )
    kept, dropped = avatar_changes(entries)
    if dropped:
        logger.info(
            "memories_skip",
            view=VIEW,
            reason="avatar_same_image",
            person=_member_id(summary),
            count=dropped,
        )
    return kept


def _is_keyword_day(f: Fact) -> bool:
    md = (f.jst_date.month, f.jst_date.day)
    return md in ((2, 14), (12, 24), (12, 25))


async def keyword_hits(
    sdir: Path, tagged: Sequence[tuple[str, Fact]]
) -> dict[cards_mod.MessageKey, frozenset[str]]:
    """``{key: {"christmas", "valentine"} subset}`` for facts on 02-14 / 12-24 / 12-25.

    One ``load_texts`` per room, in a worker, for those ids only. Texts are
    NFKC-normalised before matching and never leave this function.
    """
    wanted: dict[str, set[int]] = {}
    for room, f in tagged:
        if _is_keyword_day(f):
            wanted.setdefault(room, set()).add(f.id)
    out: dict[cards_mod.MessageKey, frozenset[str]] = {}
    for room, ids in wanted.items():
        texts = await asyncio.to_thread(load_texts, sdir, sdir / room, ids)
        for mid, text in texts.items():
            norm = normalize(text)
            hits = frozenset(name for name, rx in _KEYWORDS if rx.search(norm))
            if hits:
                out[cards_mod.MessageKey(room, mid)] = hits
    return out


async def _gather(
    service: str, sdir: Path, summary: mi.MemberSummary, now: datetime
) -> tuple[cards_mod.CardInputs, people.AvatarTimeline]:
    tagged = await get_person_facts(sdir, summary)
    letters = await people.letters_of(service, sdir, summary)
    timeline = await people.avatar_timelines(sdir, summary)
    inputs = cards_mod.CardInputs(
        facts=tagged,
        today=now.astimezone(JST).date(),
        subscription_start=subscription_start(summary),
        birthday=summary.birthday,
        graduated=summary.graduated,
        letters=letters,
        avatar_changes=await person_avatar_changes(sdir, summary),
        keyword_hits=await keyword_hits(sdir, tagged),
    )
    return inputs, timeline


def _score(fact: Fact | None) -> int | None:
    """The face's selection score: importance, else photo score."""
    if fact is None:
        return None
    return fact.importance if fact.importance is not None else fact.photo_score


def _log(
    summary: mi.MemberSummary,
    cards: list[cards_mod.Card],
    hidden: int,
    inputs: cards_mod.CardInputs,
) -> None:
    """Breadcrumbs: every fallback, every faceless earned card, then the totals."""
    person = _member_id(summary)
    lookup = _fact_lookup(inputs)

    def select(
        rule: str, fallback: str, key: cards_mod.MessageKey | None, **kw: object
    ) -> None:
        logger.info(
            "memories_select",
            view=VIEW,
            person=person,
            rule=rule,
            score=_score(lookup.get(key) if key is not None else None),
            fallback=fallback,
            message_id=key.id if key is not None else None,
            **kw,
        )

    for card in cards:
        if card.fallback is not None:
            select(card.key, card.fallback, card.message)
        for y in card.years[:-1]:  # the newest year is the card's own fallback
            if y.fallback is not None:
                select(card.key, y.fallback, y.message, year=y.year)
        if card.earned and card.message is None and card.letter is None:
            logger.info(
                "memories_skip",
                view=VIEW,
                person=person,
                rule=card.key,
                reason="no_face",
            )
    earned, total = cards_mod.progress_summary(cards)
    logger.info(
        "memories_cards",
        person=person,
        earned=earned,
        total=total,
        hidden=hidden,
    )


async def _evaluate(
    service: str, sdir: Path, summary: mi.MemberSummary, now: datetime
) -> tuple[list[cards_mod.Card], cards_mod.CardInputs, people.AvatarTimeline]:
    inputs, timeline = await _gather(service, sdir, summary, now)
    cards, hidden = await asyncio.to_thread(cards_mod.evaluate_counted, inputs)
    _log(summary, cards, hidden, inputs)
    return cards, inputs, timeline


async def evaluate_person(
    service: str, sdir: Path, summary: mi.MemberSummary, *, now: datetime
) -> list[cards_mod.Card]:
    """The person's cards (:func:`cards.evaluate`) as of ``now``."""
    cards, _, _ = await _evaluate(service, sdir, summary, now)
    return cards


# --- payload ------------------------------------------------------------------------


def _payload(
    service: str,
    sdir: Path,
    cards: list[cards_mod.Card],
    inputs: cards_mod.CardInputs,
    timeline: people.AvatarTimeline,
) -> dict:
    """The text-free binder payload (message objects with ``text=None``)."""
    lookup = _fact_lookup(inputs)

    missing = 0

    def face(k: cards_mod.MessageKey | None) -> dict | None:
        nonlocal missing
        if k is None:
            return None
        fact = lookup.get(k)
        if fact is None:
            missing += 1
            return None
        return people.message_ref(service, sdir, k.room, fact, avatar=timeline)

    def card_json(card: cards_mod.Card) -> dict:
        refs = {name: face(k) for name, k in card.refs.items()}
        return {
            "key": card.key,
            "earned": card.earned,
            "foil": card.foil,
            "rare": card.rare,
            "date": card.date.isoformat() if card.date else None,
            "face": face(card.message),
            "refs": {name: ref for name, ref in refs.items() if ref is not None},
            "progress": (
                {"current": card.progress[0], "target": card.progress[1]}
                if card.progress
                else None
            ),
            "years": [
                {
                    "year": y.year,
                    "date": y.date.isoformat(),
                    "face": face(y.message),
                    # the postcard photo of that day (never the face itself)
                    "photo": face(y.photo),
                }
                for y in card.years
            ],
            "detail": dict(card.detail),
            # the fan's own letter: its date, and where to read it
            # (``/api/chat/letters_local`` path + letter id); never her words
            "letter": (
                {
                    "date": card.date.isoformat(),
                    "member_path": people.chat_path(sdir, card.letter[0]),
                    "id": card.letter[1],
                }
                if card.letter is not None and card.date is not None
                else None
            ),
        }

    earned, total = cards_mod.progress_summary(cards)
    shelves = []
    for shelf in cards_mod.SHELVES:
        shelf_cards = [card_json(card) for card in cards if card.shelf == shelf]
        if shelf_cards:
            shelves.append({"key": shelf, "cards": shelf_cards})
    if missing:
        logger.info("memories_skip", view=VIEW, reason="face_missing", count=missing)
    return {"progress": {"earned": earned, "total": total}, "shelves": shelves}


def _side_stats(sdir: Path, rooms: Sequence[str]) -> tuple[tuple[int, int], ...]:
    """``(mtime_ns, size)`` of each room's letters and profile-image index. Blocking."""
    out = []
    for room in rooms:
        for path in (
            sdir / room / "letters.json",
            sdir / room / profile_images_service.DIR_NAME / "index.json",
        ):
            try:
                st = path.stat()
                out.append((st.st_mtime_ns, st.st_size))
            except OSError:
                out.append((-1, -1))
    return tuple(out)


def _message_refs(payload: dict) -> list[dict]:
    """Every message object in the payload (faces, refs, yearly faces and photos)."""
    out: list[dict] = []
    for shelf in payload["shelves"]:
        for card in shelf["cards"]:
            out.extend(r for r in (card["face"], *card["refs"].values()) if r)
            out.extend(r for y in card["years"] for r in (y["face"], y["photo"]) if r)
    return out


async def binder_hash(sdir: Path, summary: mi.MemberSummary, *, now: datetime) -> str:
    """Cache hash of everything :func:`evaluate_person` reads, as of ``now``.

    :data:`cards.CARDS_VERSION`, the rooms' index hashes, the JST date, the
    letters and profile-image index stats, the start date, birthday and
    graduation. Views that embed card results (the memoir list through
    :func:`binder_payload`, the timeline month) reuse it.
    """
    today = now.astimezone(JST).date()
    stats = await asyncio.to_thread(_side_stats, sdir, summary.member_dirs)
    return view_hash(
        cards_mod.CARDS_VERSION,
        await people.room_hashes(sdir, summary),
        today.isoformat(),
        stats,
        summary.subscription_start,
        summary.birthday,
        summary.graduated,
    )


async def binder_payload(
    service: str,
    sdir: Path,
    summary: mi.MemberSummary,
    *,
    now: datetime,
    data_hash: str | None = None,
) -> dict:
    """The text-free ``/memoir/cards`` payload, cached per person.

    ``data_hash`` is :func:`binder_hash` when the caller already has it (it is
    computed here otherwise). A hit evaluates nothing.
    """
    if data_hash is None:
        data_hash = await binder_hash(sdir, summary, now=now)

    async def build() -> dict:
        cards, inputs, timeline = await _evaluate(service, sdir, summary, now)
        # one message object per face over every fact: keep it off the loop
        return await asyncio.to_thread(_payload, service, sdir, cards, inputs, timeline)

    return await cached_view(sdir, VIEW, people.person_key(summary), data_hash, build)


async def build_binder(
    service: str, sdir: Path, summary: mi.MemberSummary, *, now: datetime
) -> dict:
    """The ``/memoir/cards`` payload: cached text-free, her words attached after."""
    payload = await binder_payload(service, sdir, summary, now=now)
    await people.attach_texts(sdir, _message_refs(payload))
    return payload


__all__ = [
    "IconEntry",
    "avatar_changes",
    "binder_hash",
    "binder_payload",
    "build_binder",
    "evaluate_person",
    "keyword_hits",
    "icon_entries",
    "person_avatar_changes",
    "subscription_start",
]
