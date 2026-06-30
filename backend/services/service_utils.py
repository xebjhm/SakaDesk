"""
Service utilities for multi-service support.
Maps between service identifiers and pysaka Group enum.
"""

from typing import Any, Dict, List, Optional, cast

from pysaka import Group
from pysaka.client import GROUP_CONFIG


def get_all_services() -> List[str]:
    """Get list of all supported service identifiers (lowercase)."""
    # Return lowercase names matching Group enum values
    return [g.value for g in Group]


def get_service_display_name(service: str) -> str:
    """Get display name for a service (e.g., '日向坂46')."""
    group = get_service_enum(service)
    return cast(str, GROUP_CONFIG[group]["display_name"])


def get_service_identifier(display_name: str) -> Optional[str]:
    """
    Reverse lookup: Get service identifier from display name or romanized name.
    E.g., '日向坂46' -> 'hinatazaka46'
    E.g., 'hinatazaka46' -> 'hinatazaka46'
    E.g., 'Hinatazaka46' -> 'hinatazaka46'
    Returns None if not found.
    """
    # First try Japanese display name lookup
    for group in Group:
        if GROUP_CONFIG[group]["display_name"] == display_name:
            return cast(str, group.value)

    # Then try romanized name lookup (case-insensitive)
    lower_name = display_name.lower()
    for group in Group:
        if group.value == lower_name:
            return cast(str, group.value)

    return None


def get_service_enum(service: str) -> Group:
    """Convert service string to Group enum (case-insensitive)."""
    try:
        return Group(service.lower())
    except ValueError:
        raise ValueError(f"Unknown service: {service}")


def validate_service(service: str) -> str:
    """Validate service identifier. Raises ValueError if invalid."""
    get_service_enum(service)  # Will raise if invalid
    return service


def get_service_config(service: str) -> Dict[str, Any]:
    """Get full config for a service."""
    group = get_service_enum(service)
    return cast(Dict[str, Any], GROUP_CONFIG[group])


def resolve_auth_mode(stored_mode: str, token_data: Optional[Dict[str, Any]]) -> str:
    """Effective auth mode for a service.

    "mobile" downgrades to "web" unless a ``refresh_token`` is stored: mobile mode
    refreshes via ``/update_token`` with that token, so without one it cannot work
    and falls back to web (the per-service toggle "snaps back" until a valid token
    is provided). Anything other than a token-backed "mobile" resolves to "web".
    """
    if stored_mode == "mobile" and (token_data or {}).get("refresh_token"):
        return "mobile"
    return "web"


def client_auth_params(
    auth_mode: str, session_dir: Any, token_data: Dict[str, Any]
) -> Dict[str, Any]:
    """Choose the Client refresh strategy AND request profile for the auth mode.

    - "mobile": long-lived ``refresh_token`` refresh, no browser fallback, and the
      ``android`` request profile (Dart UA, mobile host, x-talk-app-platform=android)
      so traffic mimics the official app.
    - "web" (default): cookie/session refresh with headless-browser fallback and the
      ``web`` request profile — behaves like the official web client.
    """
    if auth_mode == "mobile":
        return {
            "refresh_token": token_data.get("refresh_token"),
            "auth_dir": None,
            "platform": "android",
        }
    return {"refresh_token": None, "auth_dir": session_dir, "platform": "web"}
