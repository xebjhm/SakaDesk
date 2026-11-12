"""被叫名字的瞬間: every sentence in which she wrote the fan's nickname (spec 5.2).

:func:`nickname_moments` collects every fact with ``has_nickname`` (promo
included, the subscription welcome left out, so the list matches the header's
``nickname_count`` chip: the welcome's ``%%%`` is not her calling you), loads the
texts with ``people.attach_texts`` (one ``load_texts`` per room), splits each
text with ``selection.raw_sentences`` (``lexicon.RAW_SENTENCE_SPLIT_RE``,
original characters kept) and turns every sentence that contains the
nickname code (``%%%`` or full-width ``％％％``) into its own item. Items are
newest first; the sentences of one message keep their order. The candidate
filtering and the sentence splitting are pure and run in a worker.

``years`` lists every year that has items before the ``year`` filter. Each
item's ``message`` is the shared message object with her avatar at its time.
The payload holds her words, so it is never cached.

Logs (ids, codes and counts only): ``memories_names`` (``person``, ``count``
= items returned, ``year``); ``memories_skip`` (``view=names``,
``reason=no_sentence``, ``count``) for candidates whose text was read but in
which no sentence holds the nickname code. Texts that could not be read are
logged by ``people.attach_texts`` (``view=attach_texts``,
``reason=text_missing``).
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from pathlib import Path

import structlog

from backend.services.memories import index as mi
from backend.services.memories import people
from backend.services.memories.facts import Fact, get_person_facts
from backend.services.memories.selection import has_nickname, raw_sentences

logger = structlog.get_logger(__name__)

VIEW = "names"

_Item = tuple[int, dict]  # (JST year, {"message", "sentence"})


def _candidate_refs(
    service: str,
    sdir: Path,
    tagged: Sequence[tuple[str, Fact]],
    timeline: people.AvatarTimeline,
) -> tuple[list[Fact], list[dict]]:
    """Newest-first ``has_nickname`` facts and their message objects. Pure."""
    candidates = [
        (room, f) for room, f in reversed(tagged) if f.has_nickname and not f.is_welcome
    ]
    refs = [
        people.message_ref(service, sdir, room, f, avatar=timeline)
        for room, f in candidates
    ]
    return [f for _, f in candidates], refs


def _split(facts: Sequence[Fact], refs: Sequence[dict]) -> tuple[list[_Item], int]:
    """``(items, texts without a nickname sentence)``. Pure."""
    items: list[_Item] = []
    no_sentence = 0
    for f, ref in zip(facts, refs):
        if ref["text"] is None:
            continue  # unreadable: attach_texts already logged it
        found = [s for s in raw_sentences(ref["text"]) if has_nickname(s)]
        if not found:
            no_sentence += 1
        items.extend((f.jst_date.year, {"message": ref, "sentence": s}) for s in found)
    return items, no_sentence


async def nickname_moments(
    service: str, sdir: Path, summary: mi.MemberSummary, *, year: int | None
) -> dict:
    """``{"years": [...], "items": [{"message", "sentence"}]}``, newest first."""
    tagged = await get_person_facts(sdir, summary)
    timeline = await people.avatar_timelines(sdir, summary)
    facts, refs = await asyncio.to_thread(
        _candidate_refs, service, sdir, tagged, timeline
    )
    await people.attach_texts(sdir, refs)
    items, no_sentence = await asyncio.to_thread(_split, facts, refs)
    if no_sentence:
        logger.info("memories_skip", view=VIEW, reason="no_sentence", count=no_sentence)
    years = sorted({y for y, _ in items}, reverse=True)
    picked = [item for y, item in items if year is None or y == year]
    logger.info(
        "memories_names",
        person=summary.member_ids[0] if summary.member_ids else None,
        count=len(picked),
        year=year,
    )
    return {"years": years, "items": picked}


__all__ = ["nickname_moments"]
