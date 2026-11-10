"""あの日と今日, then and now (spec 14.2).

Shared with the recap's S08 slide (one copy of each rule):

- :func:`keywords_in` -- the ``lexicon.ECHO_KEYWORDS`` in a text (NFKC);
- :func:`first_week_window` -- the first week from a start date;
- :func:`latest_week_window` -- the 7 JST days ending on a date.
"""

from __future__ import annotations

from datetime import date, timedelta

from backend.services.memories.lexicon import ECHO_KEYWORDS
from backend.services.memories.selection import normalize

WEEK_DAYS = 7


def keywords_in(text: str) -> list[str]:
    """The :data:`~lexicon.ECHO_KEYWORDS` contained in the NFKC ``text``, in list order."""
    norm = normalize(text)
    return [k for k in ECHO_KEYWORDS if k in norm]


def first_week_window(begin: date) -> tuple[date, date]:
    """``(begin, begin + 6 days)``: the first week, both ends inclusive."""
    return begin, begin + timedelta(days=WEEK_DAYS - 1)


def latest_week_window(today: date) -> tuple[date, date]:
    """``(today - 6 days, today)``: the latest week, both ends inclusive."""
    return today - timedelta(days=WEEK_DAYS - 1), today


__all__ = ["first_week_window", "keywords_in", "latest_week_window"]
