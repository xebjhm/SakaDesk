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


def test_meta_default_note_foreground_is_a_no_op():
    assert media_api._note_foreground() is None


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
