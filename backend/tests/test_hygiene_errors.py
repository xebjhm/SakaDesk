"""Small hygiene fixes from the security audit (2026-11-13): report-hardening #76, #77, #32."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app
from backend.services import auth_service, platform

client = TestClient(app)


@pytest.mark.parametrize(
    "url",
    [
        "/api/content/members?service=hinatazaka46&talk_room_id=9",
        "/api/content/messages?service=hinatazaka46&talk_room_id=9&member_id=1",
        "/api/content/talk_room_messages?service=hinatazaka46&talk_room_id=9",
    ],
)
def test_a_missing_talk_room_answers_a_code_not_a_path(url, tmp_path):
    secret = tmp_path / "Real Name" / "out"
    missing = FileNotFoundError(f"Base path does not exist: {secret}")
    with (
        patch("backend.api.content.resolve_talk_room_path", side_effect=missing),
        patch("backend.api.content.resolve_messages_file", side_effect=missing),
        capture_logs() as logs,
    ):
        resp = client.get(url)
    assert resp.status_code == 404
    assert resp.json() == {"detail": "Not found"}
    assert "Real Name" not in repr(logs)
    assert any(e["event"] == "content_not_found" for e in logs)


def test_the_dead_credential_helpers_are_gone():
    assert not hasattr(platform, "get_credentials_dir")
    assert not hasattr(platform, "log_platform_info")


def test_the_geo_lookup_uses_https_only():
    assert auth_service._GEO_PROVIDERS
    assert all(url.startswith("https://") for url, _ in auth_service._GEO_PROVIDERS)
