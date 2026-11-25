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
- **Card baselines advance after the claim.** :func:`card_plans` never
  writes a baseline; it returns a :class:`CardCheck` whose advances the
  scheduler applies (a toast's only after its keys are claimed), so a
  failure before the claim never silently absorbs new cards.
- **Images.** ``hero`` and ``avatar`` are absolute (``Path.resolve``) and
  existed at build time (checked in a worker); the delivery layer may still
  find them gone and must drop them then. The hero is never the archive
  original: it is a cached JPEG of at most ``photo_thumb.TOAST_WIDTH`` px and
  ``photo_thumb.TOAST_MAX_BYTES`` (:func:`photo_thumb.toast_image`), within the
  Windows toast limits; when that copy cannot be made the toast has no hero.

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

from backend.services import app_state, photo_thumb
from backend.services.archive_urls import ArchiveReadError, resolve_within
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


def _contained(sdir: Path, path: Path) -> Path | None:
    """``path`` resolved (links followed) when it stays inside the service folder ``sdir``. Blocking.

    Both are made absolute first (no ``..`` folding), so a relative output
    folder still compares part for part.
    """
    try:
        return resolve_within(sdir.absolute(), path.absolute())
    except ArchiveReadError:
        return None


def _first_file(sdir: Path, paths: Sequence[Path]) -> Path | None:
    """The first of ``paths`` that is a file inside ``sdir``, resolved; else ``None``. Blocking.

    A path that resolves outside the service folder (a ``..`` in a tampered
    ``media_file`` or a planted link) is skipped with ``memories_notify_skip``
    (``reason=outside_service_dir``; security audit 2026-11-13).
    """
    for path in paths:
        resolved = _contained(sdir, path)
        if resolved is None:
            _skip("on_this_day", "*", "outside_service_dir")
            continue
        if resolved.is_file():
            return resolved
    return None


def _find_avatar_abs(sdir: Path, room_dir: Path) -> Path | None:
    """The room's avatar resolved inside ``sdir``; ``None`` when absent or outside (logged)."""
    found = find_avatar(room_dir)
    if found is None:
        return None
    resolved = _contained(sdir, found)
    if resolved is None:
        _skip("avatar", "*", "outside_service_dir")
    return resolved


async def _avatar(sdir: Path, room: str) -> Path | None:
    return await asyncio.to_thread(_find_avatar_abs, sdir, sdir / room)


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


Listed = Mapping[str, tuple[Path, Sequence[mi.MemberSummary]]]
"""A service's data dir and its people, as the scheduler already listed them."""


async def _service_moment(
    service: str,
    today_occasion: Occasion,
    base: Path | None,
    listed: Listed | None,
) -> tuple[Path, Sequence[mi.MemberSummary], dict] | None:
    if listed is not None and service in listed:
        sdir, summaries = listed[service]
    else:
        try:
            sdir = people.service_data_dir(service, base)
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


async def _toast_hero(sdir: Path, candidates: Sequence[Path]) -> Path | None:
    """The toast copy of the first existing candidate, or ``None`` (never the original)."""
    source = await asyncio.to_thread(_first_file, sdir, candidates)
    if source is None:
        return None
    try:
        return await photo_thumb.toast_image(source)
    except Exception as exc:  # noqa: BLE001 - a hero is optional
        logger.info(
            "memories_notify_skip",
            kind="on_this_day",
            service="*",
            reason="hero_unavailable",
            member_id=None,
            error_type=type(exc).__name__,
        )
        return None


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
    ctx: Context,
    services: Sequence[str],
    occasion: Occasion,
    *,
    base: Path | None = None,
    listed: Listed | None = None,
) -> MemoryToastPlan | None:
    """One On This Day toast across ``services``, or ``None`` when none has a moment.

    Each service proposes the hub's ``today`` moment; they are ranked by
    :func:`_rank` (oshi, words before photos, score, then ``services`` order).
    The body quotes her words; a picture without words gets the photo copy;
    a video, voice or empty message gets the neutral copy (never a photo
    claim). The hero is a toast-sized copy of the first existing picture
    (her photo of the day, then the message's own); none when that copy
    fails. ``base`` is the output dir when the caller already resolved it
    (default: read from settings); ``listed`` the services' data dirs and
    people when the caller already listed them (default: listed here).
    """
    found: list[tuple[tuple, str, Path, Sequence, dict]] = []
    for order, service in enumerate(services):
        got = await _service_moment(service, occasion, base, listed)
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
        hero = await _toast_hero(sdir, _hero_candidates(sdir, moment))
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


@dataclass(frozen=True)
class BaselineAdvance:
    """A person's new card baseline, written by :meth:`apply` (never by
    :func:`card_plans` itself). ``keys`` is already the union of the old and
    new keys, so applying it never shrinks the baseline."""

    service: str
    member_id: str
    keys: frozenset[str]
    data_hash: str

    async def apply(self) -> None:
        await app_state.aput_card_baseline(
            self.service, self.member_id, self.keys, self.data_hash
        )


@dataclass(frozen=True)
class CardToast:
    """One person's card toast, the occasion keys it covers and the baseline
    advance to apply once those keys are claimed in the ledger."""

    plan: MemoryToastPlan
    keys: list[str]
    advance: BaselineAdvance


@dataclass(frozen=True)
class CardCheck:
    """The result of :func:`card_plans`.

    ``toasts`` carry their own advance (apply it only after the claim, so a
    failure before the claim never absorbs the new cards); ``silent`` are
    advances with no toast (first-check seeds, no new foil card, a graduated
    person), safe to apply at once. ``counts`` feeds ``memories_card_check``.
    """

    toasts: list[CardToast]
    silent: list[BaselineAdvance]
    counts: dict[str, int]

    def advances(self) -> list[BaselineAdvance]:
        """Every advance (silent and toast ones), for a check without toasts."""
        return [*self.silent, *(t.advance for t in self.toasts)]


async def card_plans(
    ctx: Context,
    service: str,
    sdir: Path,
    summaries: Sequence[mi.MemberSummary],
    oshi: set[str],
) -> CardCheck:
    """Toasts for newly earned notifiable foil cards, one per person.

    Reads baselines but never writes them: the caller applies each
    :class:`BaselineAdvance` (see :class:`CardCheck`). A person is evaluated
    only when ``binder.binder_hash`` differs from the stored baseline's. Her
    first check seeds the baseline silently (``reason=seeded``); an
    evaluation without ``first.message`` (no facts yet, or a transient empty
    index) produces no advance (``reason=no_facts``). Every advance is the
    union of the old and new keys, so the baseline never shrinks. A toast's
    ``plan.occasion`` is the first new card's occasion key in shelf /
    catalogue order and ``keys`` every new occasion key it covers. A
    graduated person's new cards advance silently (``reason=graduated``).
    The title counts the new cards (``card_title_one`` / ``_other``; the
    count is the toast's one number).
    The counts are ``persons``, ``evaluated``, ``seeded`` and ``new_foil``.
    """
    counts = {"persons": 0, "evaluated": 0, "seeded": 0, "new_foil": 0}
    toasts: list[CardToast] = []
    silent: list[BaselineAdvance] = []
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
            silent.append(BaselineAdvance(service, mid, current, data_hash))
            continue
        new = new_foil_keys(baseline[0], current, notifiable_foil(cards))
        advance = BaselineAdvance(service, mid, baseline[0] | current, data_hash)
        if new and person.graduated:
            # After graduation a "new" card is a data-recovery artifact, not an
            # event: the baseline absorbs it silently.
            _skip("card", service, "graduated", mid)
            silent.append(advance)
            continue
        if not new:
            silent.append(advance)
            continue
        counts["new_foil"] += len(new)
        order = [c.key for c in cards if c.key in new]
        first = order[0]
        plan = MemoryToastPlan(
            kind="card",
            service=service,
            subject=mid,
            occasion=new[first],
            title=plural(ctx, "card_title", len(new)),
            body=ctx.strings["card_body"].format(name=person.name),
            avatar=await _avatar(sdir, person.member_dirs[-1]),
            hero=None,
            route=_memoir_route(sdir, person, cardKey=first),
            member_id=mid,
        )
        toasts.append(CardToast(plan, [new[k] for k in order], advance))
    return CardCheck(toasts, silent, counts)


__all__ = [
    "NAMES_MAX_CHARS",
    "QUOTE_MAX_CHARS",
    "BaselineAdvance",
    "CardCheck",
    "CardToast",
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
