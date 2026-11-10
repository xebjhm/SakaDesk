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

Logs (ids, codes and counts only; never a name, a quote, a path or a raw card
key): ``memories_notify_skip`` with ``kind``, ``service``, ``reason`` and
``member_id`` where relevant. Reasons emitted here: ``unavailable`` (unknown
service, or an occasion whose person is no longer listed), ``graduated``,
``subscription_ended``, ``no_facts`` and ``seeded``. The scheduler logs the
rest (``empty``, ``no_recap``, ...) and ``memories_card_check`` from the
counts :func:`card_plans` returns.
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
    new_foil_keys,
    notifiable_foil,
)
from backend.services.nickname import apply_nickname_or_mask, nickname_for
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
_MEDIA = frozenset({"picture", "video"})


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
    """Her words for a toast: nickname (or the mask) in, clipped; empty is ``None``."""
    if not text:
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


def _existing(path: Path) -> Path | None:
    """``path`` when it is a file, else ``None``. Blocking."""
    return path if path.is_file() else None


async def _avatar(sdir: Path, room: str) -> Path | None:
    return await asyncio.to_thread(find_avatar, sdir / room)


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


def _hero_candidate(sdir: Path, moment: dict) -> Path | None:
    """Her photo of the day, else the message itself when it is a picture."""
    for ref in (moment["photo"], moment["message"]):
        if ref is not None and ref["type"] == PICTURE and ref["media_file"]:
            return sdir / str(ref["media_file"])
    return None


async def on_this_day_plan(
    ctx: Context, services: Sequence[str], occasion: Occasion
) -> MemoryToastPlan | None:
    """One On This Day toast across ``services``, or ``None`` when none has a moment.

    Each service proposes the hub's ``today`` moment; the oshi's wins, then
    the higher score, then the earlier service in ``services``.
    """
    found: list[tuple[tuple[bool, int, int], str, Path, Sequence, dict]] = []
    for rank, service in enumerate(services):
        got = await _service_moment(service, occasion)
        if got is not None:
            sdir, summaries, moment = got
            score = moment["score"] if moment["score"] is not None else -1
            key = (not moment["oshi"], -score, rank)
            found.append((key, service, sdir, summaries, moment))
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
        elif message["type"] in _MEDIA:
            body = ctx.strings["otd_body_photo"].format(name=name)
        else:  # a voice or an empty message: no words to quote, no photo claim
            body = ctx.strings["otd_body_hidden"].format(name=name)
        candidate = _hero_candidate(sdir, moment)
        if candidate is not None:
            hero = await asyncio.to_thread(_existing, candidate)
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
) -> list[MemoryToastPlan]:
    """One toast per ``birthday`` / ``birthday_soon`` occasion of a listed,
    non-graduated person (``reason=graduated`` / ``unavailable`` otherwise)."""
    people_by_id = _by_member_id(summaries)
    plans: list[MemoryToastPlan] = []
    for occ in occasions:
        person = people_by_id.get(occ.subject)
        if person is None:
            _skip(occ.kind, service, "unavailable", occ.subject)
            continue
        if person.graduated:
            _skip(occ.kind, service, "graduated", occ.subject)
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
    return plans


# --- subscription anniversaries ------------------------------------------------------


def _milestone(occ: Occasion) -> str:
    """``"y1@2026-11-10"`` -> ``"y1"``."""
    return occ.occasion.split("@", 1)[0]


async def anniversary_plans(
    ctx: Context,
    service: str,
    sdir: Path,
    ordered: Sequence[mi.MemberSummary],
    occasions: Sequence[Occasion],
) -> list[tuple[MemoryToastPlan, list[Occasion]]]:
    """One toast per milestone, naming every member who reaches it today.

    ``ordered`` is ``people.sort_people`` (oshi first); the names follow it.
    Graduated members (``reason=graduated``) and members whose subscription
    has ended in every group (``reason=subscription_ended``) are left out.
    Each tuple is the plan (``subject`` / ``occasion`` of its first member)
    and the occasions it covers, one per named member.
    """
    rank = {people.member_id(s): i for i, s in enumerate(ordered)}
    people_by_id = _by_member_id(ordered)
    lapsed = await asyncio.to_thread(hub.lapsed_groups, sdir)
    groups: dict[str, list[tuple[mi.MemberSummary, Occasion]]] = {}
    for occ in occasions:
        person = people_by_id.get(occ.subject)
        if person is None:
            _skip(occ.kind, service, "unavailable", occ.subject)
            continue
        if person.graduated:
            _skip(occ.kind, service, "graduated", occ.subject)
            continue
        if not hub.still_subscribed(person, lapsed):
            _skip(occ.kind, service, "subscription_ended", occ.subject)
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
    return out


# --- recap ---------------------------------------------------------------------------


async def recap_plan(
    ctx: Context, service: str, sdir: Path, occasion: Occasion
) -> MemoryToastPlan | None:
    """The recap toast (``open`` / ``christmas`` / ``ready``), or ``None`` when that
    year has no recap (the scheduler logs ``reason=no_recap``)."""
    year = occasion.number
    if year is None or year not in await recap.recap_years(sdir, now=ctx.now):
        return None
    which = occasion.subject
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
    occasion key it covers. The counts are ``persons``, ``evaluated``,
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
    "anniversary_plans",
    "birthday_plans",
    "card_plans",
    "load_context",
    "on_this_day_plan",
    "plural",
    "quote",
    "recap_plan",
]
