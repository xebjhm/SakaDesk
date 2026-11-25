"""被叫名字的瞬間 (``backend/services/memories/nickname_moments.py``)."""

from __future__ import annotations

import threading

import pytest
from structlog.testing import capture_logs

from backend.services.memories import index as mi
from backend.services.memories import nickname_moments as nm
from backend.services.memories import people
from backend.services.memories import view_cache as vc
from backend.tests.memories_archive import msg, write_room

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
ROOM = "messages/34 金村 美玖/58 金村 美玖"
PROMO = "%%%へお知らせ！写真集の予約が始まったよ https://example.jp"
NAMES = ("金村", "美玖", "%%%", "％％％")

ICONS = [
    {
        "kind": "thumbnail",
        "file": "thumbnail/a.jpg",
        "first_seen": "2025-01-01T00:00:00Z",
    },
    {
        "kind": "thumbnail",
        "file": "thumbnail/b.jpg",
        "first_seen": "2026-01-01T00:00:00Z",
    },
]


@pytest.fixture
def svc(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [
            msg(1, "2025-03-01T03:00:00Z", content="今日は晴れ"),
            msg(
                2,
                "2025-03-02T03:00:00Z",
                content="%%%ちゃん、おはよう！今日も頑張ろうね。%%%大好き💕\nまたね",
            ),
            msg(3, "2025-08-01T03:00:00Z", content=PROMO),
            msg(4, "2026-01-05T03:00:00Z", content="％％％、あけおめ🎍ことよろ！"),
            msg(
                5,
                "2026-02-01T03:00:00Z",
                "picture",
                media_file="messages/34 金村 美玖/58 金村 美玖/picture/5.jpg",
            ),
        ],
        avatars=ICONS,
    )
    return sdir


async def kanemura(sdir):
    return (await mi.list_members(sdir))[0]


def sentences(payload):
    return [(i["message"]["id"], i["sentence"]) for i in payload["items"]]


@pytest.mark.asyncio
async def test_every_nickname_sentence_is_an_item_newest_first(svc):
    s = await kanemura(svc)
    payload = await nm.nickname_moments(SERVICE, svc, s, year=None)
    assert payload["years"] == [2026, 2025]
    assert sentences(payload) == [
        (4, "％％％、あけおめ🎍ことよろ"),  # full-width token, emoji kept
        (3, "%%%へお知らせ"),  # promo is included, like the chip count
        (2, "%%%ちゃん、おはよう"),
        (2, "%%%大好き💕"),  # two sentences of one message: two items
    ]
    first = payload["items"][0]["message"]
    assert first["member_path"] == f"{SVC_NAME}/{ROOM}"
    assert first["text"] == "％％％、あけおめ🎍ことよろ！"
    assert first["ts"] == "2026-01-05T03:00:00Z"


@pytest.mark.asyncio
async def test_each_row_has_her_avatar_at_the_time(svc):
    s = await kanemura(svc)
    items = (await nm.nickname_moments(SERVICE, svc, s, year=None))["items"]
    avatars = [i["message"]["avatar_url"].rsplit("/", 1)[1] for i in items]
    assert avatars == ["b.jpg", "a.jpg", "a.jpg", "a.jpg"]


@pytest.mark.asyncio
async def test_year_filters_items_but_not_the_year_list(svc):
    s = await kanemura(svc)
    with capture_logs() as logs:
        payload = await nm.nickname_moments(SERVICE, svc, s, year=2025)
    assert payload["years"] == [2026, 2025]
    assert [i for i, _ in sentences(payload)] == [3, 2, 2]
    names = next(e for e in logs if e["event"] == "memories_names")
    assert names == {
        "event": "memories_names",
        "log_level": "info",
        "person": "58",
        "count": 3,
        "year": 2025,
    }
    for e in logs:
        assert not any(n in str(v) for v in e.values() for n in NAMES), e


@pytest.mark.asyncio
async def test_a_year_without_items_is_empty(svc):
    s = await kanemura(svc)
    payload = await nm.nickname_moments(SERVICE, svc, s, year=2024)
    assert payload == {"years": [2026, 2025], "items": []}


@pytest.mark.asyncio
async def test_member_without_nickname_has_nothing(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [msg(1, "2025-01-01T03:00:00Z", content="やっほー")],
    )
    s = await kanemura(sdir)
    assert await nm.nickname_moments(SERVICE, sdir, s, year=None) == {
        "years": [],
        "items": [],
    }


@pytest.mark.asyncio
async def test_texts_load_once_per_room_and_a_missing_text_is_skipped(svc, monkeypatch):
    s = await kanemura(svc)
    calls = []
    real = people.load_texts

    def fake(sdir, mdir, ids):
        calls.append(sorted(ids))
        texts = real(sdir, mdir, ids)
        texts.pop(4)  # message 4 vanished from messages.json
        return texts

    monkeypatch.setattr(people, "load_texts", fake)
    with capture_logs() as logs:
        payload = await nm.nickname_moments(SERVICE, svc, s, year=None)
    assert calls == [[2, 3, 4]]
    assert [i for i, _ in sentences(payload)] == [3, 2, 2]
    # logged once, by attach_texts; not again as a names skip
    skip = next(e for e in logs if e.get("reason") == "text_missing")
    assert skip["event"] == "memories_skip" and skip["view"] == "attach_texts"
    assert not [e for e in logs if e.get("view") == "names"]


@pytest.mark.asyncio
async def test_a_text_without_a_nickname_sentence_is_a_distinct_skip(svc, monkeypatch):
    s = await kanemura(svc)
    monkeypatch.setattr(nm, "has_nickname", lambda sentence: False)
    with capture_logs() as logs:
        payload = await nm.nickname_moments(SERVICE, svc, s, year=None)
    assert payload == {"years": [], "items": []}
    skips = [e for e in logs if e.get("view") == "names"]
    assert skips == [
        {
            "event": "memories_skip",
            "log_level": "info",
            "view": "names",
            "reason": "no_sentence",
            "count": 3,
        }
    ]


@pytest.mark.asyncio
async def test_filtering_and_splitting_run_off_the_event_loop(svc, monkeypatch):
    s = await kanemura(svc)
    loop_thread = threading.get_ident()
    threads: dict[str, set[int]] = {"ref": set(), "split": set()}
    real_ref, real_split = people.message_ref, nm.raw_sentences

    def ref(*a, **kw):
        threads["ref"].add(threading.get_ident())
        return real_ref(*a, **kw)

    def split(text):
        threads["split"].add(threading.get_ident())
        return real_split(text)

    monkeypatch.setattr(people, "message_ref", ref)
    monkeypatch.setattr(nm, "raw_sentences", split)
    payload = await nm.nickname_moments(SERVICE, svc, s, year=None)
    assert len(payload["items"]) == 4
    assert threads["ref"] and threads["split"]
    assert loop_thread not in threads["ref"] | threads["split"]


@pytest.mark.asyncio
async def test_a_sentence_payload_is_never_cacheable(svc):
    s = await kanemura(svc)
    payload = await nm.nickname_moments(SERVICE, svc, s, year=None)
    assert vc.contains_text(payload)
