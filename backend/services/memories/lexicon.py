"""Keyword lists and patterns for the Memories selection rules (spec 3.3).

Pure data: no logic lives here. Patterns are matched against NFKC-normalised
text (see ``selection.normalize``), so full-width forms need no extra entries.
"""

from __future__ import annotations

import re

URL_RE = re.compile(r"https?://|www\.", re.IGNORECASE)

PROMO_WORDS_PATTERN = (
    r"詳細はコチラ|詳しくは|チェックしてね|ぜひ(?:見|聴|観)て|お知らせ|告知|解禁|発売|予約"
    r"|リリース|配信(?:中|開始)|放送|出演|オンエア|公演|チケット|抽選|応募|特典"
    r"|ブログ更新|出演情報|CD|Blu-ray|DVD|写真集|グッズ|コラボ|キャンペーン"
)
PROMO_WORDS_RE = re.compile(PROMO_WORDS_PATTERN)

TIME_RE = re.compile(r"\d{1,2}:\d{2}〜?")
# 【…】 heading that contains a date such as 9/14 or 9月14日.
DATE_HEADING_RE = re.compile(r"【[^】]*\d{1,2}(?:/|月|\.)\d{1,2}[^】]*】")

EMOTION_WORDS = (
    "ありがとう",
    "感謝",
    "大好き",
    "本当に",
    "嬉しい",
    "悔しい",
    "涙",
    "目標",
    "夢",
    "卒業",
    "ライブ",
    "ミーグリ",
    "誕生日",
)

NICKNAME_TOKEN = "%%%"

GREETING_RES = {
    "ohayo": re.compile(r"おはよ"),
    "oyasumi": re.compile(r"おやすみ"),
    # Bare 好き is too broad ("好きな食べ物"); only the explicit forms count.
    "daisuki": re.compile(r"大好き|だいすき"),
    "arigato": re.compile(r"ありがとう|ありがと|感謝"),
    "otsukare": re.compile(r"お疲れ|おつかれ"),
    "ohiru": re.compile(r"お昼|ランチ"),
}

# Bit per greeting class, for the multi-label ``greeting_mask`` (stored in the
# index). Append new classes at the end so existing bits keep their meaning.
GREETING_BITS = {name: 1 << i for i, name in enumerate(GREETING_RES)}

# Sentence boundaries for the repeated-sentence penalty and sentence picks.
# Matched on NFKC text, where ！？ become !?.
SENTENCE_SPLIT_RE = re.compile(r"[。!?\n]+")

# Greeting word + polite ending only, followed by punctuation / emoji / spaces.
PURE_GREETING_RE = re.compile(
    r"^(?:おはよう|おやすみ|こんばんは)(?:なさい|ございます)?[\W_]*$"
)

# Words that earn the caption bonus in the photo score.
CAPTION_BONUS_WORDS = (NICKNAME_TOKEN, "おはよ", "おやすみ", "好き")

# Sentence boundaries on RAW (un-normalised) text: full-width ！？ are listed
# because NFKC has not run. Used where her words are shown as written.
RAW_SENTENCE_SPLIT_RE = re.compile(r"[。！？!?\n]+")

# The automatic welcome a room sends when a fan subscribes:
# 「ご登録ありがとうございます」「追加して下さりありがとう」「%%%さん追加ありがとう御座います」.
# 登録 / 追加 then ありがとう (or 有難う) within one sentence: up to 16 characters
# between them (「ご登録して頂き本当に本当にありがとう」), line breaks allowed
# (「ご登録くださり\nありがとう」). Matched on NFKC text, so ！？ are !?. The phrase
# alone is not enough: ``selection.welcome_ids`` also requires the opening
# position, because she can thank for 登録 in her own words later on.
WELCOME_RE = re.compile(r"(?:登録|追加)[^。!?]{0,16}?(?:ありがと|有難|有り難)")

# Seasonal words for the Christmas and Valentine's Day moments.
CHRISTMAS_RE = re.compile(r"クリスマス|メリクリ|🎄")
VALENTINE_RE = re.compile(r"バレンタイン|チョコ")

# Seasonal / event words that pair a past message with a present one (the
# recap's S08 echo and あの日と今日's ``shared_keyword``). Order matters: the
# first shared entry wins.
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
# Minimum S08 echo score for a shared keyword to be named on the slide.
ECHO_KEYWORD_SCORE = 4
