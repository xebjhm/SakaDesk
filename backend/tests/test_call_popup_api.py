"""Tests for the background call popup API (spec C3 §4.6)."""

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app
from backend.services.call_popup import CallEvent, CallInfo

client = TestClient(app)
PATH = "日向坂46/messages/34 金村 美玖/58 金村 美玖"


class FakeController:
    def __init__(self, ok: bool = True):
        self.ok, self.events, self.active_args = ok, [], []

    def info(self, call_id):
        if call_id == 1:
            return CallInfo(call_id, "hinatazaka46", PATH, False, "34", "58", 10)
        return None

    async def on_event(self, call_id, event: CallEvent):
        self.events.append((call_id, event))
        return self.ok

    def is_active_for(self, service, group_id, member_id, message_id):
        self.active_args.append((service, group_id, member_id, message_id))
        return message_id == 10


@pytest.fixture
def fake(monkeypatch):
    f = FakeController()
    monkeypatch.setattr("backend.api.call_popup.get_call_popup_controller", lambda: f)
    return f


def _api_popup_logs(logs):
    return [
        e
        for e in logs
        if e.get("source") or str(e.get("event", "")).startswith("call_popup_")
    ]


def test_get_call_returns_the_info_with_cjk_path_intact(fake):
    with capture_logs() as logs:
        res = client.get("/api/call-popup/calls/1")
    assert res.status_code == 200
    assert res.json() == {
        "call_id": 1,
        "service": "hinatazaka46",
        "path": PATH,
        "is_group_chat": False,
        "group_id": "34",
        "member_id": "58",
        "message_id": 10,
    }
    assert PATH not in repr(logs)


def test_get_unknown_call_is_404(fake):
    assert client.get("/api/call-popup/calls/2").status_code == 404


def test_post_answered_event_is_forwarded(fake):
    res = client.post(
        "/api/call-popup/calls/1/events",
        json={"event": "answered", "message_id": 10},
    )
    assert res.status_code == 204
    assert res.content == b""
    assert fake.events == [(1, CallEvent("answered", None, None, 10))]


def test_post_skipped_event_with_reason(fake):
    res = client.post(
        "/api/call-popup/calls/1/events",
        json={"event": "skipped", "reason": "no_photo"},
    )
    assert res.status_code == 204
    assert fake.events == [(1, CallEvent("skipped", "no_photo", None, None))]


@pytest.mark.parametrize("reason", ["played", "hung_up"])
def test_post_ended_event_keeps_how_the_call_ended(fake, reason):
    res = client.post(
        "/api/call-popup/calls/1/events",
        json={"event": "ended", "reason": reason},
    )
    assert res.status_code == 204
    assert fake.events == [(1, CallEvent("ended", reason, None, None))]


def test_post_error_event_with_error_type(fake):
    res = client.post(
        "/api/call-popup/calls/1/events",
        json={"event": "error", "error_type": "type_error"},
    )
    assert res.status_code == 204
    assert fake.events[0][1] == CallEvent("error", None, "type_error", None)


def test_post_event_rejected_by_controller_is_409(fake):
    fake.ok = False
    res = client.post("/api/call-popup/calls/1/events", json={"event": "ended"})
    assert res.status_code == 409
    assert len(fake.events) == 1


@pytest.mark.parametrize(
    "body",
    [
        {"event": "rang"},
        {"event": "skipped", "reason": "No Photo"},
        {"event": "skipped", "reason": "写真"},
        {"event": "answered", "message_id": 1.5},
        {"event": "answered", "message_id": "10"},
        {"event": "ringing", "path": "x"},
        {"event": "error", "error_type": "Has Space"},
    ],
)
def test_invalid_event_body_is_422_and_logs_nothing(fake, body):
    with capture_logs() as logs:
        res = client.post("/api/call-popup/calls/1/events", json=body)
    assert res.status_code == 422
    assert fake.events == []
    assert _api_popup_logs(logs) == []


@pytest.mark.parametrize("call_id", ["0", "abc", "1000000000000"])
def test_invalid_call_id_is_422_and_logs_nothing(fake, call_id):
    with capture_logs() as logs:
        got = client.get(f"/api/call-popup/calls/{call_id}")
        posted = client.post(
            f"/api/call-popup/calls/{call_id}/events", json={"event": "ended"}
        )
    assert got.status_code == 422
    assert posted.status_code == 422
    assert fake.events == []
    assert _api_popup_logs(logs) == []


def test_active_reports_the_controller_answer(fake):
    base = "/api/call-popup/active?service=hinatazaka46&group_id=34&member_id=58"
    assert client.get(f"{base}&message_id=10").json() == {"active": True}
    assert client.get(f"{base}&message_id=11").json() == {"active": False}
    assert fake.active_args == [
        ("hinatazaka46", "34", "58", 10),
        ("hinatazaka46", "34", "58", 11),
    ]


@pytest.mark.parametrize(
    "query",
    [
        "service=hinatazaka46&group_id=3a&member_id=58&message_id=10",
        "service=Hinata&group_id=34&member_id=58&message_id=10",
        "service=hinatazaka46&group_id=34&member_id=58&message_id=-1",
        "service=hinatazaka46&group_id=34&member_id=58",
    ],
)
def test_active_rejects_bad_query(fake, query):
    with capture_logs() as logs:
        res = client.get(f"/api/call-popup/active?{query}")
    assert res.status_code == 422
    assert fake.active_args == []
    assert _api_popup_logs(logs) == []


@pytest.mark.parametrize(
    "reason",
    ["already_read", "no_photo", "superseded", "media_unavailable", "popup_active"],
)
def test_known_skip_reasons_pass_through(fake, reason):
    res = client.post(
        "/api/call-popup/calls/1/events", json={"event": "skipped", "reason": reason}
    )
    assert res.status_code == 204
    assert fake.events[-1][1].reason == reason


def test_unknown_but_well_formed_reason_becomes_other(fake):
    res = client.post(
        "/api/call-popup/calls/1/events",
        json={"event": "skipped", "reason": "kanemura_miku_58"},
    )
    assert res.status_code == 204
    assert fake.events == [(1, CallEvent("skipped", "other", None, None))]


@pytest.mark.parametrize("reason", ["played", "hung_up"])
def test_b_end_reasons_pass_through(fake, reason):
    res = client.post(
        "/api/call-popup/calls/1/events",
        json={"event": "ended", "reason": reason},
    )
    assert res.status_code == 204
    assert fake.events == [(1, CallEvent("ended", reason, None, None))]
