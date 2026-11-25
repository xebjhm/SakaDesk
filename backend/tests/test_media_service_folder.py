"""Archive media routes serve only files inside a service folder (security audit
2026-11-13, backend/api/settings.py:output-dir-unvalidated-archive-trust-root
remediation 3, and report-hardening "/api/content/media validates only against
output_dir").

A path whose first segment was not a service id was read relative to the output
dir, so a re-rooted (or simply broad) output dir exposed every file below it,
e.g. GET /api/content/media/.ssh/id_dummy. Only SakaDesk's own service folders
are served now; the display-name folder works as before.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app

client = TestClient(app)


@pytest.fixture
def out(tmp_path: Path):
    root = tmp_path / "out"
    (root / "日向坂46" / "messages").mkdir(parents=True)
    (root / "日向坂46" / "messages" / "a.jpg").write_bytes(b"\xff\xd8\xff\xe0")
    (root / "乃木坂46").mkdir()
    (root / "乃木坂46" / "x.jpg").write_bytes(b"\xff\xd8\xff\xe0")
    (root / "loose.jpg").write_bytes(b"DUMMY-LOOSE")
    # Files the old service-less fallback (a path read relative to the output
    # dir) would have served: they make test_no_service_folder_is_404 fail on it.
    (root / "messages").mkdir()
    (root / "messages" / "a.jpg").write_bytes(b"DUMMY-LOOSE")
    (root / "unknown46").mkdir()
    (root / "unknown46" / "a.jpg").write_bytes(b"DUMMY-LOOSE")
    (root / ".ssh").mkdir()
    (root / ".ssh" / "id_dummy").write_bytes(b"DUMMY-PRIVATE-KEY-0001")
    (root / "settings.json").write_text("{}", encoding="utf-8")
    with patch("backend.api.content.get_output_dir", return_value=root):
        yield root


@pytest.mark.parametrize("route", ["media", "download"])
@pytest.mark.parametrize("path", ["loose.jpg", ".ssh/id_dummy", "settings.json"])
def test_a_file_outside_every_service_folder_is_never_served(out, route, path):
    response = client.get(f"/api/content/{route}/{path}")
    assert response.status_code == 404
    assert b"DUMMY" not in response.content


def test_the_service_id_and_the_display_name_both_reach_the_folder(out):
    for path in ("hinatazaka46/messages/a.jpg", "日向坂46/messages/a.jpg"):
        response = client.get(f"/api/content/media/{path}")
        assert response.status_code == 200 and response.content == b"\xff\xd8\xff\xe0"


def test_a_path_into_another_service_folder_is_refused(out):
    response = client.get("/api/content/media/hinatazaka46/%2e%2e/乃木坂46/x.jpg")
    assert response.status_code == 403


@pytest.mark.parametrize(
    "path", ["hinatazaka46", "hinatazaka46/", "unknown46/a.jpg", "messages/a.jpg"]
)
def test_no_service_folder_is_404(out, path):
    assert client.get(f"/api/content/media/{path}").status_code == 404


def test_a_refusal_logs_a_code_only(out):
    with capture_logs() as logs:
        client.get("/api/content/media/.ssh/id_dummy")
        client.get("/api/content/media/hinatazaka46/%2e%2e/乃木坂46/x.jpg")
    assert [e["reason"] for e in logs if e["event"] == "media_request_rejected"] == [
        "no_service_folder"
    ]
    assert [
        e.get("reason") for e in logs if e["event"] == "path_traversal_blocked"
    ] == ["outside_service_folder"]
    assert "ssh" not in str(logs) and "乃木坂46" not in str(logs)
