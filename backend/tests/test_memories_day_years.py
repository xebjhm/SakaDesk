"""歷年同一天: the same calendar day across years (``day_view.day_years``) and its route."""

from __future__ import annotations

import dataclasses
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
import time_machine
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app
from backend.services.memories import day_view as dv
from backend.services.memories import index as mi
from backend.services.memories import oshi as oshi_mod
from backend.tests.memories_archive import msg, write_room, write_side_inputs

client = TestClient(app)
SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
KANE = "messages/34 金村 美玖/58 金村 美玖"
MATSU = "messages/40 松田 好花/64 松田 好花"
NOW = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)
WELCOME = "%%%さん、ご登録ありがとうございます！これからよろしくね"
OHAYO = "おはよう☀️ 今日は少し寒いね"
OYASUMI = "おやすみなさい🌙 また明日ね"
PIC = "messages\\34 金村 美玖\\58 金村 美玖\\picture\\{}.jpg"


@pytest.fixture
def out(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [
            # 2024-11-01 00:04 JST: the subscription welcome opens the room
            msg(1, "2024-10-31T15:04:00Z", content=WELCOME),
            msg(2, "2024-11-01T07:00:00Z", content="楽屋のおやつ🍪"),  # 16:00 JST
            msg(3, "2024-11-02T03:00:00Z", content="別の日"),
            msg(4, "2025-10-31T22:12:00Z", content=OHAYO),  # 2025-11-01 07:12 JST
            msg(5, "2025-11-01T06:02:00Z", "picture", media_file=PIC.format(5)),
            msg(6, "2025-11-01T12:40:00Z", "voice", media_file=PIC.format(6)),
            msg(7, "2025-11-01T14:48:00Z", content=OYASUMI),  # 23:48 JST
            msg(8, "2026-10-31T22:25:00Z", content="おはよう！リハーサルの日"),
        ],
    )
    write_room(
        sdir,
        "40 松田 好花",
        "64 松田 好花",
        [msg(1, "2025-11-01T03:00:00Z", content="お昼はうどん")],
    )
    write_side_inputs(sdir, sub_starts={"34": "2024-11-01"})

    async def fake_oshi(service):
        return {"松田好花"}

    monkeypatch.setattr(oshi_mod, "oshi_names", fake_oshi)
    return sdir


async def person(sdir, room):
    return next(s for s in await mi.list_members(sdir) if room in s.member_dirs)


@pytest.mark.asyncio
async def test_every_year_of_the_month_day_without_the_welcome(out):
    with capture_logs() as logs:
        payload = await dv.day_years(SERVICE, out, "11-01", member=None, now=NOW)
    assert payload["month_day"] == "11-01"
    assert [y["year"] for y in payload["years"]] == [2024, 2025, 2026]
    assert [y["date"] for y in payload["years"]] == [
        "2024-11-01",
        "2025-11-01",
        "2026-11-01",
    ]
    y2024, y2025, y2026 = payload["years"]
    # the welcome is the room's automatic greeting: left out, never her day
    assert [m["id"] for m in y2024["messages"]] == [2]
    assert y2024["messages"][0]["text"] == "楽屋のおやつ🍪"
    rows = [(m["room"], m["id"], m["kind"]) for m in y2025["messages"]]
    assert rows == [
        (KANE, 4, "ohayo"),
        (MATSU, 1, None),
        (KANE, 5, "photo"),
        (KANE, 6, "voice"),
        (KANE, 7, "oyasumi"),
    ]
    assert y2025["messages"][0]["text"] == OHAYO
    assert all(m["person_key"] for m in y2025["messages"])
    assert [m["id"] for m in y2026["messages"]] == [8]
    # oshi first
    assert [m["name"] for m in payload["members"]][0] == "松田 好花"
    (ev,) = [e for e in logs if e["event"] == "memories_day_years"]
    assert ev == {
        "event": "memories_day_years",
        "log_level": "info",
        "years": 3,
        "members": 2,
        "count": 7,
        "welcome": 1,
    }


@pytest.mark.asyncio
async def test_one_person_only(out):
    s = await person(out, MATSU)
    payload = await dv.day_years(SERVICE, out, "11-01", member=s, now=NOW)
    assert [y["year"] for y in payload["years"]] == [2025]
    assert [m["name"] for m in payload["members"]] == ["松田 好花"]


@pytest.mark.asyncio
async def test_a_month_day_with_nothing_and_no_future_years(out):
    payload = await dv.day_years(SERVICE, out, "02-29", member=None, now=NOW)
    assert payload == {"month_day": "02-29", "members": [], "years": []}
    early = datetime(2026, 10, 31, 3, 0, tzinfo=timezone.utc)  # before 2026-11-01
    payload = await dv.day_years(SERVICE, out, "11-01", member=None, now=early)
    assert [y["year"] for y in payload["years"]] == [2024, 2025]


def test_message_kind_is_one_rule_for_both_features():
    from backend.services.memories.facts import message_kind
    from backend.tests.test_memories_cards import fact

    assert message_kind(fact(1, "2025-01-01 07:00", greet=("ohayo",))) == "ohayo"
    # a quoted おはよう at night is no morning greeting
    assert message_kind(fact(1, "2025-01-01 22:00", greet=("ohayo",))) is None
    assert message_kind(fact(1, "2025-01-01 23:00", greet=("oyasumi",))) == "oyasumi"
    both = ("ohayo", "oyasumi")
    assert message_kind(fact(1, "2025-01-01 09:00", greet=both)) == "ohayo"
    assert message_kind(fact(1, "2025-01-01 21:00", greet=both)) == "oyasumi"
    qa = dataclasses.replace(
        fact(1, "2025-01-01 23:00", greet=("oyasumi",)), is_qa=True
    )
    assert message_kind(qa) is None
    assert message_kind(fact(1, "2025-01-01 21:00", "picture")) == "photo"
    assert message_kind(fact(1, "2025-01-01 21:00", "video")) == "video"
    assert message_kind(fact(1, "2025-01-01 21:00", "voice")) == "voice"
    assert message_kind(fact(1, "2025-01-01 21:00")) is None


# --- route ----------------------------------------------------------------------------


@pytest.fixture
def api(out):
    with patch("backend.api.memories.get_output_dir", return_value=out.parent):
        yield out


def get(url, **params):
    with time_machine.travel(NOW, tick=False):
        return client.get(url, params=params)


def test_route_returns_the_years(api):
    r = get(f"/api/memories/{SERVICE}/day/years", month_day="11-01")
    assert r.status_code == 200
    assert [y["year"] for y in r.json()["years"]] == [2024, 2025, 2026]
    r = get(
        f"/api/memories/{SERVICE}/day/years",
        month_day="11-01",
        member=f"{SVC_NAME}/{MATSU}",
    )
    assert [y["year"] for y in r.json()["years"]] == [2025]


@pytest.mark.parametrize("bad", ["2025-11-01", "13-01", "02-30", "1-1", ""])
def test_route_rejects_a_bad_month_day(api, bad):
    assert get(f"/api/memories/{SERVICE}/day/years", month_day=bad).status_code == 400


def test_route_errors(api):
    assert get(f"/api/memories/{SERVICE}/day/years").status_code == 422
    assert get("/api/memories/nope/day/years", month_day="11-01").status_code == 400
    r = get(
        f"/api/memories/{SERVICE}/day/years",
        month_day="11-01",
        member=f"{SVC_NAME}/messages/99 x/98 x",
    )
    assert r.status_code == 404
