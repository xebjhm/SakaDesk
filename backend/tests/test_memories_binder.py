"""Photocard binder service (``backend/services/memories/binder.py``)."""

from __future__ import annotations

import contextlib
import dataclasses
import json
import threading
from datetime import date, datetime, timezone

import pytest
from structlog.testing import capture_logs

from backend.services.memories import binder
from backend.services.memories import cards as c
from backend.services.memories import index as mi
from backend.services.memories import people
from backend.services.memories import view_cache as vc
from backend.tests.test_memories_cards import fact, inputs
from backend.tests.memories_archive import (
    msg,
    write_avatars,
    write_room,
    write_side_inputs,
)

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
    for name in ("a.jpg", "b.jpg"):  # distinct images: changes compare by hash
        thumbs = sdir / NEW_ROOM / "profile_images" / "thumbnail"
        (thumbs / name).write_bytes(f"icon-{name}".encode("utf-8"))
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
    # the letter's own date, and where to read it (letters_local path + id)
    assert k["you.letter.1"]["letter"] == {
        "date": "2024-08-01",
        "member_path": f"{SVC_NAME}/{OLD_ROOM}",
        "id": 1,
    }
    assert k["you.letter.1"]["face"] is None and k["you.letter.1"]["refs"] == {}
    assert k["you.letter.10"]["progress"] == {"current": 2, "target": 10}


@pytest.mark.asyncio
async def test_christmas_keyword_hit_beats_higher_importance(svc):
    s = await matsuda(svc)
    k = cards_of(await binder.build_binder(SERVICE, svc, s, now=NOW))
    xmas = k["special.christmas"]
    assert xmas["face"]["id"] == 2 and xmas["face"]["text"] == XMAS
    assert xmas["years"] == [
        {"year": 2024, "date": "2024-12-24", "face": xmas["face"], "photo": None}
    ]
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


def icon(room, when, url, digest=None):
    return binder.IconEntry(room, when, url, digest)


T1 = datetime(2025, 1, 1, tzinfo=timezone.utc)
T2 = datetime(2025, 6, 1, tzinfo=timezone.utc)


def test_avatar_changes_skip_first_undated_and_repeats():
    entries = [
        icon("a", None, "/u0"),
        icon("a", None, "/u1"),  # undated: a baseline, never a change
        icon("a", T1, "/u1"),  # same image as before
        icon("a", T2, "/u2"),
    ]
    assert binder.avatar_changes(entries) == ([c.AvatarChange(T2, "/u1", "/u2")], 0)
    assert binder.avatar_changes([]) == ([], 0)


def thumb(file, seen):
    return {"kind": "thumbnail", "file": f"thumbnail/{file}", "first_seen": seen}


def set_avatars(sdir, room, entries, contents):
    """Write ``room``'s icon index, then give each file its own bytes."""
    write_avatars(sdir / room, entries)
    for name, data in contents.items():
        (sdir / room / "profile_images" / "thumbnail" / name).write_bytes(data)


def change_keys(payload):
    return sorted(k for k in cards_of(payload) if k.startswith("change."))


@pytest.mark.asyncio
async def test_room_move_with_the_same_icon_is_not_a_change(svc):
    # the new room's first archived icon is the old room's last icon
    set_avatars(
        svc,
        OLD_ROOM,
        [
            thumb("o1.jpg", "2024-07-01T00:00:00Z"),
            thumb("o2.jpg", "2025-03-01T03:00:00Z"),
        ],
        {"o1.jpg": b"icon-A", "o2.jpg": b"icon-S"},
    )
    set_avatars(
        svc,
        NEW_ROOM,
        [thumb("n1.jpg", "2025-12-01T03:00:00Z")],
        {"n1.jpg": b"icon-S"},
    )
    s = await matsuda(svc)
    payload = await binder.build_binder(SERVICE, svc, s, now=NOW)
    assert change_keys(payload) == ["change.avatar.2025-03-01"]
    change = cards_of(payload)["change.avatar.2025-03-01"]
    assert change["detail"]["old_url"].endswith("thumbnail/o1.jpg")
    assert change["detail"]["new_url"].endswith("thumbnail/o2.jpg")


@pytest.mark.asyncio
async def test_two_rooms_sharing_one_change_give_one_card(svc):
    # both rooms archive the same new icon on the same JST day, hours apart
    set_avatars(
        svc,
        OLD_ROOM,
        [
            thumb("o1.jpg", "2024-07-01T00:00:00Z"),
            thumb("o2.jpg", "2025-03-01T01:00:00Z"),
        ],
        {"o1.jpg": b"icon-A", "o2.jpg": b"icon-S"},
    )
    set_avatars(
        svc,
        NEW_ROOM,
        [
            thumb("n0.jpg", "2025-01-01T00:00:00Z"),
            thumb("n2.jpg", "2025-03-01T05:00:00Z"),
        ],
        {"n0.jpg": b"icon-B", "n2.jpg": b"icon-S"},
    )
    s = await matsuda(svc)
    with capture_logs() as logs:
        payload = await binder.build_binder(SERVICE, svc, s, now=NOW)
    assert change_keys(payload) == ["change.avatar.2025-03-01"]
    skip = next(e for e in logs if e.get("reason") == "avatar_same_image")
    assert skip["event"] == "memories_skip" and skip["count"] == 1
    assert skip["person"] == "64"


@pytest.mark.asyncio
async def test_two_rooms_sharing_one_change_on_different_days_give_one_card(svc):
    # the new room archives the same new icon four days after the old room
    set_avatars(
        svc,
        OLD_ROOM,
        [
            thumb("o1.jpg", "2024-07-01T00:00:00Z"),
            thumb("o2.jpg", "2025-03-01T01:00:00Z"),
        ],
        {"o1.jpg": b"icon-A", "o2.jpg": b"icon-S"},
    )
    set_avatars(
        svc,
        NEW_ROOM,
        [
            thumb("n0.jpg", "2025-01-01T00:00:00Z"),
            thumb("n2.jpg", "2025-03-05T05:00:00Z"),
        ],
        {"n0.jpg": b"icon-B", "n2.jpg": b"icon-S"},
    )
    s = await matsuda(svc)
    payload = await binder.build_binder(SERVICE, svc, s, now=NOW)
    assert change_keys(payload) == ["change.avatar.2025-03-01"]


def d(day, hour=0, minute=0, second=0):
    return datetime(2025, 3, day, hour, minute, second, tzinfo=timezone.utc)


def test_avatar_changes_dedupe_by_hash_across_days():
    # B archives A's change S late, after A already moved on to T
    entries = [
        icon("a", d(1), "/a/x", "X"),
        icon("b", d(1, 1), "/b/x", "X"),
        icon("a", d(2), "/a/s", "S"),
        icon("a", d(3), "/a/t", "T"),
        icon("b", d(9), "/b/s", "S"),
    ]
    changes, dropped = binder.avatar_changes(entries)
    assert [ch.new_url for ch in changes] == ["/a/s", "/a/t"]
    assert dropped == 1
    assert changes[0].old_url == "/b/x"  # her icon just before, in any room


def test_avatar_changes_room_returning_to_its_own_icon_is_a_change():
    entries = [
        icon("b", d(1), "/b/x", "X"),  # b's baseline shows X early
        icon("a", d(2), "/a/x", "X"),
        icon("a", d(3), "/a/y", "Y"),
        icon("a", d(4), "/a/x2", "X"),  # back to X: b showed X before a's Y
    ]
    changes, dropped = binder.avatar_changes(entries)
    assert [ch.new_url for ch in changes] == ["/a/y", "/a/x2"] and dropped == 0


def test_avatar_changes_without_hashes_use_the_minute_window():
    near = [
        icon("a", d(1), "/a/x"),
        icon("b", d(1, 0, 0, 5), "/b/x"),
        icon("a", d(2), "/a/s"),
        icon("b", d(2, 0, 0, 50), "/b/s"),  # within a minute of a's change
    ]
    changes, dropped = binder.avatar_changes(near)
    assert [ch.new_url for ch in changes] == ["/a/s"] and dropped == 1
    far = [*near[:3], icon("b", d(2, 0, 5), "/b/s")]
    assert len(binder.avatar_changes(far)[0]) == 2
    # an undated entry in another room never matches by time
    undated = [
        icon("a", None, "/a/x"),
        icon("b", None, "/b/x"),
        icon("a", d(2), "/a/s"),
    ]
    assert binder.avatar_changes(undated) == ([c.AvatarChange(d(2), "/b/x", "/a/s")], 0)


def test_avatar_digest_handles_foreign_and_missing_files(tmp_path):
    assert binder._avatar_digest(tmp_path, "r", "https://cdn.example.jp/x.jpg") is None
    url = "/api/content/media/x/r/profile_images/thumbnail/missing.jpg"
    assert binder._avatar_digest(tmp_path, "r", url) is None


def test_avatar_digest_is_memoised_per_file_stat(tmp_path, monkeypatch):
    path = tmp_path / "r" / "profile_images" / "thumbnail" / "a.jpg"
    path.parent.mkdir(parents=True)
    path.write_bytes(b"icon-1")
    url = "/api/content/media/x/r/profile_images/thumbnail/a.jpg"
    reads = []
    real = type(path).read_bytes

    def counting(self):
        reads.append(self.name)
        return real(self)

    monkeypatch.setattr(type(path), "read_bytes", counting)
    first = binder._avatar_digest(tmp_path, "r", url)
    assert binder._avatar_digest(tmp_path, "r", url) == first
    assert reads == ["a.jpg"]  # the second call hit the memo
    path.write_bytes(b"icon-22")  # new size: re-hashed
    second = binder._avatar_digest(tmp_path, "r", url)
    assert second != first and len(reads) == 2


def test_avatar_digest_memo_is_bounded(tmp_path, monkeypatch):
    monkeypatch.setattr(binder, "_DIGEST_CACHE_MAX", 1)
    monkeypatch.setattr(binder, "_digest_cache", type(binder._digest_cache)())
    thumbs = tmp_path / "r" / "profile_images" / "thumbnail"
    thumbs.mkdir(parents=True)
    for name in ("a.jpg", "b.jpg"):
        (thumbs / name).write_bytes(name.encode("utf-8"))
        url = f"/api/content/media/x/r/profile_images/thumbnail/{name}"
        assert binder._avatar_digest(tmp_path, "r", url) is not None
    assert len(binder._digest_cache) == 1


@pytest.mark.asyncio
async def test_unreadable_icon_file_logs_the_minute_rule_fallback(svc, monkeypatch):
    # listed files exist (the profile-image service drops missing ones), but a
    # read can still fail, e.g. an antivirus lock on Windows
    real = type(svc).read_bytes

    def locked(self):
        if self.name == "a.jpg":
            raise PermissionError("locked")
        return real(self)

    monkeypatch.setattr(type(svc), "read_bytes", locked)
    s = await matsuda(svc)
    with capture_logs() as logs:
        await binder.person_avatar_changes(svc, s)
    skip = next(e for e in logs if e.get("reason") == "avatar_hash_missing")
    assert skip["event"] == "memories_skip" and skip["view"] == "binder"
    assert skip["count"] == 1 and skip["person"] == "64"
    assert set(skip) == {"event", "log_level", "view", "reason", "count", "person"}


@pytest.mark.asyncio
async def test_readable_icons_log_no_hash_fallback(svc):
    s = await matsuda(svc)
    with capture_logs() as logs:
        await binder.person_avatar_changes(svc, s)
    assert not [e for e in logs if e.get("reason") == "avatar_hash_missing"]


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
async def test_cache_refreshes_when_the_rules_version_changes(svc, monkeypatch):
    s = await matsuda(svc)
    await binder.build_binder(SERVICE, svc, s, now=NOW)
    monkeypatch.setattr(c, "CARDS_VERSION", c.CARDS_VERSION + 1)
    with capture_logs() as logs:
        await binder.build_binder(SERVICE, svc, s, now=NOW)
    assert [e["outcome"] for e in logs if e["event"] == "memories_view_cache"] == [
        "miss"
    ]


@pytest.mark.asyncio
async def test_payload_is_built_off_the_event_loop(svc, monkeypatch):
    s = await matsuda(svc)
    loop_thread = threading.get_ident()
    threads = []
    real = binder._payload

    def spy(*args):
        threads.append(threading.get_ident())
        return real(*args)

    monkeypatch.setattr(binder, "_payload", spy)
    await binder.build_binder(SERVICE, svc, s, now=NOW)
    assert threads and threads[0] != loop_thread


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
    assert isinstance(anniv["score"], int)  # the nearest face's importance
    assert all(isinstance(e["message_id"], int) for e in selects)
    assert all("score" in e and e["person"] == "64" for e in selects)
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
async def test_bad_subscription_start_logs_once_per_person_per_jst_day(svc):
    import time_machine

    matsu = dataclasses.replace(await matsuda(svc), subscription_start="not-a-date")
    other = dataclasses.replace(matsu, member_dirs=("messages/x/1 other",))

    def bad(logs):
        return [e for e in logs if e.get("reason") == "bad_subscription_start"]

    # 2026-11-10 23:59 JST, then 2026-11-11 00:00 JST
    late = datetime(2026, 11, 10, 14, 59, tzinfo=timezone.utc)
    with capture_logs() as logs, time_machine.travel(late, tick=False) as t:
        binder.subscription_start(matsu)
        binder.subscription_start(matsu)
        # her data changes the same day: the card evaluation does not re-log
        await binder.evaluate_person(SERVICE, svc, matsu, now=NOW)
        assert len(bad(logs)) == 1
        binder.subscription_start(other)  # another person logs her own
        assert len(bad(logs)) == 2
        t.move_to(datetime(2026, 11, 10, 15, 0, tzinfo=timezone.utc))
        binder.subscription_start(matsu)  # a new JST day
        assert len(bad(logs)) == 3
    assert (
        binder.subscription_start(dataclasses.replace(matsu, subscription_start=None))
        is None
    )


@pytest.mark.asyncio
async def test_unparsable_subscription_start_hides_the_anniversary_shelf(svc):
    s = dataclasses.replace(await matsuda(svc), subscription_start="not-a-date")
    with capture_logs() as logs:
        cards = await binder.evaluate_person(SERVICE, svc, s, now=NOW)
    skip = next(e for e in logs if e["event"] == "memories_skip")
    assert skip["reason"] == "bad_subscription_start" and skip["person"] == "64"
    assert not [card for card in cards if card.shelf == "anniversary"]
    assert "special.sub_anniversary" not in c.earned_keys(cards)


def test_log_covers_older_year_fallbacks_and_faceless_cards():
    s = mi.MemberSummary("x", "x", (OLD_ROOM,), ("64",), ("40",), None, None, False)
    inp = inputs(
        [fact(1, "2024-05-01 10:00"), fact(2, "2025-05-01 00:05")], birthday="05-01"
    )
    cards = c.evaluate(inp)
    with capture_logs() as logs:
        binder._log(s, cards, 0, inp)
    year = next(e for e in logs if e.get("year") == 2024)
    assert year["event"] == "memories_select" and year["rule"] == "special.birthday"
    assert year["fallback"] == "best_of_day" and year["message_id"] == 1
    assert year["score"] == 10
    # an earned anniversary with no non-promo fact at all has no face
    inp = inputs([], subscription_start=date(2024, 1, 1))
    with capture_logs() as logs:
        binder._log(s, c.evaluate(inp), 0, inp)
    skips = {e["rule"] for e in logs if e["event"] == "memories_skip"}
    assert {"anniv.d100", "anniv.y1"} <= skips
    assert all(e["reason"] == "no_face" for e in logs if e["event"] == "memories_skip")


def test_score_prefers_importance_then_photo_score():
    assert binder._score(None) is None
    pic = dataclasses.replace(fact(1, "2024-01-01 10:00", "picture"), photo_score=7)
    assert binder._score(pic) == 7
    assert binder._score(fact(2, "2024-01-01 10:00", importance=3)) == 3


def test_payload_logs_unresolvable_faces(tmp_path):
    card = c.Card("first.message", "first", True, message=c.MessageKey("r", 99))
    with capture_logs() as logs:
        payload = binder._payload(
            SERVICE, tmp_path, [card], inputs(), people.AvatarTimeline((), None)
        )
    assert payload["shelves"][0]["cards"][0]["face"] is None
    skip = next(e for e in logs if e["event"] == "memories_skip")
    assert skip == {
        "event": "memories_skip",
        "log_level": "info",
        "view": "binder",
        "reason": "face_missing",
        "count": 1,
    }


def test_avatar_digest_memo_is_used_under_its_lock(tmp_path, monkeypatch):
    # icon_entries runs in worker threads: every memo access must hold the lock
    class Guarded(type(binder._digest_cache)):
        def get(self, key, default=None):
            assert binder._digest_lock.locked()
            return super().get(key, default)

        def __setitem__(self, key, value):
            assert binder._digest_lock.locked()
            super().__setitem__(key, value)

    monkeypatch.setattr(binder, "_digest_cache", Guarded())
    thumbs = tmp_path / "r" / "profile_images" / "thumbnail"
    thumbs.mkdir(parents=True)
    (thumbs / "a.jpg").write_bytes(b"icon")
    url = "/api/content/media/x/r/profile_images/thumbnail/a.jpg"
    first = binder._avatar_digest(tmp_path, "r", url)
    assert first is not None
    assert binder._avatar_digest(tmp_path, "r", url) == first


@pytest.mark.asyncio
async def test_binder_payload_is_the_cached_text_free_binder(svc):
    s = (await mi.list_members(svc))[0]
    with capture_logs() as logs:
        bare = await binder.binder_payload(SERVICE, svc, s, now=NOW)
        full = await binder.build_binder(SERVICE, svc, s, now=NOW)
    assert not vc.contains_text(bare)
    assert bare["progress"] == full["progress"]
    outcomes = [
        e["outcome"]
        for e in logs
        if e["event"] == "memories_view_cache" and e["view"] == "binder"
    ]
    assert outcomes == ["miss", "hit"]  # one cache serves both


@pytest.mark.asyncio
async def test_postcard_photo_of_a_special_day_carries_its_caption(tmp_path):
    """A3: each stacked year and 加入紀念日 carry that day's best photo (CJK caption)."""
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    pic = "messages\\40 松田 好花\\64 松田 好花\\picture\\{}.jpg"
    write_room(
        sdir,
        "40 松田 好花",
        "64 松田 好花",
        [
            msg(1, "2024-07-24T03:00:00Z", content=FIRST),
            msg(2, "2024-07-24T03:01:00Z", "picture", media_file=pic.format(2)),
            msg(3, "2024-12-24T11:00:00Z", content=XMAS),
            msg(4, "2024-12-24T11:01:00Z", "picture", media_file=pic.format(4)),
            msg(5, "2024-12-24T11:02:00Z", content="楽屋のおやつ🍪"),
            msg(6, "2025-12-25T03:00:00Z", "picture", media_file=pic.format(6)),
        ],
    )
    write_side_inputs(sdir, sub_starts={"40": "2024-07-24"})
    (s,) = await mi.list_members(sdir)
    k = cards_of(await binder.build_binder(SERVICE, sdir, s, now=NOW))
    xmas = k["special.christmas"]
    y2024, y2025 = xmas["years"]
    assert y2024["face"]["id"] == 3 and y2024["photo"]["id"] == 4
    assert y2024["photo"]["type"] == "picture" and y2024["photo"]["caption"]
    # 2025: the face is the picture itself, so there is no separate photo
    assert y2025["face"]["id"] == 6 and y2025["photo"] is None
    join = k["special.join_day"]
    assert join["face"]["id"] == 1 and join["refs"]["photo"]["id"] == 2


def test_avatar_digest_never_reads_outside_the_icon_folder(tmp_path):
    """An icon URL from the archive cannot point the hash at another file."""
    from backend.services import profile_images_service
    from backend.services.memories.binder import _avatar_digest

    sdir = tmp_path / "日向坂46"
    icons = sdir / "room" / profile_images_service.DIR_NAME
    icons.mkdir(parents=True)
    (icons / "a.jpg").write_bytes(b"icon")
    (tmp_path / "secret.png").write_bytes(b"secret")
    marker = f"/{profile_images_service.DIR_NAME}/"
    assert _avatar_digest(sdir, "room", f"x{marker}a.jpg") is not None
    for rel in ("../../../secret.png", "..%2F..%2F..%2Fsecret.png", "C:/secret.png"):
        assert _avatar_digest(sdir, "room", f"x{marker}{rel}") is None
    assert _avatar_digest(sdir, "../..", f"x{marker}secret.png") is None
