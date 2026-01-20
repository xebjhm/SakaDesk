from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_get_talk_rooms_requires_service():
    """GET /api/content/talk_rooms requires service param."""
    response = client.get("/api/content/talk_rooms")
    assert response.status_code == 422


def test_get_messages_param_based():
    """GET /api/content/messages with params works."""
    # This will 404 if no data, but should not 422
    response = client.get("/api/content/messages?service=hinatazaka46&talk_room_id=40&member_id=64")
    assert response.status_code in [200, 404]  # 404 is ok if no data


def test_get_talk_rooms_invalid_service():
    """GET /api/content/talk_rooms with invalid service returns 400."""
    response = client.get("/api/content/talk_rooms?service=invalid_service")
    assert response.status_code == 400
