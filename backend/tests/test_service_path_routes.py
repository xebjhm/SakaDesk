"""Routes that take a client path read only inside a service folder (final review of
security hardening C): ``<output dir>/secret.json`` and ``<output dir>/other/...``
are refused, a ``<service>/messages/...`` path works, and the media URL forms
(id, any case, display-name folder) agree between the routes and /api/media/meta.
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import quote
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from structlog.testing import capture_logs

from backend.api import transcription as transcription_api
from backend.main import app
from backend.services import archive_urls

client = TestClient(app)
SVC = "日向坂46"
ROOM = "messages/34 G/58 M"
MSGS = {
    "member": {"name": "M"},
    "messages": [{"id": 1, "timestamp": "2025-01-15T10:00:00Z", "type": "text"}],
    "total_messages": 1,
}


def _write(path: Path, data: object = MSGS) -> None:
    path.mkdir(parents=True, exist_ok=True)
    (path / "messages.json").write_text(json.dumps(data), encoding="utf-8")


@pytest.fixture
def out(tmp_path: Path):
    root = tmp_path / "out"
    _write(root / SVC / ROOM)
    _write(root)  # <output dir>/messages.json: a file outside every service folder
    _write(root / "other" / ROOM)
    (root / "secret.json").write_text("{}", encoding="utf-8")
    with (
        patch("backend.api.content.get_output_dir", return_value=root),
        patch("backend.api.chat_features._get_output_dir", return_value=root),
        patch("backend.api.transcription.get_output_dir", return_value=root),
        patch("backend.api.translation.get_output_dir", return_value=root),
        patch("backend.api.content.is_test_mode", return_value=False),
    ):
        yield root


GOOD = f"{SVC}/{ROOM}"
BAD = [
    ".",
    "other",
    f"other/{ROOM}",
    "secret.json",
    "hinatazaka46",
    f"{SVC}/../other/{ROOM}",
    f"{SVC}/../../out",
    f"hinatazaka46/../other/{ROOM}",
]


def _get_routes(path: str):
    routes = [
        client.get("/api/content/messages_by_path", params={"path": path}),
        client.get("/api/content/profile_images", params={"path": path}),
    ]
    if path != ".":  # the client would collapse a bare "." out of the URL
        routes.append(client.get(f"/api/chat/message_dates/{quote(path, safe='')}"))
    return routes


@pytest.mark.parametrize("path", BAD)
def test_get_routes_refuse_paths_outside_a_service_folder(out, path):
    for r in _get_routes(path):
        assert r.status_code in (403, 404), (path, r.request.url)
    if path != ".":
        quoted = quote(path, safe="")
        r = client.get(f"/api/content/group_messages/{quoted}")
        assert r.status_code in (403, 404)
    r = client.post(
        "/api/content/unread_counts", json={path: {"lastReadId": 0, "revealedIds": []}}
    )
    assert r.json() == {path: 0}


def test_codes_match_the_media_route(out):
    assert client.get("/api/content/messages_by_path?path=other").status_code == 404
    assert (
        client.get(f"/api/content/messages_by_path?path={SVC}/../other/{ROOM}")
    ).status_code == 403


@pytest.mark.parametrize("path", [GOOD, f"hinatazaka46/{ROOM}", f"HINATAZAKA46/{ROOM}"])
def test_a_legit_service_path_works(out, path):
    assert (
        client.get("/api/content/messages_by_path", params={"path": path}).status_code
        == 200
    )
    assert client.get(f"/api/chat/message_dates/{path}").status_code == 200
    r = client.post(
        "/api/content/unread_counts", json={path: {"lastReadId": 0, "revealedIds": []}}
    )
    assert r.json() == {path: 1}


def test_group_messages_works_inside_a_service_folder(out):
    r = client.get(f"/api/content/group_messages/{SVC}/messages/34 G")
    assert r.status_code == 200


def test_a_link_in_the_service_folder_pointing_out_is_refused(out):
    (out / SVC / "link").symlink_to(out / "other", target_is_directory=True)
    r = client.get(
        "/api/content/messages_by_path", params={"path": f"{SVC}/link/{ROOM}"}
    )
    assert r.status_code == 403


def test_refusals_log_codes_only(out):
    with capture_logs() as logs:
        client.get("/api/content/messages_by_path?path=other")
        client.get(f"/api/content/messages_by_path?path={SVC}/../other/{ROOM}")
    assert {e.get("reason") for e in logs} == {
        "no_service_folder",
        "outside_service_folder",
    }
    assert "other" not in str(logs) and "34 G" not in str(logs)


# --- translation / transcription -------------------------------------------------------


@pytest.mark.parametrize("path", ["other/" + ROOM, ".", "secret.json"])
def test_translate_routes_refuse_paths_outside_a_service_folder(out, path):
    provider = MagicMock()
    provider.translate = AsyncMock()
    with patch(
        "backend.api.translation._get_provider_from_config",
        AsyncMock(return_value=provider),
    ):
        r1 = client.post(
            "/api/translation/translate",
            json={
                "type": "message",
                "message_id": 1,
                "service": "hinatazaka46",
                "member_path": path,
                "target_language": "en",
            },
        )
        r2 = client.post(
            "/api/translation/translate-batch",
            json={
                "type": "messages",
                "message_ids": [1],
                "service": "hinatazaka46",
                "member_path": path,
                "target_language": "en",
            },
        )
    assert r1.status_code in (403, 404) and r2.status_code in (403, 404)
    provider.translate.assert_not_called()


def _voice(root: Path, media_file: str, member: str = GOOD) -> None:
    msg = {"id": 7, "type": "voice", "media_file": media_file}
    _write(root / member, {"messages": [msg]})


def _transcribe(member: str):
    transcribe = AsyncMock(return_value=("t", []))
    with (
        patch.object(
            transcription_api.GeminiTranscriptionProvider, "transcribe", transcribe
        ),
        patch.object(transcription_api, "_get_gemini_api_key", return_value="k"),
        patch(
            "backend.services.settings_store.load_config",
            new=AsyncMock(return_value={"translation_provider": "gemini"}),
        ),
    ):
        r = client.post(
            "/api/transcription/transcribe",
            json={
                "message_id": 7,
                "service": "hinatazaka46",
                "member_path": member,
                "force": True,
            },
        )
    return r, transcribe


def test_transcribe_never_sends_a_file_outside_a_service_folder(out):
    (out / "secret.m4a").write_bytes(b"SECRET")
    # media_file climbs out of the service folder
    _voice(out, "../secret.m4a")
    r, transcribe = _transcribe(GOOD)
    assert r.status_code == 403
    transcribe.assert_not_called()
    # member_path names a folder outside every service folder
    (out / "other" / "v.m4a").write_bytes(b"SECRET")
    _voice(out, "v.m4a", member=f"other/{ROOM}")
    r, transcribe = _transcribe(f"other/{ROOM}")
    assert r.status_code == 404
    transcribe.assert_not_called()
    assert not (out / "other" / ROOM / "transcriptions.json").exists()
    # a file at the output dir root
    r, transcribe = _transcribe(".")
    assert r.status_code == 404
    transcribe.assert_not_called()


def test_transcribe_sends_a_file_inside_the_service_folder(out):
    (out / SVC / "messages" / "34 G" / "58 M" / "v.m4a").write_bytes(b"AUDIO")
    _voice(out, "messages/34 G/58 M/v.m4a")
    r, transcribe = _transcribe(GOOD)
    assert r.status_code == 200
    transcribe.assert_called_once()


def test_cached_transcription_refuses_other_folders(out):
    r = client.get(
        "/api/transcription/hinatazaka46/7", params={"member_path": f"other/{ROOM}"}
    )
    assert r.status_code == 404


# --- media: one resolver for the routes and /api/media/meta ---------------------------


@pytest.fixture
def media(out):
    pic = out / SVC / "messages" / "a.jpg"
    pic.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (400, 300), (1, 2, 3)).save(pic, "JPEG")
    (out / "outside.jpg").write_bytes(b"\xff\xd8\xff\xe0")
    return pic


FORMS = ["hinatazaka46", "HINATAZAKA46", SVC]


@pytest.mark.parametrize("form", FORMS)
def test_every_service_form_works_for_routes_and_meta(media, out, form):
    base = f"{form}/messages/a.jpg"
    assert client.get(f"/api/content/media/{base}").status_code == 200
    assert client.get(f"/api/content/download/{base}").status_code == 200
    assert client.get(f"/api/content/thumb/{base}?w=320").status_code == 200
    assert client.get(f"/api/content/avatar/{base}?w=96").status_code == 200
    url = archive_urls.MEDIA_PREFIX + base.replace(SVC, "%E6%97%A5%E5%90%91%E5%9D%8246")
    items = client.post("/api/media/meta", json={"urls": [url]}).json()["items"]
    assert items[url] is not None
    assert archive_urls.media_route_path(out, url) == media.resolve()


@pytest.mark.parametrize("form", FORMS)
def test_a_link_out_of_the_service_folder_is_refused_everywhere(media, out, form):
    (out / SVC / "link.jpg").symlink_to(out / "outside.jpg")
    base = f"{form}/link.jpg"
    for route in ("media", "download"):
        assert client.get(f"/api/content/{route}/{base}").status_code == 403
    assert client.get(f"/api/content/thumb/{base}?w=320").status_code == 403
    assert client.get(f"/api/content/avatar/{base}?w=96").status_code == 403
    assert (
        archive_urls.classify_media_route(out, archive_urls.MEDIA_PREFIX + base)
        == "outside"
    )


def test_a_backslash_path_is_not_a_service_folder(media, out):
    assert (
        client.get("/api/content/media/hinatazaka46%5Cmessages%5Ca.jpg").status_code
        == 404
    )
    url = archive_urls.MEDIA_PREFIX + "hinatazaka46%5Cmessages%5Ca.jpg"
    assert archive_urls.classify_media_route(out, url) == "invalid"


def test_clipboard_uses_the_same_resolver(media, out):
    with patch("backend.api.content.is_windows", return_value=True):
        with patch("backend.api.content.copy_file_to_clipboard") as copy:
            ok = client.post(
                "/api/content/clipboard",
                json={"media_url": f"/api/content/media/{SVC}/messages/a.jpg"},
            )
            bad = client.post(
                "/api/content/clipboard",
                json={"media_url": "/api/content/media/outside.jpg"},
            )
    assert ok.status_code == 200 and copy.call_count == 1
    assert bad.status_code == 404
