"""``/api/media`` endpoints of the 0.5.0 media pipeline (later tasks append here)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.api import media as media_api
from backend.main import app
from backend.services import archive_urls, media_meta, photo_thumb

client = TestClient(app)
META = "/api/media/meta"
ROOM = "messages/34 金村 美玖/58 金村 美玖"


def _url(*parts: str) -> str:
    return archive_urls.media_url("hinatazaka46", parts)


@pytest.fixture
def out(tmp_path):
    root = tmp_path / "out"
    room = root / "日向坂46" / ROOM
    (room / "picture").mkdir(parents=True)
    (room / "video").mkdir()
    Image.new("RGB", (40, 30), (1, 2, 3)).save(room / "picture" / "1.jpg", "JPEG")
    (room / "video" / "2.mp4").write_bytes(b"\x00" * 32)
    (tmp_path / "secret.jpg").write_bytes(b"x")
    media_meta.set_db_path(tmp_path / "cache" / media_meta.DB_NAME)
    with patch("backend.api.content.get_output_dir", return_value=root):
        yield root
    media_meta.set_db_path(None)


def test_meta_mixed_batch(out: Path, tmp_path: Path):
    pic = out / "日向坂46" / ROOM / "picture" / "1.jpg"
    rel = photo_thumb.archive_rel(out, pic)
    st = pic.stat()
    media_meta.put(
        media_meta.MetaRow(
            rel,
            f"{st.st_size}:{st.st_mtime_ns}",
            "picture",
            40,
            30,
            0x010203,
            b"blur",
            "ready",
            None,
            None,
            None,
        )
    )
    urls = [
        _url(*ROOM.split("/"), "picture", "1.jpg"),
        _url(*ROOM.split("/"), "video", "2.mp4"),
        _url(*ROOM.split("/"), "picture", "gone.jpg"),
        "/api/content/media/hinatazaka46/../../secret.jpg",
    ]
    calls: list[int] = []
    with patch.object(media_api, "_note_foreground", lambda: calls.append(1)):
        r = client.post(META, json={"urls": urls})
    assert r.status_code == 200
    items = r.json()["items"]
    assert list(items) == urls
    assert items[urls[0]]["kind"] == "picture" and items[urls[0]]["color"] == "#010203"
    assert items[urls[0]]["v"] == photo_thumb.version_token(st.st_size, st.st_mtime_ns)
    assert items[urls[1]]["kind"] == "video" and items[urls[1]]["poster"] is False
    assert items[urls[2]] is None and items[urls[3]] is None
    assert str(tmp_path) not in r.text and str(out) not in r.text
    assert r.headers["cache-control"] == "no-store"
    assert calls == [1]


def test_meta_note_foreground_tells_the_pregen_worker():
    from backend.services import media_pregen

    calls: list[int] = []
    with patch.object(media_pregen, "note_foreground", lambda: calls.append(1)):
        assert media_api._note_foreground() is None
    assert calls == [1]


@pytest.mark.parametrize("count", [0, 501])
def test_meta_rejects_a_bad_batch_size(out: Path, count: int):
    r = client.post(META, json={"urls": [_url("a.jpg")] * count})
    assert r.status_code == 400
    assert r.json()["detail"] == "bad_batch"


def test_meta_accepts_the_batch_limit(out: Path):
    r = client.post(META, json={"urls": [_url(f"{i}.jpg") for i in range(500)]})
    assert r.status_code == 200 and len(r.json()["items"]) == 500


@pytest.mark.parametrize(
    "body", [{"urls": "x"}, {"urls": [1, 2]}, {}, [], {"urls": ["a" * 5000]}]
)
def test_meta_rejects_a_malformed_body(out: Path, body):
    assert client.post(META, json=body).status_code == 422


# --- PUT /api/media/poster ----------------------------------------------------------------

POSTER = "/api/media/poster/hinatazaka46/" + ROOM


def _webp(size=(640, 360)) -> bytes:
    import io

    buf = io.BytesIO()
    Image.new("RGB", size, (90, 30, 160)).save(buf, format="WEBP")
    return buf.getvalue()


@pytest.fixture
def posters(out: Path, tmp_path: Path):
    from backend.services import video_poster

    photo_thumb.reset_cache_state()
    with patch.object(video_poster, "poster_dir", return_value=tmp_path / "posters"):
        yield tmp_path / "posters"
    photo_thumb.reset_cache_state()


def test_poster_201_then_200(out: Path, posters: Path, tmp_path: Path):
    video = out / "日向坂46" / ROOM / "video" / "2.mp4"
    st = video.stat()
    v = photo_thumb.version_token(st.st_size, st.st_mtime_ns)
    calls: list[int] = []
    with patch.object(media_api, "_note_foreground", lambda: calls.append(1)):
        r = client.put(
            f"{POSTER}/video/2.mp4",
            content=_webp(),
            headers={"Content-Type": "image/webp"},
        )
    assert r.status_code == 201 and r.json() == {"v": v}
    assert calls == [1]
    rel = photo_thumb.archive_rel(out, video)
    row = media_meta.get_many([rel])[rel]
    assert (row.poster, row.poster_source) == ("ready", "client")
    again = client.put(
        f"{POSTER}/video/2.mp4", content=_webp(), headers={"Content-Type": "image/webp"}
    )
    assert again.status_code == 200 and again.json() == {"v": v}
    assert str(tmp_path) not in r.text
    # the thumbnail route now serves the video from its poster
    thumb = client.get(f"/api/content/thumb/hinatazaka46/{ROOM}/video/2.mp4?w=160")
    assert thumb.status_code == 200 and thumb.headers["content-type"] == "image/webp"
    # and the meta endpoint reports it
    url = _url(*ROOM.split("/"), "video", "2.mp4")
    items = client.post(META, json={"urls": [url]}).json()["items"]
    assert items[url]["poster"] is True


def test_poster_bad_image_is_400(out: Path, posters: Path):
    r = client.put(
        f"{POSTER}/video/2.mp4",
        content=b"garbage",
        headers={"Content-Type": "image/jpeg"},
    )
    assert r.status_code == 400 and r.json()["detail"] == "bad_image"
    r = client.put(
        f"{POSTER}/video/2.mp4", content=_webp(), headers={"Content-Type": "image/png"}
    )
    assert r.status_code == 400 and r.json()["detail"] == "bad_image"


@pytest.mark.parametrize(
    "path",
    [
        f"{POSTER}/picture/1.jpg",
        f"{POSTER}/video/gone.mp4",
        f"{POSTER}/video",
        "/api/media/poster/hinatazaka46/%2E%2E/%2E%2E/secret.mp4",
        "/api/media/poster/hinatazaka46/%2E%2E/%E6%AB%BB%E5%9D%8246/x.mp4",
        "/api/media/poster/unknown/a.mp4",
        "/api/media/poster/hinatazaka46/a%00.mp4",
    ],
)
def test_poster_404_for_a_non_video_or_traversal(
    out: Path, posters: Path, tmp_path: Path, path: str
):
    (tmp_path / "secret.mp4").write_bytes(b"x")
    (out / "櫻坂46").mkdir()
    (out / "櫻坂46" / "x.mp4").write_bytes(b"x")  # another service's folder
    r = client.put(path, content=_webp(), headers={"Content-Type": "image/webp"})
    assert r.status_code == 404
    assert not posters.exists()


def test_poster_symlink_out_is_404(out: Path, posters: Path, tmp_path: Path):
    target = tmp_path / "outside.mp4"
    target.write_bytes(b"x")
    link = out / "日向坂46" / ROOM / "video" / "link.mp4"
    try:
        link.symlink_to(target)
    except OSError:
        pytest.skip("symlinks unavailable")
    r = client.put(
        f"{POSTER}/video/link.mp4",
        content=_webp(),
        headers={"Content-Type": "image/webp"},
    )
    assert r.status_code == 404


def test_poster_413_over_one_mib(out: Path, posters: Path):
    from backend.services import video_poster

    body = b"\xff" * (video_poster.POSTER_UPLOAD_MAX_BYTES + 1)
    r = client.put(
        f"{POSTER}/video/2.mp4", content=body, headers={"Content-Type": "image/jpeg"}
    )
    assert r.status_code == 413
    # exactly at the limit is read (and then refused as an image, not as a size)
    r = client.put(
        f"{POSTER}/video/2.mp4",
        content=body[:-1],
        headers={"Content-Type": "image/jpeg"},
    )
    assert r.status_code == 400


def test_poster_413_from_the_declared_length(out: Path, posters: Path):
    from backend.services import video_poster

    r = client.put(
        f"{POSTER}/video/2.mp4",
        content=b"x",
        headers={
            "Content-Type": "image/jpeg",
            "Content-Length": str(video_poster.POSTER_UPLOAD_MAX_BYTES + 1),
        },
    )
    assert r.status_code == 413


def test_poster_write_failure_is_503(out: Path, posters: Path):
    with patch.object(photo_thumb, "_write", side_effect=OSError("disk full")):
        r = client.put(
            f"{POSTER}/video/2.mp4",
            content=_webp(),
            headers={"Content-Type": "image/webp"},
        )
    assert r.status_code == 503 and r.json()["detail"] == "write_failed"


def test_poster_ingest_missing_race_is_404(out: Path, posters: Path):
    from backend.services import video_poster

    with patch.object(video_poster, "ingest_client", return_value=("missing", None)):
        r = client.put(
            f"{POSTER}/video/2.mp4",
            content=_webp(),
            headers={"Content-Type": "image/webp"},
        )
    assert r.status_code == 404


def test_poster_body_is_streamed_and_stops_at_the_limit(out: Path, posters: Path):
    """Raw ASGI: the handler stops pulling chunks once it is past 1 MiB + 1 byte."""
    import asyncio

    from fastapi import FastAPI

    from backend.services import video_poster

    mini = FastAPI()
    mini.include_router(media_api.router, prefix="/api/media")
    chunk = b"\xff" * 65536
    total_chunks = 64  # 4 MiB offered
    pulled = 0
    sent: list[dict] = []

    async def receive():
        nonlocal pulled
        pulled += 1
        return {
            "type": "http.request",
            "body": chunk,
            "more_body": pulled < total_chunks,
        }

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "PUT",
        "scheme": "http",
        "path": f"/api/media/poster/hinatazaka46/{ROOM}/video/2.mp4",
        "raw_path": b"",
        "query_string": b"",
        "root_path": "",
        "headers": [(b"content-type", b"image/jpeg")],
        "client": ("127.0.0.1", 1),
        "server": ("127.0.0.1", 80),
    }
    asyncio.run(mini(scope, receive, send))
    assert sent[0]["status"] == 413
    limit_chunks = video_poster.POSTER_UPLOAD_MAX_BYTES // len(chunk)
    assert pulled <= limit_chunks + 1 < total_chunks


async def _chunks(*parts: bytes):
    for p in parts:
        yield p


def test_read_capped_helper():
    import asyncio

    assert asyncio.run(media_api._read_capped(_chunks(b"ab", b"", b"cd"), 4)) == b"abcd"
    assert asyncio.run(media_api._read_capped(_chunks(b"ab", b"cde"), 4)) is None


def test_poster_archive_read_error_is_404(out: Path, posters: Path):
    with patch.object(
        archive_urls, "archive_file_ok", side_effect=archive_urls.ArchiveReadError("x")
    ):
        r = client.put(
            f"{POSTER}/video/2.mp4",
            content=_webp(),
            headers={"Content-Type": "image/webp"},
        )
    assert r.status_code == 404


# --- GET /api/media/status, DELETE /api/media/cache (M4) ----------------------------------


@pytest.fixture
def caches(tmp_path):
    from backend.services import video_poster

    photo_thumb.reset_cache_state()
    media_meta.set_db_path(tmp_path / "cache" / media_meta.DB_NAME)
    thumbs = tmp_path / "cache" / "photo_thumbs"
    posters = tmp_path / "cache" / "video_posters"
    with (
        patch.object(photo_thumb, "cache_dir", return_value=thumbs),
        patch.object(video_poster, "poster_dir", return_value=posters),
    ):
        yield thumbs, posters
    media_meta.set_db_path(None)
    photo_thumb.reset_cache_state()


def test_status_shape(caches):
    thumbs, posters = caches
    thumbs.mkdir(parents=True)
    (thumbs / "a-160.webp").write_bytes(b"x" * 300)
    media_meta.set_poster("v/1.mp4", "1:2", "ready", "shell")
    media_meta.set_poster("v/2.mp4", "1:2", "failed", "shell")
    media_meta.set_poster("v/3.mp4", "1:2", "none", "shell")
    r = client.get("/api/media/status")
    assert r.status_code == 200
    body = r.json()
    assert body["state"] == "stopped" and body["paused_reason"] is None
    assert body["services"] == {}
    assert body["posters"] == {
        "ready": 1,
        "failed": 1,
        "pending_client": 2,
        "shell_off": False,
    }
    assert body["cache"] == {
        "thumbs_bytes": 300,
        "posters_bytes": 0,
        "thumbs_cap": photo_thumb.CACHE_CAP_BYTES,
        "posters_cap": 256 * 1024**2,
    }
    assert r.headers["cache-control"] == "no-store"


def test_delete_cache_frees_the_bytes(caches):
    thumbs, posters = caches
    thumbs.mkdir(parents=True)
    posters.mkdir(parents=True)
    (thumbs / "a-160.webp").write_bytes(b"x" * 300)
    (thumbs / "b-320.webp").write_bytes(b"x" * 200)
    (posters / "p.webp").write_bytes(b"y" * 50)
    media_meta.put(
        media_meta.MetaRow(
            "a.jpg", "1:2", "picture", 1, 1, 0, None, "ready", None, None, None
        )
    )
    r = client.delete("/api/media/cache")
    assert r.status_code == 200 and r.json() == {"freed_bytes": 550}
    assert media_meta.counts()["rows"] == 0
    after = client.get("/api/media/status").json()
    assert after["cache"]["thumbs_bytes"] == 0 and after["cache"]["posters_bytes"] == 0
