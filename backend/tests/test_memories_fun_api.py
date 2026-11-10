"""Memories fun-wave HTTP API (``backend/api/memories.py``): radio, ...

Later fun-wave tasks append their route tests here.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
import time_machine
from fastapi.testclient import TestClient

from backend.main import app
from backend.services import app_state
from backend.services.memories import index as mi
from backend.tests.memories_archive import msg, write_room

client = TestClient(app)
SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
ROOM = "messages/34 金村 美玖/58 金村 美玖"
MEMBER = f"{SVC_NAME}/{ROOM}"
NOW = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)


def voice(i, ts, dur):
    return msg(
        i,
        ts,
        "voice",
        media_file=f"{ROOM}/voice/{i}.m4a".replace("/", "\\"),
        media_duration=dur,
    )


@pytest.fixture
def out(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    app_state.set_db_path(tmp_path / "app.db")
    app_state.init_db()
    svc = tmp_path / "out" / SVC_NAME
    write_room(
        svc,
        "34 金村 美玖",
        "58 金村 美玖",
        [
            voice(1, "2024-07-24T13:00:00Z", 12.5),  # JST 22:00
            voice(2, "2025-01-05T22:30:00Z", 8.0),  # JST 01-06 07:30
            msg(3, "2025-01-06T03:00:00Z", content="おはよう"),
        ],
    )
    with patch("backend.api.memories.get_output_dir", return_value=svc.parent):
        yield svc.parent


def get(url, **params):
    with time_machine.travel(NOW, tick=False):
        return client.get(url, params=params)


def no_abs_paths(out, body):
    blob = json.dumps(body, ensure_ascii=False)
    assert str(out) not in blob
    assert "person_key" not in blob


def test_radio_members_happy_path(out):
    r = get(f"/api/memories/{SERVICE}/radio/members")
    assert r.status_code == 200
    body = r.json()
    assert body["total_seconds"] == 20.5
    assert [(m["member_path"], m["voices"]) for m in body["members"]] == [(MEMBER, 2)]
    no_abs_paths(out, body)


def test_radio_program_happy_path(out):
    r = get(f"/api/memories/{SERVICE}/radio/program", program="oyasumi")
    assert r.status_code == 200
    body = r.json()
    assert body["programs"] == ["oyasumi", "ohayo", "chrono"]
    assert body["years"] == [2024, 2025]
    assert [t["message"]["id"] for t in body["tracks"]] == [1]
    assert body["tracks"][0]["end"] == 12.5
    no_abs_paths(out, body)
    r = get(
        f"/api/memories/{SERVICE}/radio/program",
        program="chrono",
        year=2025,
        member=MEMBER,
    )
    assert r.status_code == 200
    assert [t["message"]["id"] for t in r.json()["tracks"]] == [2]


def test_radio_cassettes_happy_path(out):
    r = get(f"/api/memories/{SERVICE}/radio/cassettes", member=MEMBER)
    assert r.status_code == 200
    body = r.json()
    assert [(c["year"], c["voices"]) for c in body["cassettes"]] == [
        (2024, 1),
        (2025, 1),
    ]
    assert all(c["color"] is None for c in body["cassettes"])  # no pictures
    no_abs_paths(out, body)


def test_radio_unknown_program_is_400(out):
    r = get(f"/api/memories/{SERVICE}/radio/program", program="news")
    assert r.status_code == 400


@pytest.mark.parametrize("year", [1999, 2101])
def test_radio_bad_year_is_400(out, year):
    r = get(f"/api/memories/{SERVICE}/radio/program", program="chrono", year=year)
    assert r.status_code == 400


def test_radio_unknown_service_is_400(out):
    assert get("/api/memories/nope/radio/members").status_code == 400


@pytest.mark.parametrize("path", ["radio/cassettes", "radio/program"])
def test_radio_traversal_is_400(out, path):
    for bad in ("../../etc/passwd", f"{SVC_NAME}/../../x"):
        r = get(f"/api/memories/{SERVICE}/{path}", program="oyasumi", member=bad)
        assert r.status_code == 400


def test_radio_unknown_member_is_404(out):
    (out / SVC_NAME / "messages" / "99 x" / "98 x").mkdir(parents=True)
    for path in ("radio/cassettes", "radio/program"):
        r = get(
            f"/api/memories/{SERVICE}/{path}",
            program="oyasumi",
            member=f"{SVC_NAME}/messages/99 x/98 x",
        )
        assert r.status_code == 404
    (out / "櫻坂46" / "messages" / "1 x" / "2 x").mkdir(parents=True)
    r = get(
        f"/api/memories/{SERVICE}/radio/program",
        program="oyasumi",
        member="櫻坂46/messages/1 x/2 x",
    )
    assert r.status_code == 404


# --- gacha (Task F3) ------------------------------------------------------------------


def post(url, now=NOW):
    with time_machine.travel(now, tick=False):
        return client.post(url)


def test_gacha_state_shape(out):
    r = get(f"/api/memories/{SERVICE}/gacha")
    assert r.status_code == 200
    body = r.json()
    assert body == {
        "available": True,
        "pulls_left": 3,
        "max_pulls": 3,
        "today": [],
        "history": [],
    }


def test_gacha_pull_three_then_409(out):
    lefts = []
    for _ in range(3):
        r = post(f"/api/memories/{SERVICE}/gacha/pull")
        assert r.status_code == 200
        body = r.json()
        lefts.append(body["pulls_left"])
        assert body["pull"]["message"]["member_path"] == MEMBER
        no_abs_paths(out, body)
    assert lefts == [2, 1, 0]
    r = post(f"/api/memories/{SERVICE}/gacha/pull")
    assert r.status_code == 409
    assert r.json()["detail"] == "no_pulls_left"
    state = get(f"/api/memories/{SERVICE}/gacha").json()
    assert state["pulls_left"] == 0 and len(state["today"]) == 3
    salt = app_state.get_prefs().get("memories_gacha_salt")
    assert salt and salt not in json.dumps(state)
    no_abs_paths(out, state)


def test_gacha_resets_at_jst_midnight(out):
    late = datetime(2026, 11, 10, 14, 59, 59, tzinfo=timezone.utc)  # JST 23:59:59
    for _ in range(3):
        assert post(f"/api/memories/{SERVICE}/gacha/pull", now=late).status_code == 200
    assert post(f"/api/memories/{SERVICE}/gacha/pull", now=late).status_code == 409
    midnight = datetime(2026, 11, 10, 15, 0, tzinfo=timezone.utc)  # JST 11-11 00:00
    with time_machine.travel(midnight, tick=False):
        assert client.get(f"/api/memories/{SERVICE}/gacha").json()["pulls_left"] == 3
    assert post(f"/api/memories/{SERVICE}/gacha/pull", now=midnight).status_code == 200


def test_gacha_unknown_service_is_400(out):
    assert get("/api/memories/nope/gacha").status_code == 400
    assert post("/api/memories/nope/gacha/pull").status_code == 400


# --- calendar album and cover override (Task F4) ----------------------------------------


def pic(i, ts, type_="picture"):
    return msg(i, ts, type_, media_file=f"{ROOM}/{type_}/{i}.jpg".replace("/", "\\"))


@pytest.fixture
def album_out(out):
    write_room(
        out / SVC_NAME,
        "34 金村 美玖",
        "58 金村 美玖",
        [
            pic(10, "2024-09-14T03:00:00Z"),
            pic(11, "2024-09-14T04:00:00Z"),
            msg(12, "2024-09-15T03:00:00Z", content="文字"),
        ],
    )
    return out


def put(url, body):
    with time_machine.travel(NOW, tick=False):
        return client.put(url, json=body)


def delete(url, **params):
    with time_machine.travel(NOW, tick=False):
        return client.delete(url, params=params)


def test_calendar_months_route(album_out):
    r = get(f"/api/memories/{SERVICE}/calendar/months")
    assert r.status_code == 200
    assert r.json() == {"months": ["2024-09"]}
    r = get(f"/api/memories/{SERVICE}/calendar/months", member=MEMBER)
    assert r.json() == {"months": ["2024-09"]}


def test_calendar_month_route(album_out):
    r = get(f"/api/memories/{SERVICE}/calendar/2024-09", member=MEMBER)
    assert r.status_code == 200
    body = r.json()
    assert [(d["date"], d["members"]) for d in body["days"]] == [
        ("2024-09-14", 1),
        ("2024-09-15", 1),
    ]
    assert body["days"][0]["photo"]["member_path"] == MEMBER
    assert body["days"][1]["photo"] is None
    no_abs_paths(album_out, body)


@pytest.mark.parametrize("bad", ["2024-9", "2024-13", "x", "2024-09-01"])
def test_calendar_bad_month_is_400(album_out, bad):
    assert get(f"/api/memories/{SERVICE}/calendar/{bad}").status_code == 400


def test_calendar_errors(album_out):
    assert get("/api/memories/nope/calendar/months").status_code == 400
    assert get("/api/memories/nope/calendar/2024-09").status_code == 400
    r = get(f"/api/memories/{SERVICE}/calendar/2024-09", member="../../etc/passwd")
    assert r.status_code == 400
    (album_out / SVC_NAME / "messages" / "99 x" / "98 x").mkdir(parents=True)
    r = get(
        f"/api/memories/{SERVICE}/calendar/months",
        member=f"{SVC_NAME}/messages/99 x/98 x",
    )
    assert r.status_code == 404


def sep_cover(**params):
    months = get(f"/api/memories/{SERVICE}/album/months", **params).json()["months"]
    sep = next(m for m in months if m["month"] == "2024-09")
    return sep["cover"]["id"], sep["cover_rule"]


def test_put_and_delete_album_cover(album_out):
    auto = sep_cover(member=MEMBER)
    assert auto[1] != "override"
    target = 11 if auto[0] == 10 else 10
    body = {"member": MEMBER, "month": "2024-09", "room": ROOM, "id": target}
    r = put(f"/api/memories/{SERVICE}/album/cover", body)
    assert r.status_code == 204 and r.content == b""
    assert sep_cover(member=MEMBER) == (target, "override")
    assert sep_cover() == auto  # the 全員 album is another scope
    r = delete(f"/api/memories/{SERVICE}/album/cover", member=MEMBER, month="2024-09")
    assert r.status_code == 204
    assert sep_cover(member=MEMBER) == auto
    # idempotent
    r = delete(f"/api/memories/{SERVICE}/album/cover", member=MEMBER, month="2024-09")
    assert r.status_code == 204


def test_put_album_cover_for_everyone(album_out):
    body = {"member": None, "month": "2024-09", "room": ROOM, "id": 11}
    assert put(f"/api/memories/{SERVICE}/album/cover", body).status_code == 204
    assert sep_cover() == (11, "override")
    assert (
        delete(f"/api/memories/{SERVICE}/album/cover", month="2024-09").status_code
        == 204
    )


@pytest.mark.parametrize(
    "patch_",
    [
        {"id": 12},  # a text message
        {"id": 999},  # no such message
        {"month": "2024-10"},  # another month
        {"room": "messages/99 x/98 x"},  # not a room of the scope
    ],
)
def test_put_album_cover_not_in_month(album_out, patch_):
    body = {"member": MEMBER, "month": "2024-09", "room": ROOM, "id": 10, **patch_}
    r = put(f"/api/memories/{SERVICE}/album/cover", body)
    assert r.status_code == 400
    assert r.json()["detail"] == "not_in_month"


@pytest.mark.parametrize(
    "body",
    [
        None,
        [],
        "x",
        {"month": "2024-09", "room": ROOM, "id": 10},  # member missing
        {"member": MEMBER, "room": ROOM, "id": 10},
        {"member": MEMBER, "month": "2024-9", "room": ROOM, "id": 10},
        {"member": MEMBER, "month": 202409, "room": ROOM, "id": 10},
        {"member": MEMBER, "month": "2024-09", "room": "", "id": 10},
        {"member": MEMBER, "month": "2024-09", "room": 5, "id": 10},
        {"member": MEMBER, "month": "2024-09", "room": "../../etc", "id": 10},
        {"member": MEMBER, "month": "2024-09", "room": "/etc/x", "id": 10},
        {"member": MEMBER, "month": "2024-09", "room": "a\\..\\b", "id": 10},
        {"member": MEMBER, "month": "2024-09", "room": ROOM, "id": "10"},
        {"member": MEMBER, "month": "2024-09", "room": ROOM, "id": True},
        {"member": MEMBER, "month": "2024-09", "room": ROOM, "id": -1},
        {"member": 5, "month": "2024-09", "room": ROOM, "id": 10},
        {"member": MEMBER, "month": "2024-09", "room": ROOM, "id": 10, "x": 1},
    ],
)
def test_put_album_cover_bad_body_is_400(album_out, body):
    r = put(f"/api/memories/{SERVICE}/album/cover", body)
    assert r.status_code == 400
    assert r.json()["detail"] == "bad_body"


def test_put_album_cover_body_errors(album_out):
    url = f"/api/memories/{SERVICE}/album/cover"
    with time_machine.travel(NOW, tick=False):
        r = client.put(url, content=b"{not json")
        assert r.status_code == 400
        r = client.put(url, content=b'{"x": "' + b"a" * 9000 + b'"}')
        assert r.status_code == 400
        r = client.put(url, content="\udcff".encode("utf-8", "surrogatepass"))
        assert r.status_code == 400


def test_album_cover_member_errors(album_out):
    url = f"/api/memories/{SERVICE}/album/cover"
    body = {"member": "../../etc/passwd", "month": "2024-09", "room": ROOM, "id": 10}
    assert put(url, body).status_code == 400
    assert delete(url, member="../../etc/passwd", month="2024-09").status_code == 400
    (album_out / SVC_NAME / "messages" / "99 x" / "98 x").mkdir(parents=True)
    other = f"{SVC_NAME}/messages/99 x/98 x"
    assert put(url, {**body, "member": other}).status_code == 404
    assert put("/api/memories/nope/album/cover", body).status_code == 400
    assert delete("/api/memories/nope/album/cover", month="2024-09").status_code == 400


@pytest.mark.parametrize("bad", ["2024-9", "x", "2024-00"])
def test_delete_album_cover_bad_month_is_400(album_out, bad):
    r = delete(f"/api/memories/{SERVICE}/album/cover", month=bad)
    assert r.status_code == 400


# --- review minors (F4): store errors and trailing newlines -------------------------------


def _broken_store(monkeypatch, *names):
    import sqlite3

    from backend.services.memories import user_store

    def broken(*a, **k):
        raise sqlite3.OperationalError("locked")

    for name in names:
        monkeypatch.setattr(user_store, name, broken)


def test_album_cover_store_error_is_503(album_out, monkeypatch):
    from structlog.testing import capture_logs

    _broken_store(monkeypatch, "set_cover_override", "clear_cover_override")
    body = {"member": MEMBER, "month": "2024-09", "room": ROOM, "id": 10}
    with capture_logs() as logs:
        r = put(f"/api/memories/{SERVICE}/album/cover", body)
        assert r.status_code == 503 and r.json() == {"detail": "store_unavailable"}
        r = delete(f"/api/memories/{SERVICE}/album/cover", month="2024-09")
        assert r.status_code == 503 and r.json() == {"detail": "store_unavailable"}
    rejects = [e for e in logs if e["event"] == "memories.api.reject"]
    assert [e["reason"] for e in rejects] == ["store_unavailable"] * 2
    assert {e["op"] for e in rejects} == {"cover_set", "cover_clear"}


def test_trailing_newline_in_month_or_date_is_400(album_out):
    body = {"member": MEMBER, "month": "2024-09\n", "room": ROOM, "id": 10}
    assert put(f"/api/memories/{SERVICE}/album/cover", body).status_code == 400
    r = delete(f"/api/memories/{SERVICE}/album/cover", month="2024-09\n")
    assert r.status_code == 400
    assert get(f"/api/memories/{SERVICE}/calendar/2024-09%0A").status_code == 400
    assert get(f"/api/memories/{SERVICE}/album/month/2024-09%0A").status_code == 400
    r = get(f"/api/memories/{SERVICE}/memoir/timeline/2024-09%0A", member=MEMBER)
    assert r.status_code == 400
    assert get(f"/api/memories/{SERVICE}/day", date="2024-09-14\n").status_code == 400
    assert (
        get(f"/api/memories/{SERVICE}/on-this-day", date="09-14\n").status_code == 400
    )


# --- capsule and same-time (Task F5) ---------------------------------------------------------

CAPSULE = f"/api/memories/{SERVICE}/capsule"
NOTE = "わたしのメモ 🎂"


def post_json(url, body):
    with time_machine.travel(NOW, tick=False):
        return client.post(url, json=body)


def day_note(date="2025-01-06", body=NOTE):
    return {"anchor": {"kind": "day", "date": date}, "body": body}


def card_note(member=MEMBER, key="moment.midnight"):
    return {
        "anchor": {
            "kind": "card",
            "member": member,
            "card_key": key,
            "date": "2025-01-06",
        },
        "body": NOTE,
    }


def test_capsule_crud(out):
    r = post_json(CAPSULE, day_note())
    assert r.status_code == 200
    note = r.json()
    assert note["body"] == NOTE and note["anchor"]["kind"] == "day"
    r = get(CAPSULE, date="2025-01-06")
    assert r.status_code == 200 and r.json() == {"notes": [note]}
    r = put(f"{CAPSULE}/{note['id']}", {"body": "書き直し"})
    assert r.status_code == 200 and r.json()["body"] == "書き直し"
    r = delete(f"{CAPSULE}/{note['id']}")
    assert r.status_code == 204
    assert delete(f"{CAPSULE}/{note['id']}").status_code == 404
    assert get(CAPSULE, date="2025-01-06").json() == {"notes": []}


def test_capsule_card_route(out):
    r = post_json(CAPSULE, card_note())
    assert r.status_code == 200
    note = r.json()
    r = get(CAPSULE, member=MEMBER, card="moment.midnight")
    assert r.json() == {"notes": [note]}
    no_abs_paths(out, r.json())


@pytest.mark.parametrize(
    "body",
    [
        None,
        [],
        "x",
        {"anchor": {"kind": "day", "date": "2025-01-06"}},
        {"body": NOTE},
        {**day_note(), "x": 1},
        day_note(date="2025-02-30"),
        day_note(date="2025-01-06\n"),
        {"anchor": {"kind": "week", "date": "2025-01-06"}, "body": NOTE},
        card_note(key="Bad Key"),
    ],
)
def test_capsule_bad_body_is_400(out, body):
    r = post_json(CAPSULE, body)
    assert r.status_code == 400 and r.json()["detail"] == "bad_body"


@pytest.mark.parametrize("text", ["", "   ", "あ" * 2001, 5])
def test_capsule_bad_note_is_400(out, text):
    r = post_json(CAPSULE, day_note(body=text))
    assert r.status_code == 400 and r.json()["detail"] == "bad_note"
    note = post_json(CAPSULE, day_note()).json()
    r = put(f"{CAPSULE}/{note['id']}", {"body": text})
    assert r.status_code == 400 and r.json()["detail"] == "bad_note"


def test_capsule_body_errors(out):
    with time_machine.travel(NOW, tick=False):
        r = client.post(CAPSULE, content=b"{not json")
        assert r.status_code == 400 and r.json()["detail"] == "bad_body"
        r = client.post(CAPSULE, content=b'{"body": "' + b"a" * 70000 + b'"}')
        assert r.status_code == 400 and r.json()["detail"] == "bad_note"
        r = client.put(f"{CAPSULE}/1", content=b"[]")
        assert r.status_code == 400 and r.json()["detail"] == "bad_body"
        r = client.put(f"{CAPSULE}/1", content=b'{"body": "x", "y": 1}')
        assert r.status_code == 400
        r = client.put(f"{CAPSULE}/1", content=b'{"body": "' + b"a" * 70000 + b'"}')
        assert r.status_code == 400 and r.json()["detail"] == "bad_note"


def test_capsule_member_errors(out):
    r = post_json(CAPSULE, card_note(member="../../etc/passwd"))
    assert r.status_code == 400
    (out / SVC_NAME / "messages" / "99 x" / "98 x").mkdir(parents=True)
    r = post_json(CAPSULE, card_note(member=f"{SVC_NAME}/messages/99 x/98 x"))
    assert r.status_code == 404
    (out / "櫻坂46" / "messages" / "1 x" / "2 x").mkdir(parents=True)
    r = post_json(CAPSULE, card_note(member="櫻坂46/messages/1 x/2 x"))
    assert r.status_code == 404
    r = get(CAPSULE, member="../../etc/passwd", card="moment.midnight")
    assert r.status_code == 400
    r = get(CAPSULE, member=f"{SVC_NAME}/messages/99 x/98 x", card="moment.midnight")
    assert r.status_code == 404


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"date": "2025-1-6"},
        {"date": "2025-01-06\n"},
        {"date": "2025-01-06", "member": MEMBER},
        {"date": "2025-01-06", "card": "moment.midnight"},
        {"member": MEMBER},
        {"card": "moment.midnight"},
        {"member": MEMBER, "card": "Bad Key"},
        {"member": MEMBER, "card": "ok\n"},
    ],
)
def test_capsule_list_validation(out, params):
    assert get(CAPSULE, **params).status_code == 400


def test_capsule_note_of_another_service_is_404(out):
    note = post_json(CAPSULE, day_note()).json()
    other = "/api/memories/sakurazaka46/capsule"
    (out / "櫻坂46").mkdir()
    assert put(f"{other}/{note['id']}", {"body": "x"}).status_code == 404
    assert delete(f"{other}/{note['id']}").status_code == 404
    assert put(f"{CAPSULE}/999", {"body": "x"}).status_code == 404


@pytest.mark.parametrize("note_id", [0, -1, 2**63, 2**64])
def test_capsule_note_id_out_of_range_is_404(out, note_id):
    assert put(f"{CAPSULE}/{note_id}", {"body": "x"}).status_code == 404
    assert delete(f"{CAPSULE}/{note_id}").status_code == 404


def test_capsule_unknown_service_is_400(out):
    url = "/api/memories/nope/capsule"
    assert get(url, date="2025-01-06").status_code == 400
    assert post_json(url, day_note()).status_code == 400
    assert put(f"{url}/1", {"body": "x"}).status_code == 400
    assert delete(f"{url}/1").status_code == 400
    assert get(f"{url}/due", month_day="11-10").status_code == 400
    assert get("/api/memories/nope/same-time").status_code == 400


def test_capsule_due_route(out):
    written = datetime(2025, 11, 10, 3, 0, tzinfo=timezone.utc)
    with time_machine.travel(written, tick=False):
        note = client.post(CAPSULE, json=day_note()).json()
    r = get(f"{CAPSULE}/due", month_day="11-10")
    assert r.status_code == 200
    (item,) = r.json()["notes"]
    assert item["note"]["id"] == note["id"] and item["years_ago"] == 1
    assert item["message"]["text"] == "おはよう"  # her words of 2025-01-06
    no_abs_paths(out, r.json())
    assert get(f"{CAPSULE}/due", month_day="11-11").json() == {"notes": []}


@pytest.mark.parametrize("bad", [None, "1110", "02-30", "13-01", "11-10\n"])
def test_capsule_due_validation(out, bad):
    params = {} if bad is None else {"month_day": bad}
    assert get(f"{CAPSULE}/due", **params).status_code == 400


def test_capsule_store_error_is_503(out, monkeypatch):
    _broken_store(
        monkeypatch,
        "add_note",
        "update_note",
        "delete_note",
        "notes_on_date",
        "notes_created_on_month_day",
    )
    for r in (
        post_json(CAPSULE, day_note()),
        put(f"{CAPSULE}/1", {"body": "x"}),
        delete(f"{CAPSULE}/1"),
        get(CAPSULE, date="2025-01-06"),
        get(f"{CAPSULE}/due", month_day="11-10"),
    ):
        assert r.status_code == 503 and r.json() == {"detail": "store_unavailable"}


def test_same_time_route(out):
    # NOW = 12:00 JST; her 2025-01-06 12:00 JST words
    r = get(f"/api/memories/{SERVICE}/same-time")
    assert r.status_code == 200
    body = r.json()
    assert body["clock"] == "12:00" and body["message"]["id"] == 3
    assert body["message"]["text"] == "おはよう" and body["member_path"] == MEMBER
    no_abs_paths(out, body)


def test_same_time_route_may_be_null(out):
    later = datetime(2026, 11, 10, 5, 0, tzinfo=timezone.utc)  # 14:00 JST
    with time_machine.travel(later, tick=False):
        r = client.get(f"/api/memories/{SERVICE}/same-time")
    assert r.status_code == 200 and r.json() is None
