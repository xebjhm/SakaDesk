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


@pytest.mark.parametrize(
    ("event", "fields", "level"),
    [
        ("design_tokens_applied", {"theme": "sakurazaka"}, "info"),
        ("design_tokens_fallback", {"reason": "unknown_service"}, "warning"),
        ("design_fonts_applied", {"target": "zh_tw"}, "info"),
        ("design_fonts_fallback", {"target": "zh_tw"}, "warning"),
        ("avatar_fallback", {"size": "md"}, "info"),
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
