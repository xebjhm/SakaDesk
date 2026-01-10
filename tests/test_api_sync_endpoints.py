
import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient

@pytest.fixture
def mock_sync_service():
    """Mock the global SyncService instance."""
    with patch("backend.api.sync.sync_service") as mock_service:
        mock_service.running = False
        mock_service.start_sync = AsyncMock()
        mock_service.check_new_messages = AsyncMock(return_value=[])
        mock_service.sync_older_messages = AsyncMock(return_value=10)
        yield mock_service

@pytest.mark.asyncio
async def test_start_sync_triggers_task(client, mock_sync_service):
    """Test start sync endpoint creates background task."""
    
    # We also need to mock asyncio.create_task to verify it's called
    with patch("asyncio.create_task") as mock_create_task:
        response = client.post("/api/sync/start")
        
        assert response.status_code == 200
        assert response.json() == {"status": "started"}
        
        # Verify create_task was called
        mock_create_task.assert_called_once()

@pytest.mark.asyncio
async def test_start_sync_already_running(client, mock_sync_service):
    """Test 400 error when sync is already running."""
    mock_sync_service.running = True
    
    response = client.post("/api/sync/start")
    
    assert response.status_code == 400
    assert "already running" in response.json()["detail"]

@pytest.mark.asyncio
async def test_check_new_messages(client, mock_sync_service):
    """Test check endpoints delegates to service."""
    response = client.get("/api/sync/check")
    assert response.status_code == 200
    mock_sync_service.check_new_messages.assert_called_once()

@pytest.mark.asyncio
async def test_sync_older_messages(client, mock_sync_service):
    """Test older messages endpoint delegates to service."""
    response = client.post("/api/sync/older", params={"group_id": "43", "member_id": "1"})
    assert response.status_code == 200
    mock_sync_service.sync_older_messages.assert_called_with("43", "1", 50)
