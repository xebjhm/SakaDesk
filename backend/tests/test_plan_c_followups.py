"""Plan C final-review follow-ups (security audit 2026-11-13).

(2) a blog folder needs an 8-digit date; (4) a refused client path says which
route refused it; (5) /groups lists only folders named after their service's
display name; (6) the legacy %LOCALAPPDATA%\\zakadesk folder is protected
(test_output_dir_policy_windows.py). (1) and (3) are tested in
test_letters_local_api.py and SyncModal.test.tsx.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.api.content import _list_group_refs
from backend.main import app
from backend.services.blog_service import BlogService
from backend.services.safe_paths import (
    UnsafePath,
    blog_folder,
    blog_folder_or_none,
    is_blog_date,
)

client = TestClient(app)


@pytest.mark.parametrize(
    "date",
    ["", "2026010", "202601011", "2026-01-01", "２０２６０１０１", "2026010a", None],
)
def test_a_blog_folder_needs_an_eight_digit_date(tmp_path, date):
    with pytest.raises(UnsafePath) as exc:
        blog_folder(tmp_path, "金村 美玖", "55401", date)
    assert exc.value.reason == "date"
    assert blog_folder_or_none(tmp_path, "金村 美玖", "55401", date) is None


def test_is_blog_date():
    assert is_blog_date("20260117")
    assert not is_blog_date("2026011７")


def test_an_unsafe_id_is_still_reported_first(tmp_path):
    with pytest.raises(UnsafePath) as exc:
        blog_folder(tmp_path, "金村 美玖", "../x", "")
    assert exc.value.reason == "blog_id"


def test_the_download_queue_never_builds_an_underscore_folder(tmp_path):
    """A basic-format date parses (D1 Task 1 keeps the row) but is not a folder date."""
    svc = BlogService()
    index = {
        "members": {
            "1": {
                "name": "金村 美玖",
                "blogs": [
                    {
                        "id": "b1",
                        "title": "t",
                        "published_at": "20261101T120000+09:00",
                        "url": "u",
                    },
                ],
            }
        }
    }
    with (
        patch.object(svc, "get_blogs_base_path", return_value=tmp_path),
        capture_logs() as logs,
    ):
        queue = svc.build_download_queue("hinatazaka46", index)
    assert queue == []
    assert any(
        e["event"] == "blog_path_rejected" and e["where"] == "download_queue"
        for e in logs
    )
    assert list(tmp_path.iterdir()) == []


@pytest.fixture
def out(tmp_path: Path):
    root = tmp_path / "out"
    member = root / "日向坂46" / "messages" / "34 a" / "58 b"
    member.mkdir(parents=True)
    (member / "messages.json").write_text('{"messages": []}', encoding="utf-8")
    with (
        patch("backend.api.content.get_output_dir", return_value=root),
        patch("backend.api.content.is_test_mode", return_value=False),
    ):
        yield root


@pytest.mark.parametrize(
    "path,event,reason",
    [
        ("日向坂46/../../x", "path_traversal_blocked", "outside_service_folder"),
        ("unknown46/x", "media_request_rejected", "no_service_folder"),
        ("/etc", "path_rooted_blocked", None),
    ],
)
def test_a_refused_client_path_names_its_route(out, path, event, reason):
    with capture_logs() as logs:
        client.get("/api/content/messages_by_path", params={"path": path})
    [entry] = [e for e in logs if e["event"] == event]
    assert entry["route"] == "messages_by_path"
    if reason is not None:
        assert entry["reason"] == reason


def test_a_refused_media_path_names_the_media_route(out):
    with capture_logs() as logs:
        client.get("/api/content/media/unknown46/x.jpg")
    [entry] = [e for e in logs if e["event"] == "media_request_rejected"]
    assert entry["route"] == "media"


def test_only_folders_named_after_the_display_name_are_listed(tmp_path):
    for folder, group in (("日向坂46", "34 a"), ("hinatazaka46", "35 b")):
        member = tmp_path / folder / "messages" / group / "58 m"
        member.mkdir(parents=True)
        (member / "messages.json").write_text('{"messages": []}', encoding="utf-8")
    with capture_logs() as logs:
        refs, matched = _list_group_refs(tmp_path, {})
    assert [r.group_id for r in refs] == ["34"]
    assert matched is True
    assert {
        "event": "group_folder_skipped",
        "reason": "not_display_name",
        "count": 1,
        "log_level": "info",
    } in logs
