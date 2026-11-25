"""Archive data never names a file outside its service folder (security audit 2026-11-13).

report-hardening #45/#68/#69/#71: notify_content resolved archive media and
avatar paths with no containment before handing them to the toast;
people.media_file_for kept ".." and drive parts.
"""

from __future__ import annotations

import os
from types import SimpleNamespace

import pytest
from structlog.testing import capture_logs

from backend.services.memories import notify_content as nc
from backend.services.memories import people

SERVICE = "hinatazaka46"


@pytest.mark.parametrize(
    "media_file",
    [
        "../../x.jpg",
        "messages/../../../x.jpg",
        "C:/Users/v/x.jpg",
        "a/./b.jpg",
        "x.jpg:stream",
        "..\\x.jpg",
    ],
)
def test_escaping_media_files_give_no_url_and_no_path(media_file):
    people._media_refusal_logs.reset()
    with capture_logs() as logs:
        assert people.media_url_of(SERVICE, media_file) is None
        assert people.media_file_for(SimpleNamespace(media_file=media_file)) is None
    refused = [e for e in logs if e["event"] == "memories_media_file_refused"]
    assert [e["reason"] for e in refused] == ["not_plain", "not_plain"]
    assert "Users" not in repr(logs)


def test_plain_media_files_are_unchanged():
    assert (
        people.media_url_of(SERVICE, "a\\b c.jpg")
        == "/api/content/media/hinatazaka46/a/b%20c.jpg"
    )
    assert people.media_file_for(SimpleNamespace(media_file="\\\\a/b.jpg")) == "a/b.jpg"


@pytest.fixture
def layout(tmp_path):
    sdir = tmp_path / "out" / "日向坂46"
    sdir.mkdir(parents=True)
    outside = tmp_path / "secret.jpg"
    outside.write_bytes(b"\xff\xd8secret")
    (sdir / "pic.jpg").write_bytes(b"\xff\xd8ok")
    return sdir, outside


def test_first_file_skips_a_dot_dot_path(layout):
    sdir, outside = layout
    with capture_logs() as logs:
        got = nc._first_file(
            sdir, [sdir / ".." / ".." / "secret.jpg", sdir / "pic.jpg"]
        )
    assert got == (sdir / "pic.jpg").resolve()
    assert any(e.get("reason") == "outside_service_dir" for e in logs)
    assert "secret" not in repr(logs)


@pytest.mark.skipif(os.name == "nt", reason="symlinks need a privilege on Windows")
def test_first_file_skips_a_link_that_leaves_the_folder(layout):
    sdir, outside = layout
    (sdir / "link.jpg").symlink_to(outside)
    assert nc._first_file(sdir, [sdir / "link.jpg"]) is None


@pytest.mark.skipif(os.name == "nt", reason="symlinks need a privilege on Windows")
def test_an_avatar_link_outside_the_folder_is_dropped(layout):
    sdir, outside = layout
    thumbs = sdir / "messages" / "34 a" / "58 b" / "profile_images" / "thumbnail"
    thumbs.mkdir(parents=True)
    (thumbs / "1.jpg").symlink_to(outside)
    with capture_logs() as logs:
        assert nc._find_avatar_abs(sdir, sdir / "messages" / "34 a" / "58 b") is None
    assert any(
        e.get("kind") == "avatar" and e.get("reason") == "outside_service_dir"
        for e in logs
    )


def test_an_avatar_inside_the_folder_is_kept(layout):
    sdir, _ = layout
    thumbs = sdir / "messages" / "34 a" / "58 b" / "profile_images" / "thumbnail"
    thumbs.mkdir(parents=True)
    (thumbs / "1.jpg").write_bytes(b"\xff\xd8")
    got = nc._find_avatar_abs(sdir, sdir / "messages" / "34 a" / "58 b")
    assert got == (thumbs / "1.jpg").resolve()
