"""Rooted, drive and UNC paths are rejected before any ``resolve()`` (I2 / N2).

On Windows ``Path(base) / "//host/share/x.jpg"`` (or ``"C:/..."``) replaces the
base, and resolving it would open an SMB connection to the host before the
containment check rejects it. The checks here are lexical, so they hold on any
platform: ``Path.resolve`` is patched to raise, proving it is never reached.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.api.content import _resolve_media_path, validate_path_within_dir
from backend.main import app
from backend.services import archive_urls, avatar_resize, photo_thumb

PREFIX = archive_urls.MEDIA_PREFIX

ROOTED = [
    "//host/share/x.jpg",
    "\\\\host\\share\\x.jpg",
    "\\\\host\\share",
    "C:/Windows/win.ini",
    "C:x",
    "c:\\x.jpg",
    "/etc/passwd",
    "\\x.jpg",
    "a/b:c.jpg",
    "a/b.jpg:stream",
    "a//host/share/x",
    "a\\\\host\\share",
]


class _ResolveCalled(AssertionError):
    pass


def _no_resolve(*_a, **_k):
    raise _ResolveCalled("Path.resolve reached")


@pytest.mark.parametrize("path", ROOTED)
def test_is_plain_relative_rejects(path):
    assert archive_urls.is_plain_relative(path) is False


@pytest.mark.parametrize(
    "path", ["a.jpg", "日向坂46/messages/1 金村 🌸/picture/2.jpg", ".", "a/b/"]
)
def test_is_plain_relative_accepts(path):
    assert archive_urls.is_plain_relative(path) is True


@pytest.mark.parametrize("path", ROOTED)
def test_validate_path_within_dir_rejects_before_resolve(tmp_path, path):
    with patch.object(Path, "resolve", _no_resolve):
        with pytest.raises(HTTPException) as exc:
            validate_path_within_dir(tmp_path, path)
    assert exc.value.status_code == 403


@pytest.mark.parametrize(
    "rest",
    [
        "//host/share/x.jpg",
        "\\\\host\\share\\x.jpg",
        "C:/Windows/win.ini",
        "C:x",
        "x:y.jpg",
    ],
)
def test_classify_media_route_rejects_before_resolve(tmp_path, rest):
    url = PREFIX + "hinatazaka46/" + rest
    with patch.object(Path, "resolve", _no_resolve):
        assert archive_urls.classify_media_route(tmp_path, url) == "invalid"


def test_classify_media_route_rejects_encoded_unc(tmp_path):
    url = PREFIX + "hinatazaka46/%2F%2Fhost%2Fshare%2Fx.jpg"
    with patch.object(Path, "resolve", _no_resolve):
        assert archive_urls.classify_media_route(tmp_path, url) == "invalid"


@pytest.mark.parametrize(
    "path",
    [
        "//host/share/x.jpg",
        "C:/Windows/win.ini",
        "C:x",
        "hinatazaka46///host/share/x",
    ],
)
def test_media_route_resolver_rejects_before_resolve(tmp_path, path):
    with patch("backend.api.content.get_output_dir", return_value=tmp_path):
        with patch.object(Path, "resolve", _no_resolve):
            with pytest.raises(HTTPException) as exc:
                _resolve_media_path(path)
    assert exc.value.status_code == 403


@pytest.mark.parametrize(
    "route",
    [
        "media/C:x",
        f"thumb/C:x?w={min(photo_thumb.ALLOWED_WIDTHS)}",
        f"avatar/C:x?w={min(avatar_resize.ALLOWED_WIDTHS)}",
    ],
)
def test_content_routes_reject_a_drive_path(tmp_path, route):
    client = TestClient(app)
    with patch("backend.api.content.get_output_dir", return_value=tmp_path):
        with patch.object(Path, "resolve", _no_resolve):
            response = client.get(f"/api/content/{route}")
    assert response.status_code == 403


def test_resolve_within_accepts_an_absolute_path_inside(tmp_path):
    (tmp_path / "日向坂46").mkdir()
    target = tmp_path / "日向坂46" / "a.json"
    target.write_text("{}", encoding="utf-8")
    assert archive_urls.resolve_within(tmp_path, target) == target.resolve()


def test_resolve_within_rejects_a_rooted_path_outside_before_resolve(tmp_path):
    real_resolve = Path.resolve

    def only_the_base(self, *a, **k):
        if self != tmp_path:  # the trusted output dir may resolve; the target never
            raise _ResolveCalled("Path.resolve reached")
        return real_resolve(self, *a, **k)

    with patch.object(Path, "resolve", only_the_base):
        with pytest.raises(archive_urls.ArchiveReadError):
            archive_urls.resolve_within(tmp_path, Path("//host/share/x.json"))


def test_resolve_within_rejects_a_drive_inside_the_relative_part(tmp_path):
    with pytest.raises(archive_urls.ArchiveReadError):
        archive_urls.resolve_within(tmp_path, tmp_path / "a:stream")
