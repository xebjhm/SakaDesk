"""Memories notification scheduler (``backend/services/memories/notify_scheduler.py``).

``tick()`` is driven directly with an injected clock (``time_machine`` with
``tick=False``), a recording ``send``, a fake ``load_settings`` and a synthetic
archive in a tmp output dir. The loop tests use a fake ``sleep`` that records
the waits and moves the travelled clock.
"""

from __future__ import annotations

import asyncio
import re
from contextlib import closing
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
import time_machine
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.services import app_state, settings_store, shutdown_state
from backend.services.memories import index as mi
from backend.services.memories import notify_content as nc
from backend.services.memories import notify_scheduler as ns
from backend.services.memories import oshi as oshi_mod
from backend.services.memories import people, recap
from backend.tests.memories_archive import msg, write_room, write_side_inputs

HINATA = "hinatazaka46"
HINATA_NAME = "日向坂46"
KANE = "messages/34 金村 美玖/58 金村 美玖"
MATSU = "messages/40 松田 好花/64 松田 好花"
NAMES = ("金村", "松田", "美玖", "好花")
WORDS = "ありがとう、またね"
JST = ZoneInfo("Asia/Tokyo")
CODE_RE = re.compile(r"^(\*|[a-z0-9_:.\-]{0,64})$")


def jst(y, mo, d, h=0, mi_=0, s=0):
    return datetime(y, mo, d, h, mi_, s, tzinfo=JST).astimezone(timezone.utc)


NOON = jst(2026, 11, 10, 12)


# --- fixtures ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def safe_logs():
    """Across every test: scheduler events carry ids, codes and counts only."""
    with capture_logs() as logs:
        yield logs
    for event in logs:
        name = event["event"]
        if not name.startswith(("memories_notify", "memories_card")):
            continue
        for key, value in event.items():
            if key in ("event", "log_level") or value is None:
                continue
            if isinstance(value, (bool, int, float)):
                continue
            assert isinstance(value, str), (name, key)
            if key == "error_type":
                assert re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", value)
                continue
            assert CODE_RE.match(value), (name, key, value)
            for bad in NAMES:
                assert bad not in value


@pytest.fixture(autouse=True)
def _reset_shutdown():
    shutdown_state.reset_for_tests()
    yield
    shutdown_state.reset_for_tests()
    ns._active = None


@pytest.fixture
def out(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    app_state.set_db_path(tmp_path / "app.db")
    app_state.init_db()
    root = tmp_path / "out"
    monkeypatch.setattr(people, "output_dir", lambda: root)

    async def oshi(service):
        return {"金村美玖"} if service == HINATA else set()

    monkeypatch.setattr(oshi_mod, "oshi_names", oshi)
    return root


@pytest.fixture
def svc(out):
    sdir = out / HINATA_NAME
    room(sdir, KANE, [msg(1, "2023-11-10T03:00:00Z", content=WORDS)])
    return sdir


def room(sdir, path, msgs):
    _, gid_group, mid_name = path.split("/")
    return write_room(sdir, gid_group, mid_name, msgs)


class Clock:
    """A travelled clock: ``now()`` is the travelled instant, ``move`` sets it."""

    def __init__(self, traveller):
        self._t = traveller

    def now(self):
        return datetime.now(timezone.utc)

    def move(self, when):
        self._t.move_to(when)


@pytest.fixture
def clock():
    with time_machine.travel(NOON, tick=False) as t:
        yield Clock(t)


class Harness:
    def __init__(self, clock, **settings):
        self.clock = clock
        self.settings = {**settings_store._SETTINGS_DEFAULTS, **settings}
        self.sent: list = []
        self.in_memories = False
        self.send_result = True

    async def load(self):
        return dict(self.settings)

    async def send(self, plan):
        self.sent.append(plan)
        return self.send_result

    def make(self, services=(HINATA,), **kw):
        kw.setdefault("clock", self.clock.now)
        kw.setdefault("load_settings", self.load)
        kw.setdefault("send", self.send)
        kw.setdefault("in_memories", lambda: self.in_memories)
        return ns.MemoriesNotifyScheduler(list(services), **kw)


@pytest.fixture
def h(clock, svc):
    return Harness(clock)


def rows():
    with closing(app_state._connect()) as c:
        return {
            (k, s, sub, occ): outcome
            for k, s, sub, occ, outcome in c.execute(
                "SELECT kind, service, subject, occasion, outcome "
                "FROM memories_notify_log"
            )
        }


def skips(logs, reason):
    return [
        e
        for e in logs
        if e["event"] == "memories_notify_skip" and e.get("reason") == reason
    ]


def kinds(plans):
    return [p.kind for p in plans]


# --- On This Day: the slot, the ledger, catch-up ------------------------------------------


@pytest.mark.asyncio
async def test_on_this_day_fires_at_the_slot_once(h):
    s = h.make()
    h.clock.move(jst(2026, 11, 10, 11, 59, 59))
    r = await s.tick()
    assert h.sent == [] and r.sent == 0
    h.clock.move(NOON)
    r = await s.tick()
    assert kinds(h.sent) == ["on_this_day"] and r.sent == 1 and r.due == 1
    assert rows()[("on_this_day", "*", "", "2026-11-10")] == "sent"
    h.clock.move(jst(2026, 11, 10, 12, 15))
    await s.tick()
    assert len(h.sent) == 1


@pytest.mark.asyncio
async def test_next_in_s_points_at_the_slot(h):
    h.clock.move(jst(2026, 11, 10, 11, 59))
    r = await h.make().tick()
    assert r.next_in_s == 60


@pytest.mark.asyncio
async def test_restart_the_same_day_sends_nothing(h, safe_logs):
    await h.make().tick()
    assert len(h.sent) == 1
    h.clock.move(jst(2026, 11, 10, 15))
    await h.make().tick()  # a new instance on the same DB
    assert len(h.sent) == 1
    assert any(e["kind"] == "on_this_day" for e in skips(safe_logs, "already_done"))


@pytest.mark.asyncio
async def test_missed_slot_catches_up_the_same_day_only(h):
    h.clock.move(jst(2026, 11, 11, 9))
    await h.make().tick()
    assert h.sent == []  # 11-10 is gone; 11-11's slot is ahead
    assert rows() == {}
    h.clock.move(jst(2026, 11, 10, 18))
    await h.make().tick()
    assert kinds(h.sent) == ["on_this_day"]
    assert h.sent[0].occasion == "2026-11-10"


@pytest.mark.asyncio
async def test_no_moment_today_records_empty(h, safe_logs):
    h.clock.move(jst(2026, 11, 11, 12))
    await h.make().tick()
    assert h.sent == []
    assert rows() == {("on_this_day", "*", "", "2026-11-11"): "empty"}
    assert skips(safe_logs, "empty")


@pytest.mark.asyncio
async def test_slot_setting_moves_the_fire(h):
    h.settings["memories_notify_time"] = "18:00"
    s = h.make()
    await s.tick()
    assert h.sent == []
    h.clock.move(jst(2026, 11, 10, 18))
    await s.tick()
    assert kinds(h.sent) == ["on_this_day"]


@pytest.mark.asyncio
async def test_local_zone_does_not_move_the_jst_slot(out, svc):
    """Machine in New York across its DST end (11-01 02:00 local): 12:00 JST
    is 03:00 UTC on both sides."""
    ny = ZoneInfo("America/New_York")
    room(
        svc,
        MATSU,
        [
            msg(1, "2024-11-01T03:00:00Z", content=WORDS),
            msg(2, "2024-11-02T03:00:00Z", content=WORDS),
        ],
    )
    edt = datetime(2026, 10, 31, 22, 59, 59, tzinfo=ny)  # 11-01 02:59:59 UTC
    with time_machine.travel(edt, tick=False) as t:
        hh = Harness(Clock(t))
        s = hh.make()
        await s.tick()
        assert hh.sent == []
        t.move_to(datetime(2026, 10, 31, 23, 0, tzinfo=ny))  # EDT, 03:00 UTC
        await s.tick()
        assert [p.occasion for p in hh.sent] == ["2026-11-01"]
        t.move_to(datetime(2026, 11, 1, 21, 59, 59, tzinfo=ny))  # EST, 02:59:59 UTC
        await s.tick()
        assert len(hh.sent) == 1
        t.move_to(datetime(2026, 11, 1, 22, 0, tzinfo=ny))  # EST, 03:00 UTC
        assert datetime.now(timezone.utc).hour == 3
        await s.tick()
        assert [p.occasion for p in hh.sent] == ["2026-11-01", "2026-11-02"]


# --- birthdays ----------------------------------------------------------------------------


@pytest.fixture
def bday(out, clock):
    sdir = out / HINATA_NAME
    room(sdir, KANE, [msg(1, "2023-01-05T03:00:00Z", content=WORDS)])
    write_side_inputs(sdir, birthdays={"金村美玖": "2002-09-10"})
    return Harness(clock, memories_notify_on_this_day=False)


@pytest.mark.asyncio
async def test_birthday_fires_at_midnight_jst(bday):
    s = bday.make()
    bday.clock.move(jst(2026, 9, 9, 12))
    await s.tick()
    assert kinds(bday.sent) == ["birthday_soon"]  # the 1-day reminder
    assert bday.sent[0].occasion == "2026-09-10:1"
    bday.clock.move(jst(2026, 9, 9, 23, 59, 59))
    await s.tick()
    assert len(bday.sent) == 1
    bday.clock.move(jst(2026, 9, 10))
    await s.tick()
    assert kinds(bday.sent) == ["birthday_soon", "birthday"]
    assert rows()[("birthday", HINATA, "58", "2026-09-10")] == "sent"


@pytest.mark.asyncio
async def test_leap_day_birthday_falls_on_feb_28(out, clock):
    sdir = out / HINATA_NAME
    room(sdir, KANE, [msg(1, "2023-01-05T03:00:00Z", content=WORDS)])
    write_side_inputs(sdir, birthdays={"金村美玖": "2004-02-29"})
    hh = Harness(clock, memories_notify_on_this_day=False)
    hh.clock.move(jst(2027, 2, 28))
    await hh.make().tick()
    assert kinds(hh.sent) == ["birthday"]
    hh.clock.move(jst(2027, 3, 1, 12))
    await hh.make().tick()
    assert len(hh.sent) == 1


@pytest.mark.asyncio
async def test_graduated_birthday_is_recorded_skipped(out, clock, safe_logs):
    sdir = out / HINATA_NAME
    room(sdir, MATSU, [msg(1, "2023-01-05T03:00:00Z", content=WORDS)])
    write_side_inputs(sdir, birthdays={"松田好花": "1999-04-27"}, closed_groups=["40"])
    hh = Harness(clock, memories_notify_on_this_day=False)
    hh.clock.move(jst(2026, 4, 27))
    await hh.make().tick()
    assert hh.sent == []
    assert rows() == {("birthday", HINATA, "64", "2026-04-27"): "skipped"}
    await hh.make().tick()
    assert len(skips(safe_logs, "graduated")) == 1  # not re-logged every tick


@pytest.mark.asyncio
async def test_bad_birthday_is_logged_once(out, clock, safe_logs):
    sdir = out / HINATA_NAME
    room(sdir, KANE, [msg(1, "2023-01-05T03:00:00Z", content=WORDS)])
    write_side_inputs(sdir, birthdays={"金村美玖": "not-a-date"})
    hh = Harness(clock, memories_notify_on_this_day=False)
    s = hh.make()
    await s.tick()
    await s.tick()
    assert [e["member_id"] for e in skips(safe_logs, "bad_birthday")] == ["58"]


# --- anniversaries --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_anniversary_coalesces_and_claims_every_member(out, clock):
    sdir = out / HINATA_NAME
    room(sdir, KANE, [msg(1, "2024-01-05T03:00:00Z", content=WORDS)])
    room(sdir, MATSU, [msg(1, "2024-01-05T03:00:00Z", content=WORDS)])
    write_side_inputs(sdir, sub_starts={"34": "2025-11-10", "40": "2025-11-10"})
    hh = Harness(clock, memories_notify_on_this_day=False)
    await hh.make().tick()
    assert kinds(hh.sent) == ["anniversary"]
    got = rows()
    assert got[("anniversary", HINATA, "58", "y1@2026-11-10")] == "sent"
    assert got[("anniversary", HINATA, "64", "y1@2026-11-10")] == "sent"
    hh.clock.move(jst(2026, 11, 10, 13))
    await hh.make().tick()
    assert len(hh.sent) == 1


# --- recap ---------------------------------------------------------------------------------


def stub_recap_years(monkeypatch, years):
    async def fake(sdir, *, now):
        return list(years)

    monkeypatch.setattr(recap, "recap_years", fake)


@pytest.mark.asyncio
async def test_recap_ready_on_first_launch_in_january(h, monkeypatch):
    stub_recap_years(monkeypatch, [2026])
    h.settings["memories_notify_on_this_day"] = False
    h.clock.move(jst(2027, 1, 9, 8))
    await h.make().tick()
    assert [(p.kind, p.subject, p.occasion) for p in h.sent] == [
        ("recap", "ready", "2026")
    ]
    h.clock.move(jst(2027, 1, 20, 8))
    await h.make().tick()
    h.clock.move(jst(2027, 2, 1, 12))
    await h.make().tick()
    assert len(h.sent) == 1


@pytest.mark.asyncio
async def test_recap_open_only_with_a_recap(h, monkeypatch):
    h.settings["memories_notify_on_this_day"] = False
    stub_recap_years(monkeypatch, [2025])
    h.clock.move(jst(2026, 12, 1, 12))
    await h.make().tick()
    assert h.sent == []
    assert rows() == {("recap", HINATA, "open", "2026"): "no_recap"}


@pytest.mark.asyncio
async def test_recap_open_sends_when_the_year_has_one(h, monkeypatch):
    h.settings["memories_notify_on_this_day"] = False
    stub_recap_years(monkeypatch, [2026])
    h.clock.move(jst(2026, 12, 1, 12))
    await h.make().tick()
    assert [(p.subject, p.occasion) for p in h.sent] == [("open", "2026")]


@pytest.mark.asyncio
async def test_christmas_waits_for_the_stub_then_sends(h, monkeypatch):
    h.settings["memories_notify_on_this_day"] = False
    stub_recap_years(monkeypatch, [2026])
    ready = {"v": False}

    async def christmas_ready(service, sdir, *, now):
        return ready["v"]

    monkeypatch.setattr(nc, "christmas_ready", christmas_ready)
    s = h.make()
    h.clock.move(jst(2026, 12, 25, 12))
    await s.tick()
    assert h.sent == [] and rows() == {}  # no ledger row: ask again
    ready["v"] = True
    h.clock.move(jst(2026, 12, 25, 19))
    await s.tick()
    assert [(p.subject, p.occasion) for p in h.sent] == [("christmas", "2026")]
    h.clock.move(jst(2026, 12, 26, 12))
    await s.tick()
    assert len(h.sent) == 1


# --- at-most-once ----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_concurrent_ticks_send_one_toast(h):
    s = h.make()
    await asyncio.gather(s.tick(), s.tick())
    assert len(h.sent) == 1


@pytest.mark.asyncio
async def test_failed_send_is_recorded_and_never_retried(h):
    h.send_result = False
    s = h.make()
    await s.tick()
    assert rows()[("on_this_day", "*", "", "2026-11-10")] == "failed"
    h.send_result = True
    h.clock.move(jst(2026, 11, 10, 12, 15))
    await s.tick()
    assert len(h.sent) == 1


@pytest.mark.asyncio
async def test_raising_send_is_failed(h, safe_logs):
    async def boom(plan):
        raise RuntimeError("toast")

    await h.make(send=boom).tick()
    assert rows()[("on_this_day", "*", "", "2026-11-10")] == "failed"
    assert any(
        e["event"] == "memories_notify_failed" and e["stage"] == "send"
        for e in safe_logs
    )


@pytest.mark.asyncio
async def test_cancelled_send_leaves_pending_and_never_resends(h):
    async def cancelled(plan):
        raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        await h.make(send=cancelled).tick()
    assert rows()[("on_this_day", "*", "", "2026-11-10")] == "pending"
    h.clock.move(jst(2026, 11, 10, 12, 15))
    await h.make().tick()
    assert h.sent == []


# --- settings ------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_notifications_off_records_nothing_then_on_sends(h, safe_logs):
    h.settings["notifications_enabled"] = False
    s = h.make()
    await s.tick()
    assert h.sent == [] and rows() == {}
    assert skips(safe_logs, "notifications_off")[0]["count"] == 1
    h.settings["notifications_enabled"] = True
    h.clock.move(jst(2026, 11, 10, 13))
    await s.tick()
    assert kinds(h.sent) == ["on_this_day"]


@pytest.mark.asyncio
async def test_kind_off_records_nothing_then_on_sends(h, safe_logs):
    h.settings["memories_notify_on_this_day"] = False
    s = h.make()
    await s.tick()
    assert h.sent == [] and rows() == {}
    off = skips(safe_logs, "kind_off")
    assert off[0]["kind"] == "on_this_day" and off[0]["count"] == 1
    h.settings["memories_notify_on_this_day"] = True
    h.clock.move(jst(2026, 11, 10, 13))
    await s.tick()
    assert kinds(h.sent) == ["on_this_day"]


@pytest.mark.asyncio
async def test_off_and_kind_off_skips_are_debug(h, safe_logs):
    h.settings["memories_notify_on_this_day"] = False
    await h.make().tick()
    h.settings["notifications_enabled"] = False
    await h.make().tick()
    quiet = skips(safe_logs, "kind_off") + skips(safe_logs, "notifications_off")
    assert len(quiet) == 2 and {e["log_level"] for e in quiet} == {"debug"}


@pytest.mark.asyncio
async def test_due_counts_only_occasions_still_owed(h):
    assert (await h.make().tick()).due == 1
    h.clock.move(jst(2026, 11, 10, 13))
    r = await h.make().tick()
    assert r.due == 0 and r.sent == 0


# --- in Memories -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_in_memories_suppresses_and_never_resends(h, safe_logs):
    h.in_memories = True
    s = h.make()
    r = await s.tick()
    assert h.sent == [] and r.suppressed == 1
    assert rows()[("on_this_day", "*", "", "2026-11-10")] == "suppressed"
    assert skips(safe_logs, "in_memories")
    h.in_memories = False
    h.clock.move(jst(2026, 11, 10, 12, 15))
    await s.tick()
    assert h.sent == []


# --- cards -----------------------------------------------------------------------------------


KANE_DAYS = [
    msg(1, "2024-11-10T03:00:00Z", content=WORDS),
    msg(2, "2025-06-01T03:00:00Z", content=WORDS),
]


@pytest.fixture
def cards(out, clock):
    sdir = out / HINATA_NAME
    room(sdir, KANE, KANE_DAYS)
    hh = Harness(clock, memories_notify_cards=True, memories_notify_on_this_day=False)
    return hh, sdir


@pytest.mark.asyncio
async def test_first_tick_seeds_cards_then_a_new_foil_card_notifies(cards, safe_logs):
    hh, sdir = cards
    s = hh.make()
    await s.tick()  # first tick: every service is checked, silently seeded
    assert hh.sent == []
    assert app_state.get_card_baseline(HINATA, "58") is not None
    check = [e for e in safe_logs if e["event"] == "memories_card_check"]
    assert check[0]["seeded"] == 1 and check[0]["service"] == HINATA
    # a midnight message arrives with a sync
    room(sdir, KANE, [*KANE_DAYS, msg(3, "2026-11-09T15:03:00Z", content=WORDS)])
    s.request_card_check(HINATA)
    hh.clock.move(NOON + timedelta(seconds=ns.CARD_CHECK_DELAY_S - 1))
    r = await s.tick()
    assert hh.sent == []  # too early: the index builds first
    assert r.next_in_s == 1
    hh.clock.move(NOON + timedelta(seconds=ns.CARD_CHECK_DELAY_S))
    await s.tick()
    assert kinds(hh.sent) == ["card"]
    assert rows()[("card", HINATA, "58", "moment.midnight")] == "sent"
    assert s._card_pending == {}


@pytest.mark.asyncio
async def test_card_baseline_never_shrinks(cards, monkeypatch):
    hh, sdir = cards
    s = hh.make()
    await s.tick()
    before, _ = app_state.get_card_baseline(HINATA, "58")
    from backend.services.memories import binder

    async def only_first(*args, **kwargs):
        return [c for c in await real(*args, **kwargs) if c.key == "first.message"]

    real = binder.evaluate_person
    monkeypatch.setattr(binder, "evaluate_person", only_first)
    room(sdir, KANE, [*KANE_DAYS, msg(3, "2026-11-01T03:00:00Z", content=WORDS)])
    s.request_card_check(HINATA)
    hh.clock.move(NOON + timedelta(seconds=ns.CARD_CHECK_DELAY_S))
    await s.tick()
    after, _ = app_state.get_card_baseline(HINATA, "58")
    assert before <= after and len(before) > 1


@pytest.mark.asyncio
async def test_card_check_for_a_service_without_data_clears_the_mark(cards):
    hh, _ = cards
    s = hh.make(services=(HINATA, "sakurazaka46"))
    await s.tick()
    s.request_card_check("sakurazaka46")
    hh.clock.move(NOON + timedelta(seconds=ns.CARD_CHECK_DELAY_S))
    await s.tick()
    assert s._card_pending == {}


@pytest.mark.asyncio
async def test_card_toast_suppressed_in_memories(cards):
    hh, sdir = cards
    s = hh.make()
    await s.tick()
    room(sdir, KANE, [*KANE_DAYS, msg(3, "2026-11-09T15:03:00Z", content=WORDS)])
    s.request_card_check(HINATA)
    hh.in_memories = True
    hh.clock.move(NOON + timedelta(seconds=ns.CARD_CHECK_DELAY_S))
    await s.tick()
    assert hh.sent == []
    assert rows()[("card", HINATA, "58", "moment.midnight")] == "suppressed"


# --- services ----------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unknown_service_is_skipped(h, safe_logs):
    await h.make(services=("nope", HINATA)).tick()
    assert kinds(h.sent) == ["on_this_day"]
    assert any(e["service"] == "nope" for e in skips(safe_logs, "unavailable"))


# --- shutdown --------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tick_after_begin_shutdown_does_nothing(h, safe_logs):
    shutdown_state.begin_shutdown()
    await h.make().tick()
    assert h.sent == [] and rows() == {}
    assert skips(safe_logs, "shutting_down")


@pytest.mark.asyncio
async def test_shutdown_between_units_stops_delivery(out, clock, monkeypatch):
    sdir = out / HINATA_NAME
    room(sdir, KANE, [msg(1, "2023-11-10T03:00:00Z", content=WORDS)])
    write_side_inputs(sdir, birthdays={"金村美玖": "2002-11-11"})
    hh = Harness(clock)

    async def send_then_shutdown(plan):
        hh.sent.append(plan)
        shutdown_state.begin_shutdown()
        return True

    await hh.make(send=send_then_shutdown).tick()
    # birthday_soon is delivered before on_this_day; on_this_day never claimed
    assert kinds(hh.sent) == ["birthday_soon"]
    assert ("on_this_day", "*", "", "2026-11-10") not in rows()


@pytest.mark.asyncio
async def test_shutdown_while_building_stops(h, monkeypatch):
    s = h.make()
    real = mi.list_members

    async def listing(sdir):
        shutdown_state.begin_shutdown()
        return await real(sdir)

    monkeypatch.setattr(mi, "list_members", listing)
    await s.tick()
    assert h.sent == [] and rows() == {}


@pytest.mark.asyncio
async def test_shutdown_before_empty_claim_writes_nothing(h, monkeypatch):
    h.clock.move(jst(2026, 11, 11, 12))
    s = h.make()

    async def none_and_stop(ctx, services, occasion):
        shutdown_state.begin_shutdown()
        return None

    monkeypatch.setattr(nc, "on_this_day_plan", none_and_stop)
    await s.tick()
    assert rows() == {}


@pytest.mark.asyncio
async def test_shutdown_before_skip_claim_writes_nothing(out, clock, monkeypatch):
    sdir = out / HINATA_NAME
    room(sdir, MATSU, [msg(1, "2023-01-05T03:00:00Z", content=WORDS)])
    write_side_inputs(sdir, birthdays={"松田好花": "1999-04-27"}, closed_groups=["40"])
    hh = Harness(clock, memories_notify_on_this_day=False)
    hh.clock.move(jst(2026, 4, 27))
    real = nc.birthday_plans

    async def plans_then_stop(*args):
        got = await real(*args)
        shutdown_state.begin_shutdown()
        return got

    monkeypatch.setattr(nc, "birthday_plans", plans_then_stop)
    await hh.make().tick()
    assert rows() == {}


@pytest.mark.asyncio
async def test_shutdown_before_card_check_stops(cards):
    hh, _ = cards
    s = hh.make()
    shutdown_state.begin_shutdown()
    await s.tick()
    assert app_state.get_card_baseline(HINATA, "58") is None


# --- the loop ----------------------------------------------------------------------------------


class FakeSleep:
    """Records waits and moves the travelled clock; blocks after ``limit`` calls."""

    def __init__(self, clock, limit):
        self.clock = clock
        self.limit = limit
        self.waits: list[float] = []
        self.reached = asyncio.Event()

    async def __call__(self, seconds):
        self.waits.append(seconds)
        if len(self.waits) >= self.limit:
            self.reached.set()
            await asyncio.Event().wait()
        self.clock.move(self.clock.now() + timedelta(seconds=seconds))


@pytest.mark.asyncio
async def test_loop_waits_startup_prunes_ticks_and_stops(h, monkeypatch):
    pruned = []
    real_prune = app_state.aprune_memory_notifications

    async def prune(before):
        pruned.append(before)
        return await real_prune(before)

    monkeypatch.setattr(app_state, "aprune_memory_notifications", prune)
    h.clock.move(jst(2026, 11, 10, 11, 58))
    sleep = FakeSleep(h.clock, limit=3)
    s = h.make(sleep=sleep)
    s.start()
    s.start()  # idempotent
    assert ns._active is s
    await asyncio.wait_for(sleep.reached.wait(), 5)
    assert sleep.waits[0] == ns.STARTUP_DELAY_S
    assert sleep.waits[1] == 60  # 11:59 -> slot at 12:00
    assert kinds(h.sent) == ["on_this_day"]  # ticked at 12:00
    assert len(pruned) == 1
    assert pruned[0] == jst(2026, 11, 10, 11, 59) - ns.PRUNE_AFTER
    await s.stop()
    await s.stop()  # idempotent
    assert ns._active is None


@pytest.mark.asyncio
async def test_loop_survives_a_failing_tick_and_prune(h, monkeypatch, safe_logs):
    async def boom(*args, **kwargs):
        raise RuntimeError("x")

    monkeypatch.setattr(app_state, "aprune_memory_notifications", boom)
    sleep = FakeSleep(h.clock, limit=3)
    s = h.make(sleep=sleep, load_settings=boom)
    s.start()
    await asyncio.wait_for(sleep.reached.wait(), 5)
    await s.stop()
    stages = {e["stage"] for e in safe_logs if e["event"] == "memories_notify_failed"}
    assert stages == {"tick", "prune"}
    assert sleep.waits[1] == ns.RETRY_AFTER_FAILURE_S


@pytest.mark.asyncio
async def test_wake_ends_the_wait_and_reticks(h):
    sleep = FakeSleep(h.clock, limit=2)
    h.settings["memories_notify_on_this_day"] = False
    s = h.make(sleep=sleep)
    s.start()
    await asyncio.wait_for(sleep.reached.wait(), 5)
    ticks = []
    real = s.tick

    async def counted():
        ticks.append(1)
        return await real()

    s.tick = counted  # type: ignore[method-assign]
    sleep.limit = 99
    h.settings["memories_notify_on_this_day"] = True
    assert ns.memories_notify_settings_changed() is True
    for _ in range(200):
        if h.sent:
            break
        await asyncio.sleep(0.01)
    assert kinds(h.sent) == ["on_this_day"] and ticks
    await s.stop()


@pytest.mark.asyncio
async def test_stop_during_startup_wait_exits(h):
    sleep = FakeSleep(h.clock, limit=1)
    s = h.make(sleep=sleep)
    s.start()
    await asyncio.wait_for(sleep.reached.wait(), 5)
    await asyncio.wait_for(s.stop(), ns.STOP_TIMEOUT_S + 1)
    assert h.sent == []


@pytest.mark.asyncio
async def test_stop_while_send_hangs_returns_in_time(h, monkeypatch):
    monkeypatch.setattr(ns, "STOP_TIMEOUT_S", 0.2)
    started = asyncio.Event()

    async def hang(plan):
        started.set()
        await asyncio.Event().wait()

    async def no_wait(seconds):
        await asyncio.sleep(0)

    s = h.make(send=hang, sleep=no_wait)
    s.start()
    await asyncio.wait_for(started.wait(), 5)
    shutdown_state.begin_shutdown()
    before = rows()
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    await s.stop()
    assert loop.time() - t0 < ns.STOP_TIMEOUT_S + 1
    assert rows() == before  # no claim written after begin_shutdown()
    assert before[("on_this_day", "*", "", "2026-11-10")] == "pending"


@pytest.mark.asyncio
async def test_request_card_check_wakes_and_schedules(cards):
    hh, sdir = cards
    sleep = FakeSleep(hh.clock, limit=2)
    s = hh.make(sleep=sleep)
    s.start()
    await asyncio.wait_for(sleep.reached.wait(), 5)  # first tick seeded
    room(sdir, KANE, [*KANE_DAYS, msg(3, "2026-11-09T15:03:00Z", content=WORDS)])
    sleep.reached.clear()
    sleep.limit = 4
    ns.request_card_check(HINATA)
    await asyncio.wait_for(sleep.reached.wait(), 5)
    # woken -> re-tick (not due yet) -> waits CARD_CHECK_DELAY_S -> card toast
    assert ns.CARD_CHECK_DELAY_S in sleep.waits
    for _ in range(200):
        if hh.sent:
            break
        await asyncio.sleep(0.01)
    assert kinds(hh.sent) == ["card"]
    await s.stop()


def test_module_hooks_without_a_scheduler(safe_logs):
    ns._active = None
    assert ns.memories_notify_settings_changed() is False
    ns.request_card_check(HINATA)  # never raises
    woken = [e for e in safe_logs if e["event"] == "memories_notify_wake_requested"]
    assert woken[-1]["woken"] is False
    assert any(e["event"] == "memories_notify_card_check_ignored" for e in safe_logs)


def test_request_card_check_never_raises(monkeypatch, safe_logs):
    class Broken:
        def request_card_check(self, service):
            raise RuntimeError("x")

    monkeypatch.setattr(ns, "_active", Broken())
    ns.request_card_check(HINATA)
    assert any(
        e["event"] == "memories_notify_failed" and e["stage"] == "card_request"
        for e in safe_logs
    )


# --- lifespan ----------------------------------------------------------------------------------


def test_lifespan_skips_the_scheduler_under_pytest(tmp_path, monkeypatch):
    from backend.main import app

    with capture_logs() as logs:
        with TestClient(app):
            assert ns._active is None
    assert any(
        e["event"] == "memories_notify_skipped" and e["reason"] == "env" for e in logs
    )


def test_lifespan_starts_and_stops_the_scheduler(tmp_path, monkeypatch):
    from backend.main import app
    from backend.services import auto_sync_scheduler

    started, stopped = [], []

    class Fake:
        def __init__(self, services):
            self.services = list(services)

        def start(self):
            started.append(self.services)

        async def stop(self):
            stopped.append("memories")

    class FakeAuto(Fake):
        async def stop(self):
            stopped.append("auto_sync")

    import backend.main as main_mod

    real_quiesce = main_mod.quiesce_writers

    async def quiesce():
        stopped.append("quiesce_writers")
        await real_quiesce()

    monkeypatch.setattr(auto_sync_scheduler, "scheduler_allowed_in_env", lambda: True)
    monkeypatch.setattr(auto_sync_scheduler, "AutoSyncScheduler", FakeAuto)
    monkeypatch.setattr(ns, "MemoriesNotifyScheduler", Fake)
    monkeypatch.setattr(main_mod, "quiesce_writers", quiesce)
    with TestClient(app):
        pass
    assert HINATA in started[-1]
    assert stopped == ["auto_sync", "memories", "quiesce_writers"]


# --- edges -------------------------------------------------------------------------------------


def test_default_clock_is_aware_utc():
    s = ns.MemoriesNotifyScheduler([HINATA])
    assert s._clock().tzinfo is timezone.utc


@pytest.mark.asyncio
async def test_person_without_member_id_has_no_occasions(bday, monkeypatch):
    monkeypatch.setattr(people, "member_id", lambda summary: None)
    bday.clock.move(jst(2026, 9, 10))
    await bday.make().tick()
    assert bday.sent == [] and rows() == {}


@pytest.mark.asyncio
async def test_loop_exits_when_shutdown_begins_during_a_tick(h):
    async def send_then_shutdown(plan):
        h.sent.append(plan)
        shutdown_state.begin_shutdown()
        return True

    sleep = FakeSleep(h.clock, limit=99)
    s = h.make(send=send_then_shutdown, sleep=sleep)
    s.start()
    task = s._task
    assert task is not None
    await asyncio.wait_for(asyncio.shield(task), 5)  # exits on its own
    assert sleep.waits == [ns.STARTUP_DELAY_S]
    assert rows()[("on_this_day", "*", "", "2026-11-10")] == "sent"
    await s.stop()


# --- fix wave 1: error isolation ---------------------------------------------------------------


@pytest.fixture
def busy(out, clock):
    """11-10 at 12:00 JST: an On This Day moment and a 1-day birthday reminder."""
    sdir = out / HINATA_NAME
    room(sdir, KANE, [msg(1, "2023-11-10T03:00:00Z", content=WORDS)])
    write_side_inputs(sdir, birthdays={"金村美玖": "2002-11-11"})
    return Harness(clock)


def failures(logs, stage):
    return [
        (e.get("kind"), e.get("service"))
        for e in logs
        if e["event"] == "memories_notify_failed" and e["stage"] == stage
    ]


async def _boom(*args, **kwargs):
    raise RuntimeError("bad data")


@pytest.mark.asyncio
async def test_failing_birthday_builder_does_not_silence_on_this_day(
    busy, monkeypatch, safe_logs
):
    monkeypatch.setattr(nc, "birthday_plans", _boom)
    await busy.make().tick()
    assert kinds(busy.sent) == ["on_this_day"]
    assert failures(safe_logs, "build") == [("birthday", HINATA)]


@pytest.mark.asyncio
async def test_failing_on_this_day_builder_does_not_silence_birthdays(
    busy, monkeypatch, safe_logs
):
    monkeypatch.setattr(nc, "on_this_day_plan", _boom)
    await busy.make().tick()
    assert kinds(busy.sent) == ["birthday_soon"]
    assert failures(safe_logs, "build") == [("on_this_day", "*")]
    assert ("on_this_day", "*", "", "2026-11-10") not in rows()


@pytest.mark.asyncio
async def test_failing_recap_builder_does_not_silence_on_this_day(
    out, clock, monkeypatch, safe_logs
):
    sdir = out / HINATA_NAME
    room(sdir, KANE, [msg(1, "2025-12-01T03:00:00Z", content=WORDS)])
    monkeypatch.setattr(nc, "recap_plan", _boom)
    hh = Harness(clock)
    hh.clock.move(jst(2026, 12, 1, 12))
    await hh.make().tick()
    assert kinds(hh.sent) == ["on_this_day"]
    assert failures(safe_logs, "build") == [("recap", HINATA)]


@pytest.mark.asyncio
async def test_failing_anniversary_builder_does_not_silence_on_this_day(
    out, clock, monkeypatch, safe_logs
):
    sdir = out / HINATA_NAME
    room(sdir, KANE, [msg(1, "2023-11-10T03:00:00Z", content=WORDS)])
    write_side_inputs(sdir, sub_starts={"34": "2025-11-10"})
    monkeypatch.setattr(nc, "anniversary_plans", _boom)
    hh = Harness(clock)
    await hh.make().tick()
    assert kinds(hh.sent) == ["on_this_day"]
    assert failures(safe_logs, "build") == [("anniversary", HINATA)]


@pytest.mark.asyncio
async def test_failing_claim_does_not_drop_later_units(busy, monkeypatch, safe_logs):
    real = app_state.aclaim_memory_notification

    async def claim(kind, *rest, **kw):
        if kind == "birthday_soon":
            raise RuntimeError("locked")
        return await real(kind, *rest, **kw)

    monkeypatch.setattr(app_state, "aclaim_memory_notification", claim)
    await busy.make().tick()
    assert kinds(busy.sent) == ["on_this_day"]
    assert failures(safe_logs, "deliver") == [("birthday_soon", HINATA)]


@pytest.mark.asyncio
async def test_failing_card_check_does_not_silence_on_this_day(
    busy, monkeypatch, safe_logs
):
    busy.settings["memories_notify_cards"] = True
    monkeypatch.setattr(nc, "card_plans", _boom)
    s = busy.make()
    await s.tick()
    assert kinds(busy.sent) == ["birthday_soon", "on_this_day"]
    assert failures(safe_logs, "cards") == [("card", HINATA)]


@pytest.mark.asyncio
async def test_card_baseline_advances_only_after_the_claim(cards, monkeypatch):
    hh, sdir = cards
    s = hh.make()
    await s.tick()  # seed
    seeded, _ = app_state.get_card_baseline(HINATA, "58")
    room(sdir, KANE, [*KANE_DAYS, msg(3, "2026-11-09T15:03:00Z", content=WORDS)])
    real = app_state.aclaim_memory_notification

    async def claim(kind, *rest, **kw):
        if kind == "card":
            raise RuntimeError("locked")
        return await real(kind, *rest, **kw)

    monkeypatch.setattr(app_state, "aclaim_memory_notification", claim)
    s.request_card_check(HINATA)
    hh.clock.move(NOON + timedelta(seconds=ns.CARD_CHECK_DELAY_S))
    await s.tick()
    assert hh.sent == []
    assert app_state.get_card_baseline(HINATA, "58")[0] == seeded  # not absorbed
    monkeypatch.setattr(app_state, "aclaim_memory_notification", real)
    s.request_card_check(HINATA)
    hh.clock.move(NOON + timedelta(seconds=2 * ns.CARD_CHECK_DELAY_S))
    await s.tick()
    assert kinds(hh.sent) == ["card"]
    assert "moment.midnight" in app_state.get_card_baseline(HINATA, "58")[0]


@pytest.mark.asyncio
async def test_card_baseline_not_advanced_when_halted_before_delivery(
    cards, monkeypatch
):
    hh, sdir = cards
    s = hh.make()
    await s.tick()  # seed
    seeded, _ = app_state.get_card_baseline(HINATA, "58")
    room(sdir, KANE, [*KANE_DAYS, msg(3, "2026-11-09T15:03:00Z", content=WORDS)])
    real = nc.card_plans

    async def plans_then_stop(*args):
        got = await real(*args)
        shutdown_state.begin_shutdown()
        return got

    monkeypatch.setattr(nc, "card_plans", plans_then_stop)
    s.request_card_check(HINATA)
    hh.clock.move(NOON + timedelta(seconds=ns.CARD_CHECK_DELAY_S))
    await s.tick()
    assert hh.sent == [] and rows() == {}
    assert app_state.get_card_baseline(HINATA, "58")[0] == seeded


# --- fix wave 1: silent baseline advance (ruling) ----------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "off", [{"notifications_enabled": False}, {"memories_notify_cards": False}]
)
async def test_cards_advance_silently_while_off(cards, off):
    hh, sdir = cards
    hh.settings.update(off)
    s = hh.make()
    await s.tick()  # first tick seeds even while off
    assert app_state.get_card_baseline(HINATA, "58") is not None
    room(sdir, KANE, [*KANE_DAYS, msg(3, "2026-11-09T15:03:00Z", content=WORDS)])
    s.request_card_check(HINATA)
    hh.clock.move(NOON + timedelta(seconds=ns.CARD_CHECK_DELAY_S))
    await s.tick()
    assert hh.sent == [] and rows() == {}
    assert "moment.midnight" in app_state.get_card_baseline(HINATA, "58")[0]
    assert s._card_pending == {}
    # turning it back on never floods the card earned while off
    hh.settings.update(notifications_enabled=True, memories_notify_cards=True)
    s.request_card_check(HINATA)
    hh.clock.move(NOON + timedelta(seconds=2 * ns.CARD_CHECK_DELAY_S))
    await s.tick()
    assert hh.sent == []


# --- fix wave 1: rate-limited bad start log (ruling) -------------------------------------------


@pytest.mark.asyncio
async def test_bad_subscription_start_logged_once_per_member_per_day(
    out, clock, safe_logs
):
    sdir = out / HINATA_NAME
    room(sdir, KANE, [msg(1, "2023-11-10T03:00:00Z", content=WORDS)])
    write_side_inputs(sdir, sub_starts={"34": "not-a-date"})
    hh = Harness(clock, memories_notify_on_this_day=False)
    s = hh.make()

    def bad_starts():
        return [
            e
            for e in safe_logs
            if e["event"] == "memories_skip"
            and e.get("reason") == "bad_subscription_start"
        ]

    await s.tick()  # also the silent first card seed (binder parses it too)
    first = len(bad_starts())
    assert first >= 1
    hh.clock.move(jst(2026, 11, 10, 18))
    await s.tick()
    assert len(bad_starts()) == first  # same JST day: not repeated
    hh.clock.move(jst(2026, 11, 11, 9))
    await s.tick()
    assert len(bad_starts()) == first + 1


# --- fix wave 1: minors ------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_first_tick_keeps_an_undue_card_mark(cards, safe_logs):
    hh, _ = cards
    s = hh.make()
    s.request_card_check(HINATA)  # a launch-time sync, not due for 120 s
    await s.tick()  # first tick: checks every service ...
    assert HINATA in s._card_pending  # ... but keeps the undue mark
    hh.clock.move(NOON + timedelta(seconds=ns.CARD_CHECK_DELAY_S))
    await s.tick()
    assert s._card_pending == {}
    checks = [e for e in safe_logs if e["event"] == "memories_card_check"]
    assert len(checks) == 2


@pytest.mark.asyncio
async def test_unknown_service_card_request_is_ignored(h):
    s = h.make()
    s.request_card_check("not_a_service")
    assert s._card_pending == {}
    r = await s.tick()
    assert r.next_in_s > 1


@pytest.mark.asyncio
async def test_finish_writes_only_the_keys_this_unit_claimed(out, clock, monkeypatch):
    sdir = out / HINATA_NAME
    room(sdir, KANE, [msg(1, "2024-01-05T03:00:00Z", content=WORDS)])
    room(sdir, MATSU, [msg(1, "2024-01-05T03:00:00Z", content=WORDS)])
    write_side_inputs(sdir, sub_starts={"34": "2025-11-10", "40": "2025-11-10"})
    other = ("anniversary", HINATA, "64", "y1@2026-11-10")
    app_state.claim_memory_notification(*other, "failed")  # another path's row

    async def nothing_done(keys):
        return set()  # as if the other path wrote after this tick's lookup

    monkeypatch.setattr(app_state, "amemory_notifications_done", nothing_done)
    hh = Harness(clock, memories_notify_on_this_day=False)
    await hh.make().tick()
    got = rows()
    assert got[("anniversary", HINATA, "58", "y1@2026-11-10")] == "sent"
    assert got[other] == "failed"


@pytest.mark.asyncio
async def test_output_dir_is_resolved_once_per_tick_off_the_loop(h, monkeypatch):
    import threading

    root = people.output_dir()
    calls = []

    def output_dir():
        calls.append(threading.current_thread() is threading.main_thread())
        return root

    monkeypatch.setattr(people, "output_dir", output_dir)
    await h.make(services=(HINATA, "sakurazaka46")).tick()
    assert kinds(h.sent) == ["on_this_day"]
    assert calls == [False]


@pytest.mark.asyncio
async def test_card_already_claimed_elsewhere_still_advances(cards, monkeypatch):
    hh, sdir = cards
    s = hh.make()
    await s.tick()  # seed
    room(sdir, KANE, [*KANE_DAYS, msg(3, "2026-11-09T15:03:00Z", content=WORDS)])
    real = app_state.aclaim_memory_notification

    async def claim(kind, *rest, **kw):
        if kind == "card":
            return False  # a concurrent tick took it
        return await real(kind, *rest, **kw)

    monkeypatch.setattr(app_state, "aclaim_memory_notification", claim)
    s.request_card_check(HINATA)
    hh.clock.move(NOON + timedelta(seconds=ns.CARD_CHECK_DELAY_S))
    await s.tick()
    assert hh.sent == []
    assert "moment.midnight" in app_state.get_card_baseline(HINATA, "58")[0]
