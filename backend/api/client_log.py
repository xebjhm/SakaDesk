"""Frontend breadcrumb sink.

The webview has no log file of its own, so UI decision paths (such as the
incoming-call flow) POST structured events here and they land in debug.log.
Only whitelisted event names, field keys and code-like values are accepted,
so free text, names, URLs or paths can never reach the log.
"""

from typing import Annotated, Literal, Union

import structlog
from fastapi import APIRouter, Response
from pydantic import (
    BaseModel,
    Field,
    StrictBool,
    StrictInt,
    StringConstraints,
    field_validator,
)

router = APIRouter(prefix="/api/client-log", tags=["client-log"])
logger = structlog.get_logger(__name__)

ClientEvent = Literal[
    "call_ring",
    "call_skip",
    "call_answer",
    "call_decline",
    "call_timeout",
    "call_end",
    "call_cancel",
    "call_error",
    "call_popup_start",
    "call_popup_error",
    "call_popup_heard_applied",
    "call_popup_heard_ignored",
    "app_load_failed",
    "notify_open_chat",
    "backend_sync_followed",
    "backend_sync_skipped",
    "design_tokens_applied",
    "design_tokens_fallback",
    "design_fonts_applied",
    "design_fonts_fallback",
    "avatar_fallback",
    "timeline_jump",
    "letters_load",
    "account_profile_load",
    "letter_avatar",
    "streak_load",
    "blog_load",
    "dialog",
    "dialog_load",
    "call_layer",
    "sync_start_skipped",
    "menu_item_blocked",
    "blog_fallback",
    "group_marker_fallback",
    "entry_validation",
    "archive_stats_load",
    "celebration",
    "sync_sequence",
    "letter_viewer",
    "letter_jump",
    "display_density_change",
    "favorite_video_error",
    "favorite_video_lazy_unsupported",
    "diagnostics_disk_usage",
    "calendar_picker",
    "media_playback",
    "poll_timeout",
    "poll_skipped",
    "poll_failed",
    "poll_retry",
    "poll_gave_up",
    "translation_batch_failed",
]

ALLOWED_FIELDS = frozenset(
    {
        "service",
        "group_id",
        "member_id",
        "message_id",
        "reason",
        "phase",
        "ring_ms",
        "talk_ms",
        "error_type",
        "surface",
        "call_id",
        "changed",
        "has_target",
        "theme",
        "size",
        "target",
        "index",
        "corrections",
        "outcome",
        "jump_ms",
        "path",
        "count",
        "history",
        "fallback",
        "dppx_pct",
        "ready_state",
        "network_state",
        "error_code",
        "aborted",
        "key",
        "timeout_ms",
    }
)
WARNING_EVENTS = frozenset(
    {
        "call_error",
        "app_load_failed",
        "design_tokens_fallback",
        "design_fonts_fallback",
        "poll_timeout",
        "poll_failed",
        "poll_gave_up",
        "translation_batch_failed",
    }
)

CodeStr = Annotated[str, StringConstraints(pattern=r"^[a-z0-9_]{1,40}$")]
FieldValue = Union[StrictBool, StrictInt, CodeStr]


class ClientLogEntry(BaseModel):
    event: ClientEvent
    fields: dict[str, FieldValue] = Field(default_factory=dict)

    @field_validator("fields")
    @classmethod
    def _only_known_keys(cls, value: dict[str, FieldValue]) -> dict[str, FieldValue]:
        # Do not echo the offending keys back: they are client-supplied text.
        if not set(value) <= ALLOWED_FIELDS:
            raise ValueError("unknown field key")
        return value


@router.post("", status_code=204)
async def post_client_log(entry: ClientLogEntry) -> Response:
    """Record one whitelisted UI breadcrumb in the backend log."""
    log = logger.warning if entry.event in WARNING_EVENTS else logger.info
    log(entry.event, source="client", **entry.fields)
    return Response(status_code=204)
