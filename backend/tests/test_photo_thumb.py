"""Picture thumbnails: ``backend.services.photo_thumb`` and ``GET /api/content/thumb``."""

from __future__ import annotations

import asyncio
import io
import os
import time
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from structlog.testing import capture_logs

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
        with Image.open(out) as img:
            assert img.format == "WEBP"
            assert img.size == (240, 320)
        assert not list((tmp_path / "c").glob("*.tmp"))

    def test_never_upscales_and_keeps_alpha(self, tmp_path):
        src = _png(tmp_path / "s.png", (100, 80), mode="RGBA")
        out = _run(photo_thumb.thumbnail(src, "s.png", 640, tmp_path / "c"))
        with Image.open(out) as img:
            assert img.size == (100, 80)
            assert img.mode == "RGBA"

    def test_applies_exif_orientation(self, tmp_path):
        # orientation 6 = rotate 90° clockwise to display: a landscape file shows as portrait
        src = _jpeg(tmp_path / "r.jpg", (800, 400), exif_orientation=6)
        out = _run(photo_thumb.thumbnail(src, "r.jpg", 320, tmp_path / "c"))
        with Image.open(out) as img:
            assert img.size == (160, 320)

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
        # the file is left alone (a stable ETag); the hit is remembered in memory
        assert first.stat().st_mtime_ns == 1
        assert photo_thumb._states[tmp_path / "c"].used[first.name] > 1

    def test_key_follows_path_size_mtime_and_width(self):
        base = photo_thumb.variant_name("a.jpg", 10, 5, 160)
        assert base != photo_thumb.variant_name("b.jpg", 10, 5, 160)
        assert base != photo_thumb.variant_name("a.jpg", 11, 5, 160)
        assert base != photo_thumb.variant_name("a.jpg", 10, 6, 160)
        assert base != photo_thumb.variant_name("a.jpg", 10, 5, 320)
        assert "a.jpg" not in base

    def test_a_recent_hit_survives_eviction_over_an_older_write(self, tmp_path):
        root = tmp_path / "c"
        old = _run(
            photo_thumb.thumbnail(
                _jpeg(tmp_path / "o.jpg", (600, 600)), "o.jpg", 160, root, cap=10**9
            )
        )
        mid = _run(
            photo_thumb.thumbnail(
                _jpeg(tmp_path / "m.jpg", (600, 600)), "m.jpg", 160, root, cap=10**9
            )
        )
        os.utime(old, ns=(1, 1))
        os.utime(mid, ns=(2, 2))
        # a hit on the oldest file makes it the most recently used
        _run(photo_thumb.thumbnail(tmp_path / "o.jpg", "o.jpg", 160, root, cap=10**9))
        size = old.stat().st_size
        new = _run(
            photo_thumb.thumbnail(
                _jpeg(tmp_path / "n.jpg", (600, 600)),
                "n.jpg",
                160,
                root,
                # 3 files > cap: one is evicted down to CACHE_LOW_WATER (0.75 x cap)
                cap=int(size * 2.8),
            )
        )
        assert old.exists() and new.exists()
        assert not mid.exists()
        assert mid.name not in photo_thumb._states[root].used

    def test_read_variant_gives_none_when_evicted(self, tmp_path):
        with patch("backend.services.photo_thumb.logger") as log:
            assert photo_thumb.read_variant(tmp_path / "gone.webp") is None
        log.info.assert_called_with(
            "memories_skip",
            view="photo_thumb",
            reason="vanished",
            error_type="FileNotFoundError",
        )
        (tmp_path / "v.webp").write_bytes(b"webp")
        assert photo_thumb.read_variant(tmp_path / "v.webp") == b"webp"

    def test_formats_are_an_allowlist(self):
        formats = photo_thumb.picture_formats()
        assert {"JPEG", "PNG", "WEBP", "GIF"} <= set(formats)
        assert set(formats) <= set(
            photo_thumb.BASE_FORMATS + photo_thumb.OPTIONAL_FORMATS
        )
        assert "EPS" not in formats and "BMP" not in formats
        with patch.dict(photo_thumb.Image.OPEN, {"HEIF": object()}):
            assert "HEIF" in photo_thumb.picture_formats()
        with patch.dict(photo_thumb.Image.OPEN):
            photo_thumb.Image.OPEN.pop("AVIF", None)
            photo_thumb.Image.OPEN.pop("HEIF", None)
            assert not set(photo_thumb.picture_formats()) & {"AVIF", "HEIF"}

    def test_an_mpo_file_still_opens_through_jpeg(self, tmp_path):
        src = tmp_path / "m.jpg"
        frames = [
            Image.new("RGB", (400, 300), (10, 20, 30)),
            Image.new("RGB", (400, 300), (40, 50, 60)),
        ]
        frames[0].save(src, format="MPO", save_all=True, append_images=frames[1:])
        out = _run(photo_thumb.thumbnail(src, "m.jpg", 160, tmp_path / "c"))
        assert out is not None

    def test_an_eps_file_never_reaches_its_decoder(self, tmp_path):
        from PIL import EpsImagePlugin

        src = tmp_path / "trap.jpg"
        src.write_bytes(b"%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n")
        with (
            patch.object(EpsImagePlugin.EpsImageFile, "_open") as decoder,
            patch("backend.services.photo_thumb.logger") as log,
        ):
            assert (
                _run(photo_thumb.thumbnail(src, "trap.jpg", 160, tmp_path / "c"))
                is None
            )
        decoder.assert_not_called()
        log.info.assert_called_with(
            "memories_skip",
            view="photo_thumb",
            reason="unreadable",
            error_type="UnidentifiedImageError",
        )

    def test_sweeps_stale_temp_files_on_first_use(self, tmp_path):
        root = tmp_path / "c"
        root.mkdir()
        stale, fresh = root / "a.tmp", root / "b.tmp"
        stale.write_bytes(b"x")
        fresh.write_bytes(b"x")
        old = time.time() - photo_thumb.TMP_MAX_AGE_S - 60
        os.utime(stale, (old, old))
        src = _jpeg(tmp_path / "a.jpg", (400, 400))
        with patch("backend.services.photo_thumb.logger") as log:
            _run(photo_thumb.thumbnail(src, "a.jpg", 160, root))
        assert not stale.exists() and fresh.exists()
        log.info.assert_any_call("photo_thumb_sweep", count=1)

    def test_sweep_tolerates_errors_and_a_missing_dir(self, tmp_path):
        photo_thumb._sweep_tmp(tmp_path / "none")
        root = tmp_path / "c"
        root.mkdir()
        (root / "a.tmp").write_bytes(b"x")
        with patch(
            "backend.services.photo_thumb.os.unlink", side_effect=PermissionError()
        ):
            with patch.object(photo_thumb, "TMP_MAX_AGE_S", -10):
                photo_thumb._sweep_tmp(root)
        assert (root / "a.tmp").exists()

    def test_a_full_disk_warns_once_per_window(self, tmp_path):
        srcs = [_jpeg(tmp_path / f"{i}.jpg", (400, 400)) for i in range(3)]
        with (
            patch("PIL.Image.Image.save", side_effect=OSError("disk full")),
            patch("backend.services.photo_thumb.logger") as log,
        ):
            for s in srcs:
                assert (
                    _run(photo_thumb.thumbnail(s, s.name, 160, tmp_path / "c")) is None
                )
            assert log.warning.call_count == 1
            with patch(
                "backend.services.photo_thumb.time.monotonic",
                return_value=time.monotonic() + 10**6,
            ):
                _run(photo_thumb.thumbnail(srcs[0], "again.jpg", 160, tmp_path / "c"))
        assert log.warning.call_count == 2
        assert log.warning.call_args.kwargs["suppressed"] == 2

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
        assert r.status_code == 403
        assert r.headers.get("content-type") != "image/webp"

    def test_a_symlink_escaping_the_archive_is_refused(self, archive, tmp_path):
        target = _jpeg(tmp_path / "outside.jpg", (600, 600))
        link = archive / "picture" / "link.jpg"
        try:
            link.symlink_to(target)
        except OSError:
            pytest.skip("symlinks unavailable")
        assert client.get(f"{URL}/picture/link.jpg?w=320").status_code == 403

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

    def test_headers_and_a_stable_etag_allow_304(self, archive):
        _jpeg(archive / "picture" / "1.jpg", (900, 900))
        first = client.get(f"{URL}/picture/1.jpg?w=160")
        assert first.headers["x-content-type-options"] == "nosniff"
        assert first.headers["cache-control"] == "private, max-age=86400"
        etag = first.headers["etag"]
        again = client.get(f"{URL}/picture/1.jpg?w=160")
        assert again.headers["etag"] == etag  # a hit never changes it
        r = client.get(
            f"{URL}/picture/1.jpg?w=160",
            headers={"If-None-Match": f'W/{etag}, "other"'},
        )
        assert r.status_code == 304
        assert r.content == b""
        assert r.headers["etag"] == etag
        assert (
            client.get(
                f"{URL}/picture/1.jpg?w=160", headers={"If-None-Match": '"other"'}
            ).status_code
            == 200
        )

    def test_a_variant_evicted_before_the_send_is_404(self, archive):
        _jpeg(archive / "picture" / "1.jpg", (900, 900))
        with patch("backend.services.photo_thumb.read_variant", return_value=None):
            assert client.get(f"{URL}/picture/1.jpg?w=160").status_code == 404

    def test_not_file_and_unreadable_404s_leave_breadcrumbs(self, archive):
        from backend.services.archive_urls import ArchiveReadError

        with patch("backend.api.content.logger") as log:
            assert client.get(f"{URL}/picture?w=320").status_code == 404
            log.info.assert_called_with(
                "memories_skip", view="photo_thumb", reason="not_file"
            )
            _jpeg(archive / "picture" / "1.jpg", (600, 600))
            with patch(
                "backend.api.content.archive_file_ok", side_effect=ArchiveReadError("x")
            ):
                assert client.get(f"{URL}/picture/1.jpg?w=320").status_code == 404
            log.info.assert_called_with(
                "memories_skip", view="photo_thumb", reason="unreadable"
            )


# --- toast images (Memories notification Hero) ------------------------------------------


def test_toast_image_is_a_bounded_jpeg_and_cached(tmp_path):
    root = tmp_path / "cache"
    src = _jpeg(tmp_path / "a" / "big.jpg", (3000, 1500))
    first = _run(photo_thumb.toast_image(src, root))
    assert first is not None and first.parent == root and first.suffix == ".jpg"
    with Image.open(first) as img:
        assert img.format == "JPEG" and img.size == (photo_thumb.TOAST_WIDTH, 512)
    assert first.stat().st_size <= photo_thumb.TOAST_MAX_BYTES
    assert _run(photo_thumb.toast_image(src, root)) == first  # a cache hit


def test_toast_image_flattens_transparency(tmp_path):
    src = _png(tmp_path / "a" / "alpha.png", (40, 20), mode="RGBA")
    out = _run(photo_thumb.toast_image(src, tmp_path / "cache"))
    assert out is not None
    with Image.open(out) as img:
        assert img.format == "JPEG" and img.mode == "RGB"


def test_toast_image_refuses_non_pictures_and_bad_files(tmp_path):
    root = tmp_path / "cache"
    video = tmp_path / "a" / "v.mp4"
    video.parent.mkdir(parents=True)
    video.write_bytes(b"\x00")
    assert _run(photo_thumb.toast_image(video, root)) is None
    broken = tmp_path / "a" / "b.jpg"
    broken.write_bytes(b"\xff\xd8\xff")
    assert _run(photo_thumb.toast_image(broken, root)) is None
    assert _run(photo_thumb.toast_image(tmp_path / "a" / "gone.jpg", root)) is None


def test_toast_image_over_the_byte_limit_is_refused(tmp_path):
    src = _jpeg(tmp_path / "a" / "p.jpg", (64, 64))
    with patch.object(photo_thumb, "TOAST_MAX_BYTES", 10):
        assert _run(photo_thumb.toast_image(src, tmp_path / "cache")) is None


def test_toast_jpegs_count_toward_the_cache_cap(tmp_path):
    root = tmp_path / "cache"
    src = _jpeg(tmp_path / "a" / "p.jpg", (600, 400))
    out = _run(photo_thumb.toast_image(src, root))
    assert out is not None
    photo_thumb.reset_cache_state()
    with photo_thumb._state_lock:
        assert photo_thumb._state(root).total == out.stat().st_size


def test_toast_image_that_vanishes_before_the_size_check_is_refused(tmp_path):
    src = _jpeg(tmp_path / "a" / "p.jpg", (64, 64))
    with patch.object(photo_thumb, "_size_or_none", lambda _p: None):
        assert _run(photo_thumb.toast_image(src, tmp_path / "cache")) is None
    out = _run(photo_thumb.toast_image(src, tmp_path / "cache"))
    assert out is not None
    out.unlink()
    assert photo_thumb._size_or_none(out) is None


# --- D4: the thumbnails never crowd the shared executor ------------------------------------


class TestThumbPool:
    def test_route_checks_and_cache_work_run_on_the_thumbnail_pool(
        self, archive, monkeypatch
    ):
        import threading

        from backend.api import content

        seen: dict[str, str] = {}
        real_ok = content.archive_file_ok
        real_lookup = photo_thumb.probe
        real_read = photo_thumb.read_variant

        def ok(*a):
            seen["check"] = threading.current_thread().name
            return real_ok(*a)

        def lookup(*a, **kw):
            seen["lookup"] = threading.current_thread().name
            return real_lookup(*a, **kw)

        def read(*a):
            seen["read"] = threading.current_thread().name
            return real_read(*a)

        monkeypatch.setattr(content, "archive_file_ok", ok)
        monkeypatch.setattr(photo_thumb, "probe", lookup)
        monkeypatch.setattr(photo_thumb, "read_variant", read)
        _jpeg(archive / "picture" / "1.jpg", (600, 600))
        assert client.get(f"{URL}/picture/1.jpg?w=320").status_code == 200
        assert set(seen) == {"check", "lookup", "read"}
        assert all(name.startswith("photo_thumb") for name in seen.values()), seen

    def test_route_errors_still_answer_from_the_pool(self, archive):
        assert client.get(f"{URL}/picture/none.jpg?w=320").status_code == 404


# --- M1: one decode for every size, derived misses, content-addressed URLs ---------------


def _counting_open():
    """Patch ``Image.open`` with a wrapper that counts calls (and still opens)."""
    real = Image.open
    calls: list[object] = []

    def opener(fp, *args, **kwargs):
        calls.append(fp)
        return real(fp, *args, **kwargs)

    return patch.object(photo_thumb.Image, "open", opener), calls


def _no_paths(logs, *paths: Path) -> None:
    text = repr(logs)
    for p in paths:
        assert str(p) not in text and p.name not in text, text


class TestConstants:
    def test_cache_cap_is_one_gib(self):
        assert photo_thumb.CACHE_CAP_BYTES == 1024**3

    def test_pregen_widths_are_allowed_and_640_is_on_demand_only(self):
        assert photo_thumb.PREGEN_WIDTHS == (480,)
        assert photo_thumb.ALLOWED_WIDTHS == frozenset({160, 320, 480, 640})
        # every pre-generated width is one the route serves; 640 (``large``
        # requests) is rendered on demand only (D-M7)
        assert set(photo_thumb.PREGEN_WIDTHS) <= set(photo_thumb.ALLOWED_WIDTHS)
        assert not hasattr(photo_thumb, "LARGE_WIDTH")

    def test_public_cache_helpers_keep_their_private_aliases(self):
        assert photo_thumb.cache_state_add is photo_thumb._added
        assert callable(photo_thumb.lookup) and callable(photo_thumb.read_variant)


class TestVersionToken:
    def test_is_stable_and_follows_size_and_mtime(self):
        tok = photo_thumb.version_token(10, 5)
        assert tok == photo_thumb.version_token(10, 5)
        assert len(tok) == 12 and all(c in "0123456789abcdef" for c in tok)
        assert tok != photo_thumb.version_token(11, 5)
        assert tok != photo_thumb.version_token(10, 6)

    def test_is_the_sha256_prefix_of_size_and_mtime(self):
        import hashlib

        assert (
            photo_thumb.version_token(1234, 5678)
            == hashlib.sha256(b"1234:5678").hexdigest()[:12]
        )


class TestArchiveRel:
    def test_is_the_resolved_posix_path_under_the_resolved_output(self, tmp_path):
        out = tmp_path / "out"
        f = _jpeg(out / "日向坂46" / "messages" / "a b" / "1.jpg", (10, 10))
        rel = photo_thumb.archive_rel(
            out, out / "日向坂46" / "messages" / ".." / "messages" / "a b" / "1.jpg"
        )
        assert rel == "日向坂46/messages/a b/1.jpg"
        assert photo_thumb.archive_rel(out, f) == rel

    def test_resolves_symlinks_like_the_route(self, tmp_path):
        real_out = tmp_path / "real"
        f = _jpeg(real_out / "s" / "1.jpg", (10, 10))
        link_out = tmp_path / "link"
        try:
            link_out.symlink_to(real_out, target_is_directory=True)
        except OSError:
            pytest.skip("symlinks unavailable")
        assert photo_thumb.archive_rel(link_out, link_out / "s" / "1.jpg") == "s/1.jpg"
        assert photo_thumb.archive_rel(real_out, f) == "s/1.jpg"

    def test_a_path_outside_raises(self, tmp_path):
        with pytest.raises(ValueError):
            photo_thumb.archive_rel(tmp_path / "out", tmp_path / "elsewhere.jpg")


class TestPlaceholder:
    def test_mean_colour_of_a_two_colour_image(self):
        img = Image.new("RGB", (100, 100), (200, 0, 0))
        img.paste((0, 0, 200), (50, 0, 100, 100))
        ph = photo_thumb.placeholder_of(img)
        assert all(abs(a - b) <= 2 for a, b in zip(ph.rgb, (100, 0, 100)))
        assert ph.blur is not None and len(ph.blur) <= photo_thumb.BLUR_MAX_BYTES
        blur = _open(ph.blur)
        assert blur.format == "WEBP" and max(blur.size) <= 16
        assert img.size == (100, 100)  # the input is left untouched

    def test_transparency_is_flattened_over_white(self):
        # A fully transparent pixel shows as white (like the toast JPEG), not its colour.
        ph = photo_thumb.placeholder_of(Image.new("RGBA", (20, 20), (10, 20, 30, 0)))
        assert ph.rgb == (255, 255, 255)
        half = Image.new("RGBA", (20, 20), (0, 0, 0, 255))
        half.paste((0, 0, 0, 0), (10, 0, 20, 20))
        ph = photo_thumb.placeholder_of(half)
        assert all(abs(c - 128) <= 2 for c in ph.rgb)
        assert half.getpixel((15, 5)) == (0, 0, 0, 0)  # the input is left untouched

    def test_palette_and_grey_images_are_measured_as_rgb(self):
        assert photo_thumb.placeholder_of(Image.new("L", (8, 8), 40)).rgb == (
            40,
            40,
            40,
        )
        pal = Image.new("RGB", (8, 8), (10, 200, 30)).convert(
            "P", palette=Image.Palette.ADAPTIVE
        )
        assert photo_thumb.placeholder_of(pal).rgb == (10, 200, 30)

    def test_an_oversized_blur_is_dropped(self):
        noisy = Image.effect_noise((64, 64), 120).convert("RGB")
        with patch.object(photo_thumb, "BLUR_MAX_BYTES", 10):
            ph = photo_thumb.placeholder_of(noisy)
        assert ph.blur is None and len(ph.rgb) == 3

    def test_is_frozen(self):
        ph = photo_thumb.placeholder_of(Image.new("RGB", (4, 4)))
        with pytest.raises(Exception):
            ph.rgb = (1, 2, 3)  # type: ignore[misc]


class TestMakeSet:
    def test_writes_every_width_from_one_open(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (1200, 1600))
        root = tmp_path / "c"
        patcher, calls = _counting_open()
        with patcher:
            res = photo_thumb.make_set(src, "a.jpg", (160, 320), root)
        assert len(calls) == 1
        assert res.reason is None
        assert set(res.written) == {160, 320} and res.present == {}
        st = src.stat()
        assert res.stat == (st.st_size, st.st_mtime_ns)
        assert res.size == (1200, 1600)
        assert res.placeholder is not None
        with Image.open(res.written[160]) as img:
            assert img.format == "WEBP" and img.size == (120, 160)
        with Image.open(res.written[320]) as img:
            assert img.size == (240, 320)
        assert not list(root.glob("*.tmp"))
        # every write is accounted toward the cap
        with photo_thumb._state_lock:
            assert photo_thumb._state(root).total == sum(
                p.stat().st_size for p in res.written.values()
            )

    def test_names_match_the_route_lookup(self, tmp_path):
        out = tmp_path / "out"
        src = _jpeg(out / "s" / "1.jpg", (800, 600))
        rel = photo_thumb.archive_rel(out, src)
        root = tmp_path / "c"
        res = photo_thumb.make_set(src, rel, photo_thumb.PREGEN_WIDTHS, root)
        st = src.stat()
        for w, path in res.written.items():
            assert path.name == photo_thumb.variant_name(
                rel, st.st_size, st.st_mtime_ns, w
            )
            hit, _ = photo_thumb.lookup(src, rel, w, root)
            assert hit == path
        with patch.object(photo_thumb.Image, "open", side_effect=AssertionError):
            assert _run(photo_thumb.thumbnail(src, rel, 480, root)) == res.written[480]

    def test_everything_present_opens_nothing_unless_a_placeholder_is_needed(
        self, tmp_path
    ):
        src = _jpeg(tmp_path / "a.jpg", (900, 900))
        root = tmp_path / "c"
        first = photo_thumb.make_set(src, "a.jpg", (160, 320), root)
        patcher, calls = _counting_open()
        with patcher:
            again = photo_thumb.make_set(src, "a.jpg", (160, 320), root)
        assert calls == []
        assert again.written == {} and again.present == first.written
        assert again.placeholder is None and again.size is None
        assert again.reason is None and again.stat == first.stat
        patcher, calls = _counting_open()
        with patcher:
            ph = photo_thumb.make_set(
                src, "a.jpg", (160, 320), root, need_placeholder=True
            )
        assert len(calls) == 1
        assert ph.written == {} and ph.present == first.written
        assert ph.placeholder is not None and ph.size == (900, 900)

    def test_only_missing_widths_are_written(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (900, 900))
        root = tmp_path / "c"
        small = photo_thumb.make_set(src, "a.jpg", (160,), root)
        res = photo_thumb.make_set(src, "a.jpg", (320, 160, 640), root)
        assert res.present == small.written
        assert set(res.written) == {320, 640}

    def test_size_follows_exif_orientation(self, tmp_path):
        src = _jpeg(tmp_path / "r.jpg", (800, 400), exif_orientation=6)
        res = photo_thumb.make_set(src, "r.jpg", (160, 320), tmp_path / "c")
        assert res.size == (400, 800)
        with Image.open(res.written[320]) as img:
            assert img.size == (160, 320)

    def test_rejects_an_unsupported_width(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (100, 100))
        res = photo_thumb.make_set(src, "a.jpg", (300,), tmp_path / "c")
        assert res.reason == "unsupported" and res.written == {}

    def test_missing_source_is_unavailable(self, tmp_path):
        res = photo_thumb.make_set(
            tmp_path / "gone.jpg", "gone.jpg", (160,), tmp_path / "c"
        )
        assert res.stat is None and res.reason == "unavailable" and res.written == {}

    @pytest.mark.parametrize("case", ["bomb", "eps", "truncated", "permission"])
    def test_untrusted_failures_give_a_reason_no_file_and_no_path(self, tmp_path, case):
        from structlog.testing import capture_logs

        root = tmp_path / "c"
        name = "秘密 picture.jpg"
        if case == "bomb":
            src = _png(tmp_path / name, (200, 200))
        elif case == "eps":
            src = tmp_path / name
            src.write_bytes(b"%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n")
        elif case == "truncated":
            full = io.BytesIO()
            Image.effect_noise((64, 64), 120).convert("RGB").save(full, format="JPEG")
            src = tmp_path / name
            src.write_bytes(full.getvalue()[: len(full.getvalue()) // 2])
        else:
            src = _jpeg(tmp_path / name, (100, 100))
        expected = {
            "bomb": "too_large",
            "eps": "unreadable",
            "truncated": "unreadable",
            "permission": "unavailable",
        }[case]
        bound = 100 * 100 if case == "bomb" else photo_thumb.MAX_SOURCE_PIXELS
        with (
            patch.object(photo_thumb, "MAX_SOURCE_PIXELS", bound),
            patch.object(
                photo_thumb.Image,
                "open",
                side_effect=PermissionError(str(src)),
            )
            if case == "permission"
            else patch.object(photo_thumb, "VIEW", photo_thumb.VIEW),
            capture_logs() as logs,
        ):
            res = photo_thumb.make_set(src, name, (160, 320), root)
        assert res.reason == expected
        assert res.written == {} and res.placeholder is None
        assert not root.exists() or not [p for p in root.iterdir()]
        assert any(e.get("reason") == expected for e in logs)
        _no_paths(logs, src, tmp_path)

    def test_never_raises(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (100, 100))
        with (
            patch.object(
                photo_thumb, "_variant_targets", side_effect=RuntimeError("x")
            ),
            patch("backend.services.photo_thumb.logger") as log,
        ):
            res = photo_thumb.make_set(src, "a.jpg", (160,), tmp_path / "c")
        assert res.reason == "unreadable" and res.written == {}
        log.info.assert_called_with(
            "memories_skip",
            view="photo_thumb",
            reason="unreadable",
            error_type="RuntimeError",
        )

    def test_a_write_failure_skips_that_width(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (900, 900))
        with patch.object(photo_thumb, "_write", side_effect=OSError("disk full")):
            res = photo_thumb.make_set(src, "a.jpg", (160, 320), tmp_path / "c")
        assert res.written == {} and res.present == {} and res.reason is None
        assert res.placeholder is not None and res.size == (900, 900)

    def test_a_replace_race_counts_the_variant_as_present(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (400, 400))
        root = tmp_path / "c"
        root.mkdir()
        st = src.stat()
        target = root / photo_thumb.variant_name(
            "a.jpg", st.st_size, st.st_mtime_ns, 160
        )
        real_is_file = Path.is_file
        seen = {"n": 0}

        def is_file(self):
            # the first probe sees no variant; another writer lands it meanwhile
            if self == target and seen["n"] == 0:
                seen["n"] += 1
                return False
            return real_is_file(self)

        target.write_bytes(b"other writer")
        with (
            patch.object(Path, "is_file", is_file),
            patch(
                "backend.services.photo_thumb.os.replace", side_effect=PermissionError()
            ),
        ):
            res = photo_thumb.make_set(src, "a.jpg", (160,), root)
        assert res.written == {} and res.present == {160: target}
        with patch(
            "backend.services.photo_thumb.os.replace", side_effect=PermissionError()
        ):
            target.unlink()
            res = photo_thumb.make_set(src, "a.jpg", (160,), root)
        assert res.written == {} and res.present == {}

    def test_poster_formats_restrict_the_decoder(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (400, 400))
        res = photo_thumb.make_set(
            src, "a.jpg", (160,), tmp_path / "c", formats=("WEBP",)
        )
        assert res.reason == "unreadable" and res.written == {}
        webp = tmp_path / "p.webp"
        Image.new("RGB", (400, 200), (5, 6, 7)).save(webp, format="WEBP")
        ok = photo_thumb.make_set(
            webp, "p.webp", (160,), tmp_path / "c", formats=("WEBP",)
        )
        assert set(ok.written) == {160} and ok.size == (400, 200)


class TestDerivedMiss:
    def test_a_smaller_width_is_rendered_from_a_cached_larger_variant(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (1200, 900))
        root = tmp_path / "c"
        big = _run(photo_thumb.thumbnail(src, "a.jpg", 320, root))
        assert big is not None
        real = Image.open
        opened: list[object] = []

        def guard(fp, *args, **kwargs):
            if Path(fp) == src:
                raise AssertionError("the source was decoded")
            opened.append((Path(fp), kwargs.get("formats")))
            return real(fp, *args, **kwargs)

        with (
            patch.object(photo_thumb.Image, "open", guard),
            patch("backend.services.photo_thumb.logger") as log,
        ):
            out = _run(photo_thumb.thumbnail(src, "a.jpg", 160, root))
        assert out is not None
        st = src.stat()
        assert out.name == photo_thumb.variant_name(
            "a.jpg", st.st_size, st.st_mtime_ns, 160
        )
        with Image.open(out) as img:
            assert img.format == "WEBP" and img.size == (160, 120)
        assert opened == [(big, ("WEBP",))]
        log.debug.assert_any_call("photo_thumb_cache", outcome="derived", width=160)

    def test_prefers_the_smallest_larger_variant(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (1600, 1200))
        root = tmp_path / "c"
        res = photo_thumb.make_set(src, "a.jpg", (320, 640), root)
        patcher, calls = _counting_open()
        with patcher:
            _run(photo_thumb.thumbnail(src, "a.jpg", 160, root))
        assert [Path(c) for c in calls] == [res.written[320]]

    def test_without_a_larger_variant_the_source_is_decoded(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (1200, 900))
        root = tmp_path / "c"
        _run(photo_thumb.thumbnail(src, "a.jpg", 160, root))  # smaller only
        with patch("backend.services.photo_thumb.logger") as log:
            out = _run(photo_thumb.thumbnail(src, "a.jpg", 320, root))
        assert out is not None
        log.debug.assert_any_call("photo_thumb_cache", outcome="miss", width=320)

    def test_a_broken_larger_variant_falls_back_to_the_source(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (1200, 900))
        root = tmp_path / "c"
        big = _run(photo_thumb.thumbnail(src, "a.jpg", 320, root))
        big.write_bytes(b"corrupt")
        out = _run(photo_thumb.thumbnail(src, "a.jpg", 160, root))
        assert out is not None
        with Image.open(out) as img:
            assert img.size == (160, 120)


class TestThumbnailWithToken:
    def test_gives_the_path_and_the_current_token(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (400, 400))
        st = src.stat()
        res = _run(photo_thumb.thumbnail_with_token(src, "a.jpg", 160, tmp_path / "c"))
        assert res is not None
        assert res.token == photo_thumb.version_token(st.st_size, st.st_mtime_ns)
        assert res.path == _run(
            photo_thumb.thumbnail(src, "a.jpg", 160, tmp_path / "c")
        )

    def test_none_for_a_failure(self, tmp_path):
        bad = tmp_path / "b.jpg"
        bad.write_bytes(b"garbage")
        assert (
            _run(photo_thumb.thumbnail_with_token(bad, "b.jpg", 160, tmp_path / "c"))
            is None
        )


class TestThumbRouteVersion:
    def _token(self, path: Path) -> str:
        st = path.stat()
        return photo_thumb.version_token(st.st_size, st.st_mtime_ns)

    def test_a_matching_v_is_immutable(self, archive):
        src = _jpeg(archive / "picture" / "1.jpg", (900, 900))
        r = client.get(f"{URL}/picture/1.jpg?w=160&v={self._token(src)}")
        assert r.status_code == 200
        cc = r.headers["cache-control"]
        assert cc == "private, max-age=31536000, immutable"
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["etag"]

    def test_a_stale_v_gets_the_current_body_without_caching(self, archive):
        _jpeg(archive / "picture" / "1.jpg", (900, 900))
        plain = client.get(f"{URL}/picture/1.jpg?w=160")
        r = client.get(f"{URL}/picture/1.jpg?w=160&v=000000000000")
        assert r.status_code == 200
        assert r.headers["cache-control"] == "private, no-cache"
        assert r.content == plain.content
        assert r.headers["etag"] == plain.headers["etag"]

    def test_no_v_keeps_one_day(self, archive):
        _jpeg(archive / "picture" / "1.jpg", (900, 900))
        r = client.get(f"{URL}/picture/1.jpg?w=160")
        assert r.headers["cache-control"] == "private, max-age=86400"

    @pytest.mark.parametrize(
        "bad", ["ABCDEF123456", "abc", "a1b2c3d4e5f6a", "zzzzzzzzzzzz"]
    )
    def test_a_malformed_v_is_422(self, archive, bad):
        _jpeg(archive / "picture" / "1.jpg", (900, 900))
        assert client.get(f"{URL}/picture/1.jpg?w=160&v={bad}").status_code == 422

    def test_a_matching_etag_is_still_304_with_v(self, archive):
        src = _jpeg(archive / "picture" / "1.jpg", (900, 900))
        v = self._token(src)
        first = client.get(f"{URL}/picture/1.jpg?w=160&v={v}")
        r = client.get(
            f"{URL}/picture/1.jpg?w=160&v={v}",
            headers={"If-None-Match": first.headers["etag"]},
        )
        assert r.status_code == 304 and r.content == b""
        assert r.headers["cache-control"] == "private, max-age=31536000, immutable"

    def test_the_route_keys_on_archive_rel(self, archive, tmp_path):
        src = _jpeg(archive / "picture" / "1.jpg", (900, 900))
        out = tmp_path / "out"
        rel = photo_thumb.archive_rel(out, src)
        res = photo_thumb.make_set(src, rel, (160,), tmp_path / "cache")
        with patch.object(photo_thumb.Image, "open", side_effect=AssertionError):
            r = client.get(f"{URL}/picture/1.jpg?w=160")
        assert r.status_code == 200
        assert r.headers["etag"] == f'"{res.written[160].stem}"'


class TestVideoPosterThumbs:
    """A video's thumbnail is rendered from its cached poster, never from Shell."""

    @pytest.fixture
    def posters(self, archive, tmp_path):
        from backend.services import video_poster

        with patch.object(
            video_poster, "poster_dir", return_value=tmp_path / "posters"
        ):
            yield tmp_path / "posters"

    def _video(self, archive) -> Path:
        (archive / "video").mkdir(exist_ok=True)
        src = archive / "video" / "2.mp4"
        src.write_bytes(b"\x00\x00\x00\x18ftypmp42")
        return src

    def _poster(self, posters: Path, src: Path, tmp_path: Path) -> Path:
        from backend.services import video_poster

        rel = photo_thumb.archive_rel(tmp_path / "out", src)
        st = src.stat()
        posters.mkdir(parents=True, exist_ok=True)
        out = posters / video_poster.poster_name(rel, st.st_size, st.st_mtime_ns)
        Image.new("RGB", (640, 360), (20, 200, 40)).save(out, format="WEBP")
        return out

    def test_a_video_with_a_poster_gets_a_webp_from_it(
        self, archive, posters, tmp_path
    ):
        from backend.services import win_shell_thumb

        src = self._video(archive)
        self._poster(posters, src, tmp_path)
        with patch.object(
            win_shell_thumb, "shell_thumbnail", side_effect=AssertionError("shell")
        ):
            r = client.get(f"{URL}/video/2.mp4?w=160")
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/webp"
        img = _open(r.content)
        assert img.size == (160, 90)
        assert img.convert("RGB").getpixel((80, 45))[1] > 150
        rel = photo_thumb.archive_rel(tmp_path / "out", src)
        st = src.stat()
        name = photo_thumb.variant_name(rel, st.st_size, st.st_mtime_ns, 160)
        assert (tmp_path / "cache" / name).is_file()  # keyed by the video's stat
        assert r.headers["etag"] == f'"{Path(name).stem}"'

    def test_the_video_v_is_the_videos_version(self, archive, posters, tmp_path):
        src = self._video(archive)
        self._poster(posters, src, tmp_path)
        st = src.stat()
        v = photo_thumb.version_token(st.st_size, st.st_mtime_ns)
        r = client.get(f"{URL}/video/2.mp4?w=320&v={v}")
        assert r.status_code == 200
        assert r.headers["cache-control"] == "private, max-age=31536000, immutable"

    def test_a_cached_video_variant_is_a_hit_without_the_poster(
        self, archive, posters, tmp_path
    ):
        src = self._video(archive)
        poster = self._poster(posters, src, tmp_path)
        assert client.get(f"{URL}/video/2.mp4?w=320").status_code == 200
        poster.unlink()
        assert client.get(f"{URL}/video/2.mp4?w=320").status_code == 200
        # a smaller width is derived from the cached larger variant
        assert client.get(f"{URL}/video/2.mp4?w=160").status_code == 200

    def test_a_video_without_a_poster_is_404_and_never_calls_shell(
        self, archive, posters
    ):
        from backend.services import win_shell_thumb

        self._video(archive)
        with (
            patch.object(
                win_shell_thumb, "shell_thumbnail", side_effect=AssertionError("shell")
            ),
            patch.object(win_shell_thumb, "available", return_value=True),
        ):
            r = client.get(f"{URL}/video/2.mp4?w=160")
        assert r.status_code == 404
        assert r.json()["detail"] == "No thumbnail"

    def test_a_poster_that_is_not_webp_is_refused(self, archive, posters, tmp_path):
        src = self._video(archive)
        poster = self._poster(posters, src, tmp_path)
        Image.new("RGB", (64, 64)).save(poster, format="PNG")  # not our format
        assert client.get(f"{URL}/video/2.mp4?w=160").status_code == 404

    def test_an_unknown_suffix_is_still_not_a_picture(self, archive, posters):
        (archive / "voice").mkdir()
        (archive / "voice" / "3.m4a").write_bytes(b"\x00")
        assert client.get(f"{URL}/voice/3.m4a?w=160").status_code == 404

    def test_suffix_sets_live_in_photo_thumb(self):
        from backend.services import media_meta

        assert media_meta.VIDEO_SUFFIXES is photo_thumb.VIDEO_SUFFIXES
        assert media_meta.PICTURE_SUFFIXES is photo_thumb.PICTURE_SUFFIXES
        assert photo_thumb.VIDEO_SUFFIXES == frozenset({".mp4", ".mov", ".m4v"})
        assert photo_thumb.is_video(Path("a/B.MP4"))

    def _larger(self, src: Path, tmp_path: Path, data: bytes) -> None:
        rel = photo_thumb.archive_rel(tmp_path / "out", src)
        st = src.stat()
        (tmp_path / "cache").mkdir(exist_ok=True)
        name = photo_thumb.variant_name(rel, st.st_size, st.st_mtime_ns, 640)
        (tmp_path / "cache" / name).write_bytes(data)

    def test_an_unreadable_larger_variant_falls_back_to_the_poster(
        self, archive, posters, tmp_path
    ):
        src = self._video(archive)
        self._poster(posters, src, tmp_path)
        self._larger(src, tmp_path, b"not a webp")
        r = client.get(f"{URL}/video/2.mp4?w=160")
        assert r.status_code == 200 and _open(r.content).size == (160, 90)

    def test_an_unreadable_larger_variant_without_a_poster_is_404(
        self, archive, posters, tmp_path
    ):
        src = self._video(archive)
        self._larger(src, tmp_path, b"not a webp")
        assert client.get(f"{URL}/video/2.mp4?w=160").status_code == 404


# --- M4: video-keyed variant sets and the cache total -----------------------------------


class TestMakeSetKeyStat:
    def test_variants_are_keyed_by_the_given_stat_not_the_source(self, tmp_path):
        """A video's variants are rendered from its poster but keyed by the video."""
        poster = tmp_path / "p.webp"
        Image.new("RGB", (640, 360), (5, 5, 5)).save(poster, format="WEBP")
        root = tmp_path / "c"
        res = photo_thumb.make_set(
            poster,
            "s/v/1.mp4",
            (160, 320),
            root,
            formats=("WEBP",),
            need_placeholder=True,
            key_stat=(1234, 5678),
        )
        assert res.reason is None and res.stat == (1234, 5678)
        assert set(res.written) == {160, 320}
        for w, path in res.written.items():
            assert path.name == photo_thumb.variant_name("s/v/1.mp4", 1234, 5678, w)
        assert res.size == (640, 360) and res.placeholder is not None
        again = photo_thumb.make_set(
            poster, "s/v/1.mp4", (160, 320), root, key_stat=(1234, 5678)
        )
        assert again.written == {} and set(again.present) == {160, 320}


class TestCacheTotal:
    def test_measures_once_and_reads_without_measuring(self, tmp_path):
        root = tmp_path / "c"
        root.mkdir()
        (root / "a-160.webp").write_bytes(b"x" * 100)
        assert photo_thumb.cache_total(root, measure=False) is None
        assert photo_thumb.cache_total(root) == 100
        photo_thumb.cache_state_add(root, 50, photo_thumb.CACHE_CAP_BYTES)
        assert photo_thumb.cache_total(root, measure=False) == 150


class TestFixRound1Widths:
    def test_low_water_sits_below_the_pregen_fill_line(self):
        from backend.services import media_pregen

        assert photo_thumb.CACHE_LOW_WATER == 0.75
        assert photo_thumb.CACHE_LOW_WATER < media_pregen.PREGEN_FILL_RATIO

    @pytest.mark.parametrize("width", [320, 160])
    def test_a_smaller_width_derives_from_the_pregenerated_480(self, tmp_path, width):
        """320 / 160 are rendered on demand from the cached 480: no source decode."""
        src = _jpeg(tmp_path / "a.jpg", (1600, 1200))
        root = tmp_path / "c"
        res = photo_thumb.make_set(src, "a.jpg", photo_thumb.PREGEN_WIDTHS, root)
        assert set(res.written) == {480}
        real = Image.open
        opened: list[object] = []

        def guarded(fp, *a, **kw):
            if Path(fp) == src:
                raise AssertionError("the source must not be decoded")
            opened.append(kw.get("formats"))
            return real(fp, *a, **kw)

        with (
            patch.object(photo_thumb.Image, "open", guarded),
            capture_logs() as logs,
        ):
            out = _run(photo_thumb.thumbnail(src, "a.jpg", width, root))
        assert out is not None and out.name.endswith(f"-{width}.webp")
        assert opened == [("WEBP",)]
        with Image.open(out) as img:
            assert max(img.size) == width
        assert {"event": "photo_thumb_cache", "outcome": "derived", "width": width} in [
            {k: e.get(k) for k in ("event", "outcome", "width")} for e in logs
        ]

    def test_the_route_accepts_480(self, archive):
        _jpeg(archive / "picture" / "1.jpg", (1200, 900))
        r = client.get(f"{URL}/picture/1.jpg?w=480")
        assert r.status_code == 200
        with Image.open(io.BytesIO(r.content)) as img:
            assert img.size == (480, 360)


def test_shutdown_io_pool_stops_the_threads_and_a_new_pool_is_made_on_demand():
    import threading

    pool = photo_thumb._io_executor()
    pool.submit(lambda: None).result()
    photo_thumb.shutdown_io_pool()
    assert not any(t.name.startswith("photo_thumb") for t in threading.enumerate())
    photo_thumb.shutdown_io_pool()  # nothing running: a no-op
    assert photo_thumb._io_executor() is not pool
    photo_thumb.shutdown_io_pool()


def _rewrite(path: Path, size: tuple[int, int]) -> None:
    """Rewrite ``path`` in place with new bytes and a later mtime."""
    st = path.stat()
    _jpeg(path, size)
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))


class TestSourceRewrittenDuringDecode:
    """3.4 / M1-1: bytes decoded after a rewrite are never stored under the old key."""

    def _rewriting_decode(self, src: Path):
        real = photo_thumb._decode

        def decode(*a, **k):
            out = real(*a, **k)
            _rewrite(src, (640, 480))
            return out

        return decode

    def test_make_set_skips_the_write(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (1200, 900))
        root = tmp_path / "c"
        with patch.object(photo_thumb, "_decode", self._rewriting_decode(src)):
            res = photo_thumb.make_set(src, "a.jpg", (160, 320), root)
        assert res.written == {} and res.reason == "unavailable"
        assert not root.exists() or not any(root.glob("*.webp"))

    def test_thumbnail_skips_the_write(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (1200, 900))
        root = tmp_path / "c"
        with patch.object(photo_thumb, "_decode", self._rewriting_decode(src)):
            out = _run(photo_thumb.thumbnail_with_token(src, "a.jpg", 160, root))
        assert out is None
        assert not root.exists() or not any(root.glob("*.webp"))

    def test_route_in_place_rewrite_old_v_is_no_cache_new_v_is_immutable(self, archive):
        """M1-6: after an in-place rewrite the old ``v`` never gets ``immutable``."""
        src = _jpeg(archive / "picture" / "1.jpg", (900, 900))
        st = src.stat()
        old_v = photo_thumb.version_token(st.st_size, st.st_mtime_ns)
        first = client.get(f"{URL}/picture/1.jpg?w=160&v={old_v}")
        assert first.headers["cache-control"] == "private, max-age=31536000, immutable"
        _rewrite(src, (600, 300))
        st = src.stat()
        new_v = photo_thumb.version_token(st.st_size, st.st_mtime_ns)
        assert new_v != old_v
        stale = client.get(f"{URL}/picture/1.jpg?w=160&v={old_v}")
        assert stale.status_code == 200
        assert stale.headers["cache-control"] == "private, no-cache"
        assert stale.headers["etag"] != first.headers["etag"]
        fresh = client.get(f"{URL}/picture/1.jpg?w=160&v={new_v}")
        assert fresh.headers["cache-control"] == "private, max-age=31536000, immutable"
        assert fresh.content == stale.content
        with Image.open(io.BytesIO(fresh.content)) as img:
            assert img.size == (160, 80)

    def test_a_source_deleted_during_the_decode_writes_nothing(self, tmp_path):
        src = _jpeg(tmp_path / "a.jpg", (1200, 900))
        root = tmp_path / "c"
        st = src.stat()
        real = photo_thumb._decode

        def decode(*a, **k):
            out = real(*a, **k)
            src.unlink()
            return out

        with patch.object(photo_thumb, "_decode", decode):
            made = photo_thumb.make(
                src,
                root / "x.webp",
                160,
                root,
                key_stat=(st.st_size, st.st_mtime_ns),
            )
        assert made is None
        assert not (root / "x.webp").exists()
