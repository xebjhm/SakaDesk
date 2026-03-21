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


def test_get_sync_service_returns_same_instance():
    """get_sync_service should return same instance for same service."""
    from backend.api.sync import get_sync_service, _sync_services

    _sync_services.clear()  # Reset for test

    service1 = get_sync_service("hinatazaka46")
    service2 = get_sync_service("hinatazaka46")

    assert service1 is service2


def test_get_sync_service_returns_different_instances():
    """get_sync_service should return different instances for different services."""
    from backend.api.sync import get_sync_service, _sync_services

    _sync_services.clear()  # Reset for test

    service1 = get_sync_service("hinatazaka46")
    service2 = get_sync_service("nogizaka46")

    assert service1 is not service2
    assert service1._service == "hinatazaka46"
    assert service2._service == "nogizaka46"


def test_sync_service_default_service():
    """SyncService with no args should default to hinatazaka46."""
    service = SyncService()
    assert service._service == "hinatazaka46"
