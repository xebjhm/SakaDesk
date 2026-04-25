from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_translation_routes_registered():
    """Translation configure endpoint should be accessible."""
    response = client.post(
        "/api/translation/configure",
        json={
            "provider": "gemini",
            "model": "gemini-3.1-flash-lite-preview",
            "api_key": "test-key",
            "target_language": "en",
        },
    )
    assert response.status_code == 200


def test_translate_requires_fields():
    """POST /api/translation/translate requires all fields."""
    response = client.post("/api/translation/translate", json={})
    assert response.status_code == 422


def test_translate_batch_requires_fields():
    """POST /api/translation/translate-batch requires all fields."""
    response = client.post("/api/translation/translate-batch", json={})
    assert response.status_code == 422


def test_translate_blog_requires_fields():
    """POST /api/translation/translate-blog requires all fields."""
    response = client.post("/api/translation/translate-blog", json={})
    assert response.status_code == 422


def test_translate_rejects_unconfigured_provider():
    """Translation should fail when no provider is configured."""
    client.post(
        "/api/translation/configure",
        json={
            "provider": None,
            "model": None,
            "api_key": None,
            "target_language": "en",
        },
    )
    response = client.post(
        "/api/translation/translate",
        json={
            "type": "message",
            "message_id": 1,
            "service": "hinatazaka46",
            "member_path": "日向坂46/messages/34 金村 美玖/58 金村 美玖",
            "target_language": "en",
        },
    )
    assert response.status_code == 400
    assert "provider" in response.json()["detail"].lower()
