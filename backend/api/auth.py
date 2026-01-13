from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from backend.services.auth_service import AuthService

router = APIRouter()
auth_service = AuthService()

class AuthStatus(BaseModel):
    is_authenticated: bool
    app_id: Optional[str] = None

class RefreshResult(BaseModel):
    refreshed: bool
    remaining_seconds: float
    status: str

@router.get("/status", response_model=AuthStatus)
async def get_status():
    return await auth_service.get_status()

@router.post("/login")
async def login():
    success = await auth_service.login_with_browser()
    if not success:
        raise HTTPException(status_code=401, detail="Login failed")
    return {"status": "ok"}

@router.post("/refresh-if-needed", response_model=RefreshResult)
async def refresh_if_needed():
    """
    Proactively refresh token if it's close to expiring.

    Called by frontend on a 50-55 minute interval (with jitter) to ensure
    tokens stay fresh. The frontend should reset its timer after this returns
    success to align with the new token's lifetime.

    Returns:
        RefreshResult with refresh status and remaining token lifetime.
    """
    result = await auth_service.refresh_if_needed(threshold_minutes=10)
    return result
