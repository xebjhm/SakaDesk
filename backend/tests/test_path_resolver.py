import pytest
from pathlib import Path
from unittest.mock import patch
from backend.services.path_resolver import (
    resolve_service_path,
    find_folder_by_id,
    resolve_talk_room_path,
    resolve_member_path,
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
