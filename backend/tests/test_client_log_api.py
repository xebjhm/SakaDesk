"""Tests for POST /api/client-log (whitelisted UI breadcrumbs)."""

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app

client = TestClient(app)


def _client_events(logs):
    return [e for e in logs if e.get("source") == "client"]


def test_valid_event_is_logged_with_client_source():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={
                "event": "call_ring",
                "fields": {
                    "service": "hinatazaka46",
                    "group_id": 43,
                    "member_id": 58,
                    "message_id": 123456,
                },
            },
        )
    assert res.status_code == 204
    events = _client_events(logs)
    assert len(events) == 1
    assert events[0]["event"] == "call_ring"
    assert events[0]["log_level"] == "info"
    assert events[0]["service"] == "hinatazaka46"
    assert events[0]["message_id"] == 123456


def test_fields_may_be_omitted():
    with capture_logs() as logs:
        res = client.post("/api/client-log", json={"event": "call_timeout"})
    assert res.status_code == 204
    assert len(_client_events(logs)) == 1


def test_bool_value_is_accepted():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={
                "event": "call_skip",
                "fields": {"reason": "disabled", "ring_ms": True},
            },
        )
    assert res.status_code == 204
    assert _client_events(logs)[0]["ring_ms"] is True


def test_call_error_logs_at_warning():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={
                "event": "call_error",
                "fields": {"error_type": "playback_failed", "phase": "connected"},
            },
        )
    assert res.status_code == 204
    assert _client_events(logs)[0]["log_level"] == "warning"


def test_non_error_event_logs_at_info():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={"event": "call_skip", "fields": {"reason": "no_voice"}},
        )
    assert res.status_code == 204
    events = _client_events(logs)
    assert len(events) == 1
    assert events[0]["log_level"] == "info"


@pytest.mark.parametrize(
    "body",
    [
        {"event": "not_an_event"},
        {"event": "call_ring", "fields": {"member_name": "x"}},
        {"event": "call_ring", "fields": {"reason": "has space"}},
        {"event": "call_ring", "fields": {"reason": "金村"}},
        {"event": "call_ring", "fields": {"reason": "Upper"}},
        {"event": "call_ring", "fields": {"reason": "a" * 41}},
        {"event": "call_ring", "fields": {"reason": ""}},
        {"event": "call_ring", "fields": {"reason": "abc\n"}},
        {"event": "call_ring", "fields": {"ring_ms": 1.5}},
        {"event": "call_ring", "fields": {"ring_ms": None}},
        {"event": "call_ring", "fields": {"ring_ms": {"a": 1}}},
        {"event": "call_ring", "fields": {"ring_ms": [1]}},
        {"event": "call_ring", "fields": {"reason": "/api/content/media/x"}},
    ],
)
def test_invalid_body_is_rejected_and_not_logged(body):
    with capture_logs() as logs:
        res = client.post("/api/client-log", json=body)
    assert res.status_code == 422
    assert _client_events(logs) == []


def test_notify_open_chat_event_is_accepted():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={"event": "notify_open_chat", "fields": {"service": "hinatazaka46"}},
        )
    assert res.status_code == 204
    events = _client_events(logs)
    assert len(events) == 1
    assert events[0]["event"] == "notify_open_chat"
    assert events[0]["log_level"] == "info"
    assert events[0]["service"] == "hinatazaka46"


def test_backend_sync_followed_event_is_accepted():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={
                "event": "backend_sync_followed",
                "fields": {"service": "hinatazaka46"},
            },
        )
    assert res.status_code == 204
    events = _client_events(logs)
    assert len(events) == 1
    assert events[0]["event"] == "backend_sync_followed"
    assert events[0]["log_level"] == "info"
    assert events[0]["service"] == "hinatazaka46"


def test_backend_sync_skipped_event_is_accepted():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={
                "event": "backend_sync_skipped",
                "fields": {"service": "hinatazaka46", "reason": "already_handled"},
            },
        )
    assert res.status_code == 204
    events = _client_events(logs)
    assert len(events) == 1
    assert events[0]["event"] == "backend_sync_skipped"
    assert events[0]["reason"] == "already_handled"


def test_call_popup_heard_applied_is_accepted_with_its_fields():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={
                "event": "call_popup_heard_applied",
                "fields": {
                    "service": "hinatazaka46",
                    "group_id": 34,
                    "member_id": 58,
                    "message_id": 10,
                    "changed": True,
                },
            },
        )
    assert res.status_code == 204
    events = _client_events(logs)
    assert len(events) == 1
    assert events[0]["event"] == "call_popup_heard_applied"
    assert events[0]["log_level"] == "info"
    assert events[0]["changed"] is True
    assert events[0]["message_id"] == 10


@pytest.mark.parametrize("reason", ["already_heard", "not_ready", "malformed", "error"])
def test_call_popup_heard_ignored_is_accepted(reason):
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={
                "event": "call_popup_heard_ignored",
                "fields": {"reason": reason},
            },
        )
    assert res.status_code == 204
    assert _client_events(logs)[0]["reason"] == reason


def test_call_ring_from_the_popup_carries_surface():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={
                "event": "call_ring",
                "fields": {"surface": "popup", "message_id": 10},
            },
        )
    assert res.status_code == 204
    assert _client_events(logs)[0]["surface"] == "popup"


def test_call_popup_start_accepts_call_id():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={"event": "call_popup_start", "fields": {"call_id": 1}},
        )
    assert res.status_code == 204
    assert _client_events(logs)[0]["call_id"] == 1


def test_call_popup_error_is_accepted_with_error_type():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={
                "event": "call_popup_error",
                "fields": {"call_id": 1, "error_type": "type_error"},
            },
        )
    assert res.status_code == 204
    assert _client_events(logs)[0]["error_type"] == "type_error"


def test_call_popup_events_still_reject_unknown_keys_and_bad_values():
    for body in (
        {"event": "call_popup_start", "fields": {"bogus": "x"}},
        {"event": "call_popup_error", "fields": {"error_type": "Has Space"}},
    ):
        with capture_logs() as logs:
            res = client.post("/api/client-log", json=body)
        assert res.status_code == 422
        assert _client_events(logs) == []


def test_app_load_failed_is_accepted_as_a_warning():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={"event": "app_load_failed", "fields": {"error_type": "load_failed"}},
        )
    assert res.status_code == 204
    (ev,) = _client_events(logs)
    assert (ev["event"], ev["log_level"], ev["error_type"]) == (
        "app_load_failed",
        "warning",
        "load_failed",
    )


def test_notify_open_chat_accepts_has_target():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={
                "event": "notify_open_chat",
                "fields": {"service": "hinatazaka46", "has_target": True},
            },
        )
    assert res.status_code == 204
    (event,) = _client_events(logs)
    assert event["has_target"] is True


def test_notify_open_login_accepts_delivered():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={
                "event": "notify_open_login",
                "fields": {"service": "sakurazaka46", "delivered": True},
            },
        )
    assert res.status_code == 204
    (event,) = _client_events(logs)
    assert event["delivered"] is True


@pytest.mark.parametrize(
    ("event", "fields", "level"),
    [
        ("design_tokens_applied", {"theme": "sakurazaka"}, "info"),
        ("design_tokens_fallback", {"reason": "unknown_service"}, "warning"),
        ("design_fonts_applied", {"target": "zh_tw"}, "info"),
        ("design_fonts_fallback", {"target": "zh_tw"}, "warning"),
        ("avatar_fallback", {"size": "md"}, "info"),
        ("avatar_fallback", {"surface": "member_select"}, "info"),
        ("display_density_change", {"dppx_pct": 175}, "info"),
        ("menu_item_blocked", {"target": "sent_letters"}, "info"),
        ("blog_fallback", {"target": "card_thumb", "reason": "image_error"}, "info"),
        (
            "blog_fallback",
            {"target": "timeline_thumb", "reason": "image_error"},
            "info",
        ),
        (
            "group_marker_fallback",
            {"target": "add_service", "reason": "unknown_service"},
            "info",
        ),
        (
            "group_marker_fallback",
            {"target": "sync_row", "reason": "unknown_service"},
            "info",
        ),
        ("entry_validation", {"surface": "setup", "reason": "missing_folder"}, "info"),
        ("archive_stats_load", {"outcome": "ok"}, "info"),
        ("archive_stats_load", {"outcome": "failed"}, "info"),
        ("celebration", {"target": "first_sync", "outcome": "shown"}, "info"),
        (
            "celebration",
            {"target": "first_sync", "outcome": "skipped", "reason": "sync_failed"},
            "info",
        ),
        (
            "celebration",
            {"target": "milestone_messages", "outcome": "shown", "count": 5000},
            "info",
        ),
        ("celebration", {"target": "milestone_days", "outcome": "seeded"}, "info"),
        ("favorite_video_error", {}, "info"),
        ("favorite_video_error", {"phase": "load"}, "info"),
        ("favorite_video_lazy_unsupported", {}, "info"),
    ],
)
def test_design_system_events_are_accepted(event, fields, level):
    with capture_logs() as logs:
        res = client.post("/api/client-log", json={"event": event, "fields": fields})
    assert res.status_code == 204
    entry = _client_events(logs)[0]
    assert entry["event"] == event
    assert entry["log_level"] == level
    for key, value in fields.items():
        assert entry[key] == value


def test_timeline_jump_is_accepted_with_its_fields():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={
                "event": "timeline_jump",
                "fields": {
                    "target": "first_unread",
                    "index": 2500,
                    "corrections": 1,
                    "outcome": "landed",
                    "jump_ms": 140,
                },
            },
        )
    assert res.status_code == 204
    events = _client_events(logs)
    assert len(events) == 1
    assert events[0]["event"] == "timeline_jump"
    assert events[0]["log_level"] == "info"
    assert events[0]["outcome"] == "landed"
    assert events[0]["corrections"] == 1


def test_timeline_jump_accepts_the_path_field():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={
                "event": "timeline_jump",
                "fields": {"target": "date", "path": "far_unsettled"},
            },
        )
    assert res.status_code == 204
    events = _client_events(logs)
    assert len(events) == 1
    assert events[0]["path"] == "far_unsettled"


def test_timeline_jump_rejects_text_in_its_fields():
    res = client.post(
        "/api/client-log",
        json={"event": "timeline_jump", "fields": {"target": "高井 俐香"}},
    )
    assert res.status_code == 422


@pytest.mark.parametrize(
    ("event", "fields"),
    [
        ("letters_load", {"outcome": "ok", "count": 3}),
        ("letters_load", {"outcome": "skipped_group"}),
        ("account_profile_load", {"outcome": "error"}),
        ("letter_avatar", {"count": 3, "history": 2, "fallback": 1}),
        ("streak_load", {"outcome": "ok"}),
        ("letters_load", {"outcome": "timeout"}),
        ("letters_load", {"outcome": "late", "count": 2}),
        ("letters_load", {"outcome": "dropped", "count": 1}),
        ("streak_load", {"outcome": "cache_hit"}),
        ("streak_load", {"outcome": "skipped_group"}),
        ("streak_load", {"outcome": "skipped_no_id"}),
    ],
)
def test_letter_breadcrumbs_are_accepted(event, fields):
    with capture_logs() as logs:
        res = client.post("/api/client-log", json={"event": event, "fields": fields})
    assert res.status_code == 204
    [entry] = _client_events(logs)
    assert entry["event"] == event
    assert {key: entry[key] for key in fields} == fields


@pytest.mark.parametrize(
    "fields",
    [
        {"phase": "open", "surface": "sent_letters"},
        {"phase": "open", "surface": "timeline"},
        {"phase": "fallback", "surface": "timeline", "reason": "no_image"},
        {"phase": "fallback", "surface": "sent_letters", "reason": "image_error"},
        {"phase": "skip", "surface": "timeline", "reason": "not_found"},
    ],
)
def test_letter_viewer_breadcrumb_is_accepted(fields):
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log", json={"event": "letter_viewer", "fields": fields}
        )
    assert res.status_code == 204
    [entry] = _client_events(logs)
    assert entry["event"] == "letter_viewer"
    assert entry["log_level"] == "info"
    assert {key: entry[key] for key in fields} == fields


@pytest.mark.parametrize("surface", ["sent_letters", "timeline"])
def test_letter_jump_breadcrumb_is_accepted(surface):
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={"event": "letter_jump", "fields": {"surface": surface}},
        )
    assert res.status_code == 204
    [entry] = _client_events(logs)
    assert entry["event"] == "letter_jump"
    assert entry["surface"] == surface


def test_letter_viewer_rejects_letter_text():
    res = client.post(
        "/api/client-log",
        json={"event": "letter_viewer", "fields": {"surface": "いつもありがとう🌸"}},
    )
    assert res.status_code == 422


def test_blog_load_breadcrumb_is_accepted():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={
                "event": "blog_load",
                "fields": {"target": "content", "outcome": "cache_hit", "count": 3},
            },
        )
    assert res.status_code == 204
    event = _client_events(logs)[0]
    assert event["event"] == "blog_load"
    assert event["log_level"] == "info"
    assert event["target"] == "content"
    assert event["outcome"] == "cache_hit"
    assert event["count"] == 3


def test_dialog_breadcrumbs_are_accepted():
    with capture_logs() as logs:
        a = client.post(
            "/api/client-log",
            json={
                "event": "dialog",
                "fields": {
                    "surface": "media_viewer",
                    "phase": "close",
                    "reason": "escape",
                },
            },
        )
        b = client.post(
            "/api/client-log",
            json={
                "event": "dialog_load",
                "fields": {
                    "surface": "blog_gallery",
                    "outcome": "partial",
                    "count": 12,
                },
            },
        )
    assert a.status_code == 204
    assert b.status_code == 204
    events = _client_events(logs)
    assert [e["event"] for e in events] == ["dialog", "dialog_load"]
    assert events[0]["reason"] == "escape"
    assert events[1]["count"] == 12
    assert all(e["log_level"] == "info" for e in events)


def test_dialog_breadcrumb_rejects_free_text():
    res = client.post(
        "/api/client-log",
        json={
            "event": "dialog",
            "fields": {"surface": "Settings Dialog!", "phase": "open"},
        },
    )
    assert res.status_code == 422


def test_call_layer_breadcrumb_is_accepted():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={"event": "call_layer", "fields": {"phase": "lifted", "count": 1}},
        )
    assert res.status_code == 204
    events = _client_events(logs)
    assert events[0]["event"] == "call_layer"
    assert events[0]["phase"] == "lifted"
    assert events[0]["count"] == 1


@pytest.mark.parametrize("reason", ["polling", "starting"])
def test_sync_start_skipped_breadcrumb_is_accepted(reason):
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={"event": "sync_start_skipped", "fields": {"reason": reason}},
        )
    assert res.status_code == 204
    events = _client_events(logs)
    assert events[0]["event"] == "sync_start_skipped"
    assert events[0]["reason"] == reason


@pytest.mark.parametrize("outcome", ["restored", "kept", "dropped"])
def test_call_layer_focus_breadcrumb_is_accepted(outcome):
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={
                "event": "call_layer",
                "fields": {"phase": "focus", "outcome": outcome},
            },
        )
    assert res.status_code == 204
    events = _client_events(logs)
    assert events[0]["phase"] == "focus"
    assert events[0]["outcome"] == outcome


def test_login_after_login_error_breadcrumb_is_accepted():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={
                "event": "dialog_load",
                "fields": {
                    "surface": "login",
                    "outcome": "error",
                    "reason": "after_login",
                },
            },
        )
    assert res.status_code == 204
    events = _client_events(logs)
    assert events[0]["surface"] == "login"
    assert events[0]["reason"] == "after_login"


@pytest.mark.parametrize("outcome", ["all_complete", "partial", "none", "cancelled"])
def test_sync_sequence_breadcrumb_is_accepted(outcome):
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={"event": "sync_sequence", "fields": {"outcome": outcome, "count": 1}},
        )
    assert res.status_code == 204
    events = _client_events(logs)
    assert events[0]["event"] == "sync_sequence"
    assert events[0]["outcome"] == outcome
    assert events[0]["count"] == 1


@pytest.mark.parametrize(
    "fields",
    [
        {"outcome": "pending", "phase": "load"},
        {"outcome": "ready", "phase": "refresh"},
        {"outcome": "ready", "phase": "poll", "count": 3},
        {"outcome": "failed", "phase": "poll", "count": 1},
        {"outcome": "error", "phase": "poll", "count": 2},
        {"outcome": "abandoned", "phase": "poll", "count": 4},
    ],
)
def test_diagnostics_disk_usage_breadcrumb_is_accepted(fields):
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={"event": "diagnostics_disk_usage", "fields": fields},
        )
    assert res.status_code == 204
    [entry] = _client_events(logs)
    assert entry["event"] == "diagnostics_disk_usage"
    assert entry["log_level"] == "info"
    assert {key: entry[key] for key in fields} == fields


def test_diagnostics_disk_usage_rejects_paths():
    res = client.post(
        "/api/client-log",
        json={
            "event": "diagnostics_disk_usage",
            "fields": {"outcome": "D:\\SakaDesk Output"},
        },
    )
    assert res.status_code == 422


@pytest.mark.parametrize(
    "fields",
    [
        {"phase": "open", "count": 7},
        {"phase": "select", "has_target": True},
        {"phase": "select", "has_target": False},
        {"phase": "back", "reason": "escape"},
        {"phase": "back", "reason": "button"},
    ],
)
def test_calendar_picker_breadcrumb_is_accepted(fields):
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log", json={"event": "calendar_picker", "fields": fields}
        )
    assert res.status_code == 204
    [entry] = _client_events(logs)
    assert entry["event"] == "calendar_picker"
    assert entry["log_level"] == "info"
    assert {key: entry[key] for key in fields} == fields


def test_calendar_picker_rejects_holiday_text():
    res = client.post(
        "/api/client-log",
        json={"event": "calendar_picker", "fields": {"reason": "文化の日"}},
    )
    assert res.status_code == 422


@pytest.mark.parametrize(
    "fields",
    [
        {
            "phase": "waiting",
            "surface": "video",
            "ready_state": 2,
            "network_state": 2,
            "error_code": 0,
        },
        {
            "phase": "stalled",
            "surface": "voice",
            "ready_state": 1,
            "network_state": 2,
            "error_code": 0,
            "outcome": "paused",
        },
        {
            "phase": "error",
            "surface": "video",
            "ready_state": 0,
            "network_state": 3,
            "error_code": 2,
        },
        {
            "phase": "play_rejected",
            "surface": "voice",
            "ready_state": 4,
            "network_state": 1,
            "error_code": 0,
            "error_type": "notallowederror",
        },
        {
            "phase": "recovered",
            "surface": "video",
            "ready_state": 3,
            "network_state": 2,
            "error_code": 0,
            "reason": "waiting",
        },
        {
            "phase": "retry",
            "surface": "video",
            "ready_state": 0,
            "network_state": 3,
            "error_code": 4,
        },
        {"phase": "amp_connect_failed", "error_type": "invalidstateerror"},
        {"phase": "amp_resume_failed", "error_type": "notallowederror"},
        {
            "phase": "summary",
            "surface": "video",
            "ready_state": 4,
            "network_state": 1,
            "error_code": 0,
            "count": 7,
            "aborted": 0,
        },
        {
            "phase": "summary",
            "surface": "voice",
            "ready_state": 0,
            "network_state": 0,
            "error_code": 0,
            "count": 1,
            "aborted": 2,
        },
    ],
)
def test_media_playback_breadcrumb_is_accepted(fields):
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log", json={"event": "media_playback", "fields": fields}
        )
    assert res.status_code == 204
    [entry] = _client_events(logs)
    assert entry["event"] == "media_playback"
    assert entry["log_level"] == "info"
    assert {key: entry[key] for key in fields} == fields


@pytest.mark.parametrize(
    "fields",
    [
        {"phase": "error", "path": "/api/content/media/hinatazaka46/v.mp4"},
        {"phase": "error", "surface": "https://example.com/v.mp4"},
        {"phase": "error", "src": "v.mp4"},
    ],
)
def test_media_playback_rejects_urls_and_unknown_keys(fields):
    res = client.post(
        "/api/client-log", json={"event": "media_playback", "fields": fields}
    )
    assert res.status_code == 422


@pytest.mark.parametrize(
    ("event", "fields", "level"),
    [
        (
            "poll_timeout",
            {"key": "sync_progress_hinatazaka46", "timeout_ms": 4000},
            "warning",
        ),
        ("poll_skipped", {"key": "groups", "count": 3}, "info"),
        ("poll_skipped", {"key": "groups_a46", "reason": "stale_service"}, "info"),
        ("poll_failed", {"key": "groups", "error_type": "typeerror"}, "warning"),
        ("poll_failed", {"key": "groups", "error_code": 500}, "warning"),
        ("poll_retry", {"key": "sync_progress_hinatazaka46", "count": 1}, "info"),
        ("poll_gave_up", {"key": "sync_progress_hinatazaka46", "count": 3}, "warning"),
        (
            "translation_batch_failed",
            {"count": 12, "error_type": "typeerror"},
            "warning",
        ),
        (
            "translation_batch_failed",
            {"count": 1, "error_type": "error", "caller": "trigger"},
            "warning",
        ),
    ],
)
def test_poll_breadcrumbs_are_accepted(event, fields, level):
    with capture_logs() as logs:
        res = client.post("/api/client-log", json={"event": event, "fields": fields})
    assert res.status_code == 204
    [entry] = _client_events(logs)
    assert entry["event"] == event
    assert entry["log_level"] == level
    assert {key: entry[key] for key in fields} == fields


def test_poll_breadcrumb_rejects_a_url_as_key():
    res = client.post(
        "/api/client-log",
        json={
            "event": "poll_timeout",
            "fields": {"key": "/api/sync/progress?service=x"},
        },
    )
    assert res.status_code == 422


def test_allowed_fields_never_shadow_log_call_keywords():
    """Field keys are splatted into ``log(event, source="client", **fields)``.

    A field named like one of those keywords would raise ``TypeError`` and turn
    the breadcrumb into a 500, so the allow-list must never contain them.
    """
    from backend.api.client_log import ALLOWED_FIELDS

    assert not ALLOWED_FIELDS & {"source", "event"}


@pytest.mark.parametrize(
    ("event", "fields", "level"),
    [
        (
            "conv_hydrate_retry",
            {"index": 1, "error_type": "appstatehttperror", "error_code": 503},
            "info",
        ),
        ("conv_hydrate_retry", {"index": 2, "error_type": "typeerror"}, "info"),
        (
            "conv_hydrate_retry",
            {
                "index": 5,
                "phase": "background",
                "error_type": "appstatehttperror",
                "error_code": 503,
            },
            "info",
        ),
        ("conv_hydrate_recovered", {"count": 6}, "info"),
        (
            "conv_hydrate_failed",
            {"count": 4, "error_type": "appstatehttperror", "error_code": 500},
            "warning",
        ),
        (
            "conv_write_failed",
            {"error_type": "appstatehttperror", "error_code": 500},
            "warning",
        ),
        ("read_state_pending_flushed", {"written": 1, "dropped": 0}, "info"),
        (
            "read_state_save_deferred",
            {
                "reason": "not_ready",
                "service": "hinatazaka46",
                "group_id": 34,
                "member_id": 58,
            },
            "info",
        ),
        ("read_state_sync_failed", {"error_type": "typeerror"}, "warning"),
        (
            "read_state_sync_failed",
            {"error_type": "http", "error_code": 500},
            "warning",
        ),
    ],
)
def test_read_progress_breadcrumbs_are_accepted(event, fields, level):
    with capture_logs() as logs:
        res = client.post("/api/client-log", json={"event": event, "fields": fields})
    assert res.status_code == 204
    [entry] = _client_events(logs)
    assert entry["event"] == event
    assert entry["log_level"] == level
    assert {key: entry[key] for key in fields} == fields


@pytest.mark.parametrize(
    "fields",
    [
        {"service": "hinatazaka46", "reason": "rejected", "outcome": "error_state"},
        {"service": "hinatazaka46", "reason": "failed", "outcome": "kept_list"},
        {"service": "hinatazaka46", "outcome": "retry"},
    ],
)
def test_sidebar_load_breadcrumb_is_accepted(fields):
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log", json={"event": "sidebar_load", "fields": fields}
        )
    assert res.status_code == 204
    [entry] = _client_events(logs)
    assert entry["event"] == "sidebar_load"
    assert entry["log_level"] == "info"
    assert {key: entry[key] for key in fields} == fields


def test_oshi_mirror_failed_is_allowlisted():
    r = client.post(
        "/api/client-log",
        json={"event": "oshi_mirror_failed", "fields": {"error_type": "typeerror"}},
    )
    assert r.status_code == 204


def test_memories_events_are_allowlisted():
    for event, fields in (
        ("memories_open", {"service": "hinatazaka46"}),
        ("memories_page", {"target": "recap"}),
    ):
        r = client.post("/api/client-log", json={"event": event, "fields": fields})
        assert r.status_code == 204


def test_recap_events_are_allowlisted():
    for event, fields in (
        (
            "recap_load",
            {"target": "member", "outcome": "ok", "count": 4, "member_id": "58"},
        ),
        ("recap_load", {"target": "members", "outcome": "rejected", "error_code": 500}),
        (
            "recap_play",
            {
                "phase": "step",
                "index": 1,
                "key": "s02_name",
                "reason": "key",
                "member_id": "58",
            },
        ),
        ("recap_play", {"phase": "skip", "key": "s03_clock", "reason": "not_built"}),
    ):
        r = client.post("/api/client-log", json={"event": event, "fields": fields})
        assert r.status_code == 204


def test_recap_poster_events_are_allowlisted():
    for fields in (
        {"phase": "open", "count": 3, "member_id": "58", "surface": "list"},
        {"phase": "skip", "reason": "no_poster", "member_id": "58"},
        {"phase": "font_fallback", "fallback": "font_embed_timeout"},
        {
            "phase": "font_fallback",
            "fallback": "font_truncated",
            "count": 70,
            "dropped": 6,
            "member_id": "58",
        },
        {"phase": "save", "outcome": "handed_off", "member_id": "58"},
        {"phase": "save_failed", "reason": "render_failed", "member_id": "58"},
        {
            "phase": "save_failed",
            "reason": "write_failed",
            "error_code": "export_too_large",
            "member_id": "58",
        },
    ):
        r = client.post(
            "/api/client-log", json={"event": "recap_poster", "fields": fields}
        )
        assert r.status_code == 204


def test_recap_poster_rejects_file_names():
    r = client.post(
        "/api/client-log",
        json={
            "event": "recap_poster",
            "fields": {"phase": "save", "outcome": "sakadesk-recap-2026-58.png"},
        },
    )
    assert r.status_code == 422
