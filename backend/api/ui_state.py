"""Foreground / current-chat reporting.

The webview POSTs the chat it is showing and whether the window is focused, so
toasts can skip the chat being viewed. A focused report also tells the
call popup controller that the main window came forward, so a popup that is
still ringing yields to it (no toast). That runs as a tracked background task,
so the 204 never waits on the popup host. Only code-like values are accepted
(ids and the service code), so names, text or paths can never reach the log.

``POST /api/ui-state/memories`` reports whether Memories is open and the
window focused. It is a separate flag, so it never overwrites the chat state.
"""

from typing import Annotated, Optional

import structlog
from fastapi import APIRouter, Response
from pydantic import BaseModel, StrictBool, StringConstraints

from backend.services.background_tasks import track_background_task
from backend.services.call_popup import get_call_popup_controller
from backend.services.notification_planner import UiState
from backend.services.ui_state import (
    MemoriesView,
    set_memories_view,
    set_ui_state,
)

router = APIRouter(prefix="/api/ui-state", tags=["ui-state"])
logger = structlog.get_logger(__name__)

ServiceCode = Annotated[str, StringConstraints(pattern=r"^[a-z0-9_]{1,40}$")]
IdStr = Annotated[str, StringConstraints(pattern=r"^[0-9]{1,12}$")]


class UiStateRequest(BaseModel):
    """``member_id`` is ``"0"`` for a room."""

    service: Optional[ServiceCode]
    group_id: Optional[IdStr]
    member_id: Optional[IdStr]
    focused: StrictBool


async def _popup_foreground() -> None:
    """Tell the popup controller the main window came forward. Never raises."""
    try:
        await get_call_popup_controller().on_foreground()
    except Exception as e:
        logger.warning("call_popup_foreground_failed", error_type=type(e).__name__)


@router.post("", status_code=204)
async def post_ui_state(body: UiStateRequest) -> Response:
    """Store the reported UI state for the notification planner."""
    set_ui_state(
        UiState(
            service=body.service,
            group_id=body.group_id,
            member_id=body.member_id,
            focused=body.focused,
        )
    )
    logger.debug(
        "ui_state",
        service=body.service,
        group_id=body.group_id,
        member_id=body.member_id,
        focused=body.focused,
    )
    if body.focused:
        # The main window came forward: a popup that is still ringing yields to
        # it (no toast). Not awaited: the cancel waits on the popup host.
        track_background_task(_popup_foreground(), name="call_popup_foreground")
    return Response(status_code=204)


class MemoriesStateRequest(BaseModel):
    """``open``: the Memories feature is mounted; ``focused``: window focused and visible."""

    open: StrictBool
    focused: StrictBool


@router.post("/memories", status_code=204)
async def post_memories_state(body: MemoriesStateRequest) -> Response:
    """Store whether Memories is in view, for the Memories notifications."""
    set_memories_view(MemoriesView(open=body.open, focused=body.focused))
    logger.debug("ui_state_memories", open=body.open, focused=body.focused)
    return Response(status_code=204)
