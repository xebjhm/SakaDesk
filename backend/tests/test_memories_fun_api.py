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
