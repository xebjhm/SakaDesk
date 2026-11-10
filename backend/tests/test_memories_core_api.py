"""Memories core-wave HTTP API (``backend/api/memories.py``): binder, memoir, ...

Later core tasks append their route tests here.
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch

import pytest
import time_machine
from fastapi.testclient import TestClient

from backend.main import app
from backend.services import app_state
from backend.services.memories import index as mi
from backend.tests.memories_archive import msg, write_room, write_side_inputs

client = TestClient(app)
SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
ROOM = "messages/34 金村 美玖/58 金村 美玖"
MEMBER = f"{SVC_NAME}/{ROOM}"
NOW = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)
WORDS = "メリークリスマス🎄 ありがとう"


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
            msg(1, "2024-07-24T03:00:00Z", content="はじめまして"),
            msg(2, "2024-12-24T11:00:00Z", content=WORDS),
        ],
        letters=[{"id": 1, "text": "手紙", "created_at": "2024-08-01T00:00:00Z"}],
    )
    write_side_inputs(svc, sub_starts={"34": "2024-07-24"})
    with patch("backend.api.memories.get_output_dir", return_value=svc.parent):
        yield svc.parent


def get(url, **params):
    with time_machine.travel(NOW, tick=False):
        return client.get(url, params=params)


def test_cards_happy_path(out):
    r = get(f"/api/memories/{SERVICE}/memoir/cards", member=MEMBER)
    assert r.status_code == 200
    body = r.json()
    assert body["progress"]["earned"] >= 1
    cards = {card["key"]: card for sh in body["shelves"] for card in sh["cards"]}
    assert cards["first.message"]["face"]["member_path"] == MEMBER
    assert cards["special.christmas"]["face"]["text"] == WORDS
    assert cards["anniv.y1"]["date"] == "2025-07-24"  # today comes from the clock


def test_cards_traversal_is_400(out):
    for bad in ("../../etc/passwd", f"{SVC_NAME}/../../x"):
        r = get(f"/api/memories/{SERVICE}/memoir/cards", member=bad)
        assert r.status_code == 400


def test_cards_unknown_member_is_404(out):
    (out / SVC_NAME / "messages" / "99 x" / "98 x").mkdir(parents=True)
    r = get(
        f"/api/memories/{SERVICE}/memoir/cards", member=f"{SVC_NAME}/messages/99 x/98 x"
    )
    assert r.status_code == 404
    (out / "櫻坂46" / "messages" / "1 x" / "2 x").mkdir(parents=True)
    r = get(f"/api/memories/{SERVICE}/memoir/cards", member="櫻坂46/messages/1 x/2 x")
    assert r.status_code == 404


def test_cards_unknown_service_is_400(out):
    r = get("/api/memories/nope/memoir/cards", member=MEMBER)
    assert r.status_code == 400


def test_cards_member_is_required(out):
    assert get(f"/api/memories/{SERVICE}/memoir/cards").status_code == 422


def test_cards_json_has_no_absolute_paths(out):
    r = get(f"/api/memories/{SERVICE}/memoir/cards", member=MEMBER)
    text = r.text
    assert str(out) not in text
    assert str(out).replace("\\", "/") not in text


# --- memoir: list, header, names, timeline (C3) ------------------------------------


@pytest.fixture
def no_oshi(monkeypatch):
    from backend.services.memories import oshi as oshi_mod

    async def fake(service):
        return set()

    monkeypatch.setattr(oshi_mod, "oshi_names", fake)


def test_memoir_members_happy_path(out, no_oshi):
    r = get(f"/api/memories/{SERVICE}/memoir/members")
    assert r.status_code == 200
    (row,) = r.json()["members"]
    assert row["member_path"] == MEMBER and row["oshi"] is False
    assert row["progress"]["earned"] >= 1
    assert str(out) not in r.text


def test_memoir_members_unknown_service_is_400(out):
    assert get("/api/memories/nope/memoir/members").status_code == 400


def test_memoir_header_happy_path(out):
    r = get(f"/api/memories/{SERVICE}/memoir", member=MEMBER)
    assert r.status_code == 200
    body = r.json()
    assert body["member_path"] == MEMBER
    # 2024-07-24 .. 2026-11-10 JST, inclusive
    assert body["chips"]["subscription_days"] == 840
    assert body["chips"]["nickname_count"] is None


def test_memoir_names_happy_path_and_year(out):
    r = get(f"/api/memories/{SERVICE}/memoir/names", member=MEMBER)
    assert r.status_code == 200 and r.json() == {"years": [], "items": []}
    r = get(f"/api/memories/{SERVICE}/memoir/names", member=MEMBER, year=2024)
    assert r.status_code == 200
    r = get(f"/api/memories/{SERVICE}/memoir/names", member=MEMBER, year="x")
    assert r.status_code == 422
    r = get(f"/api/memories/{SERVICE}/memoir/names", member=MEMBER, year=2019)
    assert r.status_code == 400  # outside the recap range, like the recap routes


def test_memoir_timeline_happy_path(out):
    r = get(f"/api/memories/{SERVICE}/memoir/timeline", member=MEMBER)
    assert r.status_code == 200
    months = r.json()["months"]
    assert months[0] == {"month": "2024-07", "count": 1}
    assert months[-1] == {"month": "2024-12", "count": 1}
    assert len(months) == 6
    r = get(f"/api/memories/{SERVICE}/memoir/timeline/2024-12", member=MEMBER)
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 1 and body["messages"]["top"]["text"] == WORDS
    assert str(out) not in r.text


@pytest.mark.parametrize("month", ["2024-13", "2024-7", "24-07", "2024-00", "x"])
def test_memoir_timeline_bad_month_is_400(out, month):
    r = get(f"/api/memories/{SERVICE}/memoir/timeline/{month}", member=MEMBER)
    assert r.status_code == 400


def test_memoir_timeline_month_outside_range_is_404(out):
    r = get(f"/api/memories/{SERVICE}/memoir/timeline/2025-01", member=MEMBER)
    assert r.status_code == 404


MEMBER_ROUTES = (
    "memoir",
    "memoir/names",
    "memoir/timeline",
    "memoir/timeline/2024-12",
)


@pytest.mark.parametrize("route", MEMBER_ROUTES)
def test_memoir_member_routes_validate_member(out, route):
    url = f"/api/memories/{SERVICE}/{route}"
    assert get(url, member="../../etc/passwd").status_code == 400
    assert get(url, member=f"{SVC_NAME}/../../x").status_code == 400
    (out / SVC_NAME / "messages" / "99 x" / "98 x").mkdir(parents=True, exist_ok=True)
    assert get(url, member=f"{SVC_NAME}/messages/99 x/98 x").status_code == 404
    (out / "櫻坂46" / "messages" / "1 x" / "2 x").mkdir(parents=True, exist_ok=True)
    assert get(url, member="櫻坂46/messages/1 x/2 x").status_code == 404
    assert get(f"/api/memories/nope/{route}", member=MEMBER).status_code == 400
    assert get(url).status_code == 422
