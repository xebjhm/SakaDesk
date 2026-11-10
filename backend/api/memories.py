"""Memories API: year recaps, the member memoir (list, header, names, timeline, binder), On This Day, the day view and the album for the active service, the export handoff and the share GIF."""

from __future__ import annotations

import asyncio
import re
from datetime import date, datetime, timezone
from pathlib import Path

import structlog
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from backend.api.content import get_output_dir
from backend.services.archive_urls import ArchiveReadError
from backend.services.memories import (
    album,
    album_colors,
    binder,
    day_view,
    exports,
    memoir,
    nickname_moments,
    on_this_day,
    people,
    share_gif,
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
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


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
