"""Extended tests for Content API — messages, download, media, profiles, error paths."""

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.api.content import (
    validate_path_within_dir,
    parse_id_name,
    get_member_dirs,
    get_output_dir,
    load_sync_metadata,
    _collect_groups,
    _resolve_media_path,
)
from backend.main import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# Helper: create a pysaka-style output tree on disk
# ---------------------------------------------------------------------------


def _make_messages_json(member_dir: Path, messages: list, member: dict | None = None):
    """Write a messages.json file into the given member directory."""
    member_dir.mkdir(parents=True, exist_ok=True)
    data = {
        "member": member or {"name": "Test", "thumbnail": None, "portrait": None},
        "messages": messages,
        "total_messages": len(messages),
    }
    with open(member_dir / "messages.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _build_tree(tmp_path: Path, service_display: str, groups: dict):
    """
    Build a pysaka-like directory tree.

    groups: { "34 Member Name": { "58 Member Name": [msg1, msg2, ...] } }
    """
    messages_dir = tmp_path / service_display / "messages"
    for group_folder, members in groups.items():
        for member_folder, msgs in members.items():
            _make_messages_json(messages_dir / group_folder / member_folder, msgs)
    return tmp_path


class TestCollectGroupsServiceFilter:
    """A group id (talk-room id) is only unique WITHIN a service, so the same id
    (e.g. 79) can exist in two services. A service-scoped request must return only
    that service's groups, or the frontend collides the two on their shared id."""

    def _two_service_tree(self, tmp_path: Path) -> Path:
        # Both services have a group id 79 — the real-world collision.
        _build_tree(
            tmp_path,
            "日向坂46",
            {"79 17th Single LIVE": {"120 Member": [{"id": 1}]}},
        )
        _build_tree(
            tmp_path,
            "櫻坂46",
            {"79 Nakagawa": {"134 Nakagawa": [{"id": 2}]}},
        )
        return tmp_path

    def test_service_filter_returns_only_that_service(self, tmp_path):
        self._two_service_tree(tmp_path)
        result = _collect_groups(tmp_path, "hinatazaka46")
        groups = result["groups"]
        services = {g["service"] for g in groups}
        assert services == {"hinatazaka46"}
        # Exactly one group id 79, and it is the hinatazaka one.
        id79 = [g for g in groups if str(g["id"]) == "79"]
        assert len(id79) == 1
        assert id79[0]["service"] == "hinatazaka46"

    def test_no_filter_returns_all_services(self, tmp_path):
        self._two_service_tree(tmp_path)
        result = _collect_groups(tmp_path)
        services = {g["service"] for g in result["groups"]}
        assert services == {"hinatazaka46", "sakurazaka46"}


# ---------------------------------------------------------------------------
# parse_id_name
# ---------------------------------------------------------------------------


class TestParseIdName:
    def test_standard_format(self):
        id_, name = parse_id_name("34 Gold Member")
        assert id_ == "34"
        assert name == "Gold Member"

    def test_no_id(self):
        id_, name = parse_id_name("just_a_name")
        assert id_ is None
        assert name == "just_a_name"

    def test_id_with_cjk_name(self):
        id_, name = parse_id_name("58 金村 美玖")
        assert id_ == "58"
        assert name == "金村 美玖"

    def test_empty_string(self):
        id_, name = parse_id_name("")
        assert id_ is None
        assert name == ""


# ---------------------------------------------------------------------------
# get_member_dirs
# ---------------------------------------------------------------------------


class TestGetMemberDirs:
    def test_returns_member_dirs_with_messages_json(self, tmp_path):
        group_dir = tmp_path / "34 Group"
        _make_messages_json(group_dir / "58 Member A", [{"id": 1}])
        _make_messages_json(group_dir / "59 Member B", [{"id": 2}])

        result = get_member_dirs(group_dir)
        assert len(result) == 2

    def test_skips_dirs_without_messages_json(self, tmp_path):
        group_dir = tmp_path / "34 Group"
        _make_messages_json(group_dir / "58 Member A", [{"id": 1}])
        (group_dir / "no_id_dir").mkdir(parents=True)  # no messages.json, no numeric ID

        result = get_member_dirs(group_dir)
        assert len(result) == 1

    def test_skips_dirs_without_numeric_id(self, tmp_path):
        group_dir = tmp_path / "34 Group"
        _make_messages_json(group_dir / "noid Member", [{"id": 1}])

        result = get_member_dirs(group_dir)
        assert len(result) == 0


# ---------------------------------------------------------------------------
# get_output_dir
# ---------------------------------------------------------------------------


class TestGetOutputDir:
    def test_reads_from_settings(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        with open(settings_file, "w", encoding="utf-8") as f:
            json.dump({"output_dir": str(tmp_path / "custom_out")}, f)

        with patch("backend.api.content.get_settings_path", return_value=settings_file):
            result = get_output_dir()
        assert result == tmp_path / "custom_out"

    def test_falls_back_to_default_when_no_settings(self, tmp_path):
        nonexistent = tmp_path / "missing_settings.json"
        with patch("backend.api.content.get_settings_path", return_value=nonexistent):
            result = get_output_dir()
        # Should return the module-level DEFAULT_OUTPUT_DIR
        assert isinstance(result, Path)

    def test_falls_back_on_corrupt_settings(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text("NOT_JSON", encoding="utf-8")
        with patch("backend.api.content.get_settings_path", return_value=settings_file):
            result = get_output_dir()
        assert isinstance(result, Path)


# ---------------------------------------------------------------------------
# load_sync_metadata
# ---------------------------------------------------------------------------


class TestLoadSyncMetadata:
    def test_no_output_dir(self, tmp_path):
        """Non-existent dir returns empty dicts."""
        m, sg, ls = load_sync_metadata(tmp_path / "nope")
        assert m == {}
        assert sg == {}
        assert ls == {}

    def test_loads_metadata_file(self, tmp_path):
        service_dir = tmp_path / "日向坂46"
        service_dir.mkdir()
        meta = {
            "groups": {"34_58": {"group_id": 34}},
            "server_groups": {"34": {"state": "open", "is_active": True}},
            "last_sync": "2025-01-15T12:00:00Z",
        }
        with open(service_dir / "sync_metadata.json", "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False)

        m, sg, ls = load_sync_metadata(tmp_path)
        assert "34_58" in m
        assert "日向坂46:34" in sg
        assert ls.get("hinatazaka46") == "2025-01-15T12:00:00Z"

    def test_corrupt_metadata_skipped(self, tmp_path):
        service_dir = tmp_path / "日向坂46"
        service_dir.mkdir()
        (service_dir / "sync_metadata.json").write_text("bad json!", encoding="utf-8")

        m, sg, ls = load_sync_metadata(tmp_path)
        assert m == {}

    def test_non_dir_items_skipped(self, tmp_path):
        (tmp_path / "file.txt").write_text("x", encoding="utf-8")
        m, sg, ls = load_sync_metadata(tmp_path)
        assert m == {}


# ---------------------------------------------------------------------------
# GET /api/content/messages_by_path
# ---------------------------------------------------------------------------


class TestMessagesByPath:
    def test_nonexistent_path_returns_404(self):
        with patch("backend.api.content.is_test_mode", return_value=False):
            with patch("backend.api.content.get_output_dir") as mock_out:
                mock_out.return_value = Path("/tmp/fake_output_noexist")
                response = client.get("/api/content/messages_by_path?path=no/such/path")
        # validate_path_within_dir may 403 or the 404 from missing file
        assert response.status_code in (403, 404)

    def test_returns_messages_with_pagination(self, tmp_path):
        msgs = [
            {"id": i, "timestamp": f"2025-01-15T{10 + i}:00:00Z", "type": "text"}
            for i in range(1, 6)
        ]
        member_dir = tmp_path / "svc" / "messages" / "34 Group" / "58 Member"
        _make_messages_json(member_dir, msgs)

        rel_path = "svc/messages/34 Group/58 Member"
        with patch("backend.api.content.is_test_mode", return_value=False):
            with patch("backend.api.content.get_output_dir", return_value=tmp_path):
                response = client.get(
                    f"/api/content/messages_by_path?path={rel_path}&limit=2"
                )

        assert response.status_code == 200
        data = response.json()
        assert data["total_count"] == 5
        assert len(data["messages"]) == 2

    def test_unread_count_calculation(self, tmp_path):
        msgs = [
            {"id": i, "timestamp": f"2025-01-15T{10 + i}:00:00Z"} for i in range(1, 4)
        ]
        member_dir = tmp_path / "svc" / "messages" / "34 G" / "58 M"
        _make_messages_json(member_dir, msgs)

        rel_path = "svc/messages/34 G/58 M"
        with patch("backend.api.content.is_test_mode", return_value=False):
            with patch("backend.api.content.get_output_dir", return_value=tmp_path):
                response = client.get(
                    f"/api/content/messages_by_path?path={rel_path}&last_read_id=1"
                )

        data = response.json()
        assert data["unread_count"] == 2  # ids 2 and 3 are unread

    def test_internal_error_returns_500(self, tmp_path):
        """If messages.json exists but is corrupt, expect 500."""
        member_dir = tmp_path / "svc" / "messages" / "34 G" / "58 M"
        member_dir.mkdir(parents=True)
        (member_dir / "messages.json").write_text("NOT JSON", encoding="utf-8")

        with patch("backend.api.content.is_test_mode", return_value=False):
            with patch("backend.api.content.get_output_dir", return_value=tmp_path):
                response = client.get(
                    "/api/content/messages_by_path?path=svc/messages/34 G/58 M"
                )
        assert response.status_code == 500


# ---------------------------------------------------------------------------
# GET /api/content/group_messages/{group_path}
# ---------------------------------------------------------------------------


class TestGroupMessages:
    def test_not_found_when_not_dir(self, tmp_path):
        with patch("backend.api.content.is_test_mode", return_value=False):
            with patch("backend.api.content.get_output_dir", return_value=tmp_path):
                # Path that doesn't exist
                response = client.get("/api/content/group_messages/no/such/group")
        assert response.status_code in (403, 404)

    def test_merges_messages_from_multiple_members(self, tmp_path):
        group_dir = tmp_path / "svc" / "messages" / "43 GroupChat"
        _make_messages_json(
            group_dir / "58 MemberA",
            [{"id": 1, "timestamp": "2025-01-15T10:00:00Z"}],
            {"name": "A", "thumbnail": None, "portrait": None},
        )
        _make_messages_json(
            group_dir / "59 MemberB",
            [{"id": 2, "timestamp": "2025-01-15T10:01:00Z"}],
            {"name": "B", "thumbnail": None, "portrait": None},
        )

        with patch("backend.api.content.is_test_mode", return_value=False):
            with patch("backend.api.content.get_output_dir", return_value=tmp_path):
                response = client.get(
                    "/api/content/group_messages/svc/messages/43 GroupChat"
                )

        assert response.status_code == 200
        data = response.json()
        assert data["total_messages"] == 2
        assert len(data["members"]) == 2
        # Messages sorted by timestamp
        assert data["messages"][0]["id"] == 1

    def test_unread_count_with_last_read_id(self, tmp_path):
        group_dir = tmp_path / "svc" / "messages" / "43 G"
        _make_messages_json(
            group_dir / "58 M",
            [
                {"id": i, "timestamp": f"2025-01-15T{10 + i}:00:00Z"}
                for i in range(1, 4)
            ],
        )

        with patch("backend.api.content.is_test_mode", return_value=False):
            with patch("backend.api.content.get_output_dir", return_value=tmp_path):
                response = client.get(
                    "/api/content/group_messages/svc/messages/43 G?last_read_id=2"
                )

        data = response.json()
        assert data["unread_count"] == 1  # Only id=3 is unread


# ---------------------------------------------------------------------------
# POST /api/content/unread_counts
# ---------------------------------------------------------------------------


class TestUnreadCounts:
    def test_empty_output_dir(self, tmp_path):
        """If output dir doesn't exist, return empty dict."""
        with patch(
            "backend.api.content.get_output_dir", return_value=tmp_path / "nope"
        ):
            response = client.post("/api/content/unread_counts", json={})
        assert response.status_code == 200
        assert response.json() == {}

    def test_individual_member_unread(self, tmp_path):
        msgs = [{"id": i, "timestamp": f"2025-01-{i}T00:00:00Z"} for i in range(1, 5)]
        member_dir = tmp_path / "svc" / "58 M"
        _make_messages_json(member_dir, msgs)

        with patch("backend.api.content.get_output_dir", return_value=tmp_path):
            response = client.post(
                "/api/content/unread_counts",
                json={"svc/58 M": {"lastReadId": 2, "revealedIds": []}},
            )
        data = response.json()
        assert data["svc/58 M"] == 2  # ids 3, 4 unread

    def test_legacy_format_int_state(self, tmp_path):
        msgs = [{"id": i} for i in range(1, 4)]
        member_dir = tmp_path / "svc" / "58 M"
        _make_messages_json(member_dir, msgs)

        with patch("backend.api.content.get_output_dir", return_value=tmp_path):
            response = client.post(
                "/api/content/unread_counts",
                json={"svc/58 M": 1},
            )
        data = response.json()
        assert data["svc/58 M"] == 2  # ids 2, 3

    def test_revealed_ids_reduce_unread(self, tmp_path):
        msgs = [{"id": i} for i in range(1, 5)]
        member_dir = tmp_path / "svc" / "58 M"
        _make_messages_json(member_dir, msgs)

        with patch("backend.api.content.get_output_dir", return_value=tmp_path):
            response = client.post(
                "/api/content/unread_counts",
                json={"svc/58 M": {"lastReadId": 1, "revealedIds": [3]}},
            )
        data = response.json()
        # ids 2,3,4 > lastReadId, but 3 is revealed => 2 unread (ids 2, 4)
        assert data["svc/58 M"] == 2

    def test_group_chat_path_unread(self, tmp_path):
        group_dir = tmp_path / "group"
        _make_messages_json(group_dir / "58 A", [{"id": 1}, {"id": 5}])
        _make_messages_json(group_dir / "59 B", [{"id": 2}, {"id": 6}])

        with patch("backend.api.content.get_output_dir", return_value=tmp_path):
            response = client.post(
                "/api/content/unread_counts",
                json={"group": {"lastReadId": 3, "revealedIds": []}},
            )
        data = response.json()
        assert data["group"] == 2  # ids 5, 6

    def test_path_traversal_returns_zero(self, tmp_path):
        with patch("backend.api.content.get_output_dir", return_value=tmp_path):
            response = client.post(
                "/api/content/unread_counts",
                json={"../../etc/passwd": {"lastReadId": 0, "revealedIds": []}},
            )
        data = response.json()
        assert data["../../etc/passwd"] == 0


# ---------------------------------------------------------------------------
# GET /api/content/download/{file_path}
# ---------------------------------------------------------------------------


class TestDownloadEndpoint:
    def test_nonexistent_file_returns_404(self):
        response = client.get("/api/content/download/nonexistent/file.jpg")
        assert response.status_code == 404

    def test_path_traversal_blocked(self, tmp_path):
        """Path traversal via encoded segments should be blocked."""
        with patch("backend.api.content.get_output_dir", return_value=tmp_path):
            with patch(
                "backend.api.content._resolve_media_path",
                side_effect=HTTPException(status_code=403, detail="Access denied"),
            ):
                response = client.get("/api/content/download/../../../etc/passwd")
        assert response.status_code in (200, 403, 404)
        # The real protection is in _resolve_media_path; here we verify
        # that validate_path_within_dir blocks traversal attempts.
        with pytest.raises(HTTPException) as exc:
            validate_path_within_dir(tmp_path, "../../../etc/passwd")
        assert exc.value.status_code == 403

    def test_successful_download(self, tmp_path):
        """Download a real file with Content-Disposition: attachment."""
        file_path = tmp_path / "test.txt"
        file_path.write_text("hello world", encoding="utf-8")

        with patch("backend.api.content.get_output_dir", return_value=tmp_path):
            with patch(
                "backend.api.content._resolve_media_path", return_value=file_path
            ):
                response = client.get("/api/content/download/test.txt")

        assert response.status_code == 200
        assert response.content == b"hello world"
        # The response should be application/octet-stream
        assert "application/octet-stream" in response.headers.get("content-type", "")

    def test_download_with_custom_filename(self, tmp_path):
        file_path = tmp_path / "original.txt"
        file_path.write_text("data", encoding="utf-8")

        with patch("backend.api.content._resolve_media_path", return_value=file_path):
            response = client.get(
                "/api/content/download/original.txt?filename=custom.txt"
            )

        assert response.status_code == 200
        disp = response.headers.get("content-disposition", "")
        assert "custom.txt" in disp


# ---------------------------------------------------------------------------
# GET /api/content/media/{file_path}
# ---------------------------------------------------------------------------


class TestMediaEndpoint:
    def test_nonexistent_media_returns_404(self):
        response = client.get("/api/content/media/no/such/file.jpg")
        assert response.status_code == 404

    def test_serve_existing_media(self, tmp_path):
        media_file = tmp_path / "pic.jpg"
        media_file.write_bytes(b"\xff\xd8\xff\xe0")  # JPEG header

        with patch("backend.api.content._resolve_media_path", return_value=media_file):
            response = client.get("/api/content/media/svc/pic.jpg")
        assert response.status_code == 200


# ---------------------------------------------------------------------------
# GET /api/content/media_file (param-based)
# ---------------------------------------------------------------------------


class TestMediaFileParamEndpoint:
    def test_invalid_media_type_returns_400(self):
        response = client.get(
            "/api/content/media_file?service=hinatazaka46&talk_room_id=34&member_id=58&type=executable&file=a.exe"
        )
        assert response.status_code == 400
        assert "Invalid media type" in response.json()["detail"]

    def test_path_traversal_in_filename_returns_400(self):
        response = client.get(
            "/api/content/media_file?service=hinatazaka46&talk_room_id=34&member_id=58&type=picture&file=../../secret"
        )
        assert response.status_code == 400
        assert "Invalid filename" in response.json()["detail"]

    def test_null_byte_in_filename_returns_400(self):
        response = client.get(
            "/api/content/media_file?service=hinatazaka46&talk_room_id=34&member_id=58&type=picture&file=test%00.jpg"
        )
        assert response.status_code == 400

    def test_backslash_in_filename_returns_400(self):
        response = client.get(
            "/api/content/media_file?service=hinatazaka46&talk_room_id=34&member_id=58&type=picture&file=..\\secret"
        )
        assert response.status_code == 400

    def test_invalid_service_returns_400(self):
        response = client.get(
            "/api/content/media_file?service=badservice&talk_room_id=34&member_id=58&type=picture&file=img.jpg"
        )
        assert response.status_code == 400


# ---------------------------------------------------------------------------
# GET /api/content/talk_rooms (param-based)
# ---------------------------------------------------------------------------


class TestTalkRoomsEndpoint:
    def test_missing_service_returns_422(self):
        response = client.get("/api/content/talk_rooms")
        assert response.status_code == 422

    def test_invalid_service_returns_400(self):
        response = client.get("/api/content/talk_rooms?service=bad")
        assert response.status_code == 400

    def test_no_messages_dir_returns_empty(self, tmp_path):
        """Service dir exists but no messages subdir."""
        with patch("backend.api.content.resolve_service_path", return_value=tmp_path):
            with patch("backend.api.content.validate_service"):
                response = client.get("/api/content/talk_rooms?service=hinatazaka46")
        assert response.status_code == 200
        assert response.json()["talk_rooms"] == []

    def test_returns_talk_rooms(self, tmp_path):
        messages_dir = tmp_path / "messages"
        group_dir = messages_dir / "34 Member A"
        _make_messages_json(group_dir / "58 Member A", [{"id": 1}])

        with patch("backend.api.content.resolve_service_path", return_value=tmp_path):
            with patch("backend.api.content.validate_service"):
                response = client.get("/api/content/talk_rooms?service=hinatazaka46")

        assert response.status_code == 200
        rooms = response.json()["talk_rooms"]
        assert len(rooms) == 1
        assert rooms[0]["id"] == 34
        assert rooms[0]["name"] == "Member A"


# ---------------------------------------------------------------------------
# GET /api/content/members (param-based)
# ---------------------------------------------------------------------------


class TestMembersEndpoint:
    def test_missing_params_returns_422(self):
        response = client.get("/api/content/members")
        assert response.status_code == 422

    def test_invalid_service_returns_400(self):
        response = client.get("/api/content/members?service=bad&talk_room_id=34")
        assert response.status_code == 400

    def test_nonexistent_talk_room_returns_404(self):
        response = client.get(
            "/api/content/members?service=hinatazaka46&talk_room_id=99999"
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/content/messages (param-based)
# ---------------------------------------------------------------------------


class TestMessagesParamEndpoint:
    def test_missing_params_returns_422(self):
        response = client.get("/api/content/messages")
        assert response.status_code == 422

    def test_invalid_service_returns_400(self):
        response = client.get(
            "/api/content/messages?service=bad&talk_room_id=34&member_id=58"
        )
        assert response.status_code == 400

    def test_nonexistent_data_returns_404(self):
        response = client.get(
            "/api/content/messages?service=hinatazaka46&talk_room_id=99999&member_id=88888"
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/content/talk_room_messages (param-based)
# ---------------------------------------------------------------------------


class TestTalkRoomMessagesParamEndpoint:
    def test_missing_params_returns_422(self):
        response = client.get("/api/content/talk_room_messages")
        assert response.status_code == 422

    def test_invalid_service_returns_400(self):
        response = client.get(
            "/api/content/talk_room_messages?service=bad&talk_room_id=34"
        )
        assert response.status_code == 400

    def test_nonexistent_talk_room_returns_404(self):
        response = client.get(
            "/api/content/talk_room_messages?service=hinatazaka46&talk_room_id=99999"
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# validate_path_within_dir (additional edge cases)
# ---------------------------------------------------------------------------


class TestValidatePathWithinDirExtended:
    def test_symlink_outside_base_blocked(self, tmp_path):
        """Symlink pointing outside the base should be blocked."""
        import os

        target = Path("/tmp")
        link = tmp_path / "escape"
        try:
            os.symlink(target, link)
        except OSError:
            pytest.skip("Cannot create symlinks in this environment")

        with pytest.raises(HTTPException) as exc:
            validate_path_within_dir(tmp_path, "escape")
        assert exc.value.status_code == 403

    def test_base_dir_itself_is_allowed(self, tmp_path):
        """Passing '.' should resolve to base itself (edge case)."""
        result = validate_path_within_dir(tmp_path, ".")
        assert result == tmp_path.resolve()

    def test_deeply_nested_valid_path(self, tmp_path):
        deep = tmp_path / "a" / "b" / "c"
        deep.mkdir(parents=True)
        result = validate_path_within_dir(tmp_path, "a/b/c")
        assert result == deep.resolve()


# ---------------------------------------------------------------------------
# _resolve_media_path
# ---------------------------------------------------------------------------


class TestResolveMediaPath:
    def test_translates_service_id_to_display_name(self, tmp_path):
        """Service ID (romaji) should be mapped to display name for disk path."""
        media_file = tmp_path / "日向坂46" / "messages" / "pic.jpg"
        media_file.parent.mkdir(parents=True)
        media_file.write_bytes(b"img")

        with patch("backend.api.content.get_output_dir", return_value=tmp_path):
            result = _resolve_media_path("hinatazaka46/messages/pic.jpg")
        assert result == media_file.resolve()

    def test_raises_404_when_file_missing(self, tmp_path):
        with patch("backend.api.content.get_output_dir", return_value=tmp_path):
            with pytest.raises(HTTPException) as exc:
                _resolve_media_path("hinatazaka46/nonexistent.jpg")
        assert exc.value.status_code == 404

    def test_unknown_service_passes_through(self, tmp_path):
        """Unknown service prefix should not be translated and still raise 404 if missing."""
        with patch("backend.api.content.get_output_dir", return_value=tmp_path):
            with pytest.raises(HTTPException) as exc:
                _resolve_media_path("unknown_service/file.jpg")
        assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/content/groups — server_unread_count snapshot (phone -> Windows)
# ---------------------------------------------------------------------------


class TestGroupsServerUnreadCount:
    """Each group surfaces the server's unread_count snapshot from sync_metadata."""

    def _write_metadata(self, tmp_path: Path, server_groups: dict):
        meta = {"server_groups": server_groups, "last_sync": "2025-01-15T12:00:00Z"}
        with open(
            tmp_path / "日向坂46" / "sync_metadata.json", "w", encoding="utf-8"
        ) as f:
            json.dump(meta, f, ensure_ascii=False)

    def test_surfaces_server_unread_count(self, tmp_path):
        _build_tree(
            tmp_path,
            "日向坂46",
            {"34 金村 美玖": {"58 金村 美玖": [{"id": 1}, {"id": 2}]}},
        )
        self._write_metadata(
            tmp_path,
            {"34": {"state": "open", "is_active": True, "unread_count": 2}},
        )
        with patch("backend.api.content.get_output_dir", return_value=tmp_path):
            resp = client.get("/api/content/groups")
        g = next(g for g in resp.json()["groups"] if str(g["id"]) == "34")
        assert g["server_unread_count"] == 2

    def test_none_when_group_not_in_server_snapshot(self, tmp_path):
        # Group exists locally but was never seen by a sync → unknown, must not cap.
        _build_tree(
            tmp_path, "日向坂46", {"34 金村 美玖": {"58 金村 美玖": [{"id": 1}]}}
        )
        self._write_metadata(tmp_path, {})
        with patch("backend.api.content.get_output_dir", return_value=tmp_path):
            resp = client.get("/api/content/groups")
        g = next(g for g in resp.json()["groups"] if str(g["id"]) == "34")
        assert g["server_unread_count"] is None

    def test_none_when_field_absent_in_old_metadata(self, tmp_path):
        # Metadata predating this feature has no unread_count → unknown, not zero.
        _build_tree(
            tmp_path, "日向坂46", {"34 金村 美玖": {"58 金村 美玖": [{"id": 1}]}}
        )
        self._write_metadata(tmp_path, {"34": {"state": "open", "is_active": True}})
        with patch("backend.api.content.get_output_dir", return_value=tmp_path):
            resp = client.get("/api/content/groups")
        g = next(g for g in resp.json()["groups"] if str(g["id"]) == "34")
        assert g["server_unread_count"] is None


# ---------------------------------------------------------------------------
# GET /api/content/groups — group-vs-member classification (FC-M13)
# ---------------------------------------------------------------------------


class TestGroupsClassification:
    """
    is_group_chat is the single source of truth for the frontend.

    Ground truth (from real synced data, 2026-07-02): communal official
    channels post from ONE account, so their on-disk sender count is 1 and
    member_count > 1 CANNOT detect them. GROUP_CHAT_IDS is the load-bearing
    override for exactly these single-sender communal channels (hinatazaka46
    43, nogizaka46 45, sakurazaka46 33). These tests lock in that behavior so
    the list is not "simplified" away.
    """

    def test_single_sender_communal_in_list_is_group_chat(self, tmp_path):
        # id 43 is a real single-sender communal channel (日向坂46 official).
        _build_tree(
            tmp_path,
            "日向坂46",
            {"43 日向坂46": {"79 日向坂46": [{"id": 1}, {"id": 2}]}},
        )
        with patch("backend.api.content.get_output_dir", return_value=tmp_path):
            resp = client.get("/api/content/groups")
        g = next(g for g in resp.json()["groups"] if str(g["id"]) == "43")
        assert g["member_count"] == 1  # count alone would misclassify as a DM
        assert g["is_group_chat"] is True

    def test_single_sender_dm_not_in_list_is_member_chat(self, tmp_path):
        _build_tree(
            tmp_path,
            "日向坂46",
            {"34 金村 美玖": {"58 金村 美玖": [{"id": 1}]}},
        )
        with patch("backend.api.content.get_output_dir", return_value=tmp_path):
            resp = client.get("/api/content/groups")
        g = next(g for g in resp.json()["groups"] if str(g["id"]) == "34")
        assert g["member_count"] == 1
        assert g["is_group_chat"] is False

    def test_multi_sender_group_is_group_chat_by_count(self, tmp_path):
        # A group NOT in GROUP_CHAT_IDS but with >1 sender must still classify as
        # a group chat via the member_count > 1 heuristic. Uses id 9001 (absent
        # from every override list) so this isolates the count path — an id that
        # is also in the override list would pass even if the heuristic broke.
        _build_tree(
            tmp_path,
            "日向坂46",
            {
                "9001 四期生ライブ": {
                    "58 金村 美玖": [{"id": 1}],
                    "60 小坂 菜緒": [{"id": 2}],
                }
            },
        )
        with patch("backend.api.content.get_output_dir", return_value=tmp_path):
            resp = client.get("/api/content/groups")
        g = next(g for g in resp.json()["groups"] if str(g["id"]) == "9001")
        assert g["member_count"] == 2
        assert g["is_group_chat"] is True
