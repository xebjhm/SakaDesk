"""
Service utilities for multi-service support.
Maps between service identifiers and PyHako Group enum.
"""
from pyhako import Group
from pyhako.client import GROUP_CONFIG


def get_all_services() -> list[str]:
    """Get list of all supported service identifiers."""
    return [g.value for g in Group]


def get_service_display_name(service: str) -> str:
    """Get display name for a service (e.g., '日向坂46')."""
    group = get_service_enum(service)
    return GROUP_CONFIG[group]["display_name"]


def get_service_identifier(display_name: str) -> str | None:
    """
    Reverse lookup: Get service identifier from display name.
    E.g., '日向坂46' -> 'hinatazaka46'
    Returns None if not found.
    """
    for group in Group:
        if GROUP_CONFIG[group]["display_name"] == display_name:
            return group.value
    return None


def get_service_enum(service: str) -> Group:
    """Convert service string to Group enum."""
    try:
        return Group(service)
    except ValueError:
        raise ValueError(f"Unknown service: {service}")


def validate_service(service: str) -> str:
    """Validate service identifier. Raises ValueError if invalid."""
    get_service_enum(service)  # Will raise if invalid
    return service


def get_service_config(service: str) -> dict:
    """Get full config for a service."""
    group = get_service_enum(service)
    return GROUP_CONFIG[group]
