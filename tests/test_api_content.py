
import pytest
from unittest.mock import patch, mock_open, MagicMock
from pathlib import Path
import json

@pytest.fixture
def mock_fs_structure():
    """
    Mock a rich filesystem structure for groups/members/messages.
    Structure:
    output/
      sync_metadata.json
      43_Hinatazaka/
        1_MemberOne/
           messages.json
        2_MemberTwo/
           messages.json
        _MemberInvalid/ (Should be ignored)
      44_Others/ (Empty)
    """
    with patch("pathlib.Path.exists") as mock_exists, \
         patch("pathlib.Path.iterdir") as mock_iterdir, \
         patch("pathlib.Path.is_dir") as mock_is_dir, \
         patch("builtins.open") as mock_file:
        
        # Setup Exists
        # Default True for paths we care about
        mock_exists.return_value = True
        mock_is_dir.return_value = True
        
        # Setup Directory Iteration
        # Root Output Dir -> Groups
        group43 = MagicMock(spec=Path)
        group43.name = "43_Hinatazaka"
        group43.is_dir.return_value = True
        
        group44 = MagicMock(spec=Path)
        group44.name = "44_Others"
        group44.is_dir.return_value = True
        
        groupInvalid = MagicMock(spec=Path)
        groupInvalid.name = "InvalidGroup" # No underscore
        
        # Member Dirs for Group 43
        mem1 = MagicMock(spec=Path)
        mem1.name = "1_MemberOne"
        mem1.is_dir.return_value = True
        
        mem2 = MagicMock(spec=Path)
        mem2.name = "2_MemberTwo"
        mem2.is_dir.return_value = True
        
        # Side effect for iterdir based on which path called it
        # This is tricky with mocks. 
        # Strategy: Patch get_output_dir to return a specific mock path, 
        # then control that mock's iterdir.
        
        yield {
            "group43": group43,
            "mem1": mem1,
            "mock_exists": mock_exists,
            "mock_file": mock_file
        }

@pytest.mark.asyncio
async def test_get_groups(client):
    """Test parsing of group directory structure."""
    
    # We need to control iterdir carefully.
    # It's easier to mock Path objects directly in the loop logic 
    # but the API calls iterdir() on the path object.
    
    with patch("backend.api.content.get_output_dir") as mock_get_out:
        root_path = MagicMock()
        root_path.exists.return_value = True
        
        # Group Dirs
        g1 = MagicMock(); g1.name = "43_Hinatazaka"; g1.is_dir.return_value = True
        g2 = MagicMock(); g2.name = "46_Nogizaka"; g2.is_dir.return_value = True
        
        root_path.iterdir.return_value = [g1, g2]
        
        # Member Dirs (Different for each group)
        m1 = MagicMock(); m1.name = "1_MemA"; m1.is_dir.return_value = True
        m2 = MagicMock(); m2.name = "2_MemB"; m2.is_dir.return_value = True
        
        g1.iterdir.return_value = [m1, m2]
        g2.iterdir.return_value = [] # Empty group
        
        mock_get_out.return_value = root_path
        
        # Mock Reads for messages.json
        # We need to distinguish calls, or just return generic data
        mock_json_data = json.dumps({
            "member": {"name": "Test", "is_active": True},
            "messages": [{"id": 100}]
        })
        
        with patch("builtins.open", mock_open(read_data=mock_json_data)):
             response = client.get("/api/content/groups")
             
             assert response.status_code == 200
             data = response.json()
             
             # Group 43 has members, 46 does not
             # API filters out groups with 0 members.
             assert len(data) == 1 
             assert data[0]["id"] == "43"
             assert data[0]["member_count"] == 2
             assert data[0]["members"][0]["name"] == "MemA"
             # Wait, sync parsing priority: name from folder split usually for ID/Name
             # content.py line 91: mid, mname = m_dir.name.split("_", 1)
             # content.py line 94: member_meta = {"id": mid, "name": mname ...}
             # So usage of "1_MemA" -> name="MemA"
             
             assert data[0]["members"][0]["name"] == "MemA"

@pytest.mark.asyncio
async def test_get_group_messages(client):
    """Test fetching merged messages for a group."""
    with patch("backend.api.content.get_output_dir") as mock_get_out:
        # Setup Root Mock
        root_path = MagicMock()
        mock_resolved_root = MagicMock()
        mock_resolved_root.__str__.return_value = "/tmp/output"
        root_path.resolve.return_value = mock_resolved_root
        
        mock_get_out.return_value = root_path
        
        # Valid Path requested
        req_path = "43_Hinatazaka"
        
        # Setup Target Mock (Result of root / path)
        target_path = MagicMock()
        root_path.__truediv__.return_value = target_path
        
        # Setup Resolved Target Mock
        mock_resolved_target = MagicMock()
        mock_resolved_target.__str__.return_value = f"/tmp/output/{req_path}"
        mock_resolved_target.is_dir.return_value = True
        
        target_path.resolve.return_value = mock_resolved_target
        
        # Mock Members inside the resolved path
        m1 = MagicMock()
        m1.name = "1_MemA"
        m1.is_dir.return_value = True
        
        # Configure iterdir on the RESOLVED mock
        mock_resolved_target.iterdir.return_value = [m1]
        
        # Mock member message file
        # Code does: msg_file = m_dir / "messages.json"
        mock_msg_file = MagicMock()
        mock_msg_file.exists.return_value = True
        m1.__truediv__.return_value = mock_msg_file
        
        # Mock File Open
        mock_json = json.dumps({
            "member": {"name": "MemA"},
            "messages": [
                {"id": 1, "text": "Hi", "timestamp": "2023-01-01T10:00:00Z"},
                {"id": 2, "text": "Bye", "timestamp": "2023-01-01T11:00:00Z"}
            ]
        })
        
        with patch("builtins.open", mock_open(read_data=mock_json)):
             response = client.get(f"/api/content/group_messages/{req_path}")
             
             assert response.status_code == 200
             data = response.json()
             
             assert data["total_messages"] == 2
             assert data["messages"][0]["member_name"] == "MemA"

