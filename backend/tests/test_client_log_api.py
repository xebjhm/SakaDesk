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


def test_call_popup_heard_ignored_is_accepted():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={
                "event": "call_popup_heard_ignored",
                "fields": {"reason": "already_heard"},
            },
        )
    assert res.status_code == 204
    assert _client_events(logs)[0]["reason"] == "already_heard"


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
        {"event": "call_popup_start", "fields": {"path": "x"}},
        {"event": "call_popup_error", "fields": {"error_type": "Has Space"}},
    ):
        with capture_logs() as logs:
            res = client.post("/api/client-log", json=body)
        assert res.status_code == 422
        assert _client_events(logs) == []
