# backend/api/auth.py
import asyncio

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, Dict, Any
from backend.services.auth_service import AuthService
from backend.services.service_utils import validate_service

router = APIRouter()
auth_service = AuthService()


class ServiceAuthStatus(BaseModel):
    authenticated: bool
    expires_at: Optional[str] = None
    display_name: Optional[str] = None
    token_expired: Optional[bool] = None


class AllServicesStatus(BaseModel):
    services: Dict[str, Any]


class RefreshResult(BaseModel):
    refreshed: bool
    remaining_seconds: float
    status: str


@router.get("/status", response_model=AllServicesStatus)
async def get_status():
    """Get authentication status for all services."""
    return await auth_service.get_status()


@router.post("/login")
async def login(service: str = Query(..., description="Service to login to")):
    """Login to a specific service via browser OAuth.

    Answers 200 ``{"status": "ok", "service": ...}`` once the credentials are
    saved, 400 for an unknown service, 401 when the login failed, and 409
    ``{"detail": "login_cancelled"}`` when ``POST /login/cancel`` stopped it.
    Any other cancellation (shutdown, a newer login superseding this one)
    propagates unchanged.
    """
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    try:
        success = await auth_service.login_with_browser(service)
    except asyncio.CancelledError:
        if not auth_service.consume_login_cancel(service):
            raise
        # The user's Cancel: this request's task was cancelled on purpose, so
        # undo that cancel request and answer normally.
        task = asyncio.current_task()
        if task is not None:
            task.uncancel()
        raise HTTPException(status_code=409, detail="login_cancelled")
    if not success:
        raise HTTPException(status_code=401, detail="Login failed")
    return {"status": "ok", "service": service}


@router.post("/login/cancel")
async def cancel_login(service: str = Query(..., description="Service to cancel")):
    """Cancel the in-progress browser login of a service (the login dialog's Cancel).

    Returns ``{"cancelled": bool}``: true when a login was stopped (its own
    ``POST /login`` then answers 409), false when none was in flight for the
    service, including a login that already succeeded (its credentials stay
    saved). 400 for an unknown service.
    """
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")
    return {"cancelled": await auth_service.cancel_login(service)}


@router.get("/geo-availability")
async def geo_availability(service: str = Query(..., description="Service to check")):
    """Whether a region-restricted service (Yodel is Japan-only on the web) is
    reachable from this connection. The frontend uses this to warn before a Yodel
    login from outside Japan. Non-restricted services always return available."""
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")
    return await auth_service.check_geo_availability(service)


@router.post("/logout")
async def logout(service: str = Query(..., description="Service to logout from")):
    """Logout from a specific service."""
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    await auth_service.logout(service)
    return {"status": "ok", "service": service}


@router.post("/refresh-if-needed", response_model=RefreshResult)
async def refresh_if_needed(
    service: str = Query(..., description="Service to refresh"),
):
    """Proactively refresh token if it's close to expiring for a specific service."""
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    result = await auth_service.refresh_if_needed(service, threshold_minutes=10)
    return result
