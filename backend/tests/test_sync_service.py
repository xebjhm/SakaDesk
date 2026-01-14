import pytest
from backend.services.sync_service import SyncService


def test_sync_service_accepts_service_param():
    """SyncService should accept a service parameter."""
    service = SyncService(service="hinatazaka46")
    assert service._service == "hinatazaka46"


def test_sync_service_invalid_service_raises():
    """SyncService with invalid service should raise."""
    with pytest.raises(ValueError):
        SyncService(service="invalid")
