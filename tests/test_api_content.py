"""
Tests for Content API.

PyHako directory structure:
  output_dir/
    {service_name}/                    <- e.g., "日向坂46"
      messages/
        {group_id} {group_name}/       <- e.g., "34 金村 美玖"
          {member_id} {member_name}/   <- e.g., "58 金村 美玖"
            messages.json
"""

import pytest
from unittest.mock import patch, mock_open, MagicMock
from pathlib import Path
import json


@pytest.mark.asyncio
async def test_get_groups(client):
    """Test parsing of group directory structure with PyHako format."""

    with patch("backend.api.content.get_output_dir") as mock_get_out:
        root_path = MagicMock()
        root_path.exists.return_value = True

        # Service directory (e.g., 日向坂46)
        service_dir = MagicMock()
        service_dir.name = "hinatazaka46"
        service_dir.is_dir.return_value = True

        root_path.iterdir.return_value = [service_dir]

        # messages/ directory inside service
        messages_dir = MagicMock()
        messages_dir.exists.return_value = True
        messages_dir.is_dir.return_value = True
        service_dir.__truediv__ = lambda self, x: messages_dir if x == "messages" else MagicMock()

        # Group directories inside messages/ (e.g., "34 金村 美玖")
        group1 = MagicMock()
        group1.name = "34 MemberA"
        group1.is_dir.return_value = True

        group2 = MagicMock()
        group2.name = "40 MemberB"
        group2.is_dir.return_value = True

        messages_dir.iterdir.return_value = [group1, group2]

        # Member directories inside each group (e.g., "58 金村 美玖")
        member1 = MagicMock()
        member1.name = "58 MemberA"
        member1.is_dir.return_value = True

        member2 = MagicMock()
        member2.name = "64 MemberB"
        member2.is_dir.return_value = True

        # messages.json exists in member dirs
        msg_file1 = MagicMock()
        msg_file1.exists.return_value = True
        member1.__truediv__ = lambda self, x: msg_file1 if x == "messages.json" else MagicMock()

        msg_file2 = MagicMock()
        msg_file2.exists.return_value = True
        member2.__truediv__ = lambda self, x: msg_file2 if x == "messages.json" else MagicMock()

        group1.iterdir.return_value = [member1]
        group2.iterdir.return_value = [member2]

        # relative_to mock
        member1.relative_to.return_value = Path("hinatazaka46/messages/34 MemberA/58 MemberA")
        member2.relative_to.return_value = Path("hinatazaka46/messages/40 MemberB/64 MemberB")
        group1.relative_to.return_value = Path("hinatazaka46/messages/34 MemberA")
        group2.relative_to.return_value = Path("hinatazaka46/messages/40 MemberB")

        mock_get_out.return_value = root_path

        # Mock JSON data for messages.json
        mock_json_data = json.dumps({
            "member": {"name": "Test", "is_active": True, "thumbnail": "http://example.com/thumb.jpg"},
            "messages": [{"id": 100, "text": "Hello", "timestamp": "2024-01-01T10:00:00Z"}],
            "total_messages": 1
        })

        with patch("builtins.open", mock_open(read_data=mock_json_data)):
            response = client.get("/api/content/groups")

            assert response.status_code == 200
            data = response.json()

            # Should have 2 groups (one member each)
            assert len(data) == 2
            assert data[0]["id"] == "34"
            assert data[0]["name"] == "MemberA"
            assert data[0]["service"] == "hinatazaka46"
            assert data[0]["member_count"] == 1
            assert data[0]["members"][0]["id"] == "58"
            assert data[0]["members"][0]["name"] == "MemberA"


@pytest.mark.asyncio
async def test_get_group_messages(client):
    """Test fetching merged messages for a group chat."""
    with patch("backend.api.content.get_output_dir") as mock_get_out:
        # Setup Root Mock
        root_path = MagicMock()
        mock_resolved_root = MagicMock()
        mock_resolved_root.__str__.return_value = "/tmp/output"
        root_path.resolve.return_value = mock_resolved_root

        mock_get_out.return_value = root_path

        # Valid Path requested: service/messages/group
        req_path = "hinatazaka46/messages/43 hinatazaka46"

        # Setup Target Mock (Result of root / path)
        target_path = MagicMock()
        root_path.__truediv__.return_value = target_path

        # Setup Resolved Target Mock
        mock_resolved_target = MagicMock()
        mock_resolved_target.__str__.return_value = f"/tmp/output/{req_path}"
        mock_resolved_target.is_dir.return_value = True

        target_path.resolve.return_value = mock_resolved_target

        # Mock Members inside the group directory
        m1 = MagicMock()
        m1.name = "79 hinatazaka46"
        m1.is_dir.return_value = True

        m2 = MagicMock()
        m2.name = "80 AnotherMember"
        m2.is_dir.return_value = True

        # Configure iterdir on the RESOLVED mock
        mock_resolved_target.iterdir.return_value = [m1, m2]

        # Mock member message files
        mock_msg_file1 = MagicMock()
        mock_msg_file1.exists.return_value = True
        m1.__truediv__ = lambda self, x: mock_msg_file1 if x == "messages.json" else MagicMock()

        mock_msg_file2 = MagicMock()
        mock_msg_file2.exists.return_value = True
        m2.__truediv__ = lambda self, x: mock_msg_file2 if x == "messages.json" else MagicMock()

        # Mock File Open with different data for each call
        mock_json1 = json.dumps({
            "member": {"name": "hinatazaka46"},
            "messages": [
                {"id": 1, "text": "Hi", "timestamp": "2023-01-01T10:00:00Z"},
            ]
        })
        mock_json2 = json.dumps({
            "member": {"name": "AnotherMember"},
            "messages": [
                {"id": 2, "text": "Bye", "timestamp": "2023-01-01T11:00:00Z"}
            ]
        })

        # Use side_effect to return different data
        mock_file = mock_open(read_data=mock_json1)
        mock_file.return_value.read.side_effect = [mock_json1, mock_json2]

        with patch("builtins.open", mock_open(read_data=mock_json1)):
            response = client.get(f"/api/content/group_messages/{req_path}")

            assert response.status_code == 200
            data = response.json()

            # At least 1 message from m1
            assert data["total_messages"] >= 1
            assert "messages" in data
            assert "members" in data


@pytest.mark.asyncio
async def test_get_messages_by_path(client):
    """Test fetching messages for a specific member path."""
    with patch("backend.api.content.get_output_dir") as mock_get_out:
        root_path = MagicMock()
        mock_resolved_root = MagicMock()
        mock_resolved_root.__str__.return_value = "/tmp/output"
        root_path.resolve.return_value = mock_resolved_root

        mock_get_out.return_value = root_path

        # Path to member directory
        req_path = "hinatazaka46/messages/34 MemberA/58 MemberA"

        target_path = MagicMock()
        root_path.__truediv__.return_value = target_path

        mock_resolved_target = MagicMock()
        mock_resolved_target.__str__.return_value = f"/tmp/output/{req_path}"
        target_path.resolve.return_value = mock_resolved_target

        # messages.json file
        msg_file = MagicMock()
        msg_file.exists.return_value = True
        mock_resolved_target.__truediv__ = lambda self, x: msg_file if x == "messages.json" else MagicMock()

        mock_json = json.dumps({
            "member": {"name": "MemberA", "thumbnail": "http://example.com/thumb.jpg"},
            "messages": [
                {"id": 1, "text": "Hello", "timestamp": "2024-01-01T10:00:00Z"},
                {"id": 2, "text": "World", "timestamp": "2024-01-01T11:00:00Z"},
            ],
            "total_messages": 2
        })

        with patch("builtins.open", mock_open(read_data=mock_json)):
            response = client.get(f"/api/content/messages_by_path?path={req_path}")

            assert response.status_code == 200
            data = response.json()

            assert data["total_count"] == 2
            assert len(data["messages"]) == 2
            assert data["messages"][0]["text"] == "Hello"


@pytest.mark.asyncio
async def test_parse_id_name():
    """Test the parse_id_name helper function."""
    from backend.api.content import parse_id_name

    # Standard format
    id_, name = parse_id_name("34 金村 美玖")
    assert id_ == "34"
    assert name == "金村 美玖"

    # With spaces in name
    id_, name = parse_id_name("58 Member Name With Spaces")
    assert id_ == "58"
    assert name == "Member Name With Spaces"

    # No ID prefix
    id_, name = parse_id_name("JustAName")
    assert id_ is None
    assert name == "JustAName"

    # ID without space
    id_, name = parse_id_name("123")
    assert id_ is None
    assert name == "123"
