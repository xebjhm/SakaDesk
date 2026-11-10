"""被叫名字的瞬間: every sentence in which she wrote the fan's nickname (spec 5.2).

:func:`nickname_moments` collects every fact with ``has_nickname`` (promo
included, so the list matches the header's ``nickname_count`` chip), loads the
texts with ``people.attach_texts`` (one ``load_texts`` per room), splits each
text with ``selection.raw_sentences`` (``lexicon.RAW_SENTENCE_SPLIT_RE``,
original characters kept) and turns every sentence that contains the
nickname code (``%%%`` or full-width ``％％％``) into its own item. Items are
newest first; the sentences of one message keep their order.

``years`` lists every year that has items before the ``year`` filter. Each
item's ``message`` is the shared message object with her avatar at its time.
The payload holds her words, so it is never cached.

Logs (ids, codes and counts only): ``memories_names`` (``person``, ``count``
= items returned, ``year``); ``memories_skip`` (``view=names``,
``reason=text_missing``, ``count``) for candidates whose text could not be
read.
"""

from __future__ import annotations

from pathlib import Path

import structlog

from backend.services.memories import index as mi
from backend.services.memories import people
from backend.services.memories.facts import get_person_facts
from backend.services.memories.selection import has_nickname, raw_sentences

logger = structlog.get_logger(__name__)

VIEW = "names"


async def nickname_moments(
    service: str, sdir: Path, summary: mi.MemberSummary, *, year: int | None
) -> dict:
    """``{"years": [...], "items": [{"message", "sentence"}]}``, newest first."""
    tagged = await get_person_facts(sdir, summary)
    timeline = await people.avatar_timelines(sdir, summary)
    candidates = [(room, f) for room, f in reversed(tagged) if f.has_nickname]
    refs = [
        people.message_ref(service, sdir, room, f, avatar=timeline)
        for room, f in candidates
    ]
    await people.attach_texts(sdir, refs)
    items: list[tuple[int, dict]] = []
    missing = 0
    for (_, f), ref in zip(candidates, refs):
        found = [s for s in raw_sentences(ref["text"] or "") if has_nickname(s)]
        if not found:
            missing += 1
        items.extend((f.jst_date.year, {"message": ref, "sentence": s}) for s in found)
    if missing:
        logger.info("memories_skip", view=VIEW, reason="text_missing", count=missing)
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
