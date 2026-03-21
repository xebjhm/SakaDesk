"""
Path resolver for multi-service content API.
Converts API parameters to disk paths, decoupling API from disk structure.
"""

from pathlib import Path
import re
from typing import cast

from backend.services.service_utils import get_service_display_name, validate_service


def get_output_dir() -> Path:
    """Get configured output directory."""
    from backend.services.platform import get_settings_path, get_default_output_dir
    import json

    settings_path = get_settings_path()
    if settings_path.exists():
        try:
            with open(settings_path, "r", encoding="utf-8") as f:
                settings = json.load(f)
                path_str = settings.get("output_dir")
                if path_str:
                    return Path(path_str)
        except Exception:
            pass
    return get_default_output_dir()


def resolve_service_path(service: str) -> Path:
    """Get base path for a service's content."""
    validate_service(service)
    display_name = get_service_display_name(service)
    return cast(Path, get_output_dir() / display_name)


def find_folder_by_id(base_path: Path, folder_id: int) -> Path:
    """
    Find a folder that starts with the given ID.
    Folder names are in format "{id} {name}", e.g., "40 松田 好花".
    """
    if not base_path.exists():
        raise FileNotFoundError(f"Base path does not exist: {base_path}")

    pattern = re.compile(rf"^{folder_id}\s+.+$")

    for item in base_path.iterdir():
        if item.is_dir() and pattern.match(item.name):
            return item

    raise FileNotFoundError(f"No folder found with ID {folder_id} in {base_path}")


def resolve_talk_room_path(service: str, talk_room_id: int) -> Path:
    """Resolve path to a talk room directory."""
    service_path = resolve_service_path(service)
    messages_path = service_path / "messages"
    return find_folder_by_id(messages_path, talk_room_id)


def resolve_member_path(service: str, talk_room_id: int, member_id: int) -> Path:
    """Resolve path to a member directory within a talk room."""
    talk_room_path = resolve_talk_room_path(service, talk_room_id)
    return find_folder_by_id(talk_room_path, member_id)


def resolve_messages_file(service: str, talk_room_id: int, member_id: int) -> Path:
    """Resolve path to messages.json file."""
    member_path = resolve_member_path(service, talk_room_id, member_id)
    return member_path / "messages.json"


def resolve_media_path(
    service: str, talk_room_id: int, member_id: int, media_type: str, filename: str
) -> Path:
    """Resolve path to a media file."""
    member_path = resolve_member_path(service, talk_room_id, member_id)
    return member_path / media_type / filename
