"""Resized archived avatars: the service and ``GET /api/content/avatar``."""

import io
import os
import re
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from PIL.JpegImagePlugin import JpegImageFile

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

    def test_vanished_source_falls_back_with_a_warning(self, tmp_path):
        src = tmp_path / "gone.jpg"  # validated by the route, deleted since
        cache = tmp_path / "cache"
        with patch.object(avatar_resize.logger, "warning") as warn:
            assert avatar_resize.resized_avatar(src, 192, cache) == src
        warn.assert_called_once()
        event, fields = warn.call_args.args[0], warn.call_args.kwargs
        assert event == "avatar_resize_failed"
        assert fields["reason"] == "stat"
        assert fields["error"] == "FileNotFoundError"
        assert "gone" not in repr(fields)
        assert not cache.exists()

    def test_source_above_the_pixel_cap_is_served_unchanged(self, tmp_path):
        src = _jpeg(tmp_path / "huge.jpg", (1000, 1000))
        cache = tmp_path / "cache"
        with (
            patch.object(avatar_resize, "MAX_SOURCE_PIXELS", 999_999),
            patch.object(avatar_resize.logger, "warning") as warn,
        ):
            assert avatar_resize.resized_avatar(src, 192, cache) == src
        warn.assert_called_once()
        assert warn.call_args.args[0] == "avatar_resize_skipped"
        assert warn.call_args.kwargs["reason"] == "source_large"
        assert "huge" not in repr(warn.call_args.kwargs)
        assert not cache.exists()

    def test_pixel_cap_is_inclusive(self, tmp_path):
        src = _jpeg(tmp_path / "edge.jpg", (1000, 1000))
        with patch.object(avatar_resize, "MAX_SOURCE_PIXELS", 1_000_000):
            out = avatar_resize.resized_avatar(src, 192, tmp_path / "cache")
        assert out != src

    def test_jpeg_is_decoded_at_a_reduced_scale(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (1600, 1600))
        real = JpegImageFile.draft
        with patch.object(
            JpegImageFile, "draft", autospec=True, side_effect=real
        ) as draft:
            out = avatar_resize.resized_avatar(src, 192, tmp_path / "cache")
        draft.assert_called_once()
        assert draft.call_args.args[1:] == ("RGB", (384, 384))
        assert Image.open(out).size == (192, 192)

    def test_png_is_not_drafted(self, tmp_path):
        src = _png(tmp_path / "a.png", (800, 800))
        with patch.object(Image.Image, "draft") as draft:
            avatar_resize.resized_avatar(src, 192, tmp_path / "cache")
        draft.assert_not_called()

    def test_replace_blocked_by_a_reader_serves_the_existing_variant(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (1000, 1000))
        cache = tmp_path / "cache"

        def racing_replace(tmp: str, target: Path) -> None:
            # A concurrent request finished first and holds its variant open.
            Path(target).write_bytes(b"variant")
            raise PermissionError("in use")

        with (
            patch.object(avatar_resize.os, "replace", side_effect=racing_replace),
            patch.object(avatar_resize.logger, "warning") as warn,
        ):
            out = avatar_resize.resized_avatar(src, 192, cache)
        warn.assert_not_called()
        assert out != src and out.parent == cache
        assert out.read_bytes() == b"variant"
        assert [f.name for f in cache.iterdir()] == [out.name]  # temp removed

    def test_replace_permission_error_without_a_variant_falls_back(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (1000, 1000))
        cache = tmp_path / "cache"
        with (
            patch.object(
                avatar_resize.os, "replace", side_effect=PermissionError("denied")
            ),
            patch.object(avatar_resize.logger, "warning") as warn,
        ):
            assert avatar_resize.resized_avatar(src, 192, cache) == src
        warn.assert_called_once()
        assert warn.call_args.kwargs["error"] == "PermissionError"
        assert list(cache.iterdir()) == []

    def test_rejects_widths_outside_the_allow_list(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (1000, 1000))
        with pytest.raises(ValueError):
            avatar_resize.resized_avatar(src, 100, tmp_path / "cache")

    def test_allow_list_matches_the_frontend_widths(self):
        # Mirrors AVATAR_WIDTHS in frontend/src/features/messages/mediaUrl.ts:
        # 16 px steps up to 128 cover 64 / 40 / 48 CSS px at common scales.
        assert avatar_resize.ALLOWED_WIDTHS == frozenset(
            {64, 80, 96, 112, 128, 160, 192, 256}
        )

    def test_allow_list_matches_the_frontend_source(self):
        # Parse the real frontend constant so the two lists cannot drift apart.
        source = (
            Path(__file__).resolve().parents[2]
            / "frontend"
            / "src"
            / "features"
            / "messages"
            / "mediaUrl.ts"
        ).read_text(encoding="utf-8")
        match = re.search(r"export const AVATAR_WIDTHS = \[([^\]]*)\]", source)
        assert match, "AVATAR_WIDTHS not found in mediaUrl.ts"
        frontend = frozenset(int(w) for w in re.findall(r"\d+", match.group(1)))
        assert frontend == avatar_resize.ALLOWED_WIDTHS

    @pytest.mark.parametrize("width", [80, 96, 112, 160])
    def test_density_matched_widths_are_resized(self, tmp_path, width):
        src = _jpeg(tmp_path / "a.jpg", (1000, 1000))
        out = avatar_resize.resized_avatar(src, width, tmp_path / "cache")
        assert out != src
        assert Image.open(out).size == (width, width)

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

    def test_serves_a_density_matched_width(self, archive):
        # 64 CSS px at 175 % scaling = 112 device px: served exactly.
        _jpeg(archive / "a.jpg", (1000, 1000))
        r = client.get(f"{URL}/a.jpg?w=112")
        assert r.status_code == 200
        assert _open(r.content).size == (112, 112)

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

    @pytest.mark.parametrize(
        ("w", "status"),
        [
            ("100", 400),
            ("0", 400),
            ("512", 400),
            ("-64", 400),
            ("70", 400),
            ("abc", 422),
        ],
    )
    def test_width_outside_the_allow_list_is_rejected(
        self, archive, tmp_path, w, status
    ):
        _jpeg(archive / "a.jpg", (1000, 1000))
        r = client.get(f"{URL}/a.jpg?w={w}")
        assert r.status_code == status
        assert not (tmp_path / "cache").exists()

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
        assert r.status_code == media.status_code == 403
        assert not (tmp_path / "cache").exists()

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
