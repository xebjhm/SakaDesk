from pathlib import Path

from fastapi.testclient import TestClient

from backend.main import app
from backend.api import transcription as transcription_api
from backend.services.transcription_service import (
    TranscriptionResult,
    TranscriptionSegment,
)

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
