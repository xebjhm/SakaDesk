from datetime import date, datetime, timedelta, timezone

from backend.services.memories.selection import (
    Msg,
    caption_for,
    find_bursts,
    greeting_class,
    has_nickname,
    importance,
    is_promo,
    is_pure_greeting,
    jst,
    photo_is_promo,
    photo_score,
    special_dates,
)

T0 = datetime(2026, 9, 14, 12, 0, tzinfo=timezone.utc)  # 21:00 JST


def m(i, minutes=0, type_="text", text="", fav=False):
    return Msg(
        id=i, ts=T0 + timedelta(minutes=minutes), type=type_, text=text, favorited=fav
    )


def test_promo():
    assert is_promo("詳細はコチラ https://example.jp")
    assert is_promo(
        "お知らせ！新曲の発売と予約が始まりました、ぜひチェックしてね" + "あ" * 80
    )
    assert is_promo("19:00〜 20:00〜 21:00〜 出演します")
    assert not is_promo("今日もお疲れさま！ゆっくり休んでね🌙")


def test_promo_edge_cases():
    assert is_promo("www.example.jp")
    assert is_promo("ｈｔｔｐｓ：／／ｅｘａｍｐｌｅ．ｊｐ")  # full-width URL
    assert is_promo("１９：００〜 ２０：００〜 ２１：００〜")  # full-width times
    assert is_promo("【9月14日 出演情報】")  # heading with a date + 1 word
    assert is_promo("【9/14 Live】")
    assert not is_promo("新曲の発売、楽しみ🎉")  # one word, short
    assert is_promo("新曲の発売" + "あ" * 80)  # one word, long
    assert not is_promo("")


def test_greetings():
    assert greeting_class("おはよう☀️") == "ohayo"
    assert greeting_class("おやすみ〜🌙 また明日ね") == "oyasumi"
    assert greeting_class("%%%ちゃん大好き！") == "daisuki"
    assert is_pure_greeting("おやすみなさい")
    assert not is_pure_greeting("おやすみ、今日のライブ本当にありがとう")
    assert has_nickname("％％％さん") and not has_nickname("みんな")


def test_greetings_fullwidth_and_emoji():
    assert greeting_class("お疲れさま！") == "otsukare"
    assert greeting_class("お昼ごはん🍙") == "ohiru"
    assert greeting_class("ありがとう❤️") == "arigato"
    assert greeting_class("今日は雨") is None
    assert is_pure_greeting("おはよう☀️")
    assert is_pure_greeting("こんばんは！！")
    assert is_pure_greeting("おやすみ〜🌙")
    assert not is_pure_greeting("")
    assert has_nickname("%%%ちゃん👋")


def test_importance_formula():
    base = m(1, text="あ" * 50)
    assert importance(base, special=False, repeated=False) == 50
    rich = m(2, text="%%%ちゃん本当にありがとう", fav=True)
    assert (
        importance(rich, special=True, repeated=False)
        == len(rich.text) + 300 + 80 + 100 + 150
    )
    assert importance(m(3, text="おやすみなさい"), special=False, repeated=False) < 0
    assert importance(m(4, text="あ" * 20), special=False, repeated=True) < 0


def test_importance_fullwidth_nickname_counts_once_for_emotion():
    msg = m(5, text="％％％ちゃん大好き、夢だよ")
    assert importance(msg, special=False, repeated=False) == len(msg.text) + 80 + 100


def test_bursts_and_captions():
    photos = [
        m(10, 0, "picture"),
        m(11, 4, "picture"),
        m(12, 9, "picture"),
        m(13, 30, "picture"),
    ]
    bursts = find_bursts(photos)
    assert [[p.id for p in b] for b in bursts] == [[10, 11, 12]]
    texts = [
        m(20, 11, text="ライブ最高だった！"),
        m(21, 40, text="詳細はコチラ https://x.jp"),
    ]
    assert caption_for(photos[0], texts, bursts[0]).id == 20  # burst window
    assert caption_for(photos[3], texts) is None  # promo / out of window
    assert caption_for(photos[0], texts) is None  # without burst: 11 min away


def test_bursts_edges():
    assert find_bursts([m(1, 0, "picture"), m(2, 5, "video")]) == []  # only 2
    gap = [
        m(1, 0, "picture"),
        m(2, 10, "picture"),
        m(3, 20, "video"),
        m(4, 31, "picture"),
    ]
    assert [[p.id for p in b] for b in find_bursts(gap)] == [
        [1, 2, 3]
    ]  # 10 min inclusive
    assert find_bursts([m(1, 0), m(2, 1), m(3, 2)]) == []  # texts are not media


def test_caption_nearest_and_promo_photo():
    photo = m(1, 0, "picture")
    texts = [m(2, -3, text="前"), m(3, 1, text="近い"), m(4, 4, text="遠い")]
    assert caption_for(photo, texts).id == 3
    promo = [m(5, 1, text="発売と予約のお知らせ"), m(6, 2, text="ふつう")]
    assert caption_for(photo, promo).id == 6
    assert not photo_is_promo(photo, [m(7, 2, text="ふつう")])
    assert photo_is_promo(photo, [m(8, 1, text="https://x.jp"), m(9, 3, text="ふつう")])
    assert not photo_is_promo(photo, [])


def test_photo_score():
    # 06:00 UTC = 15:00 JST, so no evening bonus here.
    p = Msg(id=1, ts=T0 - timedelta(hours=6), type="picture", text="", favorited=True)
    cap = m(2, text="おやすみ🌙")
    assert (
        photo_score(p, cap, last_in_burst=True, holiday=False) == 500 + 150 + 80 + 100
    )


def test_photo_score_evening_and_holiday_bonus():
    day = Msg(
        id=1,
        ts=datetime(2026, 9, 14, 5, 59, tzinfo=timezone.utc),
        type="picture",
        text="",
    )
    eve = Msg(
        id=2,
        ts=datetime(2026, 9, 14, 11, 0, tzinfo=timezone.utc),
        type="picture",
        text="",
    )
    late = Msg(
        id=3,
        ts=datetime(2026, 9, 14, 14, 59, tzinfo=timezone.utc),
        type="picture",
        text="",
    )
    midnight = Msg(
        id=4,
        ts=datetime(2026, 9, 14, 15, 0, tzinfo=timezone.utc),
        type="picture",
        text="",
    )
    assert photo_score(day, None, last_in_burst=False, holiday=False) == 0
    assert photo_score(eve, None, last_in_burst=False, holiday=False) == 80  # JST 20:00
    assert (
        photo_score(late, None, last_in_burst=False, holiday=False) == 80
    )  # JST 23:59
    assert (
        photo_score(midnight, None, last_in_burst=False, holiday=False) == 0
    )  # JST 00:00
    assert photo_score(day, None, last_in_burst=False, holiday=True) == 80
    assert (
        photo_score(eve, None, last_in_burst=False, holiday=True) == 80
    )  # no stacking
    assert (
        photo_score(day, m(9, text="普通"), last_in_burst=False, holiday=False) == 150
    )
    assert (
        photo_score(day, m(9, text="％％％ちゃん"), last_in_burst=False, holiday=False)
        == 230
    )


def test_jst():
    assert jst(datetime(2026, 9, 14, 11, 0, tzinfo=timezone.utc)).hour == 20


def test_special_dates():
    got = special_dates(2026, "2001-03-31", "2023-05-02")
    assert got == {
        date(2026, 3, 31),
        date(2026, 4, 1),
        date(2026, 12, 31),
        date(2026, 5, 2),
    }
    assert special_dates(2026, None, None) == {date(2026, 12, 31)}
    assert special_dates(2026, "bad", "") == {date(2026, 12, 31)}
    assert special_dates(2026, "2000-12-31", None) >= {
        date(2026, 12, 31),
        date(2027, 1, 1),
    }
    # Feb 29 birthday in a non-leap year falls back to Feb 28.
    assert date(2026, 2, 28) in special_dates(2026, "2000-02-29", None)
    assert date(2028, 2, 29) in special_dates(2028, "2000-02-29", None)


def test_konnichiwa_is_not_an_ohiru_greeting():
    assert greeting_class("こんにちは！") is None
    assert greeting_class("お昼ごはん🍙") == "ohiru"
    assert greeting_class("ランチ行ってきた") == "ohiru"


def test_promo_counts_distinct_words():
    # The same word twice is one signal; two different words are promo.
    assert not is_promo("発売発売")
    assert not is_promo("予約したよ、予約できた！")
    assert is_promo("発売と予約")


def test_special_dates_logs_unparsable_field_only():
    from structlog.testing import capture_logs

    with capture_logs() as logs:
        out = special_dates(2026, "not-a-date", "2025-13-45")
    assert out == {date(2026, 12, 31)}
    events = [e for e in logs if e["event"] == "special_date_unparsable"]
    assert [e["field"] for e in events] == ["birthday", "subscription_start"]
    assert all(
        "not-a-date" not in str(e) and "2025-13-45" not in str(e) for e in events
    )


def test_jst_rejects_naive_datetime():
    import pytest

    with pytest.raises(ValueError):
        jst(datetime(2026, 9, 14, 12, 0))
    assert jst(T0).hour == 21


def test_greeting_classes_multi_label_and_mask():
    from backend.services.memories.lexicon import GREETING_BITS
    from backend.services.memories.selection import (
        classes_from_mask,
        greeting_classes,
        greeting_mask,
    )

    text = "おやすみ、%%%大好きだよ🌙"
    assert greeting_classes(text) == {"oyasumi", "daisuki"}
    assert greeting_class(text) == "oyasumi"  # single label keeps lexicon order
    mask = greeting_mask(text)
    assert mask == GREETING_BITS["oyasumi"] | GREETING_BITS["daisuki"]
    assert classes_from_mask(mask) == {"oyasumi", "daisuki"}
    assert greeting_mask("今日は雨☔") == 0
    assert greeting_classes("ＯＫ、ありがとう！おはよう") == {"arigato", "ohayo"}


def test_bare_suki_is_not_daisuki():
    from backend.services.memories.selection import greeting_classes

    assert greeting_class("好きな食べ物はカレー🍛") is None
    assert greeting_classes("好きな食べ物はカレー") == frozenset()
    assert greeting_class("だいすき💕") == "daisuki"
    assert greeting_class("%%%ちゃん大好き") == "daisuki"


def test_split_sentences():
    from backend.services.memories.selection import split_sentences

    assert split_sentences("今日はありがとう！楽しかった。\nおやすみ🌙") == [
        "今日はありがとう",
        "楽しかった",
        "おやすみ🌙",
    ]
    assert split_sentences("ほんと？うん！！") == ["ほんと", "うん"]  # full-width
    assert split_sentences("。。\n") == []


def test_raw_sentences_keep_original_characters():
    from backend.services.memories.selection import raw_sentences

    # not NFKC: full-width ％ and ｶﾀｶﾅ stay as written; emoji kept
    assert raw_sentences("％％％ｶﾞﾝﾊﾞ！ありがと💕。\n %%%またね?") == [
        "％％％ｶﾞﾝﾊﾞ",
        "ありがと💕",
        "%%%またね",
    ]
    assert raw_sentences("！？\n") == []


def test_repeated_counts_sentences_not_messages():
    from backend.services.memories.selection import (
        is_repeated,
        sentence_counts,
        split_sentences,
    )

    texts = [
        "今日もお疲れさま！おやすみ🌙",
        "ライブ楽しかった！おやすみ🌙",
        "雨だね。おやすみ🌙",
        "今日もお疲れさま！ゆっくり休んでね",
        "今日もお疲れさま！",
    ]
    counts = sentence_counts(texts)
    assert counts["おやすみ🌙"] == 3 and counts["今日もお疲れさま"] == 3
    # Whole messages all differ, but their sentences repeat.
    assert is_repeated(split_sentences(texts[0]), counts)
    assert is_repeated(split_sentences(texts[4]), counts)
    # A long unique sentence that merely ends with a stock one is not penalised.
    long_unique = (
        "初めてのドームで本当に緊張したけどみんなの顔が見えて嬉しかった！おやすみ🌙"
    )
    assert not is_repeated(split_sentences(long_unique), counts)
    assert not is_repeated([], counts)
    # A sentence repeated inside one message counts once.
    assert sentence_counts(["うん！うん！うん！"]) == {"うん": 1}
