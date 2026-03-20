from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.api.content import validate_path_within_dir
from backend.main import app

client = TestClient(app)


def test_get_talk_rooms_requires_service():
    """GET /api/content/talk_rooms requires service param."""
    response = client.get("/api/content/talk_rooms")
    assert response.status_code == 422


def test_get_messages_param_based():
    """GET /api/content/messages with params works."""
    # This will 404 if no data, but should not 422
    response = client.get("/api/content/messages?service=hinatazaka46&talk_room_id=40&member_id=64")
    assert response.status_code in [200, 404]  # 404 is ok if no data


def test_get_talk_rooms_invalid_service():
    """GET /api/content/talk_rooms with invalid service returns 400."""
    response = client.get("/api/content/talk_rooms?service=invalid_service")
    assert response.status_code == 400


class TestValidatePathWithinDir:
    """Tests for the validate_path_within_dir security function."""

    def test_valid_path_resolves_correctly(self, tmp_path: Path):
        """A simple child path should resolve to the expected location."""
        subdir = tmp_path / "child"
        subdir.mkdir()
        result = validate_path_within_dir(tmp_path, "child")
        assert result == subdir.resolve()

    def test_parent_traversal_blocked(self, tmp_path: Path):
        """Attempting ../../../etc/passwd must raise 403."""
        with pytest.raises(HTTPException) as exc_info:
            validate_path_within_dir(tmp_path, "../../../etc/passwd")
        assert exc_info.value.status_code == 403

    def test_null_byte_rejected(self, tmp_path: Path):
        """Null bytes in path must raise 400."""
        with pytest.raises(HTTPException) as exc_info:
            validate_path_within_dir(tmp_path, "file\x00.txt")
        assert exc_info.value.status_code == 400

    def test_newline_rejected(self, tmp_path: Path):
        """Newline characters in path must raise 400."""
        with pytest.raises(HTTPException) as exc_info:
            validate_path_within_dir(tmp_path, "file\n.txt")
        assert exc_info.value.status_code == 400

    def test_carriage_return_rejected(self, tmp_path: Path):
        """Carriage return characters in path must raise 400."""
        with pytest.raises(HTTPException) as exc_info:
            validate_path_within_dir(tmp_path, "file\r.txt")
        assert exc_info.value.status_code == 400

    def test_double_dot_in_middle_blocked(self, tmp_path: Path):
        """Paths like subdir/../../etc must raise 403."""
        (tmp_path / "subdir").mkdir()
        with pytest.raises(HTTPException) as exc_info:
            validate_path_within_dir(tmp_path, "subdir/../../etc")
        assert exc_info.value.status_code == 403

    def test_dots_in_filename_allowed(self, tmp_path: Path):
        """Filenames with multiple dots (e.g. file.backup.jpg) are valid."""
        target = tmp_path / "file.backup.jpg"
        target.touch()
        result = validate_path_within_dir(tmp_path, "file.backup.jpg")
        assert result == target.resolve()


class TestDownloadEndpoint:
    """Tests for the GET /api/content/download/ endpoint."""

    def test_nonexistent_file_returns_404(self):
        """Downloading a file that does not exist should return 404, not 500."""
        response = client.get("/api/content/download/nonexistent/file.jpg")
        assert response.status_code == 404
