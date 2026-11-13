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
    model_validator,
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
    "notify_open_login",
    "notify_open_memories",
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
    "sync_sequence_resumed",
    "sync_start_all_failed",
    "sync_cancel_failed",
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
    "translation_legacy_reuse",
    "translation_legacy_resave_failed",
    "conv_hydrate_retry",
    "conv_hydrate_failed",
    "oshi_mirror_failed",
    "conv_hydrate_recovered",
    "conv_write_failed",
    "read_state_save_deferred",
    "read_state_pending_flushed",
    "read_state_sync_failed",
    "sidebar_load",
    "chat_load",
    "memories_open",
    "memories_page",
    "memories_load",
    "memories_jump",
    "memories_toggle",
    "memories_skip",
    "memories_radio",
    "memories_gacha",
    "memories_capsule",
    "recap_load",
    "recap_play",
    "recap_poster",
    "recap_share",
    "recap_opening",
    "ui_wait",
    "media_grid",
    "media_poster",
    "external_link",
    "csp_violation",
    "output_folder_pick_failed",
    "output_folder_pick_ignored",
    "setup_save_failed",
    "download_refused",
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
        "delivered",
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
        "caller",
        "written",
        "dropped",
        "kind",
        "style",
        "wait_ms",
        "grid",
        "first_tile_ms",
        "visible",
    }
)
WARNING_EVENTS = frozenset(
    {
        "csp_violation",
        "call_error",
        "app_load_failed",
        "design_tokens_fallback",
        "design_fonts_fallback",
        "poll_timeout",
        "poll_failed",
        "poll_gave_up",
        "translation_batch_failed",
        "translation_legacy_resave_failed",
        "conv_hydrate_failed",
        "conv_write_failed",
        "read_state_sync_failed",
    }
)

# The loading-UX wait breadcrumb (frontend design/loading.ts `logWait`): a slow, very slow,
# timed-out or cancelled wait, with its surface code and how long it had waited.
UI_WAIT_PHASES = frozenset({"slow", "very_slow", "timeout", "cancelled"})
UI_WAIT_FIELDS = frozenset({"surface", "phase", "wait_ms"})

# Measured numbers: a non-negative integer on every event, never a code string such as "180".
# ``wait_ms`` is the loading-UX wait; ``first_tile_ms`` and ``visible`` are the media grid's
# first-paint breadcrumb (``media_grid``, media pipeline 0.5.0).
NON_NEGATIVE_INT_FIELDS = frozenset({"wait_ms", "first_tile_ms", "visible"})

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
        for key in NON_NEGATIVE_INT_FIELDS & set(value):
            number = value[key]
            if isinstance(number, bool) or not isinstance(number, int) or number < 0:
                raise ValueError(f"{key} must be a non-negative integer")
        return value

    @model_validator(mode="after")
    def _ui_wait_is_complete(self) -> "ClientLogEntry":
        # A wait breadcrumb is only useful with all three fields. Do not echo values back:
        # they are client-supplied text.
        if self.event != "ui_wait":
            return self
        if not UI_WAIT_FIELDS <= set(self.fields):
            raise ValueError("ui_wait needs surface, phase and wait_ms")
        if self.fields["phase"] not in UI_WAIT_PHASES:
            raise ValueError("unknown ui_wait phase")
        return self


@router.post("", status_code=204)
async def post_client_log(entry: ClientLogEntry) -> Response:
    """Record one whitelisted UI breadcrumb in the backend log."""
    log = logger.warning if entry.event in WARNING_EVENTS else logger.info
    log(entry.event, source="client", **entry.fields)
    return Response(status_code=204)
