"""Q&A posts are not her longest heartfelt words (memories feedback r4 §2)."""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from backend.services.memories import cards as c
from backend.services.memories import facts as mf
from backend.services.memories import index as mi
from backend.services.memories import recap
from backend.services.memories import selection as sel
from backend.services.memories import timeline as tl
from backend.services.memories.facts import Fact
from backend.services.memories.selection import JST
from backend.tests import memories_archive as arch

ROOM = ("90 高井 俐香", "142 高井 俐香")
ROOM_REL = f"messages/{ROOM[0]}/{ROOM[1]}"

QA_PLAIN = "質問第一弾！\nQ 会えない時どう過ごせばいいですか！\nA 私も会えないと寂しい\n\nQ好きな食べ物は？\nAお肉！\nQ最近のマイブームは？\nおそうめん"
QA_DOT = "Q.MBTIは？\nA. ESFPですっ！\nQ. 使ってるメイク道具は？\nA. たくさん\nＱ．好きな色は？\nＡ．ピンク"
QA_NUMBERED = "質問にこたえるよ\n1. 好きな色は？\n→ピンク\n2. 好きな季節は？\n→春\n3. 好きな食べ物は？\n→お肉"
QA_LETTER = "✉️ 納豆にハマってるみたいだけど...\n➡️ごま油をかけたりします！\n✉️ ミーグリでは何話したい？\n➡️ライブの感想！"
HEARTFELT = (
    "今日は本当にありがとう。Qちゃんとも話したけど、みんなのおかげで頑張れたよ。"
)


@pytest.mark.parametrize("text", [QA_PLAIN, QA_DOT, QA_NUMBERED, QA_LETTER])
def test_qa_posts_are_detected(text):
    assert sel.is_qa(text)


@pytest.mark.parametrize(
    "text",
    [
        HEARTFELT,
        "Q&Aやりたいな！質問送ってね？",  # asking for questions is not a Q&A
        "Q 好きな色は？\nA ピンク",  # two Q lines are not enough
        "✉️ お手紙ありがとう\n➡️ 返事は明日ね",  # one pair is not enough
        "QUEENの曲が好き\nQUICKに返すね\nQuestionある？",  # English words starting with Q
        "",
    ],
)
def test_other_posts_are_not_qa(text):
    assert not sel.is_qa(text)


def fact(i, when, *, chars, importance=None, qa=False) -> Fact:
    local = datetime.strptime(when, "%Y-%m-%d %H:%M").replace(tzinfo=JST)
    return Fact(
        id=i,
        ts=local.astimezone(timezone.utc),
        jst_date=local.date(),
        hour=local.hour,
        minute=local.minute,
        type="text",
        is_promo=False,
        has_nickname=False,
        greeting_mask=0,
        chars=chars,
        importance=importance if importance is not None else chars,
        photo_score=None,
        burst_id=None,
        caption_id=None,
        favorited=False,
        media_file=None,
        duration_s=None,
        is_qa=qa,
    )


FACTS = [
    fact(1, "2026-03-01 20:00", chars=900, qa=True),
    fact(2, "2026-03-02 20:00", chars=400),
    fact(3, "2026-03-03 20:00", chars=50),
]


def test_longest_card_skips_qa():
    inp = c.CardInputs(
        facts=[(ROOM_REL, f) for f in FACTS],
        today=date(2026, 11, 12),
        subscription_start=None,
        birthday=None,
        graduated=False,
        letters=(),
        avatar_changes=(),
    )
    card = {k.key: k for k in c.evaluate(inp)}["record.longest"]
    assert card.message == c.MessageKey(ROOM_REL, 2) and card.detail == {"chars": 400}


def test_timeline_top_slot_skips_qa():
    _, slots = tl._pick([(ROOM_REL, f) for f in FACTS])
    assert slots["top"][1].id == 2


def test_recap_longest_metric_skips_qa():
    summary = mi.MemberSummary(
        name_norm="高井俐香",
        name="高井 俐香",
        member_dirs=(ROOM_REL,),
        member_ids=("142",),
        group_ids=("90",),
        subscription_start=None,
        birthday=None,
        graduated=False,
    )
    now = datetime(2026, 12, 10, 12, 0, tzinfo=JST)
    stats = recap._member_stats(summary, [(ROOM_REL, f) for f in FACTS], 2026, now)
    assert stats.metrics["longest"] == 400


@pytest.mark.asyncio
async def test_index_flags_qa_and_recap_s07_skips_it(tmp_path):
    from backend.services import app_state
    from backend.tests.test_memories_welcome import m

    mi.set_db_path(tmp_path / "idx.db")
    app_state.set_db_path(tmp_path / "app.db")
    app_state.init_db()
    sdir = tmp_path / "日向坂46"
    long_qa = QA_PLAIN + "\n" + "Qもっと教えて？\nAまたね\n" * 20
    letter = "今日は本当にありがとう。" + "あなたに会えて嬉しかったよ、" * 12
    rows = [
        m(1, "2025-12-01 20:00", "はじめまして、よろしくね"),
        m(2, "2026-05-01 20:00", long_qa),
        m(3, "2026-03-02 20:00", letter),
        m(4, "2026-03-05 20:00", "ライブ本当に楽しかった。" * 8),
        m(5, "2026-03-06 20:00", "お手紙ありがとう。ずっと大切にするね、" * 6),
        m(6, "2026-03-07 20:00", "今日のレッスンは難しかったけど頑張った。" * 6),
        *[m(10 + k, f"2026-01-{1 + k:02d} 20:00", f"きょうの話{k}") for k in range(20)],
    ]
    d = arch.write_room(sdir, *ROOM, rows)
    await mi.get_member_index(sdir, d)
    facts = {f.id: f for f in mf.facts_in_range(sdir, d)}
    assert facts[2].is_qa and not facts[3].is_qa
    assert (
        facts[2].importance is not None
    )  # still scored; only the longest picks skip it
    import time_machine

    with time_machine.travel(datetime(2026, 12, 10, 12, 0, tzinfo=JST), tick=False):
        summary = (await mi.list_members(sdir))[0]
        payload = await recap.build_member_recap(
            "hinatazaka46", sdir, summary, 2026, now=datetime.now(timezone.utc)
        )
    slides = {s["key"]: s for s in payload["slides"]}
    # the Q&A is the longest and best-scored text, yet S07 picks a real letter
    assert slides["s07_letter"]["data"]["message"]["id"] in (3, 4, 5, 6)
