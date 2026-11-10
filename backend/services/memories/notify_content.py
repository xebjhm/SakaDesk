"""The text and images of the Memories notifications (spec 15, 9.3).

Turns the occasions of ``notify_rules`` into
:class:`~backend.services.notification_planner.MemoryToastPlan` objects. The
scheduler (``notify_scheduler``) decides *when*; this module decides *what*.
Every builder reuses the views' own rules: the hub's ``today`` pick
(:func:`hub.today_moment`), the hub's subscription-ended check
(:func:`hub.lapsed_groups` / :func:`hub.still_subscribed`), the binder's card
evaluation (``binder.evaluate_person`` / ``cards.earned_keys``) and
``recap.recap_years``.

Copy rules (spec 1, binding):

- literally true: nothing says she knows, addresses or answers the fan; a
  subscription milestone is the fan's own (「メンバーシップ N 年目」);
- at most one number per toast (title and body together): years ago, days
  left, the milestone or the recap year;
- her words are quoted, never paraphrased: the nickname placeholder becomes
  the fan's nickname for that service, else the mask 『＊＊＊』
  (:func:`nickname.apply_nickname_or_mask`); then the quote is
  whitespace-collapsed and clipped to :data:`QUOTE_MAX_CHARS` plus ``…``;
- ``notifications_hide_content`` drops her words and the photo and keeps her
  name.

Strings are the ``memories_notify`` backend section (``get_strings``), in the
UI language (``resolve_ui_language``).

Contract with the scheduler (M4 Task 5):

- **Explicit skips.** :func:`birthday_plans`, :func:`anniversary_plans` and
  :func:`recap_plan` return a :class:`Skipped` (occasion + reason code) for
  every occasion they will never send: ``graduated``, ``subscription_ended``,
  ``unavailable`` (her ``member_id`` is no longer listed) and ``no_recap``.
  The scheduler records one ledger row per skipped occasion (outcome
  ``skipped``), so the next tick neither rebuilds nor re-logs it.
- **Christmas waits for the stub.** The 12/25 ``christmas`` occasion is
  eligible only while :func:`christmas_ready` is true (some member's recap
  shows her Christmas stub at check time). Before that :func:`recap_plan`
  returns ``None`` and the scheduler writes **no** ledger row, so a stub that
  appears in the evening still sends the toast later that JST day. After
  the window closes the occasion is simply never produced again.
- **On This Day.** ``None`` from :func:`on_this_day_plan` means no service
  has a moment today: the scheduler records ``empty``.
- **Images.** ``hero`` and ``avatar`` are absolute (``Path.resolve``) and
  existed at build time (checked in a worker); the delivery layer may still
  find them gone and must drop them then.

Logs (ids, codes and counts only; never a name, a quote, a path or a raw card
key): ``memories_notify_skip`` with ``kind``, ``service``, ``reason`` and
``member_id`` where relevant, once per build. Reasons emitted here:
``unavailable`` (unknown service, or a person no longer listed),
``graduated``, ``subscription_ended``, ``no_recap``, ``no_facts``,
``seeded`` and, at debug level, ``christmas_pending``. The scheduler logs
the rest (``empty``, ``already_done``, ...) and ``memories_card_check``
from the counts :func:`card_plans` returns.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import structlog

from backend.services import app_state
from backend.services.i18n import get_strings, resolve_ui_language
from backend.services.memories import binder, hub, people, recap
from backend.services.memories import index as mi
from backend.services.memories.cards import earned_keys
from backend.services.memories.notify_rules import (
    Occasion,
    jst_today,
    new_foil_keys,
    notifiable_foil,
)
from backend.services.nickname import (
    PLACEHOLDER_RE,
    apply_nickname_or_mask,
    nickname_for,
)
from backend.services.notification_planner import (
    MemoryToastPlan,
    clip_text,
    find_avatar,
)

logger = structlog.get_logger(__name__)

SECTION = "memories_notify"
QUOTE_MAX_CHARS = 60
NAMES_MAX_CHARS = 40
PICTURE = "picture"


@dataclass(frozen=True)
class Skipped:
    """An occasion that will never be sent, with its reason code (see above)."""

    occasion: Occasion
    reason: str


@dataclass(frozen=True)
class Context:
    """What every builder needs: settings, strings, the instant and hide-content."""

    settings: Mapping[str, Any]
    strings: Mapping[str, str]  # the ``memories_notify`` section
    now: datetime  # aware
    hide_content: bool


async def load_context(settings: Mapping[str, Any], now: datetime) -> Context:
    """The builders' context: the UI language's strings (prefs read in a thread)."""
    lang = await asyncio.to_thread(resolve_ui_language, settings)
    return Context(
        settings=settings,
        strings=get_strings(SECTION, lang),
        now=now,
        hide_content=bool(settings.get("notifications_hide_content", False)),
    )


def quote(ctx: Context, text: str | None, service: str) -> str | None:
    """Her words for a toast: nickname (or the mask) in, clipped.

    ``None`` when nothing but whitespace and placeholders is left: a bare mask
    is not her words.
    """
    if not text or not PLACEHOLDER_RE.sub("", text).strip():
        return None
    masked = apply_nickname_or_mask(
        text, nickname_for(ctx.settings, service), ctx.strings["nickname_masked"]
    )
    return clip_text(masked, QUOTE_MAX_CHARS) or None


def plural(ctx: Context, key: str, n: int, **fields: object) -> str:
    """``<key>_one`` when ``n == 1``, else ``<key>_other``, formatted with ``n``."""
    form = "one" if n == 1 else "other"
    return ctx.strings[f"{key}_{form}"].format(n=n, **fields)


def _skip(kind: str, service: str, reason: str, member_id: str | None = None) -> None:
    logger.info(
        "memories_notify_skip",
        kind=kind,
        service=service,
        reason=reason,
        member_id=member_id,
    )


def _first_file(paths: Sequence[Path]) -> Path | None:
    """The first of ``paths`` that is a file, absolute; else ``None``. Blocking."""
    for path in paths:
        resolved = path.resolve()
        if resolved.is_file():
            return resolved
    return None


def _find_avatar_abs(room_dir: Path) -> Path | None:
    found = find_avatar(room_dir)
    return found.resolve() if found is not None else None


async def _avatar(sdir: Path, room: str) -> Path | None:
    return await asyncio.to_thread(_find_avatar_abs, sdir / room)


def _memoir_route(sdir: Path, summary: mi.MemberSummary, **extra: str) -> dict:
    return {
        "page": "memoir",
        "memberPath": people.chat_path(sdir, summary.member_dirs[-1]),
        "tab": "binder",
        **extra,
    }


def _by_member_id(
    summaries: Sequence[mi.MemberSummary],
) -> dict[str, mi.MemberSummary]:
    out: dict[str, mi.MemberSummary] = {}
    for s in summaries:
        mid = people.member_id(s)
        if mid is not None:
            out.setdefault(mid, s)
    return out


# --- on this day ---------------------------------------------------------------------


async def _service_moment(
    service: str, today_occasion: Occasion
) -> tuple[Path, Sequence[mi.MemberSummary], dict] | None:
    try:
        sdir = people.service_data_dir(service)
    except ValueError:
        _skip("on_this_day", service, "unavailable")
        return None
    summaries = await mi.list_members(sdir)
    if not summaries:
        return None
    oshi = await people.oshi_rooms(service, summaries)
    moment = await hub.today_moment(service, sdir, summaries, oshi, today_occasion.day)
    return (sdir, summaries, moment) if moment is not None else None


def _hero_candidates(sdir: Path, moment: dict) -> list[Path]:
    """Her photo of the day, then the message itself, when each is a picture."""
    return [
        sdir / str(ref["media_file"])
        for ref in (moment["photo"], moment["message"])
        if ref is not None and ref["type"] == PICTURE and ref["media_file"]
    ]


def _rank(moment: dict, order: int) -> tuple[bool, bool, bool, int, int]:
    """Oshi first, words before photos, a score before none, higher score, order.

    Importance and photo score are never compared: ``has_words`` splits them.
    """
    score = moment["score"]
    return (
        not moment["oshi"],
        not moment["has_words"],
        score is None,
        -score if score is not None else 0,
        order,
    )


async def on_this_day_plan(
    ctx: Context, services: Sequence[str], occasion: Occasion
) -> MemoryToastPlan | None:
    """One On This Day toast across ``services``, or ``None`` when none has a moment.

    Each service proposes the hub's ``today`` moment; they are ranked by
    :func:`_rank` (oshi, words before photos, score, then ``services`` order).
    The body quotes her words; a picture without words gets the photo copy;
    a video, voice or empty message gets the neutral copy (never a photo
    claim). The hero is the first existing picture (her photo of the day,
    then the message's own).
    """
    found: list[tuple[tuple, str, Path, Sequence, dict]] = []
    for order, service in enumerate(services):
        got = await _service_moment(service, occasion)
        if got is not None:
            sdir, summaries, moment = got
            found.append((_rank(moment, order), service, sdir, summaries, moment))
    if not found:
        return None
    _, service, sdir, summaries, moment = min(found, key=lambda f: f[0])
    message = moment["message"]
    name = moment["name"]
    hero: Path | None = None
    if ctx.hide_content:
        body = ctx.strings["otd_body_hidden"].format(name=name)
    else:
        words = quote(ctx, message["text"] or message["caption"], service)
        if words is not None:
            body = ctx.strings["otd_body"].format(name=name, quote=words)
        elif message["type"] == PICTURE:
            body = ctx.strings["otd_body_photo"].format(name=name)
        else:  # a video, voice or empty message: no words, no photo claim
            body = ctx.strings["otd_body_hidden"].format(name=name)
        hero = await asyncio.to_thread(_first_file, _hero_candidates(sdir, moment))
    person = next(s for s in summaries if message["room"] in s.member_dirs)
    return MemoryToastPlan(
        kind="on_this_day",
        service=service,
        subject=occasion.subject,
        occasion=occasion.occasion,
        title=plural(ctx, "otd_title", moment["years_ago"]),
        body=body,
        avatar=await _avatar(sdir, message["room"]),
        hero=hero,
        route={
            "page": "onThisDay",
            "monthDay": occasion.day.strftime("%m-%d"),
            "year": moment["year"],
        },
        member_id=people.member_id(person),
    )


# --- birthdays -------------------------------------------------------------------------


async def birthday_plans(
    ctx: Context,
    service: str,
    sdir: Path,
    summaries: Sequence[mi.MemberSummary],
    occasions: Sequence[Occasion],
) -> tuple[list[MemoryToastPlan], list[Skipped]]:
    """One toast per ``birthday`` / ``birthday_soon`` occasion of a listed,
    non-graduated person; every other occasion comes back as a
    :class:`Skipped` (``graduated`` / ``unavailable``)."""
    people_by_id = _by_member_id(summaries)
    plans: list[MemoryToastPlan] = []
    skipped: list[Skipped] = []
    for occ in occasions:
        person = people_by_id.get(occ.subject)
        reason = _person_skip(person, None)
        if person is None or reason is not None:
            skipped.append(_skipped(service, occ, reason or "unavailable"))
            continue
        name = person.name
        if occ.kind == "birthday" or occ.number is None:
            title = ctx.strings["birthday_title"].format(name=name)
        else:
            title = plural(ctx, "birthday_soon_title", occ.number, name=name)
        plans.append(
            MemoryToastPlan(
                kind=occ.kind,
                service=service,
                subject=occ.subject,
                occasion=occ.occasion,
                title=title,
                body=ctx.strings["birthday_body"].format(name=name),
                avatar=await _avatar(sdir, person.member_dirs[-1]),
                hero=None,
                route=_memoir_route(sdir, person),
                member_id=occ.subject,
            )
        )
    return plans, skipped


# --- subscription anniversaries ------------------------------------------------------


def _person_skip(
    person: mi.MemberSummary | None, lapsed: frozenset[str] | None
) -> str | None:
    """The skip reason of an occasion's person, or ``None`` when she is kept.

    ``lapsed`` (anniversaries only) adds the subscription-ended check.
    """
    if person is None:
        return "unavailable"
    if person.graduated:
        return "graduated"
    if lapsed is not None and not hub.still_subscribed(person, lapsed):
        return "subscription_ended"
    return None


def _skipped(service: str, occ: Occasion, reason: str) -> Skipped:
    member_id = None if occ.kind == "recap" else occ.subject
    _skip(occ.kind, service, reason, member_id)
    return Skipped(occ, reason)


def _milestone(occ: Occasion) -> str:
    """``"y1@2026-11-10"`` -> ``"y1"``."""
    return occ.occasion.split("@", 1)[0]


async def anniversary_plans(
    ctx: Context,
    service: str,
    sdir: Path,
    ordered: Sequence[mi.MemberSummary],
    occasions: Sequence[Occasion],
) -> tuple[list[tuple[MemoryToastPlan, list[Occasion]]], list[Skipped]]:
    """One toast per milestone, naming every member who reaches it today.

    ``ordered`` is ``people.sort_people`` (oshi first); the names follow it.
    Each tuple is the plan (``subject`` / ``occasion`` of its first member)
    and the occasions it covers, one per named member. Graduated members,
    members whose subscription has ended in every group and members no
    longer listed come back as :class:`Skipped` (``graduated`` /
    ``subscription_ended`` / ``unavailable``).
    """
    rank = {people.member_id(s): i for i, s in enumerate(ordered)}
    people_by_id = _by_member_id(ordered)
    lapsed = await asyncio.to_thread(hub.lapsed_groups, sdir)
    groups: dict[str, list[tuple[mi.MemberSummary, Occasion]]] = {}
    skipped: list[Skipped] = []
    for occ in occasions:
        person = people_by_id.get(occ.subject)
        reason = _person_skip(person, lapsed)
        if person is None or reason is not None:
            skipped.append(_skipped(service, occ, reason or "unavailable"))
            continue
        groups.setdefault(_milestone(occ), []).append((person, occ))
    out: list[tuple[MemoryToastPlan, list[Occasion]]] = []
    for milestone, members in groups.items():
        members.sort(key=lambda m: rank[m[1].subject])
        first, first_occ = members[0]
        n = int(milestone[1:])
        key = "anniv_years_title" if milestone.startswith("y") else "anniv_days_title"
        names = ctx.strings["name_join"].join(p.name for p, _ in members)
        plan = MemoryToastPlan(
            kind="anniversary",
            service=service,
            subject=first_occ.subject,
            occasion=first_occ.occasion,
            title=plural(ctx, key, n),
            body=ctx.strings["anniv_body"].format(
                names=clip_text(names, NAMES_MAX_CHARS)
            ),
            avatar=await _avatar(sdir, first.member_dirs[-1]),
            hero=None,
            route=_memoir_route(sdir, first, cardKey=f"anniv.{milestone}"),
            member_id=first_occ.subject,
        )
        out.append((plan, [occ for _, occ in members]))
    return out, skipped


# --- recap ---------------------------------------------------------------------------


async def christmas_ready(service: str, sdir: Path, *, now: datetime) -> bool:
    """True when some member's recap of ``now``'s JST year shows her Christmas
    stub as of ``now`` (``recap.has_christmas_stub`` over
    ``recap.build_member_recap``, the recap's own s09 rule; cached by the
    recap). Before 12/25 the stub is sealed, so this is false. The scheduler
    may call it every tick of the 12/25 window."""
    year = jst_today(now).year
    for person in await mi.list_members(sdir):
        payload = await recap.build_member_recap(service, sdir, person, year, now=now)
        if recap.has_christmas_stub(payload):
            return True
    return False


async def recap_plan(
    ctx: Context, service: str, sdir: Path, occasion: Occasion
) -> MemoryToastPlan | Skipped | None:
    """The recap toast (``open`` / ``christmas`` / ``ready``).

    :class:`Skipped` (``no_recap``) when that year has no recap
    (``recap.recap_years``). ``None`` for ``christmas`` while
    :func:`christmas_ready` is false: not yet, so the scheduler records
    nothing and asks again next tick.
    """
    year = occasion.number
    if year is None or year not in await recap.recap_years(sdir, now=ctx.now):
        return _skipped(service, occasion, "no_recap")
    which = occasion.subject
    if which == "christmas" and not await christmas_ready(service, sdir, now=ctx.now):
        logger.debug(
            "memories_notify_skip",
            kind="recap",
            service=service,
            reason="christmas_pending",
            member_id=None,
        )
        return None
    return MemoryToastPlan(
        kind="recap",
        service=service,
        subject=which,
        occasion=occasion.occasion,
        title=ctx.strings[f"recap_{which}_title"].format(year=year),
        body=ctx.strings[f"recap_{which}_body"],
        avatar=None,
        hero=None,
        route={"page": "recap", "year": year},
        member_id=None,
    )


# --- cards ---------------------------------------------------------------------------


async def card_plans(
    ctx: Context,
    service: str,
    sdir: Path,
    summaries: Sequence[mi.MemberSummary],
    oshi: set[str],
) -> tuple[list[tuple[MemoryToastPlan, list[str]]], dict[str, int]]:
    """Toasts for newly earned notifiable foil cards, one per person.

    A person is evaluated only when ``binder.binder_hash`` differs from the
    stored baseline's. Her first check seeds the baseline silently
    (``reason=seeded``); an evaluation without ``first.message`` (no facts
    yet, or a transient empty index) leaves the baseline untouched
    (``reason=no_facts``). The baseline becomes the union of the old and new
    keys, so it never shrinks. Each tuple is the plan (``occasion`` = the
    first new card's occasion key in shelf / catalogue order) and every new
    occasion key it covers. A graduated person's new cards update the
    baseline without a toast (``reason=graduated``). The counts are ``persons``, ``evaluated``,
    ``seeded`` and ``new_foil`` (for ``memories_card_check``).
    """
    counts = {"persons": 0, "evaluated": 0, "seeded": 0, "new_foil": 0}
    out: list[tuple[MemoryToastPlan, list[str]]] = []
    for person in people.sort_people(summaries, oshi):
        mid = people.member_id(person)
        if mid is None:
            continue
        counts["persons"] += 1
        data_hash = await binder.binder_hash(sdir, person, now=ctx.now)
        baseline = await app_state.aget_card_baseline(service, mid)
        if baseline is not None and baseline[1] == data_hash:
            continue
        counts["evaluated"] += 1
        cards = await binder.evaluate_person(service, sdir, person, now=ctx.now)
        current = earned_keys(cards)
        if "first.message" not in current:
            _skip("card", service, "no_facts", mid)
            continue
        if baseline is None:
            counts["seeded"] += 1
            _skip("card", service, "seeded", mid)
            await app_state.aput_card_baseline(service, mid, current, data_hash)
            continue
        new = new_foil_keys(baseline[0], current, notifiable_foil(cards))
        await app_state.aput_card_baseline(
            service, mid, baseline[0] | current, data_hash
        )
        if new and person.graduated:
            # After graduation a "new" card is a data-recovery artifact, not an
            # event: the baseline absorbs it silently.
            _skip("card", service, "graduated", mid)
            continue
        if not new:
            continue
        counts["new_foil"] += len(new)
        order = [c.key for c in cards if c.key in new]
        first = order[0]
        plan = MemoryToastPlan(
            kind="card",
            service=service,
            subject=mid,
            occasion=new[first],
            title=ctx.strings["card_title"],
            body=ctx.strings["card_body"].format(name=person.name),
            avatar=await _avatar(sdir, person.member_dirs[-1]),
            hero=None,
            route=_memoir_route(sdir, person, cardKey=first),
            member_id=mid,
        )
        out.append((plan, [new[k] for k in order]))
    return out, counts


__all__ = [
    "NAMES_MAX_CHARS",
    "QUOTE_MAX_CHARS",
    "Context",
    "Skipped",
    "anniversary_plans",
    "birthday_plans",
    "card_plans",
    "christmas_ready",
    "load_context",
    "on_this_day_plan",
    "plural",
    "quote",
    "recap_plan",
]
