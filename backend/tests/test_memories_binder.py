"""Photocard binder service (``backend/services/memories/binder.py``)."""

from __future__ import annotations

import contextlib
import dataclasses
import json
from datetime import datetime, timezone

import pytest
from structlog.testing import capture_logs

from backend.services.memories import binder
from backend.services.memories import cards as c
from backend.services.memories import index as mi
from backend.services.memories import people
from backend.services.memories import view_cache as vc
from backend.tests.memories_archive import msg, write_room, write_side_inputs

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
OLD_ROOM = "messages/40 松田 好花/64 松田 好花"
NEW_ROOM = "messages/94 松田 好花/64 松田 好花"
KANE_ROOM = "messages/34 金村 美玖/58 金村 美玖"
NOW = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)

XMAS = "メリークリスマス🎄"
LONG = "本当にありがとう、大好きだよ。夢に向かって一緒に頑張ろうね、感謝しかない"
FIRST = "はじめまして！よろしくね"
NAMES = ("松田", "好花", "金村", "美玖")

AVATARS = [
    {
        "kind": "thumbnail",
        "file": "thumbnail/a.jpg",
        "first_seen": "2025-01-01T00:00:00Z",
    },
    {
        "kind": "thumbnail",
        "file": "thumbnail/b.jpg",
        "first_seen": "2025-12-01T03:00:00Z",
    },
]


def letter(i, created):
    return {"id": i, "text": f"手紙{i}💌", "created_at": created}


@pytest.fixture
def svc(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    write_room(
        sdir,
        "40 松田 好花",
        "64 松田 好花",
        [
            msg(1, "2024-07-24T03:00:00Z", content=FIRST),
            msg(2, "2024-12-24T11:00:00Z", content=XMAS),  # 12-24 20:00 JST
            msg(3, "2024-12-25T03:00:00Z", content=LONG),  # 12-25 12:00 JST
            msg(4, "2025-02-14T03:00:00Z", content="今日は寒いね"),
        ],
        letters=[letter(1, "2024-08-01T00:00:00Z")],
    )
    write_room(
        sdir,
        "94 松田 好花",
        "64 松田 好花",
        [
            msg(1, "2025-12-02T03:00:00Z", content="新しいアイコンだよ"),
            msg(
                2,
                "2025-12-03T03:00:00Z",
                "picture",
                media_file="messages\\94 松田 好花\\64 松田 好花\\picture\\2.jpg",
            ),
        ],
        avatars=AVATARS,
        letters=[letter(7, "2025-01-01T00:00:00Z")],
    )
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [msg(1, "2024-05-01T03:00:00Z", content="金村です")],
        letters=[letter(i, f"2024-0{i}-01T00:00:00Z") for i in range(1, 6)],
    )
    write_side_inputs(sdir, sub_starts={"40": "2024-07-24"})
    return sdir


async def matsuda(sdir):
    return next(s for s in await mi.list_members(sdir) if len(s.member_dirs) == 2)


def cards_of(payload):
    return {
        card["key"]: card for shelf in payload["shelves"] for card in shelf["cards"]
    }


@pytest.mark.asyncio
async def test_two_rooms_give_one_binder(svc):
    s = await matsuda(svc)
    payload = await binder.build_binder(SERVICE, svc, s, now=NOW)
    k = cards_of(payload)
    first = k["first.message"]["face"]
    assert first["room"] == OLD_ROOM and first["id"] == 1 and first["text"] == FIRST
    assert first["member_path"] == f"{SVC_NAME}/{OLD_ROOM}"
    pic = k["first.picture"]["face"]
    assert pic["room"] == NEW_ROOM and pic["media_file"].endswith("picture/2.jpg")
    assert k["count.messages.100"]["progress"] == {"current": 6, "target": 100}
    assert payload["progress"]["total"] == sum(
        len(sh["cards"]) for sh in payload["shelves"]
    )
    assert [sh["key"] for sh in payload["shelves"]] == [
        key for key in c.SHELVES if key not in ("graduation",)
    ]
    assert k["anniv.y1"]["earned"] and k["anniv.y1"]["date"] == "2025-07-24"


@pytest.mark.asyncio
async def test_letters_count_only_from_her_rooms(svc):
    s = await matsuda(svc)
    k = cards_of(await binder.build_binder(SERVICE, svc, s, now=NOW))
    assert k["you.letter.1"]["letter"] == {"date": "2024-08-01"}
    assert k["you.letter.1"]["face"] is None and k["you.letter.1"]["refs"] == {}
    assert k["you.letter.10"]["progress"] == {"current": 2, "target": 10}


@pytest.mark.asyncio
async def test_christmas_keyword_hit_beats_higher_importance(svc):
    s = await matsuda(svc)
    k = cards_of(await binder.build_binder(SERVICE, svc, s, now=NOW))
    xmas = k["special.christmas"]
    assert xmas["face"]["id"] == 2 and xmas["face"]["text"] == XMAS
    assert xmas["years"] == [{"year": 2024, "date": "2024-12-24", "face": xmas["face"]}]
    # no Valentine word on 02-14: best of the day instead
    assert k["special.valentine"]["face"]["id"] == 4


@pytest.mark.asyncio
async def test_keyword_hits_read_only_keyword_days(svc, monkeypatch):
    s = await matsuda(svc)
    tagged = await binder.get_person_facts(svc, s)
    calls = []
    real = binder.load_texts

    def spy(sdir, mdir, ids):
        calls.append((mdir.relative_to(sdir).as_posix(), set(ids)))
        return real(sdir, mdir, ids)

    monkeypatch.setattr(binder, "load_texts", spy)
    hits = await binder.keyword_hits(svc, tagged)
    assert calls == [(OLD_ROOM, {2, 3, 4})]
    assert hits == {c.MessageKey(OLD_ROOM, 2): frozenset({"christmas"})}


@pytest.mark.asyncio
async def test_avatar_change_card(svc):
    s = await matsuda(svc)
    k = cards_of(await binder.build_binder(SERVICE, svc, s, now=NOW))
    change = k["change.avatar.2025-12-01"]
    assert change["face"]["room"] == NEW_ROOM and change["face"]["id"] == 1
    assert (
        change["refs"]["old_last"]["id"] == 4 and change["refs"]["new_first"]["id"] == 1
    )
    assert change["detail"]["messages"] == 2
    assert change["detail"]["old_url"].endswith("thumbnail/a.jpg")
    assert change["detail"]["new_url"].endswith("thumbnail/b.jpg")
    assert change["face"]["avatar_url"].endswith("thumbnail/b.jpg")


def test_avatar_changes_skip_first_undated_and_repeats():
    t1 = datetime(2025, 1, 1, tzinfo=timezone.utc)
    t2 = datetime(2025, 6, 1, tzinfo=timezone.utc)
    tl = people.AvatarTimeline(
        entries=((None, "/u0"), (None, "/u1"), (t1, "/u1"), (t2, "/u2")), current="/u2"
    )
    assert binder.avatar_changes(tl) == [c.AvatarChange(t2, "/u1", "/u2")]
    assert binder.avatar_changes(people.AvatarTimeline((), None)) == []


@pytest.mark.asyncio
async def test_cache_holds_no_text_and_second_call_skips_facts(svc, monkeypatch):
    s = await matsuda(svc)
    calls = []
    real = binder.get_person_facts

    async def counting(sdir, summary):
        calls.append(1)
        return await real(sdir, summary)

    monkeypatch.setattr(binder, "get_person_facts", counting)
    first = await binder.build_binder(SERVICE, svc, s, now=NOW)
    with capture_logs() as logs:
        second = await binder.build_binder(SERVICE, svc, s, now=NOW)
    assert len(calls) == 1
    assert first == second
    assert [e["outcome"] for e in logs if e["event"] == "memories_view_cache"] == [
        "hit"
    ]
    with contextlib.closing(mi._connect()) as conn:
        (blob,) = conn.execute(
            "SELECT payload FROM memories_view_cache WHERE view='binder'"
        ).fetchone()
    stored = json.loads(blob)
    assert not vc.contains_text(stored)
    assert vc.contains_text(second)
    for word in (XMAS, LONG, FIRST, "手紙"):
        assert word not in blob


@pytest.mark.asyncio
async def test_cache_refreshes_on_a_new_day_and_new_letters(svc, monkeypatch):
    s = await matsuda(svc)
    calls = []
    real = binder.get_person_facts

    async def counting(sdir, summary):
        calls.append(1)
        return await real(sdir, summary)

    monkeypatch.setattr(binder, "get_person_facts", counting)
    await binder.build_binder(SERVICE, svc, s, now=NOW)
    await binder.build_binder(SERVICE, svc, s, now=NOW.replace(day=11))
    (svc / OLD_ROOM / "letters.json").write_text(
        json.dumps(
            {
                "letters": [
                    letter(1, "2024-08-01T00:00:00Z"),
                    letter(2, "2024-09-01T00:00:00Z"),
                ]
            }
        ),
        encoding="utf-8",
    )
    payload = await binder.build_binder(SERVICE, svc, s, now=NOW.replace(day=11))
    assert len(calls) == 3
    assert cards_of(payload)["you.letter.10"]["progress"]["current"] == 3


@pytest.mark.asyncio
async def test_evaluate_person_logs_counts_and_fallbacks_without_text(svc):
    s = await matsuda(svc)
    with capture_logs() as logs:
        cards = await binder.evaluate_person(SERVICE, svc, s, now=NOW)
    ev = next(e for e in logs if e["event"] == "memories_cards")
    assert ev["person"] == "64"
    assert (ev["earned"], ev["total"]) == c.progress_summary(cards)
    assert ev["hidden"] >= 1  # no birthday, not graduated, ...
    selects = [e for e in logs if e["event"] == "memories_select"]
    assert {e["rule"]: e["fallback"] for e in selects}[
        "special.valentine"
    ] == "best_of_day"
    anniv = next(e for e in selects if e["rule"] == "anniv.d100")
    assert anniv["fallback"] == "nearest" and anniv["view"] == "binder"
    assert all(isinstance(e["message_id"], int) for e in selects)
    blob = repr(logs)
    for word in (XMAS, LONG, FIRST, "手紙", OLD_ROOM, *NAMES):
        assert word not in blob


@pytest.mark.asyncio
async def test_build_binder_logs_carry_no_text_or_names(svc):
    s = await matsuda(svc)
    with capture_logs() as logs:
        await binder.build_binder(SERVICE, svc, s, now=NOW)
        await binder.build_binder(SERVICE, svc, s, now=NOW)
    blob = repr(logs)
    for word in (XMAS, LONG, FIRST, "手紙", "金村です", *NAMES):
        assert word not in blob


@pytest.mark.asyncio
async def test_graduated_person_with_birthday(svc):
    write_side_inputs(svc, birthdays={"金村美玖": "2002-05-01"}, closed_groups=["34"])
    kane = next(s for s in await mi.list_members(svc) if s.member_dirs == (KANE_ROOM,))
    k = cards_of(await binder.build_binder(SERVICE, svc, kane, now=NOW))
    assert kane.graduated
    assert k["grad.last"]["face"]["text"] == "金村です"
    assert [
        sh["key"]
        for sh in (await binder.build_binder(SERVICE, svc, kane, now=NOW))["shelves"]
    ][-1] == "graduation"
    assert k["special.birthday"]["face"]["id"] == 1
    assert k["special.birthday"]["foil"]


@pytest.mark.asyncio
async def test_unparsable_subscription_start_hides_the_anniversary_shelf(svc):
    s = dataclasses.replace(await matsuda(svc), subscription_start="not-a-date")
    cards = await binder.evaluate_person(SERVICE, svc, s, now=NOW)
    assert not [card for card in cards if card.shelf == "anniversary"]
    assert "special.sub_anniversary" not in c.earned_keys(cards)
