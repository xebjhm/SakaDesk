"""時光膠囊, capsule notes (``backend/services/memories/capsule.py``)."""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
import time_machine
from structlog.testing import capture_logs

from backend.services import app_state
from backend.services.memories import capsule, people
from backend.services.memories import index as mi
from backend.services.memories import oshi as oshi_mod
from backend.tests.memories_archive import msg, write_room

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
KANE_OLD = "messages/20 金村 美玖/30 金村 美玖"
KANE = "messages/34 金村 美玖/58 金村 美玖"
MATSU = "messages/40 松田 好花/64 松田 好花"
# 2025-11-10 12:00 JST
WRITTEN = datetime(2025, 11, 10, 3, 0, tzinfo=timezone.utc)
ANCHOR = date(2024, 6, 2)
KANE_WORDS = "あの日の金村のことば、ありがとう"
MATSU_WORDS = (
    "今日は本当に楽しかった、みんなに会えて嬉しい、ずっと応援してくれてありがとう！"
)
SECRET = "わたしだけのひみつのメモ"


def set_oshi(monkeypatch, names):
    async def fake(service):
        return set(names)

    monkeypatch.setattr(oshi_mod, "oshi_names", fake)


@pytest.fixture
def svc(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    app_state.set_db_path(tmp_path / "app.db")
    app_state.init_db()
    set_oshi(monkeypatch, {"松田好花"})
    sdir = tmp_path / "out" / SVC_NAME
    write_room(sdir, "20 金村 美玖", "30 金村 美玖", [])
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [msg(1, "2024-06-02T03:00:00Z", content=KANE_WORDS)],
    )
    write_room(
        sdir,
        "40 松田 好花",
        "64 松田 好花",
        [msg(1, "2024-06-02T04:00:00Z", content=MATSU_WORDS)],
    )
    return sdir


async def kane(sdir, room=KANE):
    return await people.resolve_person(sdir, f"{SVC_NAME}/{room}")


async def at(when, coro_fn, *args, **kwargs):
    with time_machine.travel(when, tick=False):
        return await coro_fn(*args, now=datetime.now(timezone.utc), **kwargs)


async def write_day(sdir, body=SECRET, day=ANCHOR, when=WRITTEN):
    anchor = {"kind": "day", "date": day.isoformat()}
    return await at(when, capsule.create_note, SERVICE, sdir, anchor=anchor, body=body)


async def write_card(sdir, room=KANE, key="moment.midnight", when=WRITTEN):
    anchor = {
        "kind": "card",
        "member": f"{SVC_NAME}/{room}",
        "card_key": key,
        "date": ANCHOR.isoformat(),
    }
    return await at(
        when, capsule.create_note, SERVICE, sdir, anchor=anchor, body=SECRET
    )


async def resurface(sdir, when, month_day="11-10"):
    return await at(when, capsule.resurfacing, SERVICE, sdir, month_day=month_day)


# --- CRUD -------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_list_update_delete(svc):
    note = await write_day(svc, body=f"  {SECRET}\n")
    assert note["body"] == SECRET
    assert note["anchor"] == {"kind": "day", "date": "2024-06-02", "card_key": None}
    assert note["created_at"] == note["updated_at"] == "2025-11-10T03:00:00+00:00"
    listed = await capsule.notes_for_anchor(
        SERVICE, svc, day=ANCHOR, member=None, card_key=None
    )
    assert listed == {"notes": [note]}
    later = datetime(2025, 11, 11, 3, 0, tzinfo=timezone.utc)
    updated = await at(
        later, capsule.update_note, SERVICE, svc, note_id=note["id"], body="書き直し"
    )
    assert updated["body"] == "書き直し"
    assert updated["updated_at"] == "2025-11-11T03:00:00+00:00"
    assert updated["created_at"] == note["created_at"]
    assert await capsule.delete_note(SERVICE, svc, note_id=note["id"]) is True
    assert await capsule.delete_note(SERVICE, svc, note_id=note["id"]) is False
    listed = await capsule.notes_for_anchor(
        SERVICE, svc, day=ANCHOR, member=None, card_key=None
    )
    assert listed == {"notes": []}


@pytest.mark.asyncio
async def test_update_unknown_or_other_service_note_is_none(svc):
    note = await write_day(svc)
    assert (
        await at(
            WRITTEN,
            capsule.update_note,
            "sakurazaka46",
            svc,
            note_id=note["id"],
            body="x",
        )
        is None
    )
    assert (
        await at(WRITTEN, capsule.update_note, SERVICE, svc, note_id=999, body="x")
        is None
    )
    assert await capsule.delete_note("sakurazaka46", svc, note_id=note["id"]) is False


@pytest.mark.asyncio
@pytest.mark.parametrize("body", ["", "   \n", "あ" * 2001, 5, None])
async def test_bad_body_is_bad_note(svc, body):
    with pytest.raises(capsule.CapsuleError) as e:
        await write_day(svc, body=body)
    assert e.value.code == "bad_note" and str(e.value) == "bad_note"
    note = await write_day(svc)
    with pytest.raises(capsule.CapsuleError):
        await at(
            WRITTEN, capsule.update_note, SERVICE, svc, note_id=note["id"], body=body
        )


@pytest.mark.asyncio
async def test_body_of_exactly_max_chars_is_kept(svc):
    note = await write_day(svc, body="🎂" * capsule.MAX_CHARS)
    assert len(note["body"]) == 2000


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "anchor",
    [
        None,
        [],
        {"kind": "week", "date": "2024-06-02"},
        {"kind": "day"},
        {"kind": "day", "date": "2024-06-02", "x": 1},
        {"kind": "day", "date": "2024-02-30"},
        {"kind": "day", "date": "2024-6-2"},
        {"kind": "day", "date": "2024-06-02\n"},
        {"kind": "day", "date": 20240602},
        {"kind": "card", "member": f"{SVC_NAME}/{KANE}", "card_key": "x", "date": "x"},
        {
            "kind": "card",
            "member": f"{SVC_NAME}/{KANE}",
            "card_key": "Bad Key",
            "date": "2024-06-02",
        },
        {
            "kind": "card",
            "member": f"{SVC_NAME}/{KANE}",
            "card_key": "a" * 81,
            "date": "2024-06-02",
        },
        {
            "kind": "card",
            "member": f"{SVC_NAME}/{KANE}",
            "card_key": "ok\n",
            "date": "2024-06-02",
        },
        {"kind": "card", "member": 5, "card_key": "ok", "date": "2024-06-02"},
        {"kind": "card", "card_key": "ok", "date": "2024-06-02"},
    ],
)
async def test_bad_anchor(svc, anchor):
    with pytest.raises(capsule.CapsuleError) as e:
        await at(WRITTEN, capsule.create_note, SERVICE, svc, anchor=anchor, body=SECRET)
    assert e.value.code == "bad_anchor"


@pytest.mark.asyncio
async def test_card_anchor_for_an_unknown_member(svc):
    (svc / "messages" / "99 x" / "98 x").mkdir(parents=True)
    with pytest.raises(capsule.CapsuleError) as e:
        await write_card(svc, room="messages/99 x/98 x")
    assert e.value.code == "unknown_member"


@pytest.mark.asyncio
async def test_card_anchor_resolves_through_another_room_path(svc):
    note = await write_card(svc, room=KANE_OLD)
    assert note["anchor"] == {
        "kind": "card",
        "date": "2024-06-02",
        "card_key": "moment.midnight",
    }
    person = await kane(svc, room=KANE)  # her other room
    listed = await capsule.notes_for_anchor(
        SERVICE, svc, day=None, member=person, card_key="moment.midnight"
    )
    assert [n["id"] for n in listed["notes"]] == [note["id"]]
    # other card, other person: nothing
    other = await capsule.notes_for_anchor(
        SERVICE, svc, day=None, member=person, card_key="moment.other"
    )
    assert other == {"notes": []}
    # the day list shows day notes only
    days = await capsule.notes_for_anchor(
        SERVICE, svc, day=ANCHOR, member=None, card_key=None
    )
    assert days == {"notes": []}


@pytest.mark.asyncio
async def test_notes_for_anchor_needs_exactly_one_anchor(svc):
    person = await kane(svc)
    for kwargs in (
        {"day": None, "member": None, "card_key": None},
        {"day": ANCHOR, "member": person, "card_key": "x"},
        {"day": None, "member": person, "card_key": None},
        {"day": None, "member": person, "card_key": "Bad Key"},
    ):
        with pytest.raises(capsule.CapsuleError):
            await capsule.notes_for_anchor(SERVICE, svc, **kwargs)


# --- resurfacing ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resurfaces_one_year_later_not_before(svc):
    note = await write_day(svc)
    # the day it was written: not yet
    assert await resurface(svc, WRITTEN) == {"notes": []}
    # 364 days later (2026-11-09): not yet
    day_364 = datetime(2026, 11, 9, 3, 0, tzinfo=timezone.utc)
    assert await resurface(svc, day_364, month_day="11-09") == {"notes": []}
    # first anniversary
    first = await resurface(svc, datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc))
    (item,) = first["notes"]
    assert item["note"] == note and item["years_ago"] == 1
    # oshi first on a day anchor
    assert item["message"]["text"] == MATSU_WORDS
    assert item["member_path"] == f"{SVC_NAME}/{MATSU}" and item["name"] == "松田 好花"
    # second anniversary
    second = await resurface(svc, datetime(2027, 11, 10, 3, 0, tzinfo=timezone.utc))
    assert second["notes"][0]["years_ago"] == 2


@pytest.mark.asyncio
async def test_written_late_at_night_jst_counts_by_the_jst_date(svc):
    # 2025-11-10 23:30 JST = 14:30 UTC
    await write_day(svc, when=datetime(2025, 11, 10, 14, 30, tzinfo=timezone.utc))
    # 2026-11-10 23:59 JST
    got = await resurface(svc, datetime(2026, 11, 10, 14, 59, tzinfo=timezone.utc))
    assert len(got["notes"]) == 1
    # 2026-11-11 00:00 JST: the next JST day
    got = await resurface(
        svc, datetime(2026, 11, 10, 15, 0, tzinfo=timezone.utc), month_day="11-11"
    )
    assert got == {"notes": []}


@pytest.mark.asyncio
async def test_feb_29_resurfaces_on_feb_28(svc):
    leap = datetime(2024, 2, 29, 3, 0, tzinfo=timezone.utc)
    note = await write_day(svc, when=leap)
    got = await resurface(
        svc, datetime(2025, 2, 28, 3, 0, tzinfo=timezone.utc), month_day="02-28"
    )
    assert [i["note"]["id"] for i in got["notes"]] == [note["id"]]
    assert got["notes"][0]["years_ago"] == 1
    due = await capsule.due_notes(SERVICE, date(2025, 2, 28))
    assert [n.id for n in due] == [note["id"]]
    # a leap year shows it on Feb 29, not Feb 28
    assert await capsule.due_notes(SERVICE, date(2028, 2, 28)) == []
    assert [n.id for n in await capsule.due_notes(SERVICE, date(2028, 2, 29))] == [
        note["id"]
    ]


@pytest.mark.asyncio
async def test_card_anchor_resurfaces_with_the_cards_person(svc):
    await write_card(svc, room=KANE_OLD)
    got = await resurface(svc, datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc))
    (item,) = got["notes"]
    # oshi is 松田, but the card is 金村's
    assert item["message"]["text"] == KANE_WORDS
    assert item["member_path"] == f"{SVC_NAME}/{KANE}" and item["name"] == "金村 美玖"


@pytest.mark.asyncio
async def test_card_anchor_without_her_message_keeps_her_name(svc):
    anchor = {
        "kind": "card",
        "member": f"{SVC_NAME}/{KANE}",
        "card_key": "special.birthday",
        "date": "2023-01-01",
    }
    await at(WRITTEN, capsule.create_note, SERVICE, svc, anchor=anchor, body=SECRET)
    got = await resurface(svc, datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc))
    (item,) = got["notes"]
    assert item["message"] is None
    assert item["member_path"] == f"{SVC_NAME}/{KANE}" and item["name"] == "金村 美玖"


@pytest.mark.asyncio
async def test_card_anchor_whose_person_is_gone_resurfaces_alone(svc, monkeypatch):
    await write_card(svc)

    async def gone(sdir, path):
        return None

    monkeypatch.setattr(people, "resolve_person", gone)
    with capture_logs() as logs:
        got = await resurface(svc, datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc))
    (item,) = got["notes"]
    assert item["message"] is None and item["member_path"] is None
    assert item["name"] is None
    assert any(e.get("reason") == "card_person_missing" for e in logs)

    async def foreign(sdir, path):
        raise people.ForeignServiceError("x")

    monkeypatch.setattr(people, "resolve_person", foreign)
    got = await resurface(svc, datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc))
    assert got["notes"][0]["message"] is None


@pytest.mark.asyncio
async def test_note_without_a_message_that_day_resurfaces_alone(svc):
    note = await write_day(svc, day=date(2023, 1, 1))
    with capture_logs() as logs:
        got = await resurface(svc, datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc))
    assert got["notes"] == [
        {
            "note": note,
            "years_ago": 1,
            "message": None,
            "member_path": None,
            "name": None,
        }
    ]
    assert any(e.get("reason") == "no_message" for e in logs)


@pytest.mark.asyncio
async def test_resurfacing_is_oldest_written_first(svc):
    older = await write_day(svc, when=datetime(2023, 11, 10, 3, 0, tzinfo=timezone.utc))
    newer = await write_day(svc)
    await write_card(svc)
    got = await resurface(svc, datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc))
    ids = [i["note"]["id"] for i in got["notes"]]
    assert ids[:2] == [older["id"], newer["id"]] and len(ids) == 3
    assert [i["years_ago"] for i in got["notes"]] == [3, 1, 1]


@pytest.mark.asyncio
async def test_resurfacing_limit_attaches_text_for_the_shown_notes_only(
    svc, monkeypatch
):
    older = await write_day(svc, when=datetime(2023, 11, 10, 3, 0, tzinfo=timezone.utc))
    await write_day(svc)
    await write_card(svc)
    attached: list[int] = []
    real = people.attach_texts

    async def spy(sdir, refs):
        attached.append(len(refs))
        await real(sdir, refs)

    monkeypatch.setattr(people, "attach_texts", spy)
    now = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)
    got = await at(now, capsule.resurfacing, SERVICE, svc, month_day="11-10", limit=1)
    assert [i["note"]["id"] for i in got["notes"]] == [older["id"]]
    assert attached == [1]


@pytest.mark.asyncio
async def test_due_notes_match_resurfacing_without_text(svc):
    await write_day(svc)
    await write_card(svc)
    await write_day(svc, when=datetime(2025, 11, 11, 3, 0, tzinfo=timezone.utc))
    now = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)
    shown = [i["note"]["id"] for i in (await resurface(svc, now))["notes"]]
    due = await capsule.due_notes(SERVICE, date(2026, 11, 10))
    assert [n.id for n in due] == shown and len(shown) == 2
    assert all(isinstance(n, capsule.user_store.CapsuleNote) for n in due)


@pytest.mark.asyncio
async def test_resurfacing_rejects_a_bad_month_day(svc):
    with pytest.raises(ValueError):
        await resurface(svc, WRITTEN, month_day="02-30")


@pytest.mark.asyncio
async def test_logs_never_carry_the_body(svc):
    with capture_logs() as logs:
        note = await write_day(svc)
        await capsule.notes_for_anchor(
            SERVICE, svc, day=ANCHOR, member=None, card_key=None
        )
        await at(
            WRITTEN,
            capsule.update_note,
            SERVICE,
            svc,
            note_id=note["id"],
            body=SECRET + "2",
        )
        await resurface(svc, datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc))
        await capsule.delete_note(SERVICE, svc, note_id=note["id"])
    flat = repr(logs)
    for secret in (SECRET, KANE_WORDS, MATSU_WORDS, "金村", str(svc)):
        assert secret not in flat
    ops = [e["op"] for e in logs if e["event"] == "memories_capsule"]
    assert ops == ["create", "list", "update", "resurface", "delete"]
    (create,) = [
        e for e in logs if e["event"] == "memories_capsule" and e["op"] == "create"
    ]
    assert create["note_id"] == note["id"] and create["chars"] == len(SECRET)
