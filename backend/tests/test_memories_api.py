"""Year recap HTTP API (``backend/api/memories.py``)."""

from __future__ import annotations

import json
from datetime import datetime
from unittest.mock import patch

import pytest
import time_machine
from fastapi.testclient import TestClient

from backend.main import app
from backend.services import app_state
from backend.services.memories import index as mi
from backend.tests.test_memories_recap import (
    FINAL,
    FULL_ROWS,
    KANEMURA,
    LETTERS,
    SERVICE,
    SVC_NAME,
    write_room,
    write_subs,
)

client = TestClient(app)
MEMBER = f"{SVC_NAME}/messages/{KANEMURA[0]}/{KANEMURA[1]}"


@pytest.fixture
def out(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    app_state.set_db_path(tmp_path / "app.db")
    app_state.init_db()
    svc = tmp_path / "out" / SVC_NAME
    svc.mkdir(parents=True)
    write_room(svc, KANEMURA, FULL_ROWS, letters=LETTERS)
    write_subs(svc, {"34": "2024-07-24"})
    with patch("backend.api.memories.get_output_dir", return_value=svc.parent):
        yield svc.parent


def get(url, **params):
    with time_machine.travel(FINAL, tick=False):
        return client.get(url, params=params)


def test_member_recap_happy_path(out):
    r = get(f"/api/memories/{SERVICE}/recap/2026", member=MEMBER)
    assert r.status_code == 200
    body = r.json()
    assert body["year"] == 2026
    assert body["member"]["id"] == "58"
    assert [s["key"] for s in body["slides"]][0] == "s01_first"
    assert "poster" in body


def test_members_overview(out):
    r = get(f"/api/memories/{SERVICE}/recap/2026/members")
    assert r.status_code == 200
    body = r.json()
    assert body["year"] == 2026
    assert body["members"][0]["member_path"] == MEMBER
    assert "opening" in body


def test_traversal_is_400(out):
    r = get(f"/api/memories/{SERVICE}/recap/2026", member="../../etc/passwd")
    assert r.status_code == 400
    r = get(f"/api/memories/{SERVICE}/recap/2026", member=f"{SVC_NAME}/../../x")
    assert r.status_code == 400


def test_unknown_member_is_404(out):
    r = get(
        f"/api/memories/{SERVICE}/recap/2026",
        member=f"{SVC_NAME}/messages/99 誰か/1 誰か",
    )
    assert r.status_code == 404


def test_missing_member_is_422(out):
    assert get(f"/api/memories/{SERVICE}/recap/2026").status_code == 422


def test_unknown_service_is_400(out):
    assert get("/api/memories/nope/recap/2026/members").status_code == 400
    assert get("/api/memories/nope/recap/2026", member=MEMBER).status_code == 400


@pytest.mark.parametrize("year", [2019, 2029])
def test_year_out_of_range_is_400(out, year):
    assert get(f"/api/memories/{SERVICE}/recap/{year}/members").status_code == 400
    r = get(f"/api/memories/{SERVICE}/recap/{year}", member=MEMBER)
    assert r.status_code == 400


def test_no_absolute_paths_in_response(out, tmp_path):
    texts = [
        get(f"/api/memories/{SERVICE}/recap/2026", member=MEMBER).text,
        get(f"/api/memories/{SERVICE}/recap/2026/members").text,
    ]
    for text in texts:
        assert str(tmp_path) not in text
        assert "/tmp" not in text and "\\\\" not in text
        json.loads(text)


def test_now_is_utc_aware(out):
    seen = {}

    async def fake(service, d, year, *, now):
        seen["now"] = now
        return {"year": year}

    with patch("backend.api.memories.build_members_overview", fake):
        get(f"/api/memories/{SERVICE}/recap/2026/members")
    assert (
        isinstance(seen["now"], datetime)
        and seen["now"].utcoffset().total_seconds() == 0
    )
