from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_transcription_routes_registered():
    """Transcription endpoints should be accessible."""
    response = client.get("/api/transcription/status")
    assert response.status_code == 200


def test_get_cached_returns_404_when_not_found():
    """GET cached transcript returns 404 for non-existent transcription."""
    response = client.get("/api/transcription/hinatazaka46/99999")
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
