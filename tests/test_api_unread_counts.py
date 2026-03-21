"""Tests for /api/content/unread_counts endpoint."""

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


class TestUnreadCountsEndpoint:
    """Test POST /api/content/unread_counts endpoint."""

    def test_returns_empty_dict_when_output_dir_missing(self, client):
        """Should return empty dict when output directory doesn't exist."""
        with patch("backend.api.content.get_output_dir") as mock:
            mock.return_value = Path("/nonexistent/path")
            response = client.post("/api/content/unread_counts", json={"some/path": 0})
        assert response.status_code == 200
        assert response.json() == {}

    def test_counts_all_messages_when_last_read_is_zero(self, client):
        """Should count all messages when lastReadId is 0."""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create test message file
            member_path = Path(temp_dir) / "test" / "member"
            member_path.mkdir(parents=True)
            msg_file = member_path / "messages.json"
            msg_file.write_text(
                json.dumps(
                    {
                        "messages": [
                            {"id": 100, "content": "msg1"},
                            {"id": 200, "content": "msg2"},
                            {"id": 300, "content": "msg3"},
                        ]
                    }
                )
            )

            with patch(
                "backend.api.content.get_output_dir", return_value=Path(temp_dir)
            ):
                response = client.post(
                    "/api/content/unread_counts", json={"test/member": 0}
                )

            assert response.status_code == 200
            data = response.json()
            assert data["test/member"] == 3  # All messages are unread

    def test_counts_messages_after_last_read_id(self, client):
        """Should only count messages with ID > lastReadId."""
        with tempfile.TemporaryDirectory() as temp_dir:
            member_path = Path(temp_dir) / "test" / "member"
            member_path.mkdir(parents=True)
            msg_file = member_path / "messages.json"
            msg_file.write_text(
                json.dumps(
                    {
                        "messages": [
                            {"id": 100, "content": "msg1"},
                            {"id": 200, "content": "msg2"},
                            {"id": 300, "content": "msg3"},
                            {"id": 400, "content": "msg4"},
                            {"id": 500, "content": "msg5"},
                        ]
                    }
                )
            )

            with patch(
                "backend.api.content.get_output_dir", return_value=Path(temp_dir)
            ):
                response = client.post(
                    "/api/content/unread_counts",
                    json={"test/member": {"lastReadId": 200, "revealedIds": []}},
                )

            assert response.status_code == 200
            data = response.json()
            # IDs 300, 400, 500 are unread (3 messages)
            assert data["test/member"] == 3

    def test_excludes_revealed_ids_from_count(self, client):
        """Should exclude revealedIds from unread count."""
        with tempfile.TemporaryDirectory() as temp_dir:
            member_path = Path(temp_dir) / "test" / "member"
            member_path.mkdir(parents=True)
            msg_file = member_path / "messages.json"
            msg_file.write_text(
                json.dumps(
                    {
                        "messages": [
                            {"id": 100, "content": "msg1"},
                            {"id": 200, "content": "msg2"},
                            {"id": 300, "content": "msg3"},
                            {"id": 400, "content": "msg4"},
                            {"id": 500, "content": "msg5"},
                        ]
                    }
                )
            )

            with patch(
                "backend.api.content.get_output_dir", return_value=Path(temp_dir)
            ):
                # User read up to ID 200, then revealed 300 and 500 individually
                response = client.post(
                    "/api/content/unread_counts",
                    json={
                        "test/member": {"lastReadId": 200, "revealedIds": [300, 500]}
                    },
                )

            assert response.status_code == 200
            data = response.json()
            # ID 300, 500 were revealed individually, only 400 is unread
            assert data["test/member"] == 1

    def test_counts_zero_when_all_read(self, client):
        """Should return 0 when all messages are read."""
        with tempfile.TemporaryDirectory() as temp_dir:
            member_path = Path(temp_dir) / "test" / "member"
            member_path.mkdir(parents=True)
            msg_file = member_path / "messages.json"
            msg_file.write_text(
                json.dumps(
                    {
                        "messages": [
                            {"id": 100, "content": "msg1"},
                            {"id": 200, "content": "msg2"},
                        ]
                    }
                )
            )

            with patch(
                "backend.api.content.get_output_dir", return_value=Path(temp_dir)
            ):
                response = client.post(
                    "/api/content/unread_counts",
                    json={"test/member": 200},  # All read
                )

            assert response.status_code == 200
            data = response.json()
            assert data["test/member"] == 0

    def test_handles_group_chat_with_multiple_members(self, client):
        """Should count messages across all members in a group chat."""
        with tempfile.TemporaryDirectory() as temp_dir:
            group_path = Path(temp_dir) / "group"
            group_path.mkdir(parents=True)

            # Create two member directories with messages
            member1 = group_path / "member1"
            member1.mkdir()
            (member1 / "messages.json").write_text(
                json.dumps(
                    {
                        "messages": [
                            {"id": 100, "content": "m1-msg1"},
                            {"id": 300, "content": "m1-msg2"},
                        ]
                    }
                )
            )

            member2 = group_path / "member2"
            member2.mkdir()
            (member2 / "messages.json").write_text(
                json.dumps(
                    {
                        "messages": [
                            {"id": 200, "content": "m2-msg1"},
                            {"id": 400, "content": "m2-msg2"},
                        ]
                    }
                )
            )

            with patch(
                "backend.api.content.get_output_dir", return_value=Path(temp_dir)
            ):
                response = client.post(
                    "/api/content/unread_counts",
                    json={"group": 150},  # Read up to ID 150
                )

            assert response.status_code == 200
            data = response.json()
            # Unread: member1 has ID 300, member2 has IDs 200, 400 = 3 total
            assert data["group"] == 3

    def test_handles_multiple_paths(self, client):
        """Should handle multiple paths in a single request."""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create two separate member paths
            path1 = Path(temp_dir) / "member1"
            path1.mkdir()
            (path1 / "messages.json").write_text(
                json.dumps({"messages": [{"id": 100}, {"id": 200}]})
            )

            path2 = Path(temp_dir) / "member2"
            path2.mkdir()
            (path2 / "messages.json").write_text(
                json.dumps({"messages": [{"id": 300}, {"id": 400}, {"id": 500}]})
            )

            with patch(
                "backend.api.content.get_output_dir", return_value=Path(temp_dir)
            ):
                response = client.post(
                    "/api/content/unread_counts",
                    json={
                        "member1": 100,  # 1 unread (ID 200)
                        "member2": 400,  # 1 unread (ID 500)
                    },
                )

            assert response.status_code == 200
            data = response.json()
            assert data["member1"] == 1
            assert data["member2"] == 1

    def test_handles_nonexistent_path(self, client):
        """Should return 0 for paths that don't exist."""
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch(
                "backend.api.content.get_output_dir", return_value=Path(temp_dir)
            ):
                response = client.post(
                    "/api/content/unread_counts", json={"nonexistent/path": 0}
                )

            assert response.status_code == 200
            data = response.json()
            assert data["nonexistent/path"] == 0
