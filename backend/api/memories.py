"""Memories API: year-recap payloads for the active service, the export handoff and the share GIF."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path

import structlog
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from backend.api.content import get_output_dir
from backend.services.archive_urls import ArchiveReadError, resolve_within
from backend.services.memories import exports, index, share_gif
from backend.services.memories.recap import (
    build_member_recap,
    build_members_overview,
    recap_years,
)
from backend.services.service_utils import get_service_display_name, validate_service

router = APIRouter(prefix="/api/memories", tags=["memories"])
logger = structlog.get_logger(__name__)

MIN_YEAR = 2020


def _service_dir(service: str) -> Path:
    try:
        validate_service(service)
        name = get_service_display_name(service)
    except ValueError:
        logger.warning("memories.api.reject", reason="unknown_service")
        raise HTTPException(status_code=400, detail="Unknown service") from None
    return get_output_dir() / name


def _check_year(year: int, now: datetime) -> None:
    if year < MIN_YEAR or year > now.year + 1:
        logger.warning("memories.api.reject", reason="year_range", year=year)
        raise HTTPException(status_code=400, detail="Year out of range")


def _room_rel(service_data_dir: Path, member: str) -> str:
    """Room path relative to the service dir for a chat-style ``member`` path."""
    output_dir = service_data_dir.parent
    try:
        resolved = resolve_within(output_dir, output_dir / member)
        rel = resolved.relative_to(service_data_dir.resolve())
    except ArchiveReadError:
        logger.warning("memories.api.reject", reason="outside_output_dir")
        raise HTTPException(status_code=400, detail="Invalid member path") from None
    except ValueError:
        logger.warning("memories.api.reject", reason="other_service")
        raise HTTPException(status_code=404, detail="Member not found") from None
    return rel.as_posix()


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
    rel = _room_rel(service_data_dir, member)
    summaries = await index.list_members(service_data_dir)
    summary = next((s for s in summaries if rel in s.member_dirs), None)
    if summary is None:
        logger.info("memories.api.member_not_found", year=year)
        raise HTTPException(status_code=404, detail="Member not found")
    return await build_member_recap(service, service_data_dir, summary, year, now=now)


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
