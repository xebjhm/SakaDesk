"""あの日と今日 (``backend/services/memories/then_now.py``)."""

from __future__ import annotations

from datetime import date

from backend.services.memories import then_now
from backend.services.memories.lexicon import ECHO_KEYWORDS


# --- shared helpers (also used by the recap's S08) ---------------------------------


def test_keywords_in_finds_cjk_keywords_in_list_order():
    assert then_now.keywords_in("🎂誕生日🎉 と 桜🌸") == ["桜", "誕生日"]
    assert then_now.keywords_in("なにもない🙂") == []


def test_keywords_in_reads_nfkc_text():
    # Half-width katakana normalises to the lexicon's full-width form.
    assert then_now.keywords_in("ﾗｲﾌﾞ最高") == ["ライブ"]


def test_keywords_come_from_the_lexicon():
    assert all(then_now.keywords_in(k) for k in ECHO_KEYWORDS)


def test_first_week_window_is_seven_days_inclusive():
    assert then_now.first_week_window(date(2025, 2, 25)) == (
        date(2025, 2, 25),
        date(2025, 3, 3),
    )


def test_latest_week_window_ends_today():
    assert then_now.latest_week_window(date(2026, 3, 2)) == (
        date(2026, 2, 24),
        date(2026, 3, 2),
    )
