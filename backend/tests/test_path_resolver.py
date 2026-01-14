import pytest
from pathlib import Path
from unittest.mock import patch
from backend.services.path_resolver import (
    resolve_service_path,
    find_folder_by_id,
    resolve_talk_room_path,
    resolve_member_path,
    get_output_dir,
    resolve_messages_file,
)


def test_resolve_service_path():
    """resolve_service_path returns path with display name."""
    with patch('backend.services.path_resolver.get_output_dir', return_value=Path("/output")):
        path = resolve_service_path("hinatazaka46")
        assert path == Path("/output/日向坂46")


def test_find_folder_by_id(tmp_path):
    """find_folder_by_id finds folder starting with ID."""
    (tmp_path / "40 松田 好花").mkdir()
    (tmp_path / "78 日向坂46 四期生ライブ").mkdir()

    result = find_folder_by_id(tmp_path, 40)
    assert result.name == "40 松田 好花"

    result = find_folder_by_id(tmp_path, 78)
    assert result.name == "78 日向坂46 四期生ライブ"


def test_find_folder_by_id_not_found(tmp_path):
    """find_folder_by_id raises if not found."""
    (tmp_path / "40 松田 好花").mkdir()

    with pytest.raises(FileNotFoundError):
        find_folder_by_id(tmp_path, 999)


def test_get_output_dir_default():
    """get_output_dir returns default when settings don't exist."""
    with patch('backend.services.platform.get_settings_path') as mock_path:
        mock_path.return_value = Path("/nonexistent/settings.json")
        result = get_output_dir()
        assert result == Path("output")


def test_find_folder_by_id_base_path_not_exists(tmp_path):
    """find_folder_by_id raises when base path doesn't exist."""
    non_existent = tmp_path / "nonexistent"
    with pytest.raises(FileNotFoundError):
        find_folder_by_id(non_existent, 40)


def test_resolve_talk_room_path(tmp_path):
    """resolve_talk_room_path finds talk room folder."""
    messages_dir = tmp_path / "日向坂46" / "messages"
    messages_dir.mkdir(parents=True)
    (messages_dir / "40 松田 好花").mkdir()

    with patch('backend.services.path_resolver.get_output_dir', return_value=tmp_path):
        with patch('backend.services.path_resolver.get_service_display_name', return_value="日向坂46"):
            result = resolve_talk_room_path("hinatazaka46", 40)
            assert result.name == "40 松田 好花"


def test_resolve_member_path(tmp_path):
    """resolve_member_path finds member folder within talk room."""
    member_dir = tmp_path / "日向坂46" / "messages" / "40 松田 好花" / "64 松田 好花"
    member_dir.mkdir(parents=True)

    with patch('backend.services.path_resolver.get_output_dir', return_value=tmp_path):
        with patch('backend.services.path_resolver.get_service_display_name', return_value="日向坂46"):
            result = resolve_member_path("hinatazaka46", 40, 64)
            assert result.name == "64 松田 好花"


def test_resolve_messages_file(tmp_path):
    """resolve_messages_file returns path to messages.json."""
    member_dir = tmp_path / "日向坂46" / "messages" / "40 松田 好花" / "64 松田 好花"
    member_dir.mkdir(parents=True)

    with patch('backend.services.path_resolver.get_output_dir', return_value=tmp_path):
        with patch('backend.services.path_resolver.get_service_display_name', return_value="日向坂46"):
            result = resolve_messages_file("hinatazaka46", 40, 64)
            assert result.name == "messages.json"
            assert result.parent.name == "64 松田 好花"
