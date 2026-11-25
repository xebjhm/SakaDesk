"""Shared Memories helpers (``backend/services/memories/people.py``)."""

from __future__ import annotations

import json
from datetime import date, datetime, timezone

import pytest
from structlog.testing import capture_logs

from backend.services.archive_urls import ArchiveReadError
from backend.services.memories import facts as mf
from backend.services.memories import index as mi
from backend.services.memories import oshi as oshi_mod
from backend.services.memories import people
from backend.tests.memories_archive import msg, write_room

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
OLD_ROOM = "messages/40 松田 好花/64 松田 好花"
NEW_ROOM = "messages/94 松田 好花/64 松田 好花"
KANE_ROOM = "messages/34 金村 美玖/58 金村 美玖"

SECRET = "秘密のことば"
CAPTION = "今日の景色、見せたかったんだ"


def utc(y, mo, d, h=12, mi_=0):
    return datetime(y, mo, d, h, mi_, tzinfo=timezone.utc)


@pytest.fixture
def svc(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    write_room(
        sdir,
        "40 松田 好花",
        "64 松田 好花",
        [
            msg(1, "2025-11-10T03:00:00Z", content=SECRET),
            msg(2, "2025-11-10T03:01:00Z", content=CAPTION),
            msg(
                3,
                "2025-11-10T03:02:00Z",
                "picture",
                media_file="messages\\40 松田 好花\\64 松田 好花\\picture\\3.jpg",
            ),
        ],
    )
    write_room(
        sdir,
        "94 松田 好花",
        "64 松田 好花",
        [
            msg(1, "2026-11-10T03:00:00Z", content="新しい部屋"),
            msg(2, "2026-11-11T03:00:00Z", content="翌日"),
        ],
    )
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [msg(7, "2024-11-10T05:00:00Z", content="金村の今日")],
    )
    return sdir


async def matsuda(sdir):
    summaries = await mi.list_members(sdir)
    return next(s for s in summaries if len(s.member_dirs) == 2)


# --- service / paths ---------------------------------------------------------


def test_service_data_dir_and_unknown_service(tmp_path, monkeypatch):
    monkeypatch.setattr(people.path_resolver, "get_output_dir", lambda: tmp_path)
    assert people.output_dir() == tmp_path
    assert people.service_data_dir(SERVICE) == tmp_path / SVC_NAME
    assert people.service_data_dir(SERVICE, tmp_path / "x") == tmp_path / "x" / SVC_NAME
    with pytest.raises(ValueError):
        people.service_data_dir("nope")


@pytest.mark.asyncio
async def test_person_key_and_chat_path(svc):
    s = await matsuda(svc)
    assert people.person_key(s) == f"{OLD_ROOM}|{NEW_ROOM}"
    assert people.chat_path(svc, OLD_ROOM) == f"{SVC_NAME}/{OLD_ROOM}"


# --- resolve_person ------------------------------------------------------------


@pytest.mark.asyncio
async def test_any_room_of_a_person_resolves_to_the_same_summary(svc):
    s = await matsuda(svc)
    with capture_logs() as logs:
        a = await people.resolve_person(svc, f"{SVC_NAME}/{OLD_ROOM}")
        b = await people.resolve_person(svc, f"{SVC_NAME}/{NEW_ROOM}")
    assert a == b == s
    evs = [e for e in logs if e["event"] == "memories_person_resolved"]
    assert [(e["found"], e["rooms"]) for e in evs] == [(True, 2), (True, 2)]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path", ["../../etc/passwd", f"{SVC_NAME}/../../x", f"{SVC_NAME}/../../../etc"]
)
async def test_escaping_path_raises(svc, path):
    with pytest.raises(ArchiveReadError):
        await people.resolve_person(svc, path)


@pytest.mark.asyncio
async def test_path_in_another_service_raises(svc):
    (svc.parent / "櫻坂46" / "messages" / "1 x" / "2 x").mkdir(parents=True)
    with pytest.raises(people.ForeignServiceError):
        await people.resolve_person(svc, "櫻坂46/messages/1 x/2 x")
    assert issubclass(people.ForeignServiceError, ArchiveReadError)


@pytest.mark.asyncio
async def test_unknown_room_is_none(svc):
    with capture_logs() as logs:
        got = await people.resolve_person(svc, f"{SVC_NAME}/messages/99 誰か/1 誰か")
    assert got is None
    (ev,) = [e for e in logs if e["event"] == "memories_person_resolved"]
    assert ev["found"] is False and ev["rooms"] == 0


# --- oshi / ordering -------------------------------------------------------------


@pytest.mark.asyncio
async def test_oshi_rooms_and_sort_people(svc, monkeypatch):
    summaries = await mi.list_members(svc)

    async def fake(service):
        return {"金村美玖", "誰か"}

    monkeypatch.setattr(oshi_mod, "oshi_names", fake)
    oshi = await people.oshi_rooms(SERVICE, summaries)
    assert oshi == {"金村美玖"}
    order = people.sort_people(summaries, oshi)
    assert order[0].name_norm == "金村美玖"
    assert order[1:] == [s for s in summaries if s.name_norm != "金村美玖"]
    assert people.sort_people(summaries, set()) == summaries


# --- AvatarTimeline -----------------------------------------------------------------

T1 = utc(2024, 8, 1)
T2 = utc(2026, 6, 1)
TL = people.AvatarTimeline(entries=((T1, "/a"), (T2, "/b")), current="/b")


@pytest.mark.parametrize(
    "when, expected",
    [
        (utc(2023, 1, 1), "/a"),  # before the first: archiving began later
        (T1, "/a"),
        (utc(2025, 1, 1), "/a"),  # between
        (utc(2027, 1, 1), "/b"),  # after the last
    ],
)
def test_avatar_timeline_at(when, expected):
    assert TL.at(when) == expected


def test_avatar_timeline_without_entries_returns_current():
    assert people.AvatarTimeline(entries=(), current="/c").at(T1) == "/c"
    assert people.AvatarTimeline(entries=(), current=None).at(T1) is None


def test_avatar_timeline_undated_entry_is_the_oldest():
    tl = people.AvatarTimeline(entries=((None, "/u"), (T2, "/b")), current="/b")
    assert tl.at(T1) == "/u" and tl.at(utc(2027, 1, 1)) == "/b"


AVATARS = [
    {
        "kind": "thumbnail",
        "file": "thumbnail/b.jpg",
        "first_seen": "2026-06-01T03:00:00Z",
    },
    {
        "kind": "thumbnail",
        "file": "thumbnail/a.jpg",
        "first_seen": "2024-08-01T00:00:00Z",
    },
    {
        "kind": "phone_image",
        "file": "phone_image/p.jpg",
        "first_seen": "2026-07-01T00:00:00Z",
    },
]


@pytest.mark.asyncio
async def test_avatar_timeline_of_a_room(svc):
    write_room(svc, "34 金村 美玖", "58 金村 美玖", [], avatars=AVATARS)
    tl = people.avatar_timeline(svc, KANE_ROOM)
    assert [t for t, _ in tl.entries] == [
        datetime(2024, 8, 1, tzinfo=timezone.utc),
        datetime(2026, 6, 1, 3, tzinfo=timezone.utc),
    ]
    assert tl.entries[0][1].endswith("/profile_images/thumbnail/a.jpg")
    assert tl.current == tl.entries[1][1]
    assert tl.entries[0][1].startswith("/api/content/media/hinatazaka46/messages/")
    assert people.avatar_timeline(svc, OLD_ROOM) == people.AvatarTimeline((), None)


@pytest.mark.asyncio
async def test_avatar_timelines_merge_rooms_and_cache(svc, monkeypatch):
    write_room(
        svc,
        "40 松田 好花",
        "64 松田 好花",
        [msg(1, "2025-11-10T03:00:00Z", content=SECRET)],
        avatars=[AVATARS[1]],
    )
    write_room(svc, "94 松田 好花", "64 松田 好花", [], avatars=[AVATARS[0]])
    s = await matsuda(svc)
    calls = []
    real = people.avatar_timeline

    def counting(sdir, room):
        calls.append(room)
        return real(sdir, room)

    monkeypatch.setattr(people, "avatar_timeline", counting)
    tl = await people.avatar_timelines(svc, s)
    assert len(tl.entries) == 2 and "/94%20" in tl.current
    assert "/40%20" in tl.at(utc(2025, 1, 1))
    assert await people.avatar_timelines(svc, s) == tl
    assert len(calls) == 2  # second call was a cache hit


# --- media / message objects ----------------------------------------------------------


@pytest.mark.asyncio
async def test_message_ref_normalises_media_and_has_no_absolute_path(svc):
    (fact,) = [f for f in await mf.get_facts(svc, svc / OLD_ROOM) if f.id == 3]
    tl = people.AvatarTimeline(entries=((T1, "/a"),), current="/a")
    ref = people.message_ref(SERVICE, svc, OLD_ROOM, fact, avatar=tl)
    assert ref["media_file"] == f"{OLD_ROOM}/picture/3.jpg"
    assert ref["media_url"] == people.media_url_for(SERVICE, fact)
    assert ref["media_url"].startswith("/api/content/media/hinatazaka46/messages/")
    assert "\\" not in ref["media_url"] and "%5C" not in ref["media_url"]
    assert ref["member_path"] == f"{SVC_NAME}/{OLD_ROOM}"
    assert ref["room"] == OLD_ROOM and ref["service"] == SERVICE
    assert ref["ts"] == "2025-11-10T03:02:00Z" and ref["type"] == "picture"
    assert ref["text"] is None and ref["caption"] is None
    assert ref["caption_id"] == 2  # the paired text
    assert ref["avatar_url"] == "/a" and ref["favorited"] is False
    assert ref["duration_s"] is None
    assert str(svc.parent.parent) not in json.dumps(ref, ensure_ascii=False)
    plain = people.message_ref(SERVICE, svc, OLD_ROOM, fact)
    assert plain["avatar_url"] is None


def test_media_helpers_without_media():
    assert people.media_url_of(SERVICE, None) is None
    assert people.media_url_of(SERVICE, "") is None
    assert people.media_url_of(SERVICE, "\\\\") is None
    assert people.media_url_of(SERVICE, "a\\b c.jpg") == (
        "/api/content/media/hinatazaka46/a/b%20c.jpg"
    )


@pytest.mark.asyncio
async def test_media_file_for(svc):
    facts = {f.id: f for f in await mf.get_facts(svc, svc / OLD_ROOM)}
    assert people.media_file_for(facts[3]) == f"{OLD_ROOM}/picture/3.jpg"
    assert people.media_file_for(facts[1]) is None


# --- attach_texts ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_attach_texts_one_load_per_room_and_caption(svc, monkeypatch):
    s = await matsuda(svc)
    tagged = await mf.get_person_facts(svc, s)
    refs = [people.message_ref(SERVICE, svc, room, f) for room, f in tagged]
    calls = []
    real = mf.load_texts

    def counting(sdir, mdir, ids=None):
        calls.append((mdir, set(ids)))
        return real(sdir, mdir, ids)

    monkeypatch.setattr(people, "load_texts", counting)
    with capture_logs() as logs:
        await people.attach_texts(svc, refs)
    assert len(calls) == 2
    assert {c[0] for c in calls} == {svc / OLD_ROOM, svc / NEW_ROOM}
    assert dict(calls)[svc / OLD_ROOM] == {1, 2, 3}
    by = {(r["room"], r["id"]): r for r in refs}
    assert by[(OLD_ROOM, 1)]["text"] == SECRET
    assert by[(OLD_ROOM, 3)]["text"] is None  # media without own text
    assert by[(OLD_ROOM, 3)]["caption"] == CAPTION
    assert by[(OLD_ROOM, 1)]["caption"] is None
    assert by[(NEW_ROOM, 1)]["text"] == "新しい部屋"
    assert not [e for e in logs if e["event"] == "memories_skip"]


@pytest.mark.asyncio
async def test_attach_texts_missing_id_logs_text_missing(svc):
    (fact,) = [f for f in await mf.get_facts(svc, svc / OLD_ROOM) if f.id == 1]
    ref = people.message_ref(SERVICE, svc, OLD_ROOM, fact)
    gone = {**ref, "id": 999}
    with capture_logs() as logs:
        await people.attach_texts(svc, [ref, gone])
    assert ref["text"] == SECRET and gone["text"] is None
    (ev,) = [e for e in logs if e["event"] == "memories_skip"]
    assert ev["view"] == "attach_texts" and ev["reason"] == "text_missing"
    assert ev["count"] == 1


@pytest.mark.asyncio
async def test_attach_texts_with_no_refs_reads_nothing(svc, monkeypatch):
    monkeypatch.setattr(people, "load_texts", lambda *a: pytest.fail("read"))
    await people.attach_texts(svc, [])


def _counting_loads(monkeypatch):
    calls = []
    real = mf.load_texts

    def counting(sdir, mdir, ids=None):
        calls.append(mdir)
        return real(sdir, mdir, ids)

    monkeypatch.setattr(people, "load_texts", counting)
    return calls


async def _matsuda_refs(svc):
    s = await matsuda(svc)
    tagged = await mf.get_person_facts(svc, s)
    return [people.message_ref(SERVICE, svc, room, f) for room, f in tagged]


@pytest.mark.asyncio
async def test_attach_texts_memo_serves_unchanged_rooms_without_reading(
    svc, monkeypatch
):
    calls = _counting_loads(monkeypatch)
    first = await _matsuda_refs(svc)
    await people.attach_texts(svc, first)
    assert len(calls) == 2
    again = await _matsuda_refs(svc)
    with capture_logs() as logs:
        await people.attach_texts(svc, again)
    assert len(calls) == 2  # both rooms unchanged: no file read
    assert [(r["text"], r["caption"]) for r in again] == [
        (r["text"], r["caption"]) for r in first
    ]
    (ev,) = [e for e in logs if e["event"] == "memories_text_memo"]
    assert (ev["rooms"], ev["hit"], ev["loaded"], ev["unstable"]) == (2, 2, 0, 0)


@pytest.mark.asyncio
async def test_attach_texts_memo_sees_a_sync_at_once(svc, monkeypatch):
    await people.attach_texts(svc, await _matsuda_refs(svc))
    calls = _counting_loads(monkeypatch)
    # a sync rewrites one room (new words for message 1, one message more)
    write_room(
        svc,
        "94 松田 好花",
        "64 松田 好花",
        [
            msg(1, "2026-11-10T03:00:00Z", content="書き直した言葉"),
            msg(2, "2026-11-11T03:00:00Z", content="翌日"),
            msg(3, "2026-11-12T03:00:00Z", content="もう一つ"),
        ],
    )
    refs = await _matsuda_refs(svc)
    await people.attach_texts(svc, refs)
    assert calls == [svc / NEW_ROOM]  # only the changed room is read again
    by = {(r["room"], r["id"]): r["text"] for r in refs}
    assert by[(NEW_ROOM, 1)] == "書き直した言葉"
    assert by[(NEW_ROOM, 3)] == "もう一つ"
    assert by[(OLD_ROOM, 1)] == SECRET


@pytest.mark.asyncio
async def test_attach_texts_memo_reads_again_for_ids_it_lacks(svc, monkeypatch):
    refs = await _matsuda_refs(svc)
    await people.attach_texts(svc, [r for r in refs if r["id"] == 1])
    calls = _counting_loads(monkeypatch)
    await people.attach_texts(svc, refs)
    assert sorted(calls) == sorted([svc / OLD_ROOM, svc / NEW_ROOM])
    assert {r["text"] for r in refs if r["room"] == NEW_ROOM} == {"新しい部屋", "翌日"}


@pytest.mark.asyncio
async def test_attach_texts_memo_never_keeps_a_failed_or_missing_read(svc, monkeypatch):
    (fact,) = [f for f in await mf.get_facts(svc, svc / OLD_ROOM) if f.id == 1]
    ref = people.message_ref(SERVICE, svc, OLD_ROOM, fact)
    monkeypatch.setattr(people, "load_texts", lambda *a: {})  # unreadable just now
    await people.attach_texts(svc, [ref])
    assert ref["text"] is None
    calls = _counting_loads(monkeypatch)
    ref2 = {**ref}
    await people.attach_texts(svc, [ref2, {**ref, "id": 999}])
    assert ref2["text"] == SECRET  # read again, not served from a failed read
    calls.clear()
    gone = {**ref, "id": 999}
    await people.attach_texts(svc, [gone])
    assert calls == [svc / OLD_ROOM] and gone["text"] is None  # missing: no memo


@pytest.mark.asyncio
async def test_attach_texts_memo_skips_a_file_that_changed_during_the_read(
    svc, monkeypatch
):
    real = mf.load_texts
    target = svc / OLD_ROOM / "messages.json"

    def racing(sdir, mdir, ids=None):
        out = real(sdir, mdir, ids)
        if mdir == svc / OLD_ROOM:  # a sync rewrites it right after the read
            target.write_text(target.read_text(encoding="utf-8") + " ", "utf-8")
        return out

    monkeypatch.setattr(people, "load_texts", racing)
    with capture_logs() as logs:
        await people.attach_texts(svc, await _matsuda_refs(svc))
    (ev,) = [e for e in logs if e["event"] == "memories_text_memo"]
    assert (ev["loaded"], ev["unstable"]) == (2, 1)
    calls = _counting_loads(monkeypatch)
    await people.attach_texts(svc, await _matsuda_refs(svc))
    assert calls == [svc / OLD_ROOM]  # never served from the racing read


@pytest.mark.asyncio
async def test_attach_texts_memo_unstatable_room_is_read_not_kept(svc, monkeypatch):
    real_stamp = people._stamp
    monkeypatch.setattr(
        people,
        "_stamp",
        lambda path: None if "40 松田" in str(path) else real_stamp(path),
    )
    refs = await _matsuda_refs(svc)
    with capture_logs() as logs:
        await people.attach_texts(svc, refs)
    assert {r["text"] for r in refs if r["room"] == OLD_ROOM} >= {SECRET}
    (ev,) = [e for e in logs if e["event"] == "memories_text_memo"]
    assert (ev["hit"], ev["loaded"], ev["unstable"]) == (0, 2, 1)


@pytest.mark.asyncio
async def test_attach_texts_memo_is_bounded(svc, monkeypatch):
    monkeypatch.setattr(people, "TEXT_MEMO_MAX", 2)
    await people.attach_texts(svc, await _matsuda_refs(svc))  # 3 + 2 texts
    assert people._text_memo_size() <= 2
    calls = _counting_loads(monkeypatch)
    await people.attach_texts(svc, await _matsuda_refs(svc))
    assert calls  # the evicted room is read again


# --- date facts / hashes / letters --------------------------------------------------------


@pytest.mark.asyncio
async def test_service_facts_on_month_day_and_day(svc):
    summaries = await mi.list_members(svc)
    got = await people.service_facts_on(svc, summaries, month_day="11-10")
    assert [(room, f.id) for _, room, f in got] == [
        (KANE_ROOM, 7),
        (OLD_ROOM, 1),
        (OLD_ROOM, 2),
        (OLD_ROOM, 3),
        (NEW_ROOM, 1),
    ]
    assert all(room in s.member_dirs for s, room, _ in got)
    day = await people.service_facts_on(svc, summaries, day=date(2026, 11, 11))
    assert [(room, f.id) for _, room, f in day] == [(NEW_ROOM, 2)]


@pytest.mark.asyncio
async def test_room_hashes_change_with_the_data(svc):
    s = await matsuda(svc)
    h1 = await people.room_hashes(svc, s)
    assert len(h1) == 16 and h1 == await people.room_hashes(svc, s)
    write_room(svc, "94 松田 好花", "64 松田 好花", [msg(1, "2026-12-01T03:00:00Z")])
    assert await people.room_hashes(svc, s) != h1


@pytest.mark.asyncio
async def test_person_hashes_match_room_hashes_with_one_check(svc, monkeypatch):
    summaries = await mi.list_members(svc)
    expected = [await people.room_hashes(svc, s) for s in summaries]
    calls: list[int] = []
    real = mi.data_hashes

    async def counting(sdir, dirs):
        calls.append(len(dirs))
        return await real(sdir, dirs)

    monkeypatch.setattr(mi, "data_hashes", counting)
    assert await people.person_hashes(svc, summaries) == expected
    persons, scope, hashes = await people.album_scope(svc, None)
    assert scope == "all" and hashes == expected
    rooms = sum(len(s.member_dirs) for s in summaries)
    assert calls == [rooms, rooms]  # one check per call, not one per room


LETTERS = [
    {"id": 5, "text": "ありがとう", "created_at": "2026-01-01T15:30:00Z"},  # 01-02 JST
    {"id": 4, "text": "はじめまして", "created_at": "2025-03-01T00:00:00Z"},
    {"id": "x", "text": "bad id", "created_at": "2025-03-01T00:00:00Z"},
]


@pytest.mark.asyncio
async def test_letters_of_oldest_first_across_rooms(svc):
    write_room(
        svc,
        "40 松田 好花",
        "64 松田 好花",
        [msg(1, "2025-11-10T03:00:00Z")],
        letters=LETTERS,
    )
    write_room(
        svc,
        "94 松田 好花",
        "64 松田 好花",
        [msg(1, "2026-11-10T03:00:00Z")],
        letters=[{"id": 9, "text": "新", "created_at": "2025-06-01T00:00:00Z"}],
    )
    s = await matsuda(svc)
    with capture_logs() as logs:
        got = await people.letters_of(SERVICE, svc, s)
    assert got == [
        (OLD_ROOM, 4, date(2025, 3, 1)),
        (NEW_ROOM, 9, date(2025, 6, 1)),
        (OLD_ROOM, 5, date(2026, 1, 2)),
    ]
    assert not [e for e in logs if e["event"] == "memories_skip"]


@pytest.mark.asyncio
async def test_letters_of_missing_empty_and_invalid(svc):
    s = await matsuda(svc)
    assert await people.letters_of(SERVICE, svc, s) == []  # missing
    (svc / OLD_ROOM / "letters.json").write_text('{"letters": []}', encoding="utf-8")
    assert await people.letters_of(SERVICE, svc, s) == []  # empty
    (svc / OLD_ROOM / "letters.json").write_text("{bad", encoding="utf-8")
    with capture_logs() as logs:
        assert await people.letters_of(SERVICE, svc, s) == []
    (ev,) = [e for e in logs if e["event"] == "memories_skip"]
    assert ev["view"] == "letters" and ev["reason"] == "invalid"


# --- log hygiene ----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_logs_carry_no_text_rooms_or_names(svc):
    s = await matsuda(svc)
    with capture_logs() as logs:
        await people.resolve_person(svc, f"{SVC_NAME}/{OLD_ROOM}")
        await people.resolve_person(svc, f"{SVC_NAME}/messages/99 誰か/1 誰か")
        tagged = await mf.get_person_facts(svc, s)
        refs = [people.message_ref(SERVICE, svc, r, f) for r, f in tagged]
        refs.append({**refs[0], "id": 999})
        await people.attach_texts(svc, refs)
        await people.letters_of(SERVICE, svc, s)
        await people.avatar_timelines(svc, s)
        await people.service_facts_on(svc, [s], month_day="11-10")
    blob = json.dumps([dict(e) for e in logs], ensure_ascii=False, default=str)
    for needle in (SECRET, CAPTION, "松田", "好花", "金村", "messages/", str(svc)):
        assert needle not in blob


@pytest.mark.asyncio
async def test_service_facts_on_needs_exactly_one_argument(svc):
    with pytest.raises(ValueError):
        await people.service_facts_on(svc, [], day=date(2026, 1, 1), month_day="01-01")


@pytest.mark.asyncio
async def test_avatar_cache_keeps_the_most_recent(svc, monkeypatch):
    from collections import OrderedDict

    monkeypatch.setattr(people, "_avatar_cache", OrderedDict())
    monkeypatch.setattr(people, "_AVATAR_CACHE_MAX", 1)
    summaries = await mi.list_members(svc)
    for s in summaries:
        await people.avatar_timelines(svc, s)
    assert len(people._avatar_cache) == 1
    (key,) = people._avatar_cache
    assert key[1] == people.person_key(summaries[-1])


def test_current_avatars(svc):
    write_room(svc, "34 金村 美玖", "58 金村 美玖", [], avatars=AVATARS)
    got = people.current_avatars(svc, [KANE_ROOM, OLD_ROOM])
    assert got[KANE_ROOM].endswith("/profile_images/thumbnail/b.jpg")
    assert got[OLD_ROOM] is None


# --- bounded concurrency ----------------------------------------------------------------


def _tracking(real, parties):
    """Wrap a blocking reader: the first ``parties`` calls meet at a barrier.

    Sequential calls never fill the barrier (``BrokenBarrierError`` after the
    timeout); ``peak`` records the most calls in flight at once.
    """
    import threading

    barrier = threading.Barrier(parties, timeout=5)
    lock = threading.Lock()
    state = {"n": 0, "inflight": 0, "peak": 0}

    def wrapped(*args, **kwargs):
        with lock:
            index = state["n"]
            state["n"] += 1
            state["inflight"] += 1
            state["peak"] = max(state["peak"], state["inflight"])
        try:
            if index < parties:
                barrier.wait()
            return real(*args, **kwargs)
        finally:
            with lock:
                state["inflight"] -= 1

    return wrapped, state


@pytest.mark.asyncio
async def test_attach_texts_reads_rooms_concurrently_at_most_four(
    tmp_path, monkeypatch
):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    rooms = []
    for k in range(6):
        write_room(
            sdir,
            f"{10 + k} 人{k}",
            f"{20 + k} 人{k}",
            [msg(1, "2025-11-10T03:00:00Z", content=f"言葉{k}")],
        )
        rooms.append(f"messages/{10 + k} 人{k}/{20 + k} 人{k}")
    refs = []
    for room in rooms:
        (fact,) = await mf.get_facts(sdir, sdir / room)
        refs.append(people.message_ref(SERVICE, sdir, room, fact))
    wrapped, state = _tracking(people.load_texts, people.IO_CONCURRENCY)
    monkeypatch.setattr(people, "load_texts", wrapped)
    await people.attach_texts(sdir, refs)
    assert [r["text"] for r in refs] == [f"言葉{k}" for k in range(6)]
    assert state["n"] == 6
    assert state["peak"] == people.IO_CONCURRENCY == 4


@pytest.mark.asyncio
async def test_avatar_timelines_for_loads_people_concurrently(svc, monkeypatch):
    summaries = await mi.list_members(svc)
    persons = {people.person_key(s): s for s in summaries}
    people._avatar_cache.clear()
    # each person's rooms are read in one worker: two people meet at the barrier
    wrapped, state = _tracking(people._merge_timelines, 2)
    monkeypatch.setattr(people, "_merge_timelines", wrapped)
    got = await people.avatar_timelines_for(svc, persons)
    assert list(got) == list(persons)
    assert all(isinstance(t, people.AvatarTimeline) for t in got.values())
    assert state["peak"] == 2
