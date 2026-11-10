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
                cap=int(size * 2.5),
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
