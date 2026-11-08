"""Resized archived avatars: the service and ``GET /api/content/avatar``."""

import io
import os
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.main import app
from backend.services import avatar_resize

client = TestClient(app)

MEMBER_REL = "messages/34 金村 美玖/58 金村 美玖/profile_images/group_thumbnail"
URL = "/api/content/avatar/hinatazaka46/" + MEMBER_REL


def _png(path: Path, size: tuple[int, int], mode: str = "RGB") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    colour = (200, 30, 90, 128) if mode == "RGBA" else (200, 30, 90)
    Image.new(mode, size, colour).save(path)
    return path


def _jpeg(path: Path, size: tuple[int, int]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, (10, 120, 200)).save(path, format="JPEG")
    return path


def _open(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img.load()
    return img


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class TestResizedAvatar:
    def test_downscales_to_a_square_webp(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (1000, 800))
        out = avatar_resize.resized_avatar(src, 192, tmp_path / "cache")
        assert out.parent == tmp_path / "cache"
        assert out.suffix == ".webp"
        img = Image.open(out)
        assert img.format == "WEBP"
        assert img.size == (192, 192)

    def test_keeps_alpha(self, tmp_path):
        src = _png(tmp_path / "a.png", (600, 600), mode="RGBA")
        out = avatar_resize.resized_avatar(src, 128, tmp_path / "cache")
        img = Image.open(out)
        assert img.size == (128, 128)
        assert img.mode == "RGBA"

    def test_palette_png_with_transparency_keeps_alpha(self, tmp_path):
        src = tmp_path / "p.png"
        Image.new("P", (400, 400), 0).save(src, transparency=0)
        out = avatar_resize.resized_avatar(src, 64, tmp_path / "cache")
        assert Image.open(out).mode == "RGBA"

    def test_never_upscales(self, tmp_path):
        src = _jpeg(tmp_path / "small.jpg", (150, 150))
        assert avatar_resize.resized_avatar(src, 192, tmp_path / "cache") == src
        assert not (tmp_path / "cache").exists()

    def test_short_side_below_width_is_not_upscaled(self, tmp_path):
        src = _jpeg(tmp_path / "wide.jpg", (1000, 100))
        assert avatar_resize.resized_avatar(src, 128, tmp_path / "cache") == src

    def test_cache_hit_reuses_the_file(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (1000, 1000))
        first = avatar_resize.resized_avatar(src, 256, tmp_path / "cache")
        stamp = first.stat().st_mtime_ns
        with patch("backend.services.avatar_resize.Image.open") as opened:
            second = avatar_resize.resized_avatar(src, 256, tmp_path / "cache")
        opened.assert_not_called()
        assert second == first
        assert second.stat().st_mtime_ns == stamp

    def test_key_changes_with_width_and_mtime(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (1000, 1000))
        a = avatar_resize.resized_avatar(src, 128, tmp_path / "cache")
        b = avatar_resize.resized_avatar(src, 192, tmp_path / "cache")
        assert a != b
        st = src.stat()
        os.utime(src, ns=(st.st_atime_ns, st.st_mtime_ns + 10_000_000_000))
        c = avatar_resize.resized_avatar(src, 128, tmp_path / "cache")
        assert c != a

    def test_non_image_falls_back_to_the_original(self, tmp_path):
        src = tmp_path / "broken.jpg"
        src.write_bytes(b"not an image")
        with patch.object(avatar_resize.logger, "warning") as warn:
            assert avatar_resize.resized_avatar(src, 192, tmp_path / "cache") == src
        warn.assert_called_once()
        event, fields = warn.call_args.args[0], warn.call_args.kwargs
        assert event == "avatar_resize_failed"
        assert fields["width"] == 192
        assert fields["error"] == "UnidentifiedImageError"
        # No paths or names in the breadcrumb.
        assert "broken" not in repr(fields)

    def test_write_failure_falls_back_and_leaves_no_temp_file(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (1000, 1000))
        cache = tmp_path / "cache"
        with patch("PIL.Image.Image.save", side_effect=OSError("disk full")):
            assert avatar_resize.resized_avatar(src, 192, cache) == src
        assert list(cache.iterdir()) == []

    def test_rejects_widths_outside_the_allow_list(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (1000, 1000))
        with pytest.raises(ValueError):
            avatar_resize.resized_avatar(src, 100, tmp_path / "cache")

    def test_cache_dir_lives_under_the_app_data_dir(self, tmp_path):
        with patch(
            "backend.services.avatar_resize.get_app_data_dir", return_value=tmp_path
        ):
            assert avatar_resize.cache_dir() == tmp_path / "cache" / "avatars"


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@pytest.fixture
def archive(tmp_path):
    root = tmp_path / "out"
    member = root / "日向坂46" / MEMBER_REL
    member.mkdir(parents=True)
    with (
        patch("backend.api.content.get_output_dir", return_value=root),
        patch(
            "backend.services.avatar_resize.cache_dir",
            return_value=tmp_path / "cache",
        ),
    ):
        yield member


class TestAvatarRoute:
    def test_serves_the_resized_variant(self, archive):
        _jpeg(archive / "a.jpg", (1000, 1000))
        r = client.get(f"{URL}/a.jpg?w=192")
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/webp"
        assert _open(r.content).size == (192, 192)

    def test_second_request_is_a_cache_hit(self, archive, tmp_path):
        _jpeg(archive / "a.jpg", (1000, 1000))
        assert client.get(f"{URL}/a.jpg?w=128").status_code == 200
        files = list((tmp_path / "cache").iterdir())
        assert len(files) == 1
        with patch("backend.services.avatar_resize.Image.open") as opened:
            r = client.get(f"{URL}/a.jpg?w=128")
        opened.assert_not_called()
        assert r.status_code == 200
        assert list((tmp_path / "cache").iterdir()) == files

    def test_small_source_is_served_unchanged(self, archive):
        src = _png(archive / "s.png", (100, 100))
        r = client.get(f"{URL}/s.png?w=256")
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/png"
        assert r.content == src.read_bytes()

    @pytest.mark.parametrize("w", ["100", "0", "512", "abc"])
    def test_width_outside_the_allow_list_is_rejected(self, archive, w):
        _jpeg(archive / "a.jpg", (1000, 1000))
        r = client.get(f"{URL}/a.jpg?w={w}")
        assert r.status_code in (400, 422)

    def test_width_is_required(self, archive):
        _jpeg(archive / "a.jpg", (1000, 1000))
        assert client.get(f"{URL}/a.jpg").status_code == 422

    def test_missing_file_is_404(self, archive):
        assert client.get(f"{URL}/nope.jpg?w=64").status_code == 404

    def test_path_traversal_is_refused_like_the_media_route(self, archive, tmp_path):
        secret = tmp_path / "secret.jpg"
        _jpeg(secret, (1000, 1000))
        evil = "hinatazaka46/..%2F..%2Fsecret.jpg"
        r = client.get(f"/api/content/avatar/{evil}?w=64")
        media = client.get(f"/api/content/media/{evil}")
        assert r.status_code == media.status_code
        assert r.status_code in (403, 404)

    def test_non_image_falls_back_to_the_original(self, archive):
        (archive / "bad.jpg").write_bytes(b"not an image")
        r = client.get(f"{URL}/bad.jpg?w=192")
        assert r.status_code == 200
        assert r.content == b"not an image"


def test_default_root_is_the_cache_dir(tmp_path):
    src = _jpeg(tmp_path / "a.jpg", (1000, 1000))
    with patch("backend.services.avatar_resize.cache_dir", return_value=tmp_path / "c"):
        out = avatar_resize.resized_avatar(src, 64)
    assert out.parent == tmp_path / "c"
