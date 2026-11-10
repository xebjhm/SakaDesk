"""Memories API: year-recap payloads for the active service, and the export handoff."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import structlog
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from backend.api.content import get_output_dir
from backend.services.archive_urls import ArchiveReadError, resolve_within
from backend.services.memories import exports, index
from backend.services.memories.recap import (
    build_member_recap,
    build_members_overview,
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
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > exports.MAX_BYTES:
            logger.warning("memories.export.reject", kind=kind, reason="too_large")
            raise HTTPException(status_code=413, detail="Export too large")
        chunks.append(chunk)
    data = b"".join(chunks)
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
