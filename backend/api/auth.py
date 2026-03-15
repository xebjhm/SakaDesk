# backend/api/auth.py
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
    """Login to a specific service via browser OAuth."""
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    success = await auth_service.login_with_browser(service)
    if not success:
        raise HTTPException(status_code=401, detail="Login failed")
    return {"status": "ok", "service": service}


@router.post("/logout")
async def logout(service: str = Query(..., description="Service to logout from")):
    """Logout from a specific service."""
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    auth_service.logout(service)
    return {"status": "ok", "service": service}


@router.post("/refresh-if-needed", response_model=RefreshResult)
async def refresh_if_needed(service: str = Query(..., description="Service to refresh")):
    """Proactively refresh token if it's close to expiring for a specific service."""
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    result = await auth_service.refresh_if_needed(service, threshold_minutes=10)
    return result
