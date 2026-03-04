# backend/tests/test_service_utils.py
import pytest
from backend.services.service_utils import (
    get_all_services,
    get_service_config,
    get_service_display_name,
    get_service_enum,
    validate_service,
)
from pyhako import Group


def test_get_all_services():
    services = get_all_services()
    assert len(services) == 4
    assert "hinatazaka46" in services
    assert "nogizaka46" in services
    assert "sakurazaka46" in services
    assert "yodel" in services


def test_get_service_display_name():
    assert get_service_display_name("hinatazaka46") == "日向坂46"
    assert get_service_display_name("nogizaka46") == "乃木坂46"
    assert get_service_display_name("sakurazaka46") == "櫻坂46"


def test_get_service_enum():
    assert get_service_enum("hinatazaka46") == Group.HINATAZAKA46
    assert get_service_enum("nogizaka46") == Group.NOGIZAKA46
    assert get_service_enum("sakurazaka46") == Group.SAKURAZAKA46


def test_validate_service_valid():
    assert validate_service("hinatazaka46") == "hinatazaka46"


def test_validate_service_invalid():
    with pytest.raises(ValueError):
        validate_service("invalid_service")


def test_get_service_config():
    """Test get_service_config returns correct config dict for valid service."""
    config = get_service_config("hinatazaka46")
    assert isinstance(config, dict)
    assert "display_name" in config
    assert config["display_name"] == "日向坂46"


def test_get_service_config_invalid():
    """Test get_service_config raises ValueError for invalid service."""
    with pytest.raises(ValueError, match="Unknown service"):
        get_service_config("invalid_service")


def test_get_service_display_name_invalid():
    """Test get_service_display_name raises ValueError for invalid service."""
    with pytest.raises(ValueError, match="Unknown service"):
        get_service_display_name("invalid_service")
