"""Media-request bootstrap for the local API (security audit 2026-11-13).

<img>, <video> and hidden-iframe downloads cannot add the X-SakaDesk-Token
header, so the page swaps the header once for an HttpOnly SameSite=Strict
cookie. The API guard accepts the cookie for GET/HEAD only, so a cookie can
never authorize a change and cannot mint itself: this POST needs the header.
"""

from __future__ import annotations

import structlog
from fastapi import APIRouter, Response

from backend.services import api_auth

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/api/session", tags=["session"])


@router.post("/bootstrap")
async def bootstrap(response: Response) -> dict[str, bool]:
    response.set_cookie(
        api_auth.TOKEN_COOKIE,
        api_auth.LAUNCH_TOKEN,
        httponly=True,
        samesite="strict",
        path="/api/",
    )
    logger.info("api_session_bootstrapped")
    return {"ok": True}
