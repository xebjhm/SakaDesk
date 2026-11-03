"""Background call popup API (spec C3 §4.6).

The popup page reads its call (``GET /calls/{id}``) and reports what B's call
hook did (``POST /calls/{id}/events``); the main window asks whether the popup
already owns a voice (``GET /active``) before ringing it in the app. Only
code-like values are accepted, so names, text or paths never reach the log;
the returned ``path`` is never logged.
"""

from dataclasses import asdict
from typing import Annotated, Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Path, Query, Response
from pydantic import BaseModel, ConfigDict, StrictInt, StringConstraints

from backend.services.call_popup import CallEvent, get_call_popup_controller

router = APIRouter(prefix="/api/call-popup", tags=["call-popup"])

CodeStr = Annotated[str, StringConstraints(pattern=r"^[a-z0-9_]{1,40}$")]
CallId = Annotated[int, Path(ge=1, le=999_999_999_999)]
EventName = Literal[
    "ringing",
    "skipped",
    "answered",
    "declined",
    "timeout",
    "ended",
    "cancelled",
    "error",
]


class CallEventBody(BaseModel):
    """One popup-page report; extra keys are rejected."""

    model_config = ConfigDict(extra="forbid")

    event: EventName
    reason: Optional[CodeStr] = None
    error_type: Optional[CodeStr] = None
    message_id: Optional[StrictInt] = None


@router.get("/calls/{call_id}")
async def get_call(call_id: CallId) -> dict[str, Any]:
    """Return the active call the popup page should show, or 404."""
    info = get_call_popup_controller().info(call_id)
    if info is None:
        raise HTTPException(status_code=404, detail="No such call")
    return asdict(info)


@router.post("/calls/{call_id}/events", status_code=204)
async def post_call_event(call_id: CallId, body: CallEventBody) -> Response:
    """Forward a popup event to the controller; 409 when it was not applied."""
    ok = await get_call_popup_controller().on_event(
        call_id,
        CallEvent(body.event, body.reason, body.error_type, body.message_id),
    )
    return Response(status_code=204 if ok else 409)


@router.get("/active")
async def get_active(
    service: Annotated[str, Query(pattern=r"^[a-z0-9_]{1,40}$")],
    group_id: Annotated[str, Query(pattern=r"^[0-9]{1,12}$")],
    member_id: Annotated[str, Query(pattern=r"^[0-9]{1,12}$")],
    message_id: Annotated[int, Query(ge=0)],
) -> dict[str, bool]:
    """Whether the popup owns the call for this voice message."""
    return {
        "active": get_call_popup_controller().is_active_for(
            service, group_id, member_id, message_id
        )
    }
