"""Year recap HTTP API (``backend/api/memories.py``)."""

from __future__ import annotations

import base64
import io
import json
import threading
from datetime import datetime
from unittest.mock import patch

import httpx

import pytest
import time_machine
from fastapi.testclient import TestClient

from backend.api import memories as api
from backend.main import app
from backend.services import app_state
from backend.services.memories import exports, share_gif
from backend.services.memories import index as mi
from backend.tests.test_memories_recap import (
    FINAL,
    FULL_ROWS,
    KANEMURA,
    LETTERS,
    SERVICE,
    SVC_NAME,
    write_room,
    write_subs,
)

client = TestClient(app)
MEMBER = f"{SVC_NAME}/messages/{KANEMURA[0]}/{KANEMURA[1]}"


@pytest.fixture
def out(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    app_state.set_db_path(tmp_path / "app.db")
    app_state.init_db()
    svc = tmp_path / "out" / SVC_NAME
    svc.mkdir(parents=True)
    write_room(svc, KANEMURA, FULL_ROWS, letters=LETTERS)
    write_subs(svc, {"34": "2024-07-24"})
    with patch("backend.api.memories.get_output_dir", return_value=svc.parent):
        yield svc.parent


def get(url, **params):
    with time_machine.travel(FINAL, tick=False):
        return client.get(url, params=params)


def test_member_recap_happy_path(out):
    r = get(f"/api/memories/{SERVICE}/recap/2026", member=MEMBER)
    assert r.status_code == 200
    body = r.json()
    assert body["year"] == 2026
    assert body["member"]["id"] == "58"
    assert [s["key"] for s in body["slides"]][0] == "s01_first"
    assert "poster" in body


def test_members_overview(out):
    r = get(f"/api/memories/{SERVICE}/recap/2026/members")
    assert r.status_code == 200
    body = r.json()
    assert body["year"] == 2026
    assert body["members"][0]["member_path"] == MEMBER
    assert "opening" in body


def test_traversal_is_400(out):
    r = get(f"/api/memories/{SERVICE}/recap/2026", member="../../etc/passwd")
    assert r.status_code == 400
    r = get(f"/api/memories/{SERVICE}/recap/2026", member=f"{SVC_NAME}/../../x")
    assert r.status_code == 400


def test_unknown_member_is_404(out):
    r = get(
        f"/api/memories/{SERVICE}/recap/2026",
        member=f"{SVC_NAME}/messages/99 誰か/1 誰か",
    )
    assert r.status_code == 404


def test_missing_member_is_422(out):
    assert get(f"/api/memories/{SERVICE}/recap/2026").status_code == 422


def test_unknown_service_is_400(out):
    assert get("/api/memories/nope/recap/2026/members").status_code == 400
    assert get("/api/memories/nope/recap/2026", member=MEMBER).status_code == 400


@pytest.mark.parametrize("year", [2019, 2029])
def test_year_out_of_range_is_400(out, year):
    assert get(f"/api/memories/{SERVICE}/recap/{year}/members").status_code == 400
    r = get(f"/api/memories/{SERVICE}/recap/{year}", member=MEMBER)
    assert r.status_code == 400


def test_no_absolute_paths_in_response(out, tmp_path):
    texts = [
        get(f"/api/memories/{SERVICE}/recap/2026", member=MEMBER).text,
        get(f"/api/memories/{SERVICE}/recap/2026/members").text,
    ]
    for text in texts:
        assert str(tmp_path) not in text
        assert "/tmp" not in text and "\\\\" not in text
        json.loads(text)


def test_now_is_utc_aware(out):
    seen = {}

    async def fake(service, d, year, *, now):
        seen["now"] = now
        return {"year": year}

    with patch("backend.api.memories.build_members_overview", fake):
        get(f"/api/memories/{SERVICE}/recap/2026/members")
    assert (
        isinstance(seen["now"], datetime)
        and seen["now"].utcoffset().total_seconds() == 0
    )


def test_recap_years(out):
    r = get(f"/api/memories/{SERVICE}/recap/years")
    assert r.status_code == 200
    assert r.json() == {"years": [2026]}


def test_recap_years_drops_years_before_min_year(out):
    async def fake(d, *, now):
        return [2019, 2024, 2026]

    with patch("backend.api.memories.recap_years", fake):
        r = get(f"/api/memories/{SERVICE}/recap/years")
    assert r.json() == {"years": [2024, 2026]}


def test_recap_years_unknown_service_is_400(out):
    assert get("/api/memories/nope/recap/years").status_code == 400


def test_member_of_another_service_is_404(out):
    other = out / "櫻坂46" / "messages" / "1 誰か" / "2 誰か"
    other.mkdir(parents=True)
    r = get(
        f"/api/memories/{SERVICE}/recap/2026", member="櫻坂46/messages/1 誰か/2 誰か"
    )
    assert r.status_code == 404


# --- export and share-GIF uploads ----------------------------------------------------

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def store():
    exports.store.clear()
    yield exports.store
    exports.store.clear()


def png_frame() -> str:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (54, 96), (10, 120, 190)).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def gif_body(**over) -> bytes:
    frames = [png_frame()] * 2
    payload = {"frames": frames, "fps": 15, "width": 54, "height": 96, **over}
    return json.dumps(payload).encode("utf-8")


def chunked(data: bytes, size: int = 1024):
    """A streamed body without Content-Length (only the streaming cap can stop it)."""
    for i in range(0, len(data), size):
        yield data[i : i + size]


@pytest.mark.asyncio
async def test_upload_bodies_are_joined_off_the_event_loop(store, monkeypatch):
    on_loop: list[bool] = []
    real = api._join_body

    def spy(chunks):
        on_loop.append(threading.current_thread() is threading.main_thread())
        return real(chunks)

    monkeypatch.setattr(api, "_join_body", spy)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as c:
        r1 = await c.post("/api/memories/export", params={"kind": "png"}, content=PNG)
        r2 = await c.post("/api/memories/share/gif", content=gif_body())
    assert r1.status_code == 200 and r2.status_code == 200
    assert on_loop == [False, False]  # both joined in a worker thread
    fetched = client.get(f"/api/memories/export/{r1.json()['token']}")
    assert fetched.status_code == 200 and fetched.content == PNG
    gif = client.get(f"/api/memories/export/{r2.json()['token']}")
    assert gif.content.startswith(b"GIF89a")


@pytest.mark.parametrize(
    ("url", "params", "cap_owner", "cap_name", "detail"),
    [
        (
            "/api/memories/export",
            {"kind": "png"},
            exports,
            "MAX_BYTES",
            "Export too large",
        ),
        ("/api/memories/share/gif", {}, share_gif, "MAX_BODY_BYTES", "too_large"),
    ],
)
@pytest.mark.parametrize("declared", [True, False])
def test_upload_over_the_cap_is_413(
    store, monkeypatch, url, params, cap_owner, cap_name, detail, declared
):
    monkeypatch.setattr(cap_owner, cap_name, 4096)
    data = PNG + b"\x00" * 8192
    content = data if declared else chunked(data)
    with patch.object(api, "_join_body") as join:
        r = client.post(url, params=params, content=content)
    assert r.status_code == 413 and r.json()["detail"] == detail
    join.assert_not_called()  # rejected before anything was joined
    assert len(store._entries) == 0


def test_export_whose_bytes_do_not_match_the_kind_is_400(store):
    r = client.post("/api/memories/export", params={"kind": "gif"}, content=PNG)
    assert r.status_code == 400


def test_share_gif_invalid_and_oversized_results(store, monkeypatch):
    r = client.post("/api/memories/share/gif", content=gif_body(fps=0))
    assert r.status_code == 400
    monkeypatch.setattr(exports, "MAX_BYTES", 16)
    r = client.post("/api/memories/share/gif", content=gif_body())
    assert r.status_code == 413 and r.json()["detail"] == "gif_too_large"


def test_unknown_export_token_is_404(store):
    assert client.get("/api/memories/export/missing").status_code == 404
