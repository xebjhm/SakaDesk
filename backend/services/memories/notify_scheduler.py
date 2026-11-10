"""Memories notification scheduler (spec 15, 9.3).

One asyncio task, started by the FastAPI lifespan (``main.py``) after the
auto-sync scheduler and stopped before the write barrier, because it writes
``app_state.db`` (the ledger and the card baselines) under the data lock.

Each :meth:`MemoriesNotifyScheduler.tick`:

1. reads the clock and the settings; the daily slot is
   ``memories_notify_time`` (JST, ``notify_rules.parse_slot``); the output
   dir is resolved once, in a thread;
2. stops when shutdown has begun or :meth:`~MemoriesNotifyScheduler.stop`
   was called (``reason=shutting_down``);
3. builds the candidate occasions (``notify_rules``) from every service with a
   data dir and keeps only those whose window is open now;
4. with ``notifications_enabled`` off, logs ``notifications_off`` (debug),
   records nothing and only runs the due card checks silently (step 8);
5. drops the kinds whose toggle is off (``kind_off``, debug, nothing
   recorded), so turning a toggle on later the same day still delivers;
6. drops the occasions already in the ledger (``already_done``);
7. builds the plans (``notify_content``). On This Day with no moment is
   recorded ``empty``; a recap year without a recap ``no_recap``; every other
   explicit :class:`~notify_content.Skipped` ``skipped`` (one row each, so
   the skip is not re-logged every tick). The 12/25 ``christmas`` occasion
   before its stub exists gets **no** row and is asked again next tick;
8. runs the card checks that are due: every service with data on the first
   tick after start, and each service :data:`CARD_CHECK_DELAY_S` after
   :meth:`request_card_check` (a finished sync). They run whatever the
   settings: with ``notifications_enabled`` or ``memories_notify_cards`` off
   they advance the baselines **silently** (no toast, no ledger row), so
   turning notifications back on never floods old cards. When live, a
   toast's baseline advance is applied only after its keys are claimed;
9. delivers recap, birthday, anniversary, birthday_soon, on_this_day, card.
   Each plan claims every occasion it covers before the toast (at most once:
   a failed or interrupted show is never retried) and finishes only the keys
   it claimed. In Memories the claims are finished ``suppressed`` and no
   toast is shown. Shutdown is checked before every unit, never in the
   middle of one;
10. logs ``memories_notify_tick`` (``due`` = occasions still owed, i.e. open,
    enabled and not yet in the ledger, plus card toasts; ``sent``,
    ``suppressed``, ``next_in_s``).

Failures are isolated: each service's listing, each On This Day build, each
per-service birthday / anniversary block, each recap occasion, each
per-service card check and each delivery unit catches its own error, so one
bad file, builder or claim never silences the others. ``memories_notify_failed``
carries ``stage`` (``list`` / ``build`` / ``cards`` / ``deliver`` / ``send``
inside a tick; ``tick`` / ``prune`` for the loop; ``card_request`` for
:func:`request_card_check`), ``kind``, ``service``, ``error_type`` and
``where`` (the innermost frame as ``module:function:line``; code, never
data). A repeat of the same (``stage``, ``kind``, ``error_type``) is logged
at most once per :data:`FAILURE_LOG_INTERVAL`, with ``repeats`` = the
failures suppressed since the last line. A failed card check keeps its
pending mark, re-armed to retry :data:`CARD_CHECK_DELAY_S` later.

The loop waits :data:`STARTUP_DELAY_S`, prunes ledger rows older than
:data:`PRUNE_AFTER` once, then ticks and waits until the next slot / JST
midnight / due card check, at most :data:`MAX_SLEEP_S`, or until woken
(:func:`memories_notify_settings_changed`, :func:`request_card_check`).

Logs carry ids, codes and counts only: ``memories_notify_tick``,
``memories_notify_skip`` (``kind``, ``service``, ``reason``, ``count`` /
``member_id``), ``memories_notify_failed`` (``stage``, ``error_type``, plus
``kind`` / ``service``), ``memories_card_check`` and
``memories_notify_wake_requested``. Never a title, body, name, route or path.
(``binder.subscription_start`` itself logs a bad stored start at most once
per person per JST day, on every path.)
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta, timezone
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
FAILURE_LOG_INTERVAL = timedelta(hours=1)  # one line per repeating failure

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
    due: int  # occasions still owed (open, enabled, not in the ledger) + card toasts
    sent: int
    suppressed: int
    next_in_s: float


@dataclass
class _Unit:
    """One toast and every ledger key it covers (the first decides the claim);
    a card toast also carries the baseline advance applied after the claim."""

    plan: MemoryToastPlan
    covered: list[NotifyKey]
    advance: nc.BaselineAdvance | None = None


@dataclass
class _ServiceData:
    sdir: Path
    summaries: Sequence[mi.MemberSummary]


@dataclass
class _Counts:
    due: int = 0
    sent: int = 0
    suppressed: int = 0
    units: list[_Unit] = field(default_factory=list)


class _Halted(BaseException):
    """Internal: shutdown began or stop() was called; leave the tick now.

    A ``BaseException`` so the per-unit ``except Exception`` isolation never
    swallows it.
    """


def _skip(kind: str, service: str, reason: str, **extra: Any) -> None:
    logger.info(
        "memories_notify_skip", kind=kind, service=service, reason=reason, **extra
    )


def _quiet_skip(kind: str, service: str, reason: str, count: int) -> None:
    """A skip that repeats every tick while a setting stays off: debug level."""
    logger.debug(
        "memories_notify_skip", kind=kind, service=service, reason=reason, count=count
    )


_NOT_CODE = re.compile(r"[^A-Za-z0-9_.:]")


def _where(exc: BaseException) -> str:
    """The innermost frame of ``exc`` as ``module:function:line`` (code only)."""
    tb = exc.__traceback__
    if tb is None:
        return "unknown"
    while tb.tb_next is not None:
        tb = tb.tb_next
    frame = tb.tb_frame
    module = frame.f_globals.get("__name__", "unknown")
    return _NOT_CODE.sub("_", f"{module}:{frame.f_code.co_name}:{tb.tb_lineno}")


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
        # (stage, kind, error_type) -> (last logged at, suppressed since)
        self._failure_log: dict[tuple[str, str, str], tuple[datetime, int]] = {}

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
        every sync). A service this scheduler does not know is ignored (debug
        breadcrumb). Wakes the loop so its wait includes the new due time.
        """
        if service not in self._services:
            logger.debug("memories_notify_card_check_ignored", service="unknown")
            return
        self._card_pending.setdefault(service, self._clock())
        self._wake.set()

    def _failed(self, stage: str, kind: str, service: str, exc: BaseException) -> None:
        """``memories_notify_failed``, once per (stage, kind, error_type) per
        :data:`FAILURE_LOG_INTERVAL`; ``repeats`` counts the suppressed ones."""
        key = (stage, kind, type(exc).__name__)
        now = self._clock()
        last = self._failure_log.get(key)
        if last is not None and now - last[0] < FAILURE_LOG_INTERVAL:
            self._failure_log[key] = (last[0], last[1] + 1)
            return
        self._failure_log[key] = (now, 0)
        logger.error(
            "memories_notify_failed",
            stage=stage,
            kind=kind,
            service=service,
            error_type=key[2],
            where=_where(exc),
            repeats=last[1] if last is not None else 0,
        )

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
            self._failed("prune", "*", "*", exc)
        while not self._halted():
            try:
                delay = (await self.tick()).next_in_s
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._failed("tick", "*", "*", exc)
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
        notify_on = bool(settings.get("notifications_enabled", True))
        cards_on = bool(settings.get(SETTING_FOR_KIND["card"], False))
        counts = _Counts()
        try:
            self._check()
            base = await asyncio.to_thread(people.output_dir)
            data = await self._service_data(base)
            occasions = [
                o for o in self._occasions(data, now, slot) if is_open(o.window, now)
            ]
            ctx = await nc.load_context(settings, now)
            if not notify_on:
                if occasions:
                    _quiet_skip("*", "*", "notifications_off", len(occasions))
                await self._check_cards(ctx, data, now, counts, live=False)
                return self._result(now, slot, counts)
            occasions = self._drop_kinds_off(occasions, settings)
            occasions = await self._drop_done(occasions)
            counts.due = len(occasions)
            await self._build(ctx, data, base, occasions, counts)
            await self._check_cards(ctx, data, now, counts, live=cards_on)
            counts.due += sum(1 for u in counts.units if u.plan.kind == "card")
            await self._deliver(counts)
        except _Halted:
            _skip("*", "*", "shutting_down")
        return self._result(now, slot, counts)

    def _result(self, now: datetime, slot: time, counts: _Counts) -> TickResult:
        next_in = next_wake(now, slot, MAX_SLEEP_S)
        if self._card_pending:
            earliest = min(self._card_pending.values())
            card_in = (earliest - now).total_seconds() + CARD_CHECK_DELAY_S
            next_in = max(1.0, min(next_in, card_in))
        result = TickResult(counts.due, counts.sent, counts.suppressed, next_in)
        logger.info(
            "memories_notify_tick",
            due=counts.due,
            sent=counts.sent,
            suppressed=counts.suppressed,
            next_in_s=round(next_in, 1),
        )
        return result

    async def _service_data(self, base: Path) -> dict[str, _ServiceData]:
        """Every service with a data dir and its people (listing runs in a thread)."""
        out: dict[str, _ServiceData] = {}
        for service in self._services:
            self._check()
            try:
                sdir = people.service_data_dir(service, base)
            except ValueError:
                _skip("*", service, "unavailable")
                continue
            try:
                if not await asyncio.to_thread(sdir.is_dir):
                    continue
                summaries = await mi.list_members(sdir)
            except Exception as exc:
                self._failed("list", "*", service, exc)
                continue
            out[service] = _ServiceData(sdir, summaries)
        self._check()
        return out

    def _occasions(
        self, data: Mapping[str, _ServiceData], now: datetime, slot: time
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
                start = binder.subscription_start(summary)
                out += anniversary_occasions(service, mid, start, today, slot)
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
            _quiet_skip(kind, "*", "kind_off", count)
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
            _quiet_skip(kind, "*", "already_done", count)
        return kept

    async def _record(self, occ: Occasion, outcome: str) -> None:
        """A terminal ledger row without a toast (never written once halted)."""
        self._check()
        await app_state.aclaim_memory_notification(*_key(occ), outcome)

    async def _record_skipped(self, skipped: Sequence[nc.Skipped]) -> None:
        for s in skipped:
            await self._record(
                s.occasion, "no_recap" if s.reason == "no_recap" else "skipped"
            )

    async def _build(
        self,
        ctx: nc.Context,
        data: Mapping[str, _ServiceData],
        base: Path,
        occasions: list[Occasion],
        counts: _Counts,
    ) -> None:
        by_kind: dict[tuple[str, str], list[Occasion]] = {}
        for occ in occasions:
            by_kind.setdefault((occ.kind, occ.service), []).append(occ)

        for occ in by_kind.get(("on_this_day", "*"), []):
            self._check()
            try:
                otd = await nc.on_this_day_plan(ctx, list(data), occ, base=base)
                if otd is None:
                    _skip("on_this_day", "*", "empty")
                    await self._record(occ, "empty")
                else:
                    counts.units.append(_Unit(otd, [_key(occ)]))
            except Exception as exc:
                self._failed("build", "on_this_day", "*", exc)

        for service, sd in data.items():
            births = by_kind.get(("birthday", service), []) + by_kind.get(
                ("birthday_soon", service), []
            )
            if births:
                self._check()
                try:
                    plans, skipped = await nc.birthday_plans(
                        ctx, service, sd.sdir, sd.summaries, births
                    )
                    await self._record_skipped(skipped)
                    counts.units += [
                        _Unit(p, [(p.kind, p.service, p.subject, p.occasion)])
                        for p in plans
                    ]
                except Exception as exc:
                    self._failed("build", "birthday", service, exc)
            annivs = by_kind.get(("anniversary", service), [])
            if annivs:
                self._check()
                try:
                    oshi = await people.oshi_rooms(service, sd.summaries)
                    ordered = people.sort_people(sd.summaries, oshi)
                    groups, skipped = await nc.anniversary_plans(
                        ctx, service, sd.sdir, ordered, annivs
                    )
                    await self._record_skipped(skipped)
                    counts.units += [
                        _Unit(p, [_key(o) for o in covered]) for p, covered in groups
                    ]
                except Exception as exc:
                    self._failed("build", "anniversary", service, exc)
            for occ in by_kind.get(("recap", service), []):
                self._check()
                try:
                    got = await nc.recap_plan(ctx, service, sd.sdir, occ)
                    if isinstance(got, nc.Skipped):
                        await self._record_skipped([got])
                    elif got is not None:
                        counts.units.append(_Unit(got, [_key(occ)]))
                except Exception as exc:
                    self._failed("build", "recap", service, exc)

    async def _check_cards(
        self,
        ctx: nc.Context,
        data: Mapping[str, _ServiceData],
        now: datetime,
        counts: _Counts,
        *,
        live: bool,
    ) -> None:
        """Run the due card checks. ``live``: card toasts become delivery units
        whose advance waits for the claim; otherwise every advance is applied
        at once, silently (no toast, no ledger row)."""
        ready = now - timedelta(seconds=CARD_CHECK_DELAY_S)
        due = {s for s, at in self._card_pending.items() if at <= ready}
        if self._first_card_check:
            due |= set(data)
        self._first_card_check = False
        for service in [s for s in self._services if s in due]:
            self._check()
            mark = self._card_pending.get(service)
            sd = data.get(service)
            try:
                if sd is not None:
                    await self._check_service_cards(ctx, service, sd, counts, live)
            except Exception as exc:
                self._failed("cards", "card", service, exc)
                # Keep the mark, re-armed: retry CARD_CHECK_DELAY_S from now.
                self._card_pending[service] = now
                continue
            # Only a due, unchanged mark is used up; a first-tick check keeps a
            # mark that is not due yet, so the delayed check still runs.
            if mark is not None and mark <= ready:
                if self._card_pending.get(service) == mark:
                    del self._card_pending[service]

    async def _check_service_cards(
        self,
        ctx: nc.Context,
        service: str,
        sd: _ServiceData,
        counts: _Counts,
        live: bool,
    ) -> None:
        oshi = await people.oshi_rooms(service, sd.summaries)
        check = await nc.card_plans(ctx, service, sd.sdir, sd.summaries, oshi)
        logger.info("memories_card_check", service=service, live=live, **check.counts)
        silent = check.silent if live else check.advances()
        for advance in silent:
            self._check()
            await advance.apply()
        if live:
            counts.units += [
                _Unit(
                    t.plan,
                    [("card", service, t.plan.subject, k) for k in t.keys],
                    t.advance,
                )
                for t in check.toasts
            ]

    async def _deliver(self, counts: _Counts) -> None:
        order = {kind: i for i, kind in enumerate(DELIVERY_ORDER)}
        for unit in sorted(counts.units, key=lambda u: order[u.plan.kind]):
            self._check()
            try:
                await self._deliver_one(unit, counts)
            except Exception as exc:
                self._failed("deliver", unit.plan.kind, unit.plan.service, exc)

    async def _deliver_one(self, unit: _Unit, counts: _Counts) -> None:
        plan = unit.plan
        first, *rest = unit.covered
        if not await app_state.aclaim_memory_notification(*first):
            _quiet_skip(plan.kind, plan.service, "already_done", 1)
            await self._advance(unit)  # another path claimed these keys
            return
        claimed = [first]
        for key in rest:
            if await app_state.aclaim_memory_notification(*key):
                claimed.append(key)
        if self._in_memories():
            _skip(plan.kind, plan.service, "in_memories", member_id=plan.member_id)
            await self._finish(claimed, "suppressed")
            counts.suppressed += 1
            await self._advance(unit)
            return
        try:
            ok = await self._send(plan)
        except asyncio.CancelledError:
            raise  # the claim stays pending: never resent
        except Exception as exc:
            self._failed("send", plan.kind, plan.service, exc)
            ok = False
        await self._finish(claimed, "sent" if ok else "failed")
        counts.sent += int(ok)
        await self._advance(unit)

    async def _advance(self, unit: _Unit) -> None:
        """A card toast's baseline advance, after its outcome is written (a
        failed write never costs the toast; a crash before it is recovered by
        the next check, whose claim finds the row and only advances)."""
        if unit.advance is not None:
            await unit.advance.apply()

    async def _finish(self, keys: Sequence[NotifyKey], outcome: str) -> None:
        for key in keys:
            await app_state.afinish_memory_notification(*key, outcome)


def memories_notify_settings_changed() -> bool:
    """Wake the running scheduler after a Memories notify setting (or the
    global notifications switch) changed.

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
