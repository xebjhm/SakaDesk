"""Memories notification scheduler (spec 15, 9.3).

One asyncio task, started by the FastAPI lifespan (``main.py``) after the
auto-sync scheduler and stopped before the write barrier, because it writes
``app_state.db`` (the ledger and the card baselines) under the data lock.

Each :meth:`MemoriesNotifyScheduler.tick`:

1. reads the clock and the settings; the daily slot is
   ``memories_notify_time`` (JST, ``notify_rules.parse_slot``);
2. stops when shutdown has begun or :meth:`~MemoriesNotifyScheduler.stop`
   was called (``reason=shutting_down``);
3. builds the candidate occasions (``notify_rules``) from every service with a
   data dir and keeps only those whose window is open now;
4. with ``notifications_enabled`` off, logs ``notifications_off`` and records
   nothing; 5. drops the kinds whose toggle is off (``kind_off``, nothing
   recorded), so turning a toggle on later the same day still delivers;
6. drops the occasions already in the ledger (``already_done``);
7. builds the plans (``notify_content``). On This Day with no moment is
   recorded ``empty``; a recap year without a recap ``no_recap``; every other
   explicit :class:`~notify_content.Skipped` ``skipped`` (one row each, so
   the skip is not re-logged every tick). The 12/25 ``christmas`` occasion
   before its stub exists gets **no** row and is asked again next tick;
8. with ``memories_notify_cards`` on, runs the card checks that are due: every
   service on the first tick after start, then each service
   :data:`CARD_CHECK_DELAY_S` after :meth:`request_card_check` (a finished
   sync). With cards off the pending marks are dropped;
9. delivers recap, birthday, anniversary, birthday_soon, on_this_day, card.
   Each plan claims every occasion it covers before the toast (at most once:
   a failed or interrupted show is never retried). In Memories the claims are
   finished ``suppressed`` and no toast is shown. Shutdown is checked before
   every unit, never in the middle of one;
10. logs ``memories_notify_tick`` (``due``, ``sent``, ``suppressed``,
    ``next_in_s``).

The loop waits :data:`STARTUP_DELAY_S`, prunes ledger rows older than
:data:`PRUNE_AFTER` once, then ticks and waits until the next slot / JST
midnight / due card check, at most :data:`MAX_SLEEP_S`, or until woken
(:func:`memories_notify_settings_changed`, :func:`request_card_check`).

Logs carry ids, codes and counts only: ``memories_notify_tick``,
``memories_notify_skip`` (``kind``, ``service``, ``reason``, ``count`` /
``member_id``), ``memories_notify_failed`` (``stage``, ``error_type``),
``memories_card_check`` and ``memories_notify_wake_requested``. Never a
title, body, name, route or path.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import structlog

from backend.services import app_state, notification_service, settings_store, ui_state
from backend.services.memories import binder, people
from backend.services.memories import index as mi
from backend.services.memories import notify_content as nc
from backend.services.memories.cards import parse_birthday
from backend.services.memories.notify_rules import (
    SETTING_FOR_KIND,
    Occasion,
    anniversary_occasions,
    birthday_occasions,
    is_open,
    jst_today,
    next_wake,
    on_this_day_occasion,
    parse_slot,
    recap_occasions,
)
from backend.services.notification_planner import MemoryToastPlan
from backend.services.shutdown_state import is_shutting_down

logger = structlog.get_logger(__name__)

STARTUP_DELAY_S = 60.0
MAX_SLEEP_S = 900.0  # re-evaluate at least every 15 min (sleep/resume, clock changes)
CARD_CHECK_DELAY_S = 120.0  # after a sync, let the memory index build first
STOP_TIMEOUT_S = 5.0
PRUNE_AFTER = timedelta(days=400)
RETRY_AFTER_FAILURE_S = 60.0  # the wait after a tick that raised

DELIVERY_ORDER = (
    "recap",
    "birthday",
    "anniversary",
    "birthday_soon",
    "on_this_day",
    "card",
)

NotifyKey = app_state.NotifyKey
ClockFn = Callable[[], datetime]
SleepFn = Callable[[float], Awaitable[Any]]
LoadSettingsFn = Callable[[], Awaitable[Mapping[str, Any]]]
SendFn = Callable[[MemoryToastPlan], Awaitable[bool]]

_active: Optional["MemoriesNotifyScheduler"] = None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _key(occ: Occasion) -> NotifyKey:
    return (occ.kind, occ.service, occ.subject, occ.occasion)


@dataclass(frozen=True)
class TickResult:
    due: int  # open occasions plus card toasts this tick
    sent: int
    suppressed: int
    next_in_s: float


@dataclass
class _Unit:
    """One toast and every ledger key it covers (the first decides the claim)."""

    plan: MemoryToastPlan
    covered: list[NotifyKey]


@dataclass
class _ServiceData:
    sdir: Path
    summaries: Sequence[mi.MemberSummary]


@dataclass
class _Counts:
    sent: int = 0
    suppressed: int = 0
    units: list[_Unit] = field(default_factory=list)


class _Halted(Exception):
    """Internal: shutdown began or stop() was called; leave the tick now."""


def _skip(kind: str, service: str, reason: str, **extra: Any) -> None:
    logger.info(
        "memories_notify_skip", kind=kind, service=service, reason=reason, **extra
    )


class MemoriesNotifyScheduler:
    """Computes due Memories occasions and delivers their toasts (one task)."""

    def __init__(
        self,
        services: Iterable[str],
        *,
        clock: ClockFn = _utc_now,
        sleep: SleepFn = asyncio.sleep,
        load_settings: LoadSettingsFn = settings_store.load_config,
        send: SendFn = notification_service.send_memory,
        in_memories: Callable[[], bool] = ui_state.memories_in_view,
    ) -> None:
        self._services = list(services)
        self._clock = clock
        self._sleep = sleep
        self._load_settings = load_settings
        self._send = send
        self._in_memories = in_memories
        self._task: asyncio.Task[None] | None = None
        self._wake = asyncio.Event()
        self._stopping = False
        self._first_card_check = True
        self._card_pending: dict[str, datetime] = {}
        self._bad_birthdays: set[tuple[str, str]] = set()

    # --- lifecycle --------------------------------------------------------------

    def start(self) -> None:
        """Create the one ``memories_notify`` task. Idempotent while running."""
        global _active
        if self._task is not None:
            return
        self._stopping = False
        self._task = asyncio.create_task(self._run(), name="memories_notify")
        _active = self

    async def stop(self) -> None:
        """Ask the loop to exit at its next check point; after
        :data:`STOP_TIMEOUT_S` cancel it. Idempotent."""
        global _active
        if _active is self:
            _active = None
        self._stopping = True
        self._wake.set()
        task, self._task = self._task, None
        if task is None:
            return
        done, _ = await asyncio.wait({task}, timeout=STOP_TIMEOUT_S)
        if not done:
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    def wake(self) -> None:
        """End the current wait early (settings changed). Event-loop thread only."""
        self._wake.set()

    def request_card_check(self, service: str) -> None:
        """Mark ``service`` for a card check :data:`CARD_CHECK_DELAY_S` from now.

        An earlier pending mark is kept (the check is not pushed back by
        every sync). Wakes the loop so its wait includes the new due time.
        """
        self._card_pending.setdefault(service, self._clock())
        self._wake.set()

    def _halted(self) -> bool:
        return self._stopping or is_shutting_down()

    def _check(self) -> None:
        if self._halted():
            raise _Halted

    # --- the loop -------------------------------------------------------------------

    async def _wait(self, seconds: float) -> None:
        """Sleep ``seconds`` or until woken (same pattern as AutoSyncScheduler)."""
        sleeper = asyncio.ensure_future(self._sleep(seconds))
        waker = asyncio.ensure_future(self._wake.wait())
        try:
            await asyncio.wait({sleeper, waker}, return_when=asyncio.FIRST_COMPLETED)
            if sleeper.done():
                sleeper.result()  # surface a sleep failure
            else:
                self._wake.clear()
        finally:
            for pending in (sleeper, waker):
                if not pending.done():
                    pending.cancel()
            await asyncio.gather(sleeper, waker, return_exceptions=True)

    async def _run(self) -> None:
        await self._wait(STARTUP_DELAY_S)
        if self._halted():
            return
        try:
            pruned = await app_state.aprune_memory_notifications(
                self._clock() - PRUNE_AFTER
            )
            logger.info("memories_notify_pruned", count=pruned)
        except Exception as exc:
            logger.error(
                "memories_notify_failed", stage="prune", error_type=type(exc).__name__
            )
        while not self._halted():
            try:
                delay = (await self.tick()).next_in_s
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error(
                    "memories_notify_failed",
                    stage="tick",
                    error_type=type(exc).__name__,
                )
                delay = RETRY_AFTER_FAILURE_S
            if self._halted():
                return
            await self._wait(delay)

    # --- one tick -------------------------------------------------------------------

    async def tick(self) -> TickResult:
        """One evaluation (public for tests); see the module docstring."""
        now = self._clock()
        settings = await self._load_settings()
        slot = parse_slot(settings.get("memories_notify_time"))
        cards_on = bool(settings.get(SETTING_FOR_KIND["card"], False))
        notify_on = bool(settings.get("notifications_enabled", True))
        if not (cards_on and notify_on):
            self._card_pending.clear()
        counts = _Counts()
        due = 0
        try:
            self._check()
            data = await self._service_data()
            occasions = [
                o for o in self._occasions(data, now, slot) if is_open(o.window, now)
            ]
            due = len(occasions)
            if not notify_on:
                if occasions:
                    _skip("*", "*", "notifications_off", count=len(occasions))
                return self._result(now, slot, due, counts)
            occasions = self._drop_kinds_off(occasions, settings)
            occasions = await self._drop_done(occasions)
            ctx = await nc.load_context(settings, now)
            await self._build(ctx, data, occasions, counts)
            if cards_on:
                await self._check_cards(ctx, data, now, counts)
            due += sum(1 for u in counts.units if u.plan.kind == "card")
            await self._deliver(counts)
        except _Halted:
            _skip("*", "*", "shutting_down")
        return self._result(now, slot, due, counts)

    def _result(
        self, now: datetime, slot: Any, due: int, counts: _Counts
    ) -> TickResult:
        next_in = next_wake(now, slot, MAX_SLEEP_S)
        if self._card_pending:
            earliest = min(self._card_pending.values())
            card_in = (earliest - now).total_seconds() + CARD_CHECK_DELAY_S
            next_in = max(1.0, min(next_in, card_in))
        result = TickResult(due, counts.sent, counts.suppressed, next_in)
        logger.info(
            "memories_notify_tick",
            due=due,
            sent=counts.sent,
            suppressed=counts.suppressed,
            next_in_s=round(next_in, 1),
        )
        return result

    async def _service_data(self) -> dict[str, _ServiceData]:
        """Every service with a data dir and its people (listing runs in a thread)."""
        out: dict[str, _ServiceData] = {}
        for service in self._services:
            self._check()
            try:
                sdir = people.service_data_dir(service)
            except ValueError:
                _skip("*", service, "unavailable")
                continue
            if not await asyncio.to_thread(sdir.is_dir):
                continue
            summaries = await mi.list_members(sdir)
            out[service] = _ServiceData(sdir, summaries)
        self._check()
        return out

    def _occasions(
        self, data: Mapping[str, _ServiceData], now: datetime, slot: Any
    ) -> list[Occasion]:
        today = jst_today(now)
        out = [on_this_day_occasion(today, slot)]
        for service, sd in data.items():
            for summary in sd.summaries:
                mid = people.member_id(summary)
                if mid is None:
                    continue
                if summary.birthday and parse_birthday(summary.birthday) is None:
                    if (service, mid) not in self._bad_birthdays:
                        self._bad_birthdays.add((service, mid))
                        _skip("birthday", service, "bad_birthday", member_id=mid)
                out += birthday_occasions(service, mid, summary.birthday, today, slot)
                out += anniversary_occasions(
                    service, mid, binder.subscription_start(summary), today, slot
                )
            out += recap_occasions(service, today, slot)
        return out

    def _drop_kinds_off(
        self, occasions: list[Occasion], settings: Mapping[str, Any]
    ) -> list[Occasion]:
        kept: list[Occasion] = []
        off: dict[str, int] = {}
        for occ in occasions:
            if settings.get(SETTING_FOR_KIND[occ.kind], True):
                kept.append(occ)
            else:
                off[occ.kind] = off.get(occ.kind, 0) + 1
        for kind, count in off.items():
            _skip(kind, "*", "kind_off", count=count)
        return kept

    async def _drop_done(self, occasions: list[Occasion]) -> list[Occasion]:
        if not occasions:
            return []
        done = await app_state.amemory_notifications_done([_key(o) for o in occasions])
        dropped: dict[str, int] = {}
        kept: list[Occasion] = []
        for occ in occasions:
            if _key(occ) in done:
                dropped[occ.kind] = dropped.get(occ.kind, 0) + 1
            else:
                kept.append(occ)
        for kind, count in dropped.items():
            logger.debug(
                "memories_notify_skip",
                kind=kind,
                service="*",
                reason="already_done",
                count=count,
            )
        return kept

    async def _record(self, occ: Occasion, outcome: str) -> None:
        """A terminal ledger row without a toast (never written once halted)."""
        self._check()
        await app_state.aclaim_memory_notification(*_key(occ), outcome)

    async def _build(
        self,
        ctx: nc.Context,
        data: Mapping[str, _ServiceData],
        occasions: list[Occasion],
        counts: _Counts,
    ) -> None:
        by_kind: dict[tuple[str, str], list[Occasion]] = {}
        for occ in occasions:
            by_kind.setdefault((occ.kind, occ.service), []).append(occ)

        for occ in by_kind.get(("on_this_day", "*"), []):
            self._check()
            otd = await nc.on_this_day_plan(ctx, list(data), occ)
            if otd is None:
                _skip("on_this_day", "*", "empty")
                await self._record(occ, "empty")
            else:
                counts.units.append(_Unit(otd, [_key(occ)]))

        for service, sd in data.items():
            self._check()
            births = by_kind.get(("birthday", service), []) + by_kind.get(
                ("birthday_soon", service), []
            )
            if births:
                plans, skipped = await nc.birthday_plans(
                    ctx, service, sd.sdir, sd.summaries, births
                )
                await self._record_skipped(skipped)
                counts.units += [
                    _Unit(p, [(p.kind, p.service, p.subject, p.occasion)])
                    for p in plans
                ]
            annivs = by_kind.get(("anniversary", service), [])
            if annivs:
                self._check()
                oshi = await people.oshi_rooms(service, sd.summaries)
                ordered = people.sort_people(sd.summaries, oshi)
                groups, skipped = await nc.anniversary_plans(
                    ctx, service, sd.sdir, ordered, annivs
                )
                await self._record_skipped(skipped)
                counts.units += [
                    _Unit(p, [_key(o) for o in covered]) for p, covered in groups
                ]
            for occ in by_kind.get(("recap", service), []):
                self._check()
                got = await nc.recap_plan(ctx, service, sd.sdir, occ)
                if isinstance(got, nc.Skipped):
                    await self._record_skipped([got])
                elif got is not None:
                    counts.units.append(_Unit(got, [_key(occ)]))

    async def _record_skipped(self, skipped: Sequence[nc.Skipped]) -> None:
        for s in skipped:
            await self._record(
                s.occasion, "no_recap" if s.reason == "no_recap" else "skipped"
            )

    async def _check_cards(
        self,
        ctx: nc.Context,
        data: Mapping[str, _ServiceData],
        now: datetime,
        counts: _Counts,
    ) -> None:
        ready = now - timedelta(seconds=CARD_CHECK_DELAY_S)
        due = {s for s, at in self._card_pending.items() if at <= ready}
        if self._first_card_check:
            due |= set(data)
        self._first_card_check = False
        for service in [s for s in self._services if s in due]:
            self._check()
            mark = self._card_pending.get(service)
            sd = data.get(service)
            if sd is not None:
                oshi = await people.oshi_rooms(service, sd.summaries)
                plans, stats = await nc.card_plans(
                    ctx, service, sd.sdir, sd.summaries, oshi
                )
                counts.units += [
                    _Unit(p, [("card", service, p.subject, k) for k in keys])
                    for p, keys in plans
                ]
                logger.info("memories_card_check", service=service, **stats)
            if self._card_pending.get(service) == mark:
                self._card_pending.pop(service, None)

    async def _deliver(self, counts: _Counts) -> None:
        order = {kind: i for i, kind in enumerate(DELIVERY_ORDER)}
        for unit in sorted(counts.units, key=lambda u: order[u.plan.kind]):
            self._check()
            plan = unit.plan
            first, *rest = unit.covered
            if not await app_state.aclaim_memory_notification(*first):
                logger.debug(
                    "memories_notify_skip",
                    kind=plan.kind,
                    service=plan.service,
                    reason="already_done",
                    count=1,
                )
                continue
            for key in rest:
                await app_state.aclaim_memory_notification(*key)
            if self._in_memories():
                _skip(plan.kind, plan.service, "in_memories", member_id=plan.member_id)
                await self._finish(unit.covered, "suppressed")
                counts.suppressed += 1
                continue
            try:
                ok = await self._send(plan)
            except asyncio.CancelledError:
                raise  # the claim stays pending: never resent
            except Exception as exc:
                logger.error(
                    "memories_notify_failed",
                    stage="send",
                    error_type=type(exc).__name__,
                )
                ok = False
            await self._finish(unit.covered, "sent" if ok else "failed")
            counts.sent += int(ok)

    async def _finish(self, keys: Sequence[NotifyKey], outcome: str) -> None:
        for key in keys:
            await app_state.afinish_memory_notification(*key, outcome)


def memories_notify_settings_changed() -> bool:
    """Wake the running scheduler after a Memories notify setting changed.

    Returns whether a scheduler was woken; logs ``memories_notify_wake_requested``.
    """
    scheduler = _active
    if scheduler is not None:
        scheduler.wake()
    logger.info("memories_notify_wake_requested", woken=scheduler is not None)
    return scheduler is not None


def request_card_check(service: str) -> None:
    """Ask the running scheduler for a card check of ``service`` (after a sync).

    A no-op (debug breadcrumb) without a scheduler. Never raises.
    """
    scheduler = _active
    if scheduler is None:
        logger.debug("memories_notify_card_check_ignored", service=service)
        return
    try:
        scheduler.request_card_check(service)
    except Exception as exc:
        logger.error(
            "memories_notify_failed",
            stage="card_request",
            error_type=type(exc).__name__,
        )


__all__ = [
    "CARD_CHECK_DELAY_S",
    "DELIVERY_ORDER",
    "MAX_SLEEP_S",
    "PRUNE_AFTER",
    "STARTUP_DELAY_S",
    "STOP_TIMEOUT_S",
    "MemoriesNotifyScheduler",
    "TickResult",
    "memories_notify_settings_changed",
    "request_card_check",
]
