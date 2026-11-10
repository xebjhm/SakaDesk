"""``/api/media``: the shared media pipeline's endpoints (0.5.0).

- ``POST /api/media/meta``: placeholders and content versions of up to
  :data:`media_meta.META_BATCH_MAX` media-route URLs at once (see
  ``backend.services.media_meta.meta_for_urls``). The answer is fresh state,
  so it is sent with ``Cache-Control: no-store`` (``ApiNoStoreMiddleware``).
- ``PUT /api/media/poster/{file_path}``: a client-captured poster frame of
  an archive video (the fallback when the Windows Shell gave none; see
  ``backend.services.video_poster.ingest_client``).

Logs carry counts and codes only (``media_meta_rejected``: ``reason``,
``count``; ``media_poster_rejected``: ``reason``).
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import quote

import structlog
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.services import archive_urls, media_meta, photo_thumb, video_poster

router = APIRouter()
logger = structlog.get_logger(__name__)

MAX_URL_CHARS = 4096
"""Longest URL accepted in a meta batch (422 beyond); real media URLs are far shorter."""


class MetaRequest(BaseModel):
    urls: list[Annotated[str, Field(max_length=MAX_URL_CHARS)]]


def _note_foreground() -> None:
    """Tell the pre-generation worker a gallery is in use (it yields for a while).

    A no-op until Task M4 wires ``media_pregen.note_foreground`` in.
    """


@router.post("/meta")
async def post_meta(body: MetaRequest) -> dict[str, Any]:
    """Meta items for a batch of media-route URLs: ``{"items": {url: item | null}}``.

    400 ``bad_batch`` for an empty batch or more than
    ``media_meta.META_BATCH_MAX`` URLs; 422 for a body that is not
    ``{"urls": [str, ...]}``. The items only ever echo the URLs sent; they
    never contain a filesystem path.
    """
    if not 1 <= len(body.urls) <= media_meta.META_BATCH_MAX:
        logger.info("media_meta_rejected", reason="bad_batch", count=len(body.urls))
        raise HTTPException(status_code=400, detail="bad_batch")
    _note_foreground()
    return {"items": await media_meta.meta_for_urls(body.urls)}


async def _read_capped(stream: AsyncIterator[bytes], limit: int) -> bytes | None:
    """The whole body, or ``None`` as soon as it passes ``limit`` bytes (never read further)."""
    buf = bytearray()
    async for chunk in stream:
        buf += chunk
        if len(buf) > limit:
            return None
    return bytes(buf)


def _poster_target(file_path: str) -> tuple[Path, str] | None:
    """``(archive video, its photo_thumb.archive_rel key)`` of a route path, or ``None``. Blocking.

    The path is resolved like a ``/api/content/media`` URL
    (``archive_urls.classify_media_route``: a known service id, strictly
    inside that service's folder), then must be a regular archive file
    (``archive_file_ok``) with a video suffix.
    """
    from backend.api.content import get_output_dir  # the media route's output dir

    output_dir = get_output_dir()
    url = archive_urls.MEDIA_PREFIX + quote(file_path, safe="/")
    found = archive_urls.classify_media_route(output_dir, url)
    if isinstance(found, str):
        logger.info("media_poster_rejected", reason=found)
        return None
    target = found[1]
    if not photo_thumb.is_video(target):
        logger.info("media_poster_rejected", reason="not_video")
        return None
    try:
        ok = archive_urls.archive_file_ok(output_dir, target)
    except archive_urls.ArchiveReadError:
        ok = False
    if not ok:
        logger.info("media_poster_rejected", reason="not_file")
        return None
    return target, photo_thumb.archive_rel(output_dir, target)


_POSTER_ERRORS = {
    "bad_image": (400, "bad_image"),
    "too_large": (413, "too_large"),
    "write_failed": (503, "write_failed"),
}


@router.put("/poster/{file_path:path}")
async def put_poster(file_path: str, request: Request) -> JSONResponse:
    """Store a client-captured poster of an archive video.

    ``file_path`` is a media-route path (``<service id>/<rest>``); the body is
    a raw ``image/webp`` or ``image/jpeg`` of at most
    ``video_poster.POSTER_UPLOAD_MAX_BYTES``. The body is streamed and
    reading stops past the limit (413; a larger declared ``Content-Length``
    is refused before reading). Answers 201 ``{"v"}`` when stored, 200
    ``{"v"}`` when this video version already has a poster (the first one
    wins), 400 ``bad_image`` (content type, undecodable, wrong format, over
    a bound), 404 when the target is not a regular archive video (including
    any traversal or another service's folder) and 503 ``write_failed``
    when the poster cache cannot be written. The answer never carries a path.
    """
    limit = video_poster.POSTER_UPLOAD_MAX_BYTES
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        logger.info("media_poster_rejected", reason="too_large")
        raise HTTPException(status_code=413, detail="too_large")
    _note_foreground()
    found = await asyncio.to_thread(_poster_target, file_path)
    if found is None:
        raise HTTPException(status_code=404, detail="File not found")
    body = await _read_capped(request.stream(), limit)
    if body is None:
        logger.info("media_poster_rejected", reason="too_large")
        raise HTTPException(status_code=413, detail="too_large")
    source, rel = found
    outcome, v = await asyncio.to_thread(
        video_poster.ingest_client,
        source,
        rel,
        body,
        request.headers.get("content-type", ""),
    )
    if outcome == "ready":
        return JSONResponse(status_code=201, content={"v": v})
    if outcome == "exists":
        return JSONResponse(status_code=200, content={"v": v})
    status, detail = _POSTER_ERRORS.get(outcome, (404, "File not found"))
    raise HTTPException(status_code=status, detail=detail)
