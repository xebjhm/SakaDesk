# backend/api/auth.py
import asyncio

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, Dict, Any
from backend.services.auth_service import AuthService, LoginCancelledError
from backend.services.shutdown_state import is_shutting_down
from backend.services.service_utils import validate_service

router = APIRouter()
auth_service = AuthService()

# The frontend's id for one login attempt (letters, digits, - and _).
ATTEMPT_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"


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
async def login(
    service: str = Query(..., description="Service to login to"),
    attempt: Optional[str] = Query(
        None, pattern=ATTEMPT_PATTERN, description="The frontend's id for this login"
    ),
):
    """Login to a specific service via browser OAuth.

    Answers 200 ``{"status": "ok", "service": ...}`` once the credentials are
    saved, 400 for an unknown service, 401 when the login failed, and 409
    ``{"detail": "login_cancelled"}`` when ``POST /login/cancel`` stopped it
    (also when the cancel for ``attempt`` arrived first: no browser opens).
    Any other cancellation (shutdown, a newer login superseding this one)
    propagates unchanged, also when it lands together with the user's cancel.
    """
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    try:
        success = await auth_service.login_with_browser(service, attempt)
    except LoginCancelledError:
        raise HTTPException(status_code=409, detail="login_cancelled")
    except asyncio.CancelledError:
        users_cancel = auth_service.consume_login_cancel(service)
        task = asyncio.current_task()
        # Only the user's cancel was requested (exactly one cancel pending, not
        # shutting down): undo it and answer. Otherwise it propagates.
        if (
            not users_cancel
            or task is None
            or task.cancelling() != 1
            or is_shutting_down()
        ):
            raise
        task.uncancel()
        raise HTTPException(status_code=409, detail="login_cancelled")
    if not success:
        raise HTTPException(status_code=401, detail="Login failed")
    return {"status": "ok", "service": service}


@router.post("/login/cancel")
async def cancel_login(
    service: str = Query(..., description="Service to cancel"),
    attempt: Optional[str] = Query(
        None, pattern=ATTEMPT_PATTERN, description="The login attempt to cancel"
    ),
):
    """Cancel the browser login of a service (the login dialog's Cancel).

    Returns ``{"cancelled": bool}``: true when a login was stopped, or when
    ``attempt`` has not reached the backend yet and will refuse to start (its
    own ``POST /login`` then answers 409); false when none was in flight for
    the service, including a login that already finished (it may have saved
    its credentials, so the caller re-checks the auth status). 400 for an
    unknown service.
    """
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")
    return {"cancelled": await auth_service.cancel_login(service, attempt)}


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
