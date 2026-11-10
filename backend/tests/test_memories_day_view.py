"""那一天 day view (``backend/services/memories/day_view.py``)."""

from __future__ import annotations

import json
from datetime import date, datetime, timezone

import pytest
from structlog.testing import capture_logs

from backend.services import service_utils
from backend.services.memories import day_view as dv
from backend.services.memories import index as mi
from backend.services.memories import oshi as oshi_mod
from backend.services.memories import people
from backend.tests.memories_archive import msg, write_room

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
SAKU = "sakurazaka46"
SAKU_NAME = "櫻坂46"
NOGI = "nogizaka46"
NOGI_NAME = "乃木坂46"
KANE = "messages/34 金村 美玖/58 金村 美玖"
MATSU = "messages/40 松田 好花/64 松田 好花"
NOW = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)
DAY = date(2024, 9, 14)
K_MORNING = "おはよう、今日は撮影です"
K_CAPTION = "見て見て、海がきれい"
M_NOON = "お昼ごはん食べたよ"
SAKU_WORDS = "櫻坂の部屋の言葉"
ICONS = [
    {
        "kind": "thumbnail",
        "file": "thumbnail/a.jpg",
        "first_seen": "2024-01-01T00:00:00Z",
    },
    {
        "kind": "thumbnail",
        "file": "thumbnail/b.jpg",
        "first_seen": "2024-09-14T02:00:00Z",
    },
]


@pytest.fixture
def out(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    root = tmp_path / "out"
    hina = root / SVC_NAME
    write_room(
        hina,
        "34 金村 美玖",
        "58 金村 美玖",
        [
            msg(1, "2024-09-13T23:00:00Z", content=K_MORNING),  # 08:00 JST 9/14
            msg(2, "2024-09-14T03:00:00Z", content=K_CAPTION),
            msg(
                3,
                "2024-09-14T03:01:00Z",
                "picture",
                media_file="messages\\34 金村 美玖\\58 金村 美玖\\picture\\3.jpg",
            ),
            msg(4, "2024-09-14T16:00:00Z", content="翌日"),  # 9/15 JST
        ],
        avatars=ICONS,
    )
    write_room(
        hina,
        "40 松田 好花",
        "64 松田 好花",
        [
            msg(1, "2024-09-14T02:00:00Z", content=M_NOON),
            msg(2, "2024-09-14T03:00:00Z", content="同じ時刻"),  # ties: by id
        ],
    )
    # another service with the SAME relative room path and the same ids
    write_room(
        root / SAKU_NAME,
        "34 金村 美玖",
        "58 金村 美玖",
        [msg(1, "2024-09-14T01:00:00Z", content=SAKU_WORDS)],
    )
    write_room(
        root / NOGI_NAME,
        "1 誰か",
        "2 誰か",
        [msg(1, "2024-09-14T01:00:00Z", content="乃木坂")],
    )
    monkeypatch.setattr(
        service_utils, "get_all_services", lambda: [SERVICE, NOGI, SAKU, "yodel"]
    )

    async def fake_oshi(service):
        return {"松田好花"} if service == SERVICE else set()

    monkeypatch.setattr(oshi_mod, "oshi_names", fake_oshi)
    return root


async def person(sdir, room):
    return next(s for s in await mi.list_members(sdir) if room in s.member_dirs)


def ids(payload):
    return [(m["service"], m["room"], m["id"]) for m in payload["messages"]]


@pytest.mark.asyncio
async def test_merges_every_person_in_time_order(out):
    hina = out / SVC_NAME
    payload = await dv.day_view(
        SERVICE, hina, DAY, member=None, include_other_services=False, now=NOW
    )
    assert payload["date"] == "2024-09-14"
    assert ids(payload) == [
        (SERVICE, KANE, 1),
        (SERVICE, MATSU, 1),
        (SERVICE, KANE, 2),
        (SERVICE, MATSU, 2),
        (SERVICE, KANE, 3),
    ]
    assert payload["other_services"] == []
    by = {(m["room"], m["id"]): m for m in payload["messages"]}
    assert by[(KANE, 1)]["text"] == K_MORNING
    assert by[(KANE, 3)]["caption"] == K_CAPTION  # caption attached
    assert by[(KANE, 3)]["text"] is None
    assert by[(KANE, 3)]["media_file"] == f"{KANE}/picture/3.jpg"
    assert by[(KANE, 1)]["avatar_url"].endswith("thumbnail/a.jpg")
    assert by[(KANE, 2)]["avatar_url"].endswith("thumbnail/b.jpg")
    # oshi first, avatar at that date (her first message of the day)
    members = payload["members"]
    assert [m["member_path"] for m in members] == [
        f"{SVC_NAME}/{MATSU}",
        f"{SVC_NAME}/{KANE}",
    ]
    assert members[0]["oshi"] is True and members[1]["oshi"] is False
    assert members[0]["member_id"] == "64" and members[0]["service"] == SERVICE
    assert members[0]["name"] and members[0]["avatar_url"] is None
    assert members[1]["avatar_url"].endswith("thumbnail/a.jpg")
    assert str(out) not in json.dumps(payload, ensure_ascii=False)


@pytest.mark.asyncio
async def test_member_filter_ignores_other_services(out):
    hina = out / SVC_NAME
    kane = await person(hina, KANE)
    payload = await dv.day_view(
        SERVICE, hina, DAY, member=kane, include_other_services=True, now=NOW
    )
    assert ids(payload) == [(SERVICE, KANE, 1), (SERVICE, KANE, 2), (SERVICE, KANE, 3)]
    assert [m["member_path"] for m in payload["members"]] == [f"{SVC_NAME}/{KANE}"]
    assert payload["other_services"] == []


@pytest.mark.asyncio
async def test_other_services_included_with_their_own_texts(out, monkeypatch):
    real = people.service_facts_on

    async def broken_nogi(sdir, summaries, **kw):
        if sdir.name == NOGI_NAME:
            raise OSError("disk gone")
        return await real(sdir, summaries, **kw)

    monkeypatch.setattr(people, "service_facts_on", broken_nogi)
    hina = out / SVC_NAME
    with capture_logs() as logs:
        payload = await dv.day_view(
            SERVICE, hina, DAY, member=None, include_other_services=True, now=NOW
        )
    assert payload["other_services"] == [SAKU]
    assert ids(payload)[:2] == [(SERVICE, KANE, 1), (SAKU, KANE, 1)]
    by = {(m["service"], m["room"], m["id"]): m for m in payload["messages"]}
    # same relative room path and id in two services: each keeps its own words
    assert by[(SAKU, KANE, 1)]["text"] == SAKU_WORDS
    assert by[(SERVICE, KANE, 1)]["text"] == K_MORNING
    assert by[(SAKU, KANE, 1)]["member_path"] == f"{SAKU_NAME}/{KANE}"
    saku_member = next(m for m in payload["members"] if m["service"] == SAKU)
    assert saku_member["member_path"] == f"{SAKU_NAME}/{KANE}"
    assert payload["members"][0]["oshi"] is True  # oshi first across services
    (skip,) = [e for e in logs if e["event"] == "memories_skip"]
    assert skip["view"] == "day" and skip["reason"] == "other_service_failed"
    assert skip["error_type"] == "OSError" and skip["service"] == NOGI
    (ev,) = [e for e in logs if e["event"] == "memories_day"]
    assert ev["others"] is True and ev["services"] == 2
    assert ev["count"] == 6 and ev["members"] == 3


@pytest.mark.asyncio
async def test_other_service_without_data_that_day_is_not_listed(out):
    hina = out / SVC_NAME
    payload = await dv.day_view(
        SERVICE,
        hina,
        date(2024, 9, 13),
        member=None,
        include_other_services=True,
        now=NOW,
    )
    assert payload["messages"] == [] and payload["members"] == []
    assert payload["other_services"] == []


@pytest.mark.asyncio
async def test_failure_while_loading_other_texts_is_skipped(out, monkeypatch):
    real = people.attach_texts

    async def broken(sdir, refs):
        if sdir.name == SAKU_NAME:
            raise ValueError("bad json")
        await real(sdir, refs)

    monkeypatch.setattr(people, "attach_texts", broken)
    hina = out / SVC_NAME
    with capture_logs() as logs:
        payload = await dv.day_view(
            SERVICE, hina, DAY, member=None, include_other_services=True, now=NOW
        )
    assert payload["other_services"] == [NOGI]
    assert {m["service"] for m in payload["messages"]} == {SERVICE, NOGI}
    reasons = [e["reason"] for e in logs if e["event"] == "memories_skip"]
    assert reasons == ["other_service_failed"]


@pytest.mark.asyncio
async def test_logs_carry_no_text_or_names(out):
    hina = out / SVC_NAME
    with capture_logs() as logs:
        await dv.day_view(
            SERVICE, hina, DAY, member=None, include_other_services=True, now=NOW
        )
    blob = json.dumps([dict(e) for e in logs], ensure_ascii=False, default=str)
    for needle in (
        K_MORNING,
        K_CAPTION,
        M_NOON,
        SAKU_WORDS,
        "金村",
        "松田",
        "誰か",
        "messages/",
        str(out),
    ):
        assert needle not in blob
