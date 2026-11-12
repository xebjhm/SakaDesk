"""Memories API: year recaps, the member memoir (list, header, names, timeline, binder), On This Day, the day view, the album, the favorites board, the hub, the voice radio, the gacha, the calendar album, album cover overrides, capsule notes, the same-time line, her 24 hours and then-and-now pairs for the active service, the export handoff and the share GIF.

A ``sqlite3.Error`` from the fan's own store (``app_state.db``) on a cover,
capsule or gacha route is 503 ``store_unavailable`` (``memories.api.reject``,
``reason=store_unavailable``, ``op``), never a bare 500.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import re
import sqlite3
from collections.abc import Iterator
from datetime import date, datetime, timezone
from pathlib import Path, PurePosixPath

import structlog
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from backend.api.content import get_output_dir
from backend.services.archive_urls import ArchiveReadError
from backend.services.memories import (
    album,
    album_colors,
    binder,
    calendar_album,
    capsule,
    covers,
    day24,
    day_view,
    exports,
    favorites_board,
    gacha,
    hub,
    memoir,
    nickname_moments,
    on_this_day,
    people,
    radio,
    same_time,
    share_gif,
    then_now,
    timeline,
)
from backend.services.memories.index import MemberSummary
from backend.services.memories.recap import (
    build_member_recap,
    build_members_overview,
    recap_years,
)

router = APIRouter(prefix="/api/memories", tags=["memories"])
logger = structlog.get_logger(__name__)

MIN_YEAR = 2020
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\Z")


def _service_dir(service: str) -> Path:
    """The service's data dir (``people.service_data_dir``); 400 for an unknown service."""
    try:
        return people.service_data_dir(service, get_output_dir())
    except ValueError:
        logger.warning("memories.api.reject", reason="unknown_service")
        raise HTTPException(status_code=400, detail="Unknown service") from None


def _check_year(year: int, now: datetime) -> None:
    if year < MIN_YEAR or year > now.year + 1:
        logger.warning("memories.api.reject", reason="year_range", year=year)
        raise HTTPException(status_code=400, detail="Year out of range")


async def _person(
    service_data_dir: Path, member: str, **log_fields: object
) -> MemberSummary:
    """The person owning the room at the chat-style ``member`` path.

    A path that escapes the output dir is 400; a path in another service or a
    room no person owns is 404 (``people.resolve_person``). ``log_fields``
    (ids and codes only, e.g. ``year``) are added to the not-found breadcrumb.
    """
    try:
        summary = await people.resolve_person(service_data_dir, member)
    except people.ForeignServiceError:
        logger.warning("memories.api.reject", reason="other_service")
        raise HTTPException(status_code=404, detail="Member not found") from None
    except ArchiveReadError:
        logger.warning("memories.api.reject", reason="outside_output_dir")
        raise HTTPException(status_code=400, detail="Invalid member path") from None
    if summary is None:
        logger.info("memories.api.member_not_found", **log_fields)
        raise HTTPException(status_code=404, detail="Member not found")
    return summary


@contextlib.contextmanager
def _store_guard(op: str) -> Iterator[None]:
    """Map a ``sqlite3.Error`` of the fan's store to 503 ``store_unavailable``."""
    try:
        yield
    except sqlite3.Error as e:
        logger.warning(
            "memories.api.reject",
            reason="store_unavailable",
            op=op,
            error_type=type(e).__name__,
        )
        raise HTTPException(status_code=503, detail="store_unavailable") from None


def _join_body(chunks: list[bytes]) -> bytes:
    """One upload body from its streamed chunks (up to tens of MB; run in a worker)."""
    return b"".join(chunks)


async def _read_capped(request: Request, cap: int) -> list[bytes] | None:
    """The streamed body's chunks, or ``None`` once it grows past ``cap`` bytes.

    The chunks are not joined here: joining tens of MB would block the event
    loop, so callers join them in a worker thread (:func:`_join_body`).
    """
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > cap:
            return None
        chunks.append(chunk)
    return chunks


def _assemble_share_gif(chunks: list[bytes]) -> tuple[bytes, int]:
    """Blocking: join the body and assemble the GIF (runs in a worker thread)."""
    return share_gif.assemble_gif(_join_body(chunks))


@router.get("/{service}/recap/years")
async def recap_year_shelf(service: str) -> dict[str, list[int]]:
    """Years with a recap for this service (the shelf of yearbooks), ascending.

    Registered before ``/{service}/recap/{year}`` so ``years`` is not read as a year.
    Years before ``MIN_YEAR`` are dropped (the recap API refuses them).
    """
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    years = await recap_years(service_data_dir, now=now)
    return {"years": [y for y in years if y >= MIN_YEAR]}


@router.get("/{service}/recap/{year}/members")
async def recap_members(service: str, year: int) -> dict:
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    _check_year(year, now)
    return await build_members_overview(service, service_data_dir, year, now=now)


@router.get("/{service}/recap/{year}")
async def recap_member(service: str, year: int, member: str = Query(...)) -> dict:
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    _check_year(year, now)
    summary = await _person(service_data_dir, member, year=year)
    return await build_member_recap(service, service_data_dir, summary, year, now=now)


@router.get("/{service}/memoir/cards")
async def memoir_cards(service: str, member: str = Query(...)) -> dict:
    """The person's 卡冊 photocard binder (``binder.build_binder``).

    ``member`` is the chat path of any of her rooms; the binder covers the
    whole person. Unknown service or an escaping path is 400; a room no
    person owns (or another service's room) is 404.
    """
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    summary = await _person(service_data_dir, member, view="binder")
    return await binder.build_binder(service, service_data_dir, summary, now=now)


@router.get("/{service}/memoir/members")
async def memoir_members(service: str) -> dict:
    """The memoir's member list, oshi first, with binder progress (``memoir``)."""
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    return await memoir.list_memoir_members(service, service_data_dir, now=now)


@router.get("/{service}/memoir")
async def memoir_header(service: str, member: str = Query(...)) -> dict:
    """The memoir header of the person owning ``member``: name, avatar, chips."""
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    summary = await _person(service_data_dir, member, view="memoir")
    return await memoir.memoir_header(service, service_data_dir, summary, now=now)


@router.get("/{service}/memoir/names")
async def memoir_names(
    service: str, member: str = Query(...), year: int | None = Query(None)
) -> dict:
    """Every sentence with the fan's nickname, newest first (``nickname_moments``).

    ``year`` filters the items; ``years`` always lists every year with items.
    A ``year`` outside the recap range is 400, like the recap routes.
    """
    if year is not None:
        _check_year(year, datetime.now(timezone.utc))
    service_data_dir = _service_dir(service)
    summary = await _person(service_data_dir, member, view="names")
    return await nickname_moments.nickname_moments(
        service, service_data_dir, summary, year=year
    )


@router.get("/{service}/memoir/timeline")
async def memoir_timeline(service: str, member: str = Query(...)) -> dict:
    """The timeline rail: message counts per month, first to last month."""
    service_data_dir = _service_dir(service)
    summary = await _person(service_data_dir, member, view="timeline")
    return await timeline.timeline_months(service, service_data_dir, summary)


@router.get("/{service}/memoir/timeline/{month}")
async def memoir_timeline_month(
    service: str, month: str, member: str = Query(...)
) -> dict:
    """One timeline month. A malformed ``month`` is 400; one outside her range 404."""
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    if not timeline.MONTH_RE.match(month):
        logger.warning("memories.api.reject", reason="bad_month")
        raise HTTPException(status_code=400, detail="Invalid month")
    summary = await _person(service_data_dir, member, view="timeline")
    try:
        return await timeline.timeline_month(
            service, service_data_dir, summary, month, now=now
        )
    except timeline.MonthOutOfRange:
        logger.info("memories.api.month_not_found", month=month)
        raise HTTPException(status_code=404, detail="Month not found") from None


@router.get("/{service}/on-this-day")
async def on_this_day_route(
    service: str, month_day_q: str | None = Query(None, alias="date")
) -> dict:
    """On This Day for ``date`` (``MM-DD``; default: today in JST).

    A malformed or impossible ``date`` (e.g. ``02-30``) is 400.
    """
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    month_day = (
        month_day_q if month_day_q is not None else on_this_day.month_day_of(now)
    )
    try:
        on_this_day.parse_month_day(month_day)
    except ValueError:
        logger.warning("memories.api.reject", reason="bad_date")
        raise HTTPException(status_code=400, detail="Invalid date") from None
    return await on_this_day.on_this_day(service, service_data_dir, month_day, now=now)


def _parse_day(raw: str) -> date:
    """A ``YYYY-MM-DD`` date; 400 for any other format or an impossible date."""
    try:
        if not DATE_RE.match(raw):
            raise ValueError(raw)
        return date.fromisoformat(raw)
    except ValueError:
        logger.warning("memories.api.reject", reason="bad_date")
        raise HTTPException(status_code=400, detail="Invalid date") from None


_TRUE = frozenset({"1", "true", "yes", "on"})
_FALSE = frozenset({"0", "false", "no", "off"})


def _parse_flag(raw: str | None) -> bool:
    """A boolean query flag (``1/true/yes/on``, ``0/false/no/off``; absent = off).

    Any other value is 400, like every other validation error here.
    """
    if raw is None:
        return False
    value = raw.strip().lower()
    if value in _TRUE:
        return True
    if value in _FALSE:
        return False
    logger.warning("memories.api.reject", reason="bad_flag")
    raise HTTPException(status_code=400, detail="Invalid flag")


@router.get("/{service}/day")
async def day_route(
    service: str,
    day_q: str = Query(..., alias="date"),
    member: str | None = Query(None),
    others_q: str | None = Query(None, alias="others"),
) -> dict:
    """The 那一天 day view of ``date`` (``YYYY-MM-DD``), merged across people.

    ``member`` (chat path of any of her rooms) limits it to one person and
    disables ``others``; ``others`` (``1/true/yes/on`` or ``0/false/no/off``,
    anything else 400) adds the fan's other services.
    """
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    day = _parse_day(day_q)
    others = _parse_flag(others_q)
    summary = (
        await _person(service_data_dir, member, view="day")
        if member is not None
        else None
    )
    return await day_view.day_view(
        service,
        service_data_dir,
        day,
        member=summary,
        include_other_services=others,
        now=now,
    )


async def _optional_person(
    service_data_dir: Path, member: str | None, view: str
) -> MemberSummary | None:
    """The person owning ``member``, or ``None`` (全員) when it is absent."""
    if member is None:
        return None
    return await _person(service_data_dir, member, view=view)


def _check_kind(kind: str) -> None:
    if kind not in album.KINDS:
        logger.warning("memories.api.reject", reason="bad_kind")
        raise HTTPException(status_code=400, detail="Invalid kind")


@router.get("/{service}/album/members")
async def album_members_route(service: str) -> dict:
    """The album's member list with picture + video counts (``album``)."""
    service_data_dir = _service_dir(service)
    return await album.album_members(service, service_data_dir)


@router.get("/{service}/album/months")
async def album_months_route(
    service: str, member: str | None = Query(None), kind: str = Query("all")
) -> dict:
    """The album's monthly sections, newest first.

    ``member`` (chat path of any of her rooms) limits it to one person;
    absent means everyone. ``kind`` is ``all|picture|video|favorite`` (400
    otherwise).
    """
    service_data_dir = _service_dir(service)
    _check_kind(kind)
    summary = await _optional_person(service_data_dir, member, "album")
    return await album.album_months(
        service, service_data_dir, member=summary, kind=kind
    )


@router.get("/{service}/album/month/{month}")
async def album_month_route(
    service: str,
    month: str,
    member: str | None = Query(None),
    kind: str = Query("all"),
) -> dict:
    """One album month: items in time order and bursts. A malformed month is 400."""
    service_data_dir = _service_dir(service)
    if not timeline.MONTH_RE.match(month):
        logger.warning("memories.api.reject", reason="bad_month")
        raise HTTPException(status_code=400, detail="Invalid month")
    _check_kind(kind)
    summary = await _optional_person(service_data_dir, member, "album")
    return await album.album_month(
        service, service_data_dir, month, member=summary, kind=kind
    )


@router.get("/{service}/album/colors")
async def album_colors_route(service: str, member: str | None = Query(None)) -> dict:
    """The album's monthly colour ribbon (``album_colors.month_colors_for``)."""
    service_data_dir = _service_dir(service)
    summary = await _optional_person(service_data_dir, member, "album")
    return await album_colors.month_colors_for(service, service_data_dir, summary)


@router.get("/{service}/favorites")
async def favorites_route(service: str, member: str | None = Query(None)) -> dict:
    """The favorites cork board (``favorites_board.favorites_board``).

    ``member`` (chat path of any of her rooms) limits the items to one
    person; the member list always covers everyone.
    """
    service_data_dir = _service_dir(service)
    summary = await _optional_person(service_data_dir, member, "favorites")
    return await favorites_board.favorites_board(
        service, service_data_dir, member=summary
    )


RADIO_MIN_YEAR = 2000
RADIO_MAX_YEAR = 2100


@router.get("/{service}/radio/members")
async def radio_members_route(service: str) -> dict:
    """The radio's member list with voice counts and lengths (``radio``)."""
    service_data_dir = _service_dir(service)
    return await radio.radio_members(service, service_data_dir)


@router.get("/{service}/radio/program")
async def radio_program_route(
    service: str,
    program: str = Query(...),
    member: str | None = Query(None),
    year: int | None = Query(None),
) -> dict:
    """One radio program's tracks (``radio.radio_program``).

    ``program`` is one of ``radio.PROGRAMS`` (400 otherwise); ``year`` picks
    the chronological program's year and must be 2000-2100 (400 otherwise);
    ``member`` (chat path of any of her rooms) limits it to one person.
    """
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    if program not in radio.PROGRAMS:
        logger.warning("memories.api.reject", reason="bad_program")
        raise HTTPException(status_code=400, detail="Invalid program")
    if year is not None and not RADIO_MIN_YEAR <= year <= RADIO_MAX_YEAR:
        logger.warning("memories.api.reject", reason="year_range", year=year)
        raise HTTPException(status_code=400, detail="Year out of range")
    summary = await _optional_person(service_data_dir, member, "radio")
    return await radio.radio_program(
        service, service_data_dir, program=program, member=summary, year=year, now=now
    )


@router.get("/{service}/radio/cassettes")
async def radio_cassettes_route(service: str, member: str | None = Query(None)) -> dict:
    """One cassette per year with voices, oldest first (``radio.radio_cassettes``)."""
    service_data_dir = _service_dir(service)
    summary = await _optional_person(service_data_dir, member, "radio")
    return await radio.radio_cassettes(service, service_data_dir, member=summary)


@router.get("/{service}/gacha")
async def gacha_state_route(service: str) -> dict:
    """Today's gacha pulls, the pulls left and the history (``gacha.gacha_state``)."""
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    with _store_guard("gacha_state"):
        return await gacha.gacha_state(service, service_data_dir, now=now)


@router.post("/{service}/gacha/pull")
async def gacha_pull_route(service: str) -> dict:
    """Draw the next gacha pull of the JST day (``gacha.pull``).

    409 ``no_pulls_left`` once the day's pulls are used (also when a racing
    click took the last one); 503 ``store_unavailable`` on a store error.
    """
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    with _store_guard("gacha_pull"):
        body = await gacha.pull(service, service_data_dir, now=now)
    if body is None:
        logger.info("memories.api.reject", reason="no_pulls_left")
        raise HTTPException(status_code=409, detail="no_pulls_left")
    return body


def _check_month(month: str) -> None:
    if not timeline.MONTH_RE.match(month):
        logger.warning("memories.api.reject", reason="bad_month")
        raise HTTPException(status_code=400, detail="Invalid month")


@router.get("/{service}/calendar/months")
async def calendar_months_route(service: str, member: str | None = Query(None)) -> dict:
    """The JST months with at least one message, oldest first (``calendar_album``).

    Registered before ``/{service}/calendar/{month}`` so ``months`` is not read
    as a month.
    """
    service_data_dir = _service_dir(service)
    summary = await _optional_person(service_data_dir, member, "calendar")
    return await calendar_album.calendar_months(
        service, service_data_dir, member=summary
    )


@router.get("/{service}/calendar/{month}")
async def calendar_month_route(
    service: str, month: str, member: str | None = Query(None)
) -> dict:
    """One calendar month's day cells (``calendar_album.calendar_month``).

    A malformed ``month`` is 400; a month without messages gives ``days: []``.
    """
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    _check_month(month)
    summary = await _optional_person(service_data_dir, member, "calendar")
    return await calendar_album.calendar_month(
        service, service_data_dir, month, member=summary, now=now
    )


COVER_BODY_MAX = 4096
_COVER_KEYS = frozenset({"member", "month", "room", "id"})


def _bad_body() -> HTTPException:
    logger.warning("memories.api.reject", reason="bad_body")
    return HTTPException(status_code=400, detail="bad_body")


def _safe_room(room: object) -> bool:
    """A non-empty relative POSIX room path without ``..``, ``\\`` or a root."""
    if not isinstance(room, str) or not room or "\\" in room:
        return False
    parts = PurePosixPath(room)
    return not parts.is_absolute() and ".." not in parts.parts


def _parse_cover_body(raw: bytes) -> tuple[str | None, str, str, int]:
    """``(member, month, room, id)`` of a ``PUT /album/cover`` body; 400 otherwise.

    The body must be a JSON object with exactly ``member`` (string or
    ``null``), ``month`` (``YYYY-MM``), ``room`` (a relative room path) and
    ``id`` (a non-negative integer).
    """
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise _bad_body() from None
    if not isinstance(body, dict) or set(body) != _COVER_KEYS:
        raise _bad_body()
    member, month, room, mid = body["member"], body["month"], body["room"], body["id"]
    if member is not None and not isinstance(member, str):
        raise _bad_body()
    if not isinstance(month, str) or not timeline.MONTH_RE.match(month):
        raise _bad_body()
    if not _safe_room(room):
        raise _bad_body()
    if not isinstance(mid, int) or isinstance(mid, bool) or mid < 0:
        raise _bad_body()
    return member, month, room, mid


@router.put("/{service}/album/cover", status_code=204)
async def album_cover_set_route(service: str, request: Request) -> Response:
    """Set the album cover of a month (``covers.set_cover_override``).

    Body ``{"member": str | null, "month": "YYYY-MM", "room": str, "id": int}``
    (``member`` = chat path of any of her rooms; ``null`` = the 全員 album).
    A malformed body is 400 ``bad_body``; a message that is not a picture /
    video of that month in that scope is 400 ``not_in_month``.
    """
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    chunks = await _read_capped(request, COVER_BODY_MAX)
    if chunks is None:
        raise _bad_body()
    member, month, room, mid = _parse_cover_body(_join_body(chunks))
    summary = await _optional_person(service_data_dir, member, "album_cover")
    try:
        with _store_guard("cover_set"):
            await covers.set_cover_override(
                service,
                service_data_dir,
                member=summary,
                month=month,
                room=room,
                message_id=mid,
                now=now,
            )
    except ValueError:
        logger.info("memories.api.reject", reason="not_in_month")
        raise HTTPException(status_code=400, detail="not_in_month") from None
    return Response(status_code=204)


@router.delete("/{service}/album/cover", status_code=204)
async def album_cover_clear_route(
    service: str, month: str = Query(...), member: str | None = Query(None)
) -> Response:
    """Clear a month's album cover override (idempotent: 204 either way)."""
    service_data_dir = _service_dir(service)
    _check_month(month)
    summary = await _optional_person(service_data_dir, member, "album_cover")
    with _store_guard("cover_clear"):
        await covers.clear_cover_override(
            service, service_data_dir, member=summary, month=month
        )
    return Response(status_code=204)


CAPSULE_BODY_MAX = 64 * 1024
_CAPSULE_CREATE_KEYS = frozenset({"anchor", "body"})
_CAPSULE_UPDATE_KEYS = frozenset({"body"})


def _bad_note() -> HTTPException:
    logger.warning("memories.api.reject", reason="bad_note")
    return HTTPException(status_code=400, detail="bad_note")


async def _capsule_body(request: Request, keys: frozenset[str]) -> dict:
    """The JSON object body of a capsule write with exactly ``keys``; 400 otherwise.

    A body over :data:`CAPSULE_BODY_MAX` bytes is ``bad_note`` (it cannot hold
    a note of at most ``capsule.MAX_CHARS`` characters); anything that is not
    such an object is ``bad_body``.
    """
    chunks = await _read_capped(request, CAPSULE_BODY_MAX)
    if chunks is None:
        raise _bad_note()
    try:
        body = json.loads(_join_body(chunks).decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise _bad_body() from None
    if not isinstance(body, dict) or set(body) != keys:
        raise _bad_body()
    return body


def _capsule_reject(e: capsule.CapsuleError) -> HTTPException:
    if e.code == "bad_note":
        return _bad_note()
    if e.code == "unknown_member":
        logger.info("memories.api.member_not_found", view="capsule")
        return HTTPException(status_code=404, detail="Member not found")
    return _bad_body()


def _note_not_found(note_id: int) -> HTTPException:
    logger.info("memories.api.note_not_found", note_id=note_id)
    return HTTPException(status_code=404, detail="Note not found")


# SQLite's INTEGER PRIMARY KEY range: an id outside it names no note (and
# would overflow the driver), so it is 404 like any other unknown note.
NOTE_ID_MAX = 2**63 - 1


def _check_note_id(note_id: int) -> None:
    if not 1 <= note_id <= NOTE_ID_MAX:
        logger.info("memories.api.note_not_found", reason="note_id_range")
        raise HTTPException(status_code=404, detail="Note not found")


@router.get("/{service}/capsule")
async def capsule_list_route(
    service: str,
    day_q: str | None = Query(None, alias="date"),
    member: str | None = Query(None),
    card: str | None = Query(None),
) -> dict:
    """The fan's notes on one anchor (``capsule.notes_for_anchor``).

    Either ``date`` (``YYYY-MM-DD``, the day notes) or ``member`` (chat path
    of any of her rooms) + ``card`` (a card key) -- anything else is 400.
    """
    service_data_dir = _service_dir(service)
    if (day_q is None) == (member is None and card is None):
        logger.warning("memories.api.reject", reason="bad_anchor")
        raise HTTPException(status_code=400, detail="Invalid anchor")
    if day_q is not None:
        with _store_guard("capsule_list"):
            return await capsule.notes_for_anchor(
                service,
                service_data_dir,
                day=_parse_day(day_q),
                member=None,
                card_key=None,
            )
    if member is None or card is None or not capsule.valid_card_key(card):
        logger.warning("memories.api.reject", reason="bad_anchor")
        raise HTTPException(status_code=400, detail="Invalid anchor")
    summary = await _person(service_data_dir, member, view="capsule")
    with _store_guard("capsule_list"):
        return await capsule.notes_for_anchor(
            service, service_data_dir, day=None, member=summary, card_key=card
        )


@router.get("/{service}/capsule/due")
async def capsule_due_route(service: str, month_day: str | None = Query(None)) -> dict:
    """The notes resurfacing on ``month_day`` (``MM-DD``) this JST year.

    ``capsule.resurfacing``: each with ``years_ago`` and her message of the
    anchor day. A malformed or impossible ``month_day`` is 400.
    """
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    try:
        if month_day is None:  # required; 400 like every other bad date
            raise ValueError("missing")
        on_this_day.parse_month_day(month_day)
    except ValueError:
        logger.warning("memories.api.reject", reason="bad_date")
        raise HTTPException(status_code=400, detail="Invalid date") from None
    with _store_guard("capsule_due"):
        return await capsule.resurfacing(
            service, service_data_dir, month_day=month_day, now=now
        )


@router.post("/{service}/capsule")
async def capsule_create_route(service: str, request: Request) -> dict:
    """Write a capsule note (``capsule.create_note``); returns the note.

    Body ``{"anchor": {"kind": "day", "date"} | {"kind": "card", "member",
    "card_key", "date"}, "body": str}``. A malformed body or anchor is 400
    ``bad_body``; an empty or over-long note 400 ``bad_note``; a card
    ``member`` no person owns (or another service's) 404, one escaping the
    output dir 400.
    """
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    body = await _capsule_body(request, _CAPSULE_CREATE_KEYS)
    try:
        with _store_guard("capsule_create"):
            return await capsule.create_note(
                service,
                service_data_dir,
                anchor=body["anchor"],
                body=body["body"],
                now=now,
            )
    except capsule.CapsuleError as e:
        raise _capsule_reject(e) from None
    except people.ForeignServiceError:
        logger.warning("memories.api.reject", reason="other_service")
        raise HTTPException(status_code=404, detail="Member not found") from None
    except ArchiveReadError:
        logger.warning("memories.api.reject", reason="outside_output_dir")
        raise HTTPException(status_code=400, detail="Invalid member path") from None


@router.put("/{service}/capsule/{note_id}")
async def capsule_update_route(service: str, note_id: int, request: Request) -> dict:
    """Replace a note's body (``{"body": str}``); 404 for an unknown note,
    another service's or an id outside 1..2^63-1, 400 ``bad_note`` /
    ``bad_body`` for a bad body."""
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    _check_note_id(note_id)
    body = await _capsule_body(request, _CAPSULE_UPDATE_KEYS)
    try:
        with _store_guard("capsule_update"):
            note = await capsule.update_note(
                service, service_data_dir, note_id=note_id, body=body["body"], now=now
            )
    except capsule.CapsuleError as e:
        raise _capsule_reject(e) from None
    if note is None:
        raise _note_not_found(note_id)
    return note


@router.delete("/{service}/capsule/{note_id}", status_code=204)
async def capsule_delete_route(service: str, note_id: int) -> Response:
    """Delete a note; 404 for an unknown note, another service's or an id
    outside 1..2^63-1."""
    service_data_dir = _service_dir(service)
    _check_note_id(note_id)
    with _store_guard("capsule_delete"):
        found = await capsule.delete_note(service, service_data_dir, note_id=note_id)
    if not found:
        raise _note_not_found(note_id)
    return Response(status_code=204)


@router.get("/{service}/same-time")
async def same_time_route(service: str) -> dict | None:
    """同じ時刻 for the current JST minute (``same_time.same_time``), or ``null``."""
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    return await same_time.same_time(service, service_data_dir, now=now)


SEED_RE = re.compile(r"^\d{1,18}\Z")


def _parse_seed(raw: str | None) -> int | None:
    """The 🎲 seed: absent, or 1-18 ASCII digits; anything else is 400."""
    if raw is None:
        return None
    if not SEED_RE.match(raw):
        logger.warning("memories.api.reject", reason="bad_seed")
        raise HTTPException(status_code=400, detail="Invalid seed")
    return int(raw)


def _parse_recent(raw: str | None) -> frozenset[int]:
    """Recently shown message ids: comma-separated, each 1-18 ASCII digits, at
    most ``day24.RECENT_MAX``; anything else is 400."""
    if raw is None:
        return frozenset()
    parts = raw.split(",")
    if len(parts) > day24.RECENT_MAX or not all(SEED_RE.match(p) for p in parts):
        logger.warning("memories.api.reject", reason="bad_recent")
        raise HTTPException(status_code=400, detail="Invalid recent")
    return frozenset(int(p) for p in parts)


@router.get("/{service}/memoir/day24")
async def memoir_day24_route(
    service: str,
    member: str = Query(...),
    seed: str | None = Query(None),
    recent: str | None = Query(None),
) -> dict:
    """彼女の24時間 of the person owning ``member`` (``day24.build_day24``).

    ``seed`` (1-18 digits, else 400) rebuilds the day (🎲); without it the
    JST date picks the day. ``recent`` (comma-separated ids the client showed
    in its last re-rolls, else 400) are avoided. ``{"slots": []}`` when her
    day is too thin.
    """
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    parsed = _parse_seed(seed)
    shown = _parse_recent(recent)
    summary = await _person(service_data_dir, member, view="day24")
    return await day24.build_day24(
        service, service_data_dir, summary, seed=parsed, now=now, recent=shown
    )


@router.get("/{service}/then-now/day")
async def then_now_day_route(
    service: str,
    day_q: str = Query(..., alias="date"),
    member: str | None = Query(None),
) -> dict | None:
    """あの日と今日 for ``date`` (``YYYY-MM-DD``; ``then_now.then_now_day``).

    ``member`` (chat path of any of her rooms) pins the person. ``null`` when
    there is no later year to pair with (the toggle is hidden).
    """
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    day = _parse_day(day_q)
    summary = await _optional_person(service_data_dir, member, "then_now")
    return await then_now.then_now_day(
        service, service_data_dir, day, member=summary, now=now
    )


@router.get("/{service}/then-now/first-week")
async def then_now_first_week_route(
    service: str, member: str = Query(...)
) -> dict | None:
    """初見 vs 今 of the person owning ``member`` (``then_now.then_now_first_week``),
    or ``null`` when the weeks overlap or no row has both sides."""
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    summary = await _person(service_data_dir, member, view="then_now")
    return await then_now.then_now_first_week(
        service, service_data_dir, summary, now=now
    )


@router.get("/{service}/hub")
async def hub_route(service: str) -> dict:
    """The Memories hub board (``hub.build_hub``): moment, counts, countdown."""
    now = datetime.now(timezone.utc)
    service_data_dir = _service_dir(service)
    return await hub.build_hub(service, service_data_dir, now=now)


@router.post("/export")
async def export_store(
    request: Request, kind: exports.ExportKind = Query(...)
) -> dict[str, str]:
    """Hold a rendered export (PNG, GIF, WebM, MP4) in memory for a download.

    The body is the raw file. Its signature must match ``kind`` (else 400) and it
    may be at most ``exports.MAX_BYTES`` (else 413). Returns ``{"token": ...}``
    for ``GET /api/memories/export/{token}``. Nothing is written to disk.
    """
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > exports.MAX_BYTES:
        logger.warning("memories.export.reject", kind=kind, reason="too_large")
        raise HTTPException(status_code=413, detail="Export too large")
    chunks = await _read_capped(request, exports.MAX_BYTES)
    if chunks is None:
        logger.warning("memories.export.reject", kind=kind, reason="too_large")
        raise HTTPException(status_code=413, detail="Export too large")
    data = await asyncio.to_thread(_join_body, chunks)
    total = len(data)
    if not exports.magic_matches(kind, data):
        logger.warning(
            "memories.export.reject",
            kind=kind,
            size_kb=total // 1024,
            reason="magic_mismatch",
        )
        raise HTTPException(status_code=400, detail="Content does not match kind")
    token, evicted = exports.store.put(kind, data)
    logger.info(
        "memories.export.stored",
        kind=kind,
        size_kb=total // 1024,
        evicted=evicted,
        outcome="stored",
    )
    return {"token": token}


@router.post("/share/gif")
async def share_gif_store(request: Request) -> dict[str, str]:
    """Assemble the recap's share GIF from PNG frames and hold it for a download.

    The body is ``{"frames": [b64 png, ...], "fps", "width", "height",
    "durations_ms"?}`` (see ``share_gif``). It may be at most
    ``share_gif.MAX_BODY_BYTES`` (else 413, checked while streaming); invalid input
    is 400 with a reason code as the detail. The GIF goes straight into the export
    store, so the response is ``{"token": ...}`` exactly like ``POST /export`` and
    the frontend opens ``GET /export/{token}``. A GIF over ``exports.MAX_BYTES`` is
    413. Nothing is written to disk.
    """
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > share_gif.MAX_BODY_BYTES:
        logger.warning("memories.share.reject", reason="too_large")
        raise HTTPException(status_code=413, detail="too_large")
    chunks = await _read_capped(request, share_gif.MAX_BODY_BYTES)
    if chunks is None:
        logger.warning("memories.share.reject", reason="too_large")
        raise HTTPException(status_code=413, detail="too_large")
    try:
        data, frames = await asyncio.to_thread(_assemble_share_gif, chunks)
    except share_gif.ShareGifError as e:
        logger.warning("memories.share.reject", reason=e.code)
        raise HTTPException(status_code=e.status, detail=e.code) from None
    if len(data) > exports.MAX_BYTES:
        logger.warning(
            "memories.share.reject",
            reason="gif_too_large",
            frames=frames,
            size_kb=len(data) // 1024,
        )
        raise HTTPException(status_code=413, detail="gif_too_large")
    token, evicted = exports.store.put("gif", data)
    logger.info(
        "memories.share.gif",
        frames=frames,
        size_kb=len(data) // 1024,
        evicted=evicted,
        outcome="stored",
    )
    return {"token": token}


@router.get("/export/{token}")
async def export_fetch(token: str, filename: str | None = Query(None)) -> Response:
    """Return a held export as an attachment (the webview opens its save dialog).

    ``filename`` is sanitised and its extension forced to the export's kind.
    Unknown or expired tokens are 404. The entry stays until its TTL, so a
    repeated request from the webview still succeeds.
    """
    entry = exports.store.get(token)
    if entry is None:
        logger.info("memories.export.fetch", outcome="not_found")
        raise HTTPException(status_code=404, detail="Export not found")
    name = exports.sanitize_filename(filename, entry.kind)
    logger.info(
        "memories.export.fetch",
        kind=entry.kind,
        size_kb=len(entry.data) // 1024,
        outcome="served",
    )
    return Response(
        content=entry.data,
        media_type=exports.MEDIA_TYPES[entry.kind],
        headers={
            "Content-Disposition": exports.content_disposition(name, entry.kind),
            "X-Content-Type-Options": "nosniff",
        },
    )
