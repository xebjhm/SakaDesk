"""Downloads keep a safe name; the clipboard copies media only (security audit 2026-11-13).

report-hardening #39: the client filename reached Content-Disposition verbatim
(filename="../../evil.exe"); #40: POST /api/content/clipboard copied any file
type under the archive.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app
from backend.services.passive_media import download_name

client = TestClient(app)


@pytest.mark.parametrize(
    "requested,served,expected",
    [
        ("../../evil.exe", "1.jpg", "evil.jpg"),
        ("C:\\Users\\x\\a.png", "1.png", "a.png"),
        ("2024-01-15_0900_金村🌸.jpg", "1.jpg", "2024-01-15_0900_金村🌸.jpg"),
        ("a\r\nb.jpg", "1.jpg", "ab.jpg"),
        ("note.txt", "1.mp4", "note.mp4"),
        ("photo.JPG", "1.jpg", "photo.JPG"),
        ("..", "1.jpg", "1.jpg"),
        ("", "1.m4a", "1.m4a"),
        (None, "1.m4a", "1.m4a"),
        ("x.exe", "README", "x"),
    ],
)
def test_download_name(requested, served, expected):
    assert download_name(requested, served) == expected


@pytest.fixture
def out(tmp_path: Path):
    root = tmp_path / "out"
    media = root / "日向坂46" / "messages" / "34 a" / "58 b"
    (media / "picture").mkdir(parents=True)
    (media / "picture" / "1.jpg").write_bytes(b"\xff\xd8\xff\xe0")
    (media / "notes.txt").write_text("x", encoding="utf-8")
    with patch("backend.api.content.get_output_dir", return_value=root):
        yield root


def test_the_download_route_uses_the_safe_name(out):
    resp = client.get(
        "/api/content/download/日向坂46/messages/34 a/58 b/picture/1.jpg",
        params={"filename": "../../evil.exe"},
    )
    assert resp.status_code == 200
    disposition = resp.headers["content-disposition"]
    assert (
        "evil.jpg" in disposition
        and ".exe" not in disposition
        and ".." not in disposition
    )


def test_the_clipboard_refuses_a_file_that_is_not_media(out):
    with (
        patch("backend.api.content.is_windows", return_value=True),
        patch("backend.api.content.copy_file_to_clipboard") as copy,
        capture_logs() as logs,
    ):
        resp = client.post(
            "/api/content/clipboard",
            json={
                "media_url": "/api/content/media/hinatazaka46/messages/34%20a/58%20b/notes.txt"
            },
        )
    assert resp.status_code == 400
    copy.assert_not_called()
    assert {
        "event": "clipboard_refused",
        "reason": "not_media",
        "log_level": "info",
    } in logs


def test_the_clipboard_still_copies_a_picture(out):
    with (
        patch("backend.api.content.is_windows", return_value=True),
        patch("backend.api.content.copy_file_to_clipboard") as copy,
    ):
        resp = client.post(
            "/api/content/clipboard",
            json={
                "media_url": "/api/content/media/hinatazaka46/messages/34%20a/58%20b/picture/1.jpg"
            },
        )
    assert resp.status_code == 200
    copy.assert_called_once()
