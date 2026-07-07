import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

from backend.main import app
from backend.api import transcription as transcription_api
from backend.services.transcription_service import (
    TranscriptionResult,
    TranscriptionSegment,
)

_MEMBER_REL = "日向坂46/messages/34 金村 美玖/58 金村 美玖"


def _make_result(message_id: int) -> TranscriptionResult:
    return TranscriptionResult(
        message_id=message_id,
        media_type="voice",
        language="ja",
        model="gemini-3.1-flash-lite",
        duration_seconds=1.0,
        full_text="やあ",
        segments=[TranscriptionSegment(start=0.0, end=1.0, text="やあ")],
    )


def _setup_voice_member(tmp_path: Path) -> str:
    """Create a member dir with a voice message + its media file on disk."""
    member_dir = tmp_path / _MEMBER_REL
    (member_dir / "voice").mkdir(parents=True)
    (member_dir / "voice" / "500.m4a").write_bytes(b"fake audio")
    media_file = "messages/34 金村 美玖/58 金村 美玖/voice/500.m4a"
    (member_dir / "messages.json").write_text(
        json.dumps(
            {"messages": [{"id": 500, "type": "voice", "media_file": media_file}]}
        ),
        encoding="utf-8",
    )
    return _MEMBER_REL


def _setup_video_member(tmp_path: Path, *, is_muted=None) -> str:
    """Create a member dir with a video message + its media file on disk.

    ``is_muted`` mirrors the flag pysaka's sync computes via get_audio_metadata
    (True = the video has no audio track). Pass None to omit it, simulating an
    older message synced before the flag was persisted.
    """
    member_dir = tmp_path / _MEMBER_REL
    (member_dir / "video").mkdir(parents=True)
    (member_dir / "video" / "600.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42")
    msg = {
        "id": 600,
        "type": "video",
        "media_file": "messages/34 金村 美玖/58 金村 美玖/video/600.mp4",
    }
    if is_muted is not None:
        msg["is_muted"] = is_muted
    (member_dir / "messages.json").write_text(
        json.dumps({"messages": [msg]}), encoding="utf-8"
    )
    return _MEMBER_REL


class TestTranscribePost:
    """POST /transcribe branch coverage: cache fast path, no-key, error mapping."""

    def test_muted_video_via_stored_flag_returns_no_speech_without_ai(
        self, tmp_path, monkeypatch
    ):
        """A video already flagged is_muted at sync time short-circuits to an
        empty no_speech transcript and never reaches the Gemini path."""
        member_rel = _setup_video_member(tmp_path, is_muted=True)
        monkeypatch.setattr(transcription_api, "get_output_dir", lambda: tmp_path)
        with patch.object(transcription_api, "_get_gemini_api_key") as mock_key:
            resp = client.post(
                "/api/transcription/transcribe",
                json={
                    "message_id": 600,
                    "service": "hinatazaka46",
                    "member_path": member_rel,
                    "force": True,
                },
            )
        assert resp.status_code == 200
        body = resp.json()["transcription"]
        assert body["no_speech"] is True
        assert body["segments"] == []
        assert body["full_text"] == ""
        mock_key.assert_not_called()  # never entered the AI path

        cached = transcription_api.storage.load(tmp_path / member_rel, 600)
        assert cached is not None and cached.no_speech is True

    def test_muted_video_without_stored_flag_probes_then_skips(
        self, tmp_path, monkeypatch
    ):
        """When is_muted was never persisted (older messages), the endpoint
        computes it on demand via the existing get_audio_metadata detection and
        still skips Gemini for an audio-less video."""
        member_rel = _setup_video_member(tmp_path, is_muted=None)
        monkeypatch.setattr(transcription_api, "get_output_dir", lambda: tmp_path)
        with (
            patch.object(transcription_api, "_get_gemini_api_key") as mock_key,
            patch.object(
                transcription_api,
                "get_audio_metadata",
                return_value={"duration": 2.4, "is_muted": True},
            ) as mock_probe,
        ):
            resp = client.post(
                "/api/transcription/transcribe",
                json={
                    "message_id": 600,
                    "service": "hinatazaka46",
                    "member_path": member_rel,
                    "force": True,
                },
            )
        assert resp.status_code == 200
        assert resp.json()["transcription"]["no_speech"] is True
        mock_probe.assert_called_once()
        mock_key.assert_not_called()

    def test_cache_hit_returns_without_calling_ai(self, tmp_path, monkeypatch):
        (tmp_path / _MEMBER_REL).mkdir(parents=True)
        monkeypatch.setattr(transcription_api, "get_output_dir", lambda: tmp_path)
        with (
            patch.object(
                transcription_api.storage, "load", return_value=_make_result(500)
            ),
            patch.object(transcription_api, "_get_gemini_api_key") as mock_key,
        ):
            resp = client.post(
                "/api/transcription/transcribe",
                json={
                    "message_id": 500,
                    "service": "hinatazaka46",
                    "member_path": _MEMBER_REL,
                    "force": False,
                },
            )
        assert resp.status_code == 200
        assert resp.json()["transcription"]["message_id"] == 500
        mock_key.assert_not_called()  # never entered the AI path

    def test_no_api_key_returns_400(self, tmp_path, monkeypatch):
        member_rel = _setup_voice_member(tmp_path)
        monkeypatch.setattr(transcription_api, "get_output_dir", lambda: tmp_path)
        with (
            patch.object(transcription_api.storage, "load", return_value=None),
            patch.object(transcription_api, "_get_gemini_api_key", return_value=None),
        ):
            resp = client.post(
                "/api/transcription/transcribe",
                json={
                    "message_id": 500,
                    "service": "hinatazaka46",
                    "member_path": member_rel,
                    "force": True,
                },
            )
        assert resp.status_code == 400
        assert "api key" in resp.json()["detail"].lower()

    def test_rate_limit_maps_to_429(self, tmp_path, monkeypatch):
        member_rel = _setup_voice_member(tmp_path)
        monkeypatch.setattr(transcription_api, "get_output_dir", lambda: tmp_path)
        req = httpx.Request("POST", "https://gemini.example")
        err = httpx.HTTPStatusError(
            "boom", request=req, response=httpx.Response(429, request=req)
        )

        async def _raise(*a, **k):
            raise err

        with (
            patch.object(transcription_api.storage, "load", return_value=None),
            patch.object(transcription_api, "_get_gemini_api_key", return_value="k"),
            patch(
                "backend.services.settings_store.load_config",
                new=AsyncMock(
                    return_value={
                        "translation_provider": "gemini",
                        "translation_model": "gemini-3.1-flash-lite",
                    }
                ),
            ),
            patch.object(
                transcription_api.GeminiTranscriptionProvider, "transcribe", new=_raise
            ),
        ):
            resp = client.post(
                "/api/transcription/transcribe",
                json={
                    "message_id": 500,
                    "service": "hinatazaka46",
                    "member_path": member_rel,
                    "force": True,
                },
            )
        assert resp.status_code == 429


client = TestClient(app)


def _save_transcript(member_dir: Path, message_id: int) -> None:
    """Write a cached transcript into a member directory."""
    member_dir.mkdir(parents=True, exist_ok=True)
    transcription_api.storage.save(
        member_dir,
        TranscriptionResult(
            message_id=message_id,
            media_type="voice",
            language="ja",
            model="gemini-3.1-flash-lite",
            duration_seconds=1.0,
            full_text="こんにちは",
            segments=[TranscriptionSegment(start=0.0, end=1.0, text="こんにちは")],
        ),
    )


def test_transcription_routes_registered():
    """Transcription endpoints should be accessible."""
    response = client.get("/api/transcription/status")
    assert response.status_code == 200


def test_get_cached_returns_404_when_not_found():
    """GET cached transcript returns 404 for non-existent transcription."""
    response = client.get("/api/transcription/hinatazaka46/99999")
    assert response.status_code == 404


def test_get_cached_with_member_path_loads_directly(tmp_path, monkeypatch):
    """member_path fast path loads the transcript without scanning member dirs."""
    monkeypatch.setattr(transcription_api, "get_output_dir", lambda: tmp_path)
    member_path = "hinatazaka46/messages/1 group/2 member"
    _save_transcript(tmp_path / member_path, 4242)

    response = client.get(
        "/api/transcription/hinatazaka46/4242",
        params={"member_path": member_path},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["transcription"]["message_id"] == 4242


def test_get_cached_with_member_path_returns_404_when_absent(tmp_path, monkeypatch):
    """member_path fast path returns 404 (no fallback scan) when not cached there."""
    monkeypatch.setattr(transcription_api, "get_output_dir", lambda: tmp_path)
    member_path = "hinatazaka46/messages/1 group/2 member"
    (tmp_path / member_path).mkdir(parents=True)

    response = client.get(
        "/api/transcription/hinatazaka46/999",
        params={"member_path": member_path},
    )

    assert response.status_code == 404


def test_transcribe_requires_fields():
    """POST /api/transcription/transcribe requires all fields."""
    response = client.post("/api/transcription/transcribe", json={})
    assert response.status_code == 422


def test_status_returns_queue_info():
    """GET /api/transcription/status returns queue info."""
    response = client.get("/api/transcription/status")
    data = response.json()
    assert "queue_size" in data
    assert "processing" in data
