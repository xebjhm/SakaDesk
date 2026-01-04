from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from backend.services.auth_service import AuthService

router = APIRouter()
auth_service = AuthService()

class AuthStatus(BaseModel):
    is_authenticated: bool
    app_id: Optional[str] = None

@router.get("/status", response_model=AuthStatus)
async def get_status():
    return await auth_service.get_status()

@router.post("/login")
async def login():
    success = await auth_service.login_with_browser()
    if not success:
        raise HTTPException(status_code=401, detail="Login failed")
    return {"status": "ok"}
