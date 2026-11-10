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
