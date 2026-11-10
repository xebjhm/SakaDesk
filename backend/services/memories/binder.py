"""The 卡冊 photocard binder of one person (spec 5.3).

- :func:`evaluate_person` gathers the inputs of :func:`cards.evaluate`
  (``facts.get_person_facts``, the fan's letters, real avatar changes, the
  subscription start and her birthday), computes the Christmas / Valentine
  keyword hits with one ``load_texts`` per room (only for facts on 02-14 and
  12-24/25), and evaluates the cards.
- :func:`build_binder` renders the cards as the ``/memoir/cards`` payload. The
  text-free payload is cached (``view_cache``, view ``binder``) and her words
  are attached after the cache read with ``people.attach_texts``.

Logs (ids, codes and counts only): one ``memories_cards`` per evaluation
(``person`` = first member id, ``earned``, ``total``, ``hidden``) and one
``memories_select`` (``view=binder``, ``rule`` = card key, ``fallback``,
``message_id``) per card whose face came from a fallback.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from datetime import date, datetime
from pathlib import Path

import structlog

from backend.services import profile_images_service
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


def avatar_changes(timeline: people.AvatarTimeline) -> list[cards_mod.AvatarChange]:
    """Real icon changes: consecutive timeline entries, skipping the first.

    An entry without ``first_seen`` cannot be dated and is not a change; an
    entry with the same URL as the one before is not a change either.
    """
    out = []
    entries = timeline.entries
    for (_, old), (seen, new) in zip(entries, entries[1:]):
        if seen is None or new == old:
            continue
        out.append(cards_mod.AvatarChange(changed_at=seen, old_url=old, new_url=new))
    return out


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
        subscription_start=_parse_day(summary.subscription_start),
        birthday=summary.birthday,
        graduated=summary.graduated,
        letters=letters,
        avatar_changes=avatar_changes(timeline),
        keyword_hits=await keyword_hits(sdir, tagged),
    )
    return inputs, timeline


def _log(summary: mi.MemberSummary, cards: list[cards_mod.Card], hidden: int) -> None:
    earned, total = cards_mod.progress_summary(cards)
    for card in cards:
        if card.fallback is not None:
            logger.info(
                "memories_select",
                view=VIEW,
                rule=card.key,
                fallback=card.fallback,
                message_id=card.message.id if card.message else None,
            )
    logger.info(
        "memories_cards",
        person=_member_id(summary),
        earned=earned,
        total=total,
        hidden=hidden,
    )


async def _evaluate(
    service: str, sdir: Path, summary: mi.MemberSummary, now: datetime
) -> tuple[list[cards_mod.Card], cards_mod.CardInputs, people.AvatarTimeline]:
    inputs, timeline = await _gather(service, sdir, summary, now)
    cards, hidden = await asyncio.to_thread(cards_mod.evaluate_counted, inputs)
    _log(summary, cards, hidden)
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
    lookup = {cards_mod.MessageKey(room, f.id): f for room, f in inputs.facts}

    def face(k: cards_mod.MessageKey | None) -> dict | None:
        fact = lookup.get(k) if k is not None else None
        if k is None or fact is None:
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
                {"year": y.year, "date": y.date.isoformat(), "face": face(y.message)}
                for y in card.years
            ],
            "detail": dict(card.detail),
            "letter": (
                {"date": card.date.isoformat()}
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
    """Every message object in the payload (faces, refs, yearly faces)."""
    out: list[dict] = []
    for shelf in payload["shelves"]:
        for card in shelf["cards"]:
            out.extend(r for r in (card["face"], *card["refs"].values()) if r)
            out.extend(y["face"] for y in card["years"] if y["face"])
    return out


async def build_binder(
    service: str, sdir: Path, summary: mi.MemberSummary, *, now: datetime
) -> dict:
    """The ``/memoir/cards`` payload: cached text-free, her words attached after."""
    today = now.astimezone(JST).date()
    stats = await asyncio.to_thread(_side_stats, sdir, summary.member_dirs)
    data_hash = view_hash(
        await people.room_hashes(sdir, summary),
        today.isoformat(),
        stats,
        summary.subscription_start,
        summary.birthday,
        summary.graduated,
    )

    async def build() -> dict:
        cards, inputs, timeline = await _evaluate(service, sdir, summary, now)
        return _payload(service, sdir, cards, inputs, timeline)

    payload = await cached_view(
        sdir, VIEW, people.person_key(summary), data_hash, build
    )
    await people.attach_texts(sdir, _message_refs(payload))
    return payload


__all__ = ["avatar_changes", "build_binder", "evaluate_person", "keyword_hits"]
