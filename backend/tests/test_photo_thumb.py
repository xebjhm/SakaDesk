"""Picture thumbnails: ``backend.services.photo_thumb`` and ``GET /api/content/thumb``."""

from __future__ import annotations

import asyncio
import io
import os
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.main import app
from backend.services import photo_thumb

client = TestClient(app)

ROOM = "messages/34 金村 美玖/58 金村 美玖"
URL = "/api/content/thumb/hinatazaka46/" + ROOM


def _jpeg(
    path: Path, size: tuple[int, int], exif_orientation: int | None = None
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", size, (10, 120, 200))
    if exif_orientation is None:
        img.save(path, format="JPEG")
    else:
        exif = Image.Exif()
        exif[0x0112] = exif_orientation
        img.save(path, format="JPEG", exif=exif.tobytes())
    return path


def _png(path: Path, size: tuple[int, int], mode: str = "RGB") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new(mode, size, (200, 30, 90, 128) if mode == "RGBA" else (200, 30, 90)).save(
        path
    )
    return path


def _open(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img.load()
    return img


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _fresh_state():
    photo_thumb.reset_cache_state()
    yield
    photo_thumb.reset_cache_state()


@pytest.fixture
def archive(tmp_path):
    root = tmp_path / "out"
    room = root / "日向坂46" / ROOM
    (room / "picture").mkdir(parents=True)
    with (
        patch("backend.api.content.get_output_dir", return_value=root),
        patch(
            "backend.services.photo_thumb.cache_dir", return_value=tmp_path / "cache"
        ),
    ):
        yield room


# --- service ---------------------------------------------------------------------------


class TestThumbnail:
    def test_downscales_keeping_the_aspect(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (1200, 1600))
        out = _run(photo_thumb.thumbnail(src, "a.jpg", 320, tmp_path / "c"))
        assert out is not None and out.parent == tmp_path / "c"
        img = Image.open(out)
        assert img.format == "WEBP"
        assert img.size == (240, 320)
        assert not list((tmp_path / "c").glob("*.tmp"))

    def test_never_upscales_and_keeps_alpha(self, tmp_path):
        src = _png(tmp_path / "s.png", (100, 80), mode="RGBA")
        out = _run(photo_thumb.thumbnail(src, "s.png", 640, tmp_path / "c"))
        img = Image.open(out)
        assert img.size == (100, 80)
        assert img.mode == "RGBA"

    def test_applies_exif_orientation(self, tmp_path):
        # orientation 6 = rotate 90° clockwise to display: a landscape file shows as portrait
        src = _jpeg(tmp_path / "r.jpg", (800, 400), exif_orientation=6)
        out = _run(photo_thumb.thumbnail(src, "r.jpg", 320, tmp_path / "c"))
        assert Image.open(out).size == (160, 320)

    def test_rejects_an_unsupported_width(self, tmp_path):
        with pytest.raises(ValueError):
            _run(
                photo_thumb.thumbnail(tmp_path / "a.jpg", "a.jpg", 300, tmp_path / "c")
            )

    def test_non_picture_is_none_without_opening(self, tmp_path):
        src = tmp_path / "v.mp4"
        src.write_bytes(b"\x00" * 16)
        with patch("backend.services.photo_thumb.Image.open") as opened:
            assert (
                _run(photo_thumb.thumbnail(src, "v.mp4", 320, tmp_path / "c")) is None
            )
        opened.assert_not_called()

    def test_refuses_a_decompression_bomb_from_the_header(self, tmp_path):
        src = _png(tmp_path / "big.png", (200, 200))
        with (
            patch.object(photo_thumb, "MAX_SOURCE_PIXELS", 100 * 100),
            patch("backend.services.photo_thumb.logger") as log,
            patch("PIL.ImageFile.ImageFile.load") as load,
        ):
            assert (
                _run(photo_thumb.thumbnail(src, "big.png", 160, tmp_path / "c")) is None
            )
        load.assert_not_called()
        log.info.assert_called_with(
            "memories_skip",
            view="photo_thumb",
            reason="too_large",
            error_type="DecompressionBombError",
        )

    def test_pixel_bound_never_exceeds_pillow(self):
        with patch.object(photo_thumb.Image, "MAX_IMAGE_PIXELS", 1000):
            assert photo_thumb._pixel_limit() == 1000
        with patch.object(photo_thumb.Image, "MAX_IMAGE_PIXELS", None):
            assert photo_thumb._pixel_limit() == photo_thumb.MAX_SOURCE_PIXELS

    def test_corrupt_file_is_skipped(self, tmp_path):
        src = tmp_path / "bad.jpg"
        src.write_bytes(b"not a jpeg")
        with patch("backend.services.photo_thumb.logger") as log:
            assert (
                _run(photo_thumb.thumbnail(src, "bad.jpg", 160, tmp_path / "c")) is None
            )
        log.info.assert_called_with(
            "memories_skip",
            view="photo_thumb",
            reason="unreadable",
            error_type="UnidentifiedImageError",
        )

    def test_unreadable_source_is_unavailable(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (400, 400))
        with patch(
            "backend.services.photo_thumb.Image.open", side_effect=PermissionError()
        ):
            assert (
                _run(photo_thumb.thumbnail(src, "a.jpg", 160, tmp_path / "c")) is None
            )

    def test_missing_source_is_none(self, tmp_path):
        assert (
            _run(
                photo_thumb.thumbnail(
                    tmp_path / "gone.jpg", "gone.jpg", 160, tmp_path / "c"
                )
            )
            is None
        )

    def test_second_call_is_a_cache_hit(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (900, 900))
        first = _run(photo_thumb.thumbnail(src, "a.jpg", 160, tmp_path / "c"))
        os.utime(first, ns=(1, 1))
        with patch("backend.services.photo_thumb.Image.open") as opened:
            again = _run(photo_thumb.thumbnail(src, "a.jpg", 160, tmp_path / "c"))
        opened.assert_not_called()
        assert again == first
        assert first.stat().st_mtime_ns > 1  # a hit refreshes the LRU order

    def test_key_follows_path_size_mtime_and_width(self):
        base = photo_thumb.variant_name("a.jpg", 10, 5, 160)
        assert base != photo_thumb.variant_name("b.jpg", 10, 5, 160)
        assert base != photo_thumb.variant_name("a.jpg", 11, 5, 160)
        assert base != photo_thumb.variant_name("a.jpg", 10, 6, 160)
        assert base != photo_thumb.variant_name("a.jpg", 10, 5, 320)
        assert "a.jpg" not in base

    def test_touch_failure_still_serves_the_hit(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (400, 400))
        first = _run(photo_thumb.thumbnail(src, "a.jpg", 160, tmp_path / "c"))
        with patch(
            "backend.services.photo_thumb.os.utime", side_effect=PermissionError()
        ):
            assert (
                _run(photo_thumb.thumbnail(src, "a.jpg", 160, tmp_path / "c")) == first
            )

    def test_evicts_the_oldest_at_the_cap(self, tmp_path):
        root = tmp_path / "c"
        made = []
        for i in range(4):
            src = _jpeg(tmp_path / f"{i}.jpg", (600, 600))
            out = _run(photo_thumb.thumbnail(src, f"{i}.jpg", 160, root, cap=10**9))
            os.utime(out, ns=(i + 1, i + 1))
            made.append(out)
        size = made[0].stat().st_size
        photo_thumb.reset_cache_state()
        # a cap that fits about four variants: the fifth write evicts down to 90 %
        src = _jpeg(tmp_path / "new.jpg", (600, 600))
        with patch("backend.services.photo_thumb.logger") as log:
            newest = _run(
                photo_thumb.thumbnail(src, "new.jpg", 160, root, cap=int(size * 4.5))
            )
        assert newest is not None and newest.exists()
        assert not made[0].exists()
        assert made[3].exists()
        evicted = [
            c for c in log.info.call_args_list if c.args[0] == "photo_thumb_evict"
        ]
        assert evicted and evicted[0].kwargs["count"] >= 1

    def test_eviction_skips_a_file_held_open(self, tmp_path):
        root = tmp_path / "c"
        a = _run(
            photo_thumb.thumbnail(
                _jpeg(tmp_path / "a.jpg", (600, 600)), "a.jpg", 160, root, cap=10**9
            )
        )
        os.utime(a, ns=(1, 1))
        real_unlink = Path.unlink

        def unlink(self, *args, **kwargs):
            if self == a:
                raise PermissionError()
            return real_unlink(self, *args, **kwargs)

        with patch.object(Path, "unlink", unlink):
            b = _run(
                photo_thumb.thumbnail(
                    _jpeg(tmp_path / "b.jpg", (600, 600)), "b.jpg", 160, root, cap=1
                )
            )
        assert a.exists()  # held: skipped
        assert b is not None

    def test_eviction_tolerates_files_vanishing(self, tmp_path):
        root = tmp_path / "c"
        root.mkdir()
        (root / "x-160.webp").write_bytes(b"x" * 10)
        state = photo_thumb._CacheState(total=0)
        with patch.object(Path, "unlink", side_effect=FileNotFoundError()):
            photo_thumb._evict(root, state, cap=1)
        assert state.total == 0

    def test_stat_errors_while_measuring_are_ignored(self, tmp_path):
        root = tmp_path / "c"
        root.mkdir()
        (root / "x-160.webp").write_bytes(b"x" * 10)
        with patch("os.DirEntry.stat", side_effect=OSError(), create=True):
            entries = photo_thumb._variants(root)
        assert len(entries) == 1
        broken = type(
            "E",
            (),
            {
                "stat": lambda self: (_ for _ in ()).throw(OSError()),
                "path": str(root / "x"),
                "name": "x",
            },
        )()
        with patch.object(photo_thumb, "_variants", return_value=[broken]):
            assert photo_thumb._state(root).total == 0
            state = photo_thumb._CacheState(total=5)
            photo_thumb._evict(root, state, cap=1)
            assert state.total == 0

    def test_missing_cache_dir_measures_zero(self, tmp_path):
        assert photo_thumb._variants(tmp_path / "none") == []

    def test_write_failure_is_none(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (400, 400))
        with patch("PIL.Image.Image.save", side_effect=OSError("disk full")):
            assert (
                _run(photo_thumb.thumbnail(src, "a.jpg", 160, tmp_path / "c")) is None
            )
        assert not list((tmp_path / "c").glob("*"))

    def test_replace_race_serves_the_existing_variant(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (400, 400))
        root = tmp_path / "c"
        hit, target = photo_thumb.lookup(src, "a.jpg", 160, root)
        assert hit is None
        root.mkdir()
        target.write_bytes(b"other writer")
        with patch(
            "backend.services.photo_thumb.os.replace", side_effect=PermissionError()
        ):
            assert photo_thumb.make(src, target, 160, root) == target

    def test_replace_permission_error_without_a_variant_is_none(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (400, 400))
        _, target = photo_thumb.lookup(src, "a.jpg", 160, tmp_path / "c")
        with patch(
            "backend.services.photo_thumb.os.replace", side_effect=PermissionError()
        ):
            assert photo_thumb.make(src, target, 160, tmp_path / "c") is None

    def test_decodes_are_bounded_by_the_slots(self, tmp_path):
        srcs = [_jpeg(tmp_path / f"{i}.jpg", (300, 300)) for i in range(5)]
        active = peak = 0
        real = photo_thumb.make

        def counting(*args, **kwargs):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            try:
                import time

                time.sleep(0.02)
                return real(*args, **kwargs)
            finally:
                active -= 1

        async def run_all():
            with patch.object(photo_thumb, "make", counting):
                return await asyncio.gather(
                    *(
                        photo_thumb.thumbnail(s, s.name, 160, tmp_path / "c")
                        for s in srcs
                    )
                )

        results = _run(run_all())
        assert all(r is not None for r in results)
        assert peak <= photo_thumb.DECODE_SLOTS

    def test_default_cache_dir_is_a_sibling_of_the_avatars(self):
        from backend.services import avatar_resize

        assert photo_thumb.cache_dir().parent == avatar_resize.cache_dir().parent
        assert photo_thumb.cache_dir().name == "photo_thumbs"

    def test_uses_the_default_cache_dir(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (400, 400))
        with patch.object(photo_thumb, "cache_dir", return_value=tmp_path / "dflt"):
            out = _run(photo_thumb.thumbnail(src, "a.jpg", 160))
        assert out is not None and out.parent == tmp_path / "dflt"


# --- route -------------------------------------------------------------------------------


class TestThumbRoute:
    def test_serves_a_webp(self, archive):
        _jpeg(archive / "picture" / "1.jpg", (1080, 1350))
        r = client.get(f"{URL}/picture/1.jpg?w=320")
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/webp"
        assert _open(r.content).size == (256, 320)

    def test_rejects_an_unlisted_width(self, archive):
        _jpeg(archive / "picture" / "1.jpg", (600, 600))
        assert client.get(f"{URL}/picture/1.jpg?w=300").status_code == 400

    def test_a_video_is_404(self, archive):
        (archive / "video").mkdir()
        (archive / "video" / "2.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42")
        assert client.get(f"{URL}/video/2.mp4?w=320").status_code == 404

    def test_a_missing_file_is_404(self, archive):
        assert client.get(f"{URL}/picture/none.jpg?w=320").status_code == 404

    def test_a_directory_is_404(self, archive):
        assert client.get(f"{URL}/picture?w=320").status_code == 404

    def test_a_path_outside_the_archive_is_refused(self, archive, tmp_path):
        _jpeg(tmp_path / "secret.jpg", (600, 600))
        # encoded dot segments reach the route undecoded by the client
        r = client.get("/api/content/thumb/hinatazaka46/%2E%2E/%2E%2E/secret.jpg?w=320")
        assert r.status_code in (400, 403, 404)
        assert r.headers.get("content-type") != "image/webp"

    def test_a_symlink_escaping_the_archive_is_refused(self, archive, tmp_path):
        target = _jpeg(tmp_path / "outside.jpg", (600, 600))
        link = archive / "picture" / "link.jpg"
        try:
            link.symlink_to(target)
        except OSError:
            pytest.skip("symlinks unavailable")
        assert client.get(f"{URL}/picture/link.jpg?w=320").status_code in (403, 404)

    def test_archive_read_error_is_404(self, archive):
        _jpeg(archive / "picture" / "1.jpg", (600, 600))
        from backend.services.archive_urls import ArchiveReadError

        with patch(
            "backend.api.content.archive_file_ok", side_effect=ArchiveReadError("x")
        ):
            assert client.get(f"{URL}/picture/1.jpg?w=320").status_code == 404

    def test_an_undecodable_picture_is_404(self, archive):
        (archive / "picture" / "3.jpg").write_bytes(b"garbage")
        assert client.get(f"{URL}/picture/3.jpg?w=160").status_code == 404

    def test_second_request_is_a_cache_hit(self, archive, tmp_path):
        _jpeg(archive / "picture" / "1.jpg", (900, 900))
        assert client.get(f"{URL}/picture/1.jpg?w=160").status_code == 200
        files = list((tmp_path / "cache").iterdir())
        assert len(files) == 1
        with patch("backend.services.photo_thumb.Image.open") as opened:
            r = client.get(f"{URL}/picture/1.jpg?w=160")
        opened.assert_not_called()
        assert r.status_code == 200
        assert list((tmp_path / "cache").iterdir()) == files
