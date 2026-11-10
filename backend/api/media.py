"""``/api/media``: the shared media pipeline's endpoints (0.5.0).

- ``POST /api/media/meta``: placeholders and content versions of up to
  :data:`media_meta.META_BATCH_MAX` media-route URLs at once (see
  ``backend.services.media_meta.meta_for_urls``). The answer is fresh state,
  so it is sent with ``Cache-Control: no-store`` (``ApiNoStoreMiddleware``).

Logs carry counts and codes only (``media_meta_rejected``: ``reason``, ``count``).
"""

from __future__ import annotations

from typing import Annotated, Any

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.services import media_meta

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
