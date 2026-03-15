"""
Test fixtures for E2E and integration testing.
These fixtures simulate authenticated state and API responses.
"""

# Simulated authenticated config (bypasses real OAuth)
TEST_AUTH_CONFIG = {
    "access_token": "test_token_for_e2e_testing_only",
    "x-talk-app-id": "test_app_id",
    "session_dir": "/tmp/hakodesk_test_session",
}

# Test member data
TEST_MEMBER = {
    "id": "test_member_001",
    "name": "Test Member",
    "thumbnail": "/api/content/media/test/thumbnail.jpg",
    "portrait": "/api/content/media/test/portrait.jpg",
    "phone_image": None,
}

# Test group/member list for sidebar
TEST_GROUPS = {
    "groups": [
        {
            "path": "individual/test_member_001",
            "name": "Test Member",
            "is_group": False,
            "message_count": 10,
            "last_message_date": "2024-01-15T10:30:00Z",
        },
        {
            "path": "group/test_group_chat",
            "name": "Test Group Chat",
            "is_group": True,
            "message_count": 25,
            "last_message_date": "2024-01-15T12:00:00Z",
        },
    ]
}

# Test messages for chat view
TEST_MESSAGES = [
    {
        "id": 1,
        "timestamp": "2024-01-15T09:00:00Z",
        "type": "text",
        "content": "Hello! This is a test message.",
        "is_favorite": False,
        "media_file": None,
        "width": None,
        "height": None,
    },
    {
        "id": 2,
        "timestamp": "2024-01-15T09:05:00Z",
        "type": "text",
        "content": "This is another test message with a link: https://example.com",
        "is_favorite": True,
        "media_file": None,
        "width": None,
        "height": None,
    },
    {
        "id": 3,
        "timestamp": "2024-01-15T09:10:00Z",
        "type": "picture",
        "content": "Check out this photo!",
        "is_favorite": False,
        "media_file": "test/photo.jpg",
        "width": 800,
        "height": 600,
    },
    {
        "id": 4,
        "timestamp": "2024-01-15T09:15:00Z",
        "type": "voice",
        "content": None,
        "is_favorite": False,
        "media_file": "test/voice.mp3",
        "width": None,
        "height": None,
    },
]

# Response for messages endpoint
def get_test_messages_response(path: str, last_read_id: int = 0) -> dict:
    """Generate test messages response matching API format."""
    message_ids = [int(m["id"]) for m in TEST_MESSAGES]  # type: ignore[call-overload]
    unread_count = sum(1 for mid in message_ids if mid > last_read_id)
    return {
        "member": TEST_MEMBER,
        "messages": TEST_MESSAGES,
        "total_count": len(TEST_MESSAGES),
        "unread_count": unread_count,
        "max_message_id": max(message_ids) if message_ids else 0,
    }
