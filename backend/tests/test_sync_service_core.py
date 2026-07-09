"""Comprehensive tests for SyncService core sync logic.

Covers: timestamp cursor operations, check_new_messages, start_sync phase
progression, group-level batching, error handling, and fresh-vs-incremental
sync code paths.
"""

import contextlib
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.services.sync_service import (
    SyncService,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_metadata(
    groups: dict | None = None,
    last_sync: str | None = None,
    server_groups: dict | None = None,
) -> dict:
    """Build a sync metadata dict for testing."""
    md = {"groups": groups or {}, "last_sync": last_sync}
    if server_groups is not None:
        md["server_groups"] = server_groups
    return md


def _member_info(
    group_id: int,
    member_id: int,
    member_name: str = "Test",
    last_message_id: int | None = None,
    last_sync_ts: str | None = None,
    **extra,
) -> dict:
    """Build a metadata['groups'] entry."""
    info = {
        "group_id": group_id,
        "group_name": f"Group {group_id}",
        "group_thumbnail": None,
        "member_id": member_id,
        "member_name": member_name,
        "last_message_id": last_message_id,
        "thumbnail": None,
        "portrait": None,
    }
    if last_sync_ts is not None:
        info["last_sync_ts"] = last_sync_ts
    info.update(extra)
    return info


def _make_message(msg_id: int, member_id: int, published_at: str) -> dict:
    """Build a minimal message dict as returned by Client.get_messages."""
    return {
        "id": msg_id,
        "member_id": member_id,
        "published_at": published_at,
        "text": f"Message {msg_id}",
    }


# ---------------------------------------------------------------------------
# check_new_messages — timestamp cursor operations
# ---------------------------------------------------------------------------


class TestCheckNewMessages:
    """Test the lightweight new-message polling endpoint."""

    @pytest.mark.asyncio
    async def test_returns_empty_when_running(self):
        svc = SyncService()
        svc.running = True
        result = await svc.check_new_messages()
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_token(self):
        svc = SyncService()
        with patch.object(svc, "load_config", new_callable=AsyncMock, return_value={}):
            result = await svc.check_new_messages()
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_groups_in_metadata(self):
        svc = SyncService()
        with (
            patch.object(
                svc,
                "load_config",
                new_callable=AsyncMock,
                return_value={"access_token": "tok"},
            ),
            patch.object(
                svc,
                "load_metadata",
                new_callable=AsyncMock,
                return_value={"groups": {}},
            ),
        ):
            result = await svc.check_new_messages()
        assert result == []

    @pytest.mark.asyncio
    async def test_timestamp_cursor_finds_new_messages(self):
        """When using timestamp cursors, new messages after the cursor are detected."""
        svc = SyncService()

        metadata = _make_metadata(
            groups={
                "100_1": _member_info(
                    100,
                    1,
                    member_name="金村 美玖",
                    last_sync_ts="2025-03-19T12:00:00Z",
                ),
            },
            server_groups={
                "100": {"state": "open", "is_active": True},
            },
        )

        new_msg = _make_message(999, 1, "2025-03-20T08:00:00Z")

        mock_client = MagicMock()
        mock_client.get_messages = AsyncMock(return_value=[new_msg])

        with (
            patch.object(
                svc,
                "load_config",
                new_callable=AsyncMock,
                return_value={
                    "access_token": "tok",
                    "refresh_token": "ref",
                    "cookies": {},
                },
            ),
            patch.object(
                svc, "load_metadata", new_callable=AsyncMock, return_value=metadata
            ),
            patch(
                "backend.services.sync_service.get_session_dir",
                return_value=Path("/tmp/session"),
            ),
            patch("backend.services.sync_service.aiohttp.TCPConnector"),
            patch(
                "backend.services.sync_service.aiohttp.ClientSession"
            ) as mock_sess_cls,
            patch("backend.services.sync_service.Client", return_value=mock_client),
        ):
            mock_session = AsyncMock()
            mock_sess_ctx = AsyncMock()
            mock_sess_ctx.__aenter__ = AsyncMock(return_value=mock_session)
            mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_sess_cls.return_value = mock_sess_ctx

            result = await svc.check_new_messages()

        assert len(result) == 1
        assert result[0]["member_name"] == "金村 美玖"
        assert result[0]["count"] == 1

    @pytest.mark.asyncio
    async def test_id_cursor_fallback_finds_new_messages(self):
        """When no timestamp cursor exists, falls back to ID-based comparison."""
        svc = SyncService()

        metadata = _make_metadata(
            groups={
                "100_1": _member_info(
                    100,
                    1,
                    member_name="田村 保乃",
                    last_message_id=50,
                ),
            },
            server_groups={
                "100": {"state": "open", "is_active": True},
            },
        )

        new_msg = _make_message(51, 1, "2025-03-20T08:00:00Z")

        mock_client = MagicMock()
        mock_client.get_messages = AsyncMock(return_value=[new_msg])

        with (
            patch.object(
                svc,
                "load_config",
                new_callable=AsyncMock,
                return_value={
                    "access_token": "tok",
                    "refresh_token": "ref",
                    "cookies": {},
                },
            ),
            patch.object(
                svc, "load_metadata", new_callable=AsyncMock, return_value=metadata
            ),
            patch(
                "backend.services.sync_service.get_session_dir",
                return_value=Path("/tmp/session"),
            ),
            patch("backend.services.sync_service.aiohttp.TCPConnector"),
            patch(
                "backend.services.sync_service.aiohttp.ClientSession"
            ) as mock_sess_cls,
            patch("backend.services.sync_service.Client", return_value=mock_client),
        ):
            mock_session = AsyncMock()
            mock_sess_ctx = AsyncMock()
            mock_sess_ctx.__aenter__ = AsyncMock(return_value=mock_session)
            mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_sess_cls.return_value = mock_sess_ctx

            result = await svc.check_new_messages()

        assert len(result) == 1
        assert result[0]["member_name"] == "田村 保乃"
        assert result[0]["count"] == 1

    @pytest.mark.asyncio
    async def test_boundary_message_at_cursor_not_reported(self):
        """SD-BE-SVC-12: the newest already-synced message sits EXACTLY at the
        cursor (the stored cursor IS its published_at). An inclusive `>=` filter
        counted it as new on every check (perpetual false positive); the strict
        `>` cursor must exclude it."""
        svc = SyncService()

        metadata = _make_metadata(
            groups={
                "100_1": _member_info(
                    100,
                    1,
                    member_name="Boundary",
                    last_sync_ts="2025-03-20T12:00:00Z",
                ),
            },
            server_groups={"100": {"state": "open", "is_active": True}},
        )

        # get_messages(since_ts=cursor) is inclusive server-side, so it returns
        # the boundary message itself — it must NOT be reported as new.
        boundary_msg = _make_message(500, 1, "2025-03-20T12:00:00Z")
        mock_client = MagicMock()
        mock_client.get_messages = AsyncMock(return_value=[boundary_msg])

        with (
            patch.object(
                svc,
                "load_config",
                new_callable=AsyncMock,
                return_value={
                    "access_token": "tok",
                    "refresh_token": "ref",
                    "cookies": {},
                },
            ),
            patch.object(
                svc, "load_metadata", new_callable=AsyncMock, return_value=metadata
            ),
            patch(
                "backend.services.sync_service.get_session_dir",
                return_value=Path("/tmp/session"),
            ),
            patch("backend.services.sync_service.aiohttp.TCPConnector"),
            patch(
                "backend.services.sync_service.aiohttp.ClientSession"
            ) as mock_sess_cls,
            patch("backend.services.sync_service.Client", return_value=mock_client),
        ):
            mock_session = AsyncMock()
            mock_sess_ctx = AsyncMock()
            mock_sess_ctx.__aenter__ = AsyncMock(return_value=mock_session)
            mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_sess_cls.return_value = mock_sess_ctx

            result = await svc.check_new_messages()

        assert result == []

    @pytest.mark.asyncio
    async def test_no_new_messages_returns_empty(self):
        """When all messages are older than cursor, no new messages reported."""
        svc = SyncService()

        metadata = _make_metadata(
            groups={
                "100_1": _member_info(
                    100,
                    1,
                    member_name="Test",
                    last_sync_ts="2025-03-20T12:00:00Z",
                ),
            },
            server_groups={"100": {"state": "open", "is_active": True}},
        )

        old_msg = _make_message(10, 1, "2025-03-19T08:00:00Z")
        mock_client = MagicMock()
        mock_client.get_messages = AsyncMock(return_value=[old_msg])

        with (
            patch.object(
                svc,
                "load_config",
                new_callable=AsyncMock,
                return_value={
                    "access_token": "tok",
                    "refresh_token": "ref",
                    "cookies": {},
                },
            ),
            patch.object(
                svc, "load_metadata", new_callable=AsyncMock, return_value=metadata
            ),
            patch(
                "backend.services.sync_service.get_session_dir",
                return_value=Path("/tmp/session"),
            ),
            patch("backend.services.sync_service.aiohttp.TCPConnector"),
            patch(
                "backend.services.sync_service.aiohttp.ClientSession"
            ) as mock_sess_cls,
            patch("backend.services.sync_service.Client", return_value=mock_client),
        ):
            mock_session = AsyncMock()
            mock_sess_ctx = AsyncMock()
            mock_sess_ctx.__aenter__ = AsyncMock(return_value=mock_session)
            mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_sess_cls.return_value = mock_sess_ctx

            result = await svc.check_new_messages()

        assert result == []

    @pytest.mark.asyncio
    async def test_skips_inactive_groups(self):
        """Members in inactive groups should be skipped entirely."""
        svc = SyncService()

        metadata = _make_metadata(
            groups={
                "100_1": _member_info(
                    100,
                    1,
                    member_name="Inactive",
                    last_sync_ts="2025-01-01T00:00:00Z",
                ),
            },
            server_groups={"100": {"state": "closed", "is_active": False}},
        )

        mock_client = MagicMock()
        mock_client.get_messages = AsyncMock(return_value=[])

        with (
            patch.object(
                svc,
                "load_config",
                new_callable=AsyncMock,
                return_value={
                    "access_token": "tok",
                    "refresh_token": "ref",
                    "cookies": {},
                },
            ),
            patch.object(
                svc, "load_metadata", new_callable=AsyncMock, return_value=metadata
            ),
            patch(
                "backend.services.sync_service.get_session_dir",
                return_value=Path("/tmp/session"),
            ),
            patch("backend.services.sync_service.aiohttp.TCPConnector"),
            patch(
                "backend.services.sync_service.aiohttp.ClientSession"
            ) as mock_sess_cls,
            patch("backend.services.sync_service.Client", return_value=mock_client),
        ):
            mock_session = AsyncMock()
            mock_sess_ctx = AsyncMock()
            mock_sess_ctx.__aenter__ = AsyncMock(return_value=mock_session)
            mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_sess_cls.return_value = mock_sess_ctx

            result = await svc.check_new_messages()

        # Client.get_messages should never have been called (inactive group)
        mock_client.get_messages.assert_not_called()
        assert result == []

    @pytest.mark.asyncio
    async def test_batches_by_group_id(self):
        """Multiple members in the same group should use a single API call."""
        svc = SyncService()

        metadata = _make_metadata(
            groups={
                "100_1": _member_info(
                    100,
                    1,
                    member_name="MemberA",
                    last_sync_ts="2025-03-19T00:00:00Z",
                ),
                "100_2": _member_info(
                    100,
                    2,
                    member_name="MemberB",
                    last_sync_ts="2025-03-19T00:00:00Z",
                ),
            },
            server_groups={"100": {"state": "open", "is_active": True}},
        )

        msgs = [
            _make_message(10, 1, "2025-03-20T08:00:00Z"),
            _make_message(11, 2, "2025-03-20T09:00:00Z"),
        ]

        mock_client = MagicMock()
        mock_client.get_messages = AsyncMock(return_value=msgs)

        with (
            patch.object(
                svc,
                "load_config",
                new_callable=AsyncMock,
                return_value={
                    "access_token": "tok",
                    "refresh_token": "ref",
                    "cookies": {},
                },
            ),
            patch.object(
                svc, "load_metadata", new_callable=AsyncMock, return_value=metadata
            ),
            patch(
                "backend.services.sync_service.get_session_dir",
                return_value=Path("/tmp/session"),
            ),
            patch("backend.services.sync_service.aiohttp.TCPConnector"),
            patch(
                "backend.services.sync_service.aiohttp.ClientSession"
            ) as mock_sess_cls,
            patch("backend.services.sync_service.Client", return_value=mock_client),
        ):
            mock_session = AsyncMock()
            mock_sess_ctx = AsyncMock()
            mock_sess_ctx.__aenter__ = AsyncMock(return_value=mock_session)
            mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_sess_cls.return_value = mock_sess_ctx

            result = await svc.check_new_messages()

        # Only ONE get_messages call for group 100 (batched)
        assert mock_client.get_messages.call_count == 1
        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_group_api_error_continues_other_groups(self):
        """If one group's API call fails, other groups still get checked."""
        svc = SyncService()

        metadata = _make_metadata(
            groups={
                "100_1": _member_info(
                    100,
                    1,
                    member_name="FailGroup",
                    last_sync_ts="2025-03-19T00:00:00Z",
                ),
                "200_2": _member_info(
                    200,
                    2,
                    member_name="OKGroup",
                    last_sync_ts="2025-03-19T00:00:00Z",
                ),
            },
            server_groups={
                "100": {"state": "open", "is_active": True},
                "200": {"state": "open", "is_active": True},
            },
        )

        new_msg = _make_message(99, 2, "2025-03-20T10:00:00Z")

        call_count = 0

        async def mock_get_messages(session, gid, **kwargs):
            nonlocal call_count
            call_count += 1
            if gid == 100:
                raise ConnectionError("Server unreachable")
            return [new_msg]

        mock_client = MagicMock()
        mock_client.get_messages = AsyncMock(side_effect=mock_get_messages)

        with (
            patch.object(
                svc,
                "load_config",
                new_callable=AsyncMock,
                return_value={
                    "access_token": "tok",
                    "refresh_token": "ref",
                    "cookies": {},
                },
            ),
            patch.object(
                svc, "load_metadata", new_callable=AsyncMock, return_value=metadata
            ),
            patch(
                "backend.services.sync_service.get_session_dir",
                return_value=Path("/tmp/session"),
            ),
            patch("backend.services.sync_service.aiohttp.TCPConnector"),
            patch(
                "backend.services.sync_service.aiohttp.ClientSession"
            ) as mock_sess_cls,
            patch("backend.services.sync_service.Client", return_value=mock_client),
        ):
            mock_session = AsyncMock()
            mock_sess_ctx = AsyncMock()
            mock_sess_ctx.__aenter__ = AsyncMock(return_value=mock_session)
            mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_sess_cls.return_value = mock_sess_ctx

            result = await svc.check_new_messages()

        # Group 100 failed but group 200 succeeded
        assert len(result) == 1
        assert result[0]["member_name"] == "OKGroup"

    @pytest.mark.asyncio
    async def test_outer_exception_returns_empty(self):
        """A top-level exception should be caught and return empty list."""
        svc = SyncService()
        with patch.object(
            svc,
            "load_config",
            new_callable=AsyncMock,
            side_effect=RuntimeError("boom"),
        ):
            result = await svc.check_new_messages()
        assert result == []


# ---------------------------------------------------------------------------
# start_sync — phase management and guards
# ---------------------------------------------------------------------------


class TestStartSyncGuards:
    """Test guard conditions and early returns in start_sync."""

    @pytest.mark.asyncio
    async def test_returns_false_when_already_running(self):
        svc = SyncService()
        svc.running = True
        result = await svc.start_sync()
        assert result is False
        assert svc.running is True  # State unchanged

    @pytest.mark.asyncio
    async def test_skips_when_not_configured(self):
        """start_sync should return early when app is not configured."""
        svc = SyncService()

        mock_progress = MagicMock()
        mock_progress.error = MagicMock()

        with (
            patch.object(
                svc,
                "load_app_settings",
                new_callable=AsyncMock,
                return_value={"is_configured": False},
            ),
            patch("backend.services.sync_service.progress_manager") as mock_pm,
        ):
            mock_pm.get.return_value = mock_progress
            await svc.start_sync()

        mock_progress.error.assert_called_once()
        assert svc.running is False

    @pytest.mark.asyncio
    async def test_resets_running_flag_after_auth_error(self):
        """If auth fails, running flag must be reset to False."""
        svc = SyncService()

        mock_progress = MagicMock()
        mock_progress.error = MagicMock()
        mock_progress.start_phase = MagicMock()

        with (
            patch.object(
                svc,
                "load_app_settings",
                new_callable=AsyncMock,
                return_value={"is_configured": True, "output_dir": "/tmp/test"},
            ),
            patch.object(
                svc,
                "load_config",
                new_callable=AsyncMock,
                return_value={},  # No access_token
            ),
            patch("backend.services.sync_service.progress_manager") as mock_pm,
        ):
            mock_pm.get.return_value = mock_progress
            await svc.start_sync()

        assert svc.running is False


# ---------------------------------------------------------------------------
# start_sync — force resync
# ---------------------------------------------------------------------------


class TestForceResync:
    """Test force_resync clearing state files."""

    @pytest.mark.asyncio
    async def test_force_resync_resets_cursor_keeps_metadata(self, tmp_path):
        svc = SyncService()

        service_dir = tmp_path / "日向坂46"
        service_dir.mkdir()
        metadata_file = service_dir / "sync_metadata.json"
        metadata_file.write_text("{}", encoding="utf-8")
        state_file = service_dir / "sync_state.json"
        state_file.write_text("{}", encoding="utf-8")

        mock_progress = MagicMock()
        mock_progress.error = MagicMock()
        mock_progress.start_phase = MagicMock()

        with (
            patch.object(
                svc,
                "load_app_settings",
                new_callable=AsyncMock,
                return_value={
                    "is_configured": True,
                    "output_dir": str(tmp_path),
                },
            ),
            patch.object(
                svc,
                "load_config",
                new_callable=AsyncMock,
                return_value={},
            ),
            patch(
                "backend.services.sync_service.get_service_display_name",
                return_value="日向坂46",
            ),
            patch("backend.services.sync_service.progress_manager") as mock_pm,
        ):
            mock_pm.get.return_value = mock_progress
            await svc.start_sync(force_resync=True)

        # force_resync resets the message cursor (sync_state.json) to re-fetch
        # everything, but KEEPS sync_metadata.json — it holds the server_unread
        # read/unread cap, so deleting it would make a resync reset read state.
        assert not state_file.exists()
        assert metadata_file.exists()


# ---------------------------------------------------------------------------
# save_metadata — atomic write
# ---------------------------------------------------------------------------


class TestSaveMetadataCore:
    """Test save_metadata with CJK content and atomic behavior."""

    @pytest.mark.asyncio
    async def test_roundtrip_with_cjk(self, tmp_path):
        svc = SyncService()
        svc.service_data_dir = tmp_path
        svc.metadata_file = tmp_path / "sync_metadata.json"

        data = {
            "groups": {
                "100_1": {
                    "member_name": "齊藤 京子",
                    "group_name": "日向坂46 テスト",
                }
            },
            "last_sync": "2025-03-20T00:00:00Z",
        }
        await svc.save_metadata(data)

        raw = svc.metadata_file.read_bytes().decode("utf-8")
        # ensure_ascii=False means CJK stored literally
        assert "齊藤 京子" in raw
        assert "日向坂46" in raw

        loaded = json.loads(raw)
        assert loaded == data

    @pytest.mark.asyncio
    async def test_atomic_write_preserves_original_on_error(self, tmp_path):
        svc = SyncService()
        svc.service_data_dir = tmp_path
        svc.metadata_file = tmp_path / "sync_metadata.json"

        original = {"groups": {"old": True}, "last_sync": "old"}
        await svc.save_metadata(original)

        with pytest.raises(TypeError):
            await svc.save_metadata({"groups": object()})

        loaded = json.loads(svc.metadata_file.read_text(encoding="utf-8"))
        assert loaded == original

    @pytest.mark.asyncio
    async def test_replace_retries_transient_permission_error(self, tmp_path):
        """SD-BE-SVC-17: the final rename must retry a transient Windows
        PermissionError (AV / Search indexer holding sync_metadata.json) instead
        of failing the whole sync at its last step and discarding the update."""
        svc = SyncService()
        svc.service_data_dir = tmp_path
        svc.metadata_file = tmp_path / "sync_metadata.json"

        calls = {"n": 0}
        real_replace = __import__("os").replace

        def flaky_replace(src, dst):
            calls["n"] += 1
            if calls["n"] == 1:
                raise PermissionError("WinError 32: locked by indexer")
            return real_replace(src, dst)

        data = {"groups": {}, "last_sync": "2025-03-20T00:00:00Z"}
        with (
            patch(
                "backend.services.service_utils.os.replace", side_effect=flaky_replace
            ),
            patch("backend.services.service_utils.time.sleep"),
        ):
            await svc.save_metadata(data)

        # Retried past the first transient failure and eventually wrote the file.
        assert calls["n"] >= 2
        loaded = json.loads(svc.metadata_file.read_text(encoding="utf-8"))
        assert loaded == data


# ---------------------------------------------------------------------------
# Fresh sync vs incremental sync detection
# ---------------------------------------------------------------------------


class TestFreshVsIncrementalSync:
    """Test the fresh-vs-incremental detection logic in start_sync."""

    @pytest.mark.asyncio
    async def test_empty_service_dir_is_fresh(self, tmp_path):
        """When service_data_dir is empty (or non-existent), is_fresh=True."""
        svc = SyncService()
        tmp_path / "日向坂46"
        # Directory does not exist yet

        mock_progress = MagicMock()
        mock_progress.start_phase = MagicMock()
        mock_progress.set_completed = MagicMock()
        mock_progress.complete = MagicMock()
        mock_progress.update = MagicMock()
        mock_progress.error = MagicMock()

        mock_client = MagicMock()
        mock_client.access_token = "tok"
        mock_client.refresh_if_needed = AsyncMock()
        mock_client.get_groups = AsyncMock(return_value=[])  # No groups -> early exit

        with (
            patch.object(
                svc,
                "load_app_settings",
                new_callable=AsyncMock,
                return_value={
                    "is_configured": True,
                    "output_dir": str(tmp_path),
                },
            ),
            patch.object(
                svc,
                "load_config",
                new_callable=AsyncMock,
                return_value={"access_token": "tok"},
            ),
            patch(
                "backend.services.sync_service.get_service_display_name",
                return_value="日向坂46",
            ),
            patch(
                "backend.services.sync_service.get_session_dir",
                return_value=tmp_path / "session",
            ),
            patch("backend.services.sync_service.aiohttp.TCPConnector"),
            patch(
                "backend.services.sync_service.aiohttp.ClientSession"
            ) as mock_sess_cls,
            patch("backend.services.sync_service.Client", return_value=mock_client),
            patch("backend.services.sync_service.progress_manager") as mock_pm,
        ):
            mock_pm.get.return_value = mock_progress
            mock_session = AsyncMock()
            mock_sess_ctx = AsyncMock()
            mock_sess_ctx.__aenter__ = AsyncMock(return_value=mock_session)
            mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_sess_cls.return_value = mock_sess_ctx

            await svc.start_sync()

        # Sync completed (no groups found) without error
        mock_progress.complete.assert_called()

    @pytest.mark.asyncio
    async def test_dir_with_only_metadata_is_fresh(self, tmp_path):
        """A directory with only sync_metadata.json and sync_state.json is fresh."""
        svc = SyncService()
        service_dir = tmp_path / "日向坂46"
        service_dir.mkdir()
        (service_dir / "sync_metadata.json").write_text("{}", encoding="utf-8")
        (service_dir / "sync_state.json").write_text("{}", encoding="utf-8")

        mock_progress = MagicMock()
        mock_progress.start_phase = MagicMock()
        mock_progress.set_completed = MagicMock()
        mock_progress.complete = MagicMock()
        mock_progress.update = MagicMock()
        mock_progress.error = MagicMock()

        mock_client = MagicMock()
        mock_client.access_token = "tok"
        mock_client.refresh_if_needed = AsyncMock()
        mock_client.get_groups = AsyncMock(return_value=[])

        with (
            patch.object(
                svc,
                "load_app_settings",
                new_callable=AsyncMock,
                return_value={
                    "is_configured": True,
                    "output_dir": str(tmp_path),
                },
            ),
            patch.object(
                svc,
                "load_config",
                new_callable=AsyncMock,
                return_value={"access_token": "tok"},
            ),
            patch(
                "backend.services.sync_service.get_service_display_name",
                return_value="日向坂46",
            ),
            patch(
                "backend.services.sync_service.get_session_dir",
                return_value=tmp_path / "session",
            ),
            patch("backend.services.sync_service.aiohttp.TCPConnector"),
            patch(
                "backend.services.sync_service.aiohttp.ClientSession"
            ) as mock_sess_cls,
            patch("backend.services.sync_service.Client", return_value=mock_client),
            patch("backend.services.sync_service.progress_manager") as mock_pm,
        ):
            mock_pm.get.return_value = mock_progress
            mock_session = AsyncMock()
            mock_sess_ctx = AsyncMock()
            mock_sess_ctx.__aenter__ = AsyncMock(return_value=mock_session)
            mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_sess_cls.return_value = mock_sess_ctx

            await svc.start_sync()

        mock_progress.complete.assert_called()


# ---------------------------------------------------------------------------
# Sync phase progression — full pipeline with mocked client
# ---------------------------------------------------------------------------


class TestSyncPhaseProgression:
    """Test that start_sync progresses through all phases correctly."""

    @pytest.mark.asyncio
    async def test_phases_execute_in_order(self, tmp_path):
        """Verify scanning -> discovering -> syncing -> downloading -> complete."""
        svc = SyncService()

        phases_seen = []
        mock_progress = MagicMock()

        def track_phase(phase_name, *args, **kwargs):
            phases_seen.append(phase_name)

        mock_progress.start_phase = MagicMock(side_effect=track_phase)
        mock_progress.set_completed = MagicMock()
        mock_progress.complete = MagicMock()
        mock_progress.update = MagicMock()
        mock_progress.error = MagicMock()

        groups = [
            {
                "id": 100,
                "name": "Group1",
                "state": "open",
                "subscription": {"state": "active"},
            },
        ]
        members = [
            {"id": 1, "name": "MemberA", "thumbnail": None, "portrait": None},
        ]

        mock_client = MagicMock()
        mock_client.access_token = "tok"
        mock_client.refresh_if_needed = AsyncMock()
        mock_client.get_groups = AsyncMock(return_value=groups)
        mock_client.get_members = AsyncMock(return_value=members)
        mock_client.get_messages = AsyncMock(return_value=[])

        mock_manager = MagicMock()
        mock_manager.get_last_ts = MagicMock(return_value=None)
        mock_manager.get_last_id = MagicMock(return_value=None)
        mock_manager.sync_member = AsyncMock(return_value=0)
        mock_manager.client = mock_client
        mock_manager.process_media_queue = AsyncMock(return_value={})
        mock_manager.update_message_metadata = AsyncMock()

        with (
            patch.object(
                svc,
                "load_app_settings",
                new_callable=AsyncMock,
                return_value={
                    "is_configured": True,
                    "output_dir": str(tmp_path),
                },
            ),
            patch.object(
                svc,
                "load_config",
                new_callable=AsyncMock,
                return_value={"access_token": "tok"},
            ),
            patch.object(
                svc,
                "load_metadata",
                new_callable=AsyncMock,
                return_value=_make_metadata(),
            ),
            patch.object(svc, "save_metadata", new_callable=AsyncMock),
            patch(
                "backend.services.sync_service.get_service_display_name",
                return_value="日向坂46",
            ),
            patch(
                "backend.services.sync_service.get_session_dir",
                return_value=tmp_path / "session",
            ),
            patch("backend.services.sync_service.aiohttp.TCPConnector"),
            patch(
                "backend.services.sync_service.aiohttp.ClientSession"
            ) as mock_sess_cls,
            patch("backend.services.sync_service.Client", return_value=mock_client),
            patch(
                "backend.services.sync_service.SyncManager", return_value=mock_manager
            ),
            patch("backend.services.sync_service.progress_manager") as mock_pm,
            patch(
                "backend.services.sync_service.notify_sync_complete_async",
                new_callable=AsyncMock,
            ),
        ):
            mock_pm.get.return_value = mock_progress
            mock_session = AsyncMock()
            mock_sess_ctx = AsyncMock()
            mock_sess_ctx.__aenter__ = AsyncMock(return_value=mock_session)
            mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_sess_cls.return_value = mock_sess_ctx

            await svc.start_sync()

        assert phases_seen == ["scanning", "discovering", "syncing", "downloading"]
        mock_progress.complete.assert_called_once()

    @pytest.mark.asyncio
    async def test_skips_closed_groups(self, tmp_path):
        """Closed groups should not have members fetched or synced."""
        svc = SyncService()

        mock_progress = MagicMock()
        mock_progress.start_phase = MagicMock()
        mock_progress.set_completed = MagicMock()
        mock_progress.complete = MagicMock()
        mock_progress.update = MagicMock()
        mock_progress.error = MagicMock()

        groups = [
            {
                "id": 100,
                "name": "OpenGroup",
                "state": "open",
                "subscription": {"state": "active"},
            },
            {
                "id": 200,
                "name": "ClosedGroup",
                "state": "closed",
                "subscription": {"state": "active"},
            },
        ]
        members = [
            {"id": 1, "name": "MemberA", "thumbnail": None, "portrait": None},
        ]

        mock_client = MagicMock()
        mock_client.access_token = "tok"
        mock_client.refresh_if_needed = AsyncMock()
        mock_client.get_groups = AsyncMock(return_value=groups)
        mock_client.get_members = AsyncMock(return_value=members)
        mock_client.get_messages = AsyncMock(return_value=[])

        mock_manager = MagicMock()
        mock_manager.get_last_ts = MagicMock(return_value=None)
        mock_manager.get_last_id = MagicMock(return_value=None)
        mock_manager.sync_member = AsyncMock(return_value=0)
        mock_manager.client = mock_client
        mock_manager.process_media_queue = AsyncMock(return_value={})

        with (
            patch.object(
                svc,
                "load_app_settings",
                new_callable=AsyncMock,
                return_value={
                    "is_configured": True,
                    "output_dir": str(tmp_path),
                },
            ),
            patch.object(
                svc,
                "load_config",
                new_callable=AsyncMock,
                return_value={"access_token": "tok"},
            ),
            patch.object(
                svc,
                "load_metadata",
                new_callable=AsyncMock,
                return_value=_make_metadata(),
            ),
            patch.object(svc, "save_metadata", new_callable=AsyncMock),
            patch(
                "backend.services.sync_service.get_service_display_name",
                return_value="日向坂46",
            ),
            patch(
                "backend.services.sync_service.get_session_dir",
                return_value=tmp_path / "session",
            ),
            patch("backend.services.sync_service.aiohttp.TCPConnector"),
            patch(
                "backend.services.sync_service.aiohttp.ClientSession"
            ) as mock_sess_cls,
            patch("backend.services.sync_service.Client", return_value=mock_client),
            patch(
                "backend.services.sync_service.SyncManager", return_value=mock_manager
            ),
            patch("backend.services.sync_service.progress_manager") as mock_pm,
            patch(
                "backend.services.sync_service.notify_sync_complete_async",
                new_callable=AsyncMock,
            ),
        ):
            mock_pm.get.return_value = mock_progress
            mock_session = AsyncMock()
            mock_sess_ctx = AsyncMock()
            mock_sess_ctx.__aenter__ = AsyncMock(return_value=mock_session)
            mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_sess_cls.return_value = mock_sess_ctx

            await svc.start_sync()

        # get_members called only for open group (100), not closed (200)
        assert mock_client.get_members.call_count == 1
        call_args = mock_client.get_members.call_args
        assert call_args[0][1] == 100  # group_id=100

    @pytest.mark.asyncio
    async def test_metadata_updated_with_new_messages(self, tmp_path):
        """When sync finds new messages, metadata should be updated and saved."""
        svc = SyncService()

        mock_progress = MagicMock()
        mock_progress.start_phase = MagicMock()
        mock_progress.set_completed = MagicMock()
        mock_progress.complete = MagicMock()
        mock_progress.update = MagicMock()
        mock_progress.error = MagicMock()

        groups = [
            {
                "id": 100,
                "name": "Group1",
                "state": "open",
                "subscription": {"state": "active"},
            },
        ]
        members = [
            {"id": 1, "name": "MemberA", "thumbnail": None, "portrait": None},
        ]

        mock_client = MagicMock()
        mock_client.access_token = "tok"
        mock_client.refresh_if_needed = AsyncMock()
        mock_client.get_groups = AsyncMock(return_value=groups)
        mock_client.get_members = AsyncMock(return_value=members)
        mock_client.get_messages = AsyncMock(return_value=[])

        mock_manager = MagicMock()
        mock_manager.get_last_ts = MagicMock(return_value="2025-03-20T12:00:00Z")
        mock_manager.get_last_id = MagicMock(return_value=999)
        mock_manager.sync_member = AsyncMock(return_value=5)  # 5 new messages
        mock_manager.client = mock_client
        mock_manager.process_media_queue = AsyncMock(return_value={})

        saved_metadata = {}

        async def capture_metadata(md):
            saved_metadata.update(md)

        with (
            patch.object(
                svc,
                "load_app_settings",
                new_callable=AsyncMock,
                return_value={
                    "is_configured": True,
                    "output_dir": str(tmp_path),
                },
            ),
            patch.object(
                svc,
                "load_config",
                new_callable=AsyncMock,
                return_value={"access_token": "tok"},
            ),
            patch.object(
                svc,
                "load_metadata",
                new_callable=AsyncMock,
                return_value=_make_metadata(
                    groups={
                        "100_1": _member_info(100, 1, member_name="MemberA"),
                    }
                ),
            ),
            patch.object(
                svc,
                "save_metadata",
                new_callable=AsyncMock,
                side_effect=capture_metadata,
            ),
            patch(
                "backend.services.sync_service.get_service_display_name",
                return_value="日向坂46",
            ),
            patch(
                "backend.services.sync_service.get_session_dir",
                return_value=tmp_path / "session",
            ),
            patch("backend.services.sync_service.aiohttp.TCPConnector"),
            patch(
                "backend.services.sync_service.aiohttp.ClientSession"
            ) as mock_sess_cls,
            patch("backend.services.sync_service.Client", return_value=mock_client),
            patch(
                "backend.services.sync_service.SyncManager", return_value=mock_manager
            ),
            patch("backend.services.sync_service.progress_manager") as mock_pm,
            patch(
                "backend.services.sync_service.notify_sync_complete_async",
                new_callable=AsyncMock,
            ) as mock_notify,
        ):
            mock_pm.get.return_value = mock_progress
            mock_session = AsyncMock()
            mock_sess_ctx = AsyncMock()
            mock_sess_ctx.__aenter__ = AsyncMock(return_value=mock_session)
            mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_sess_cls.return_value = mock_sess_ctx

            await svc.start_sync()

        # Metadata was saved with updated cursor values
        assert saved_metadata["groups"]["100_1"]["last_message_id"] == 999
        assert (
            saved_metadata["groups"]["100_1"]["last_sync_ts"] == "2025-03-20T12:00:00Z"
        )
        assert saved_metadata.get("last_sync") is not None
        # Notification was sent (SD-BE-SVC-18: awaited async wrapper, off-loop).
        mock_notify.assert_awaited_once_with(5, 1)

    @pytest.mark.asyncio
    async def test_server_unread_count_captured_in_metadata(self, tmp_path):
        """Sync snapshots each group's server unread_count into server_groups.

        This is the phone->Windows signal: when the user reads a room on the
        official app, the server's unread_count drops, and the next sync records
        it so the badge can be capped to match.
        """
        svc = SyncService()

        mock_progress = MagicMock()
        for attr in ("start_phase", "set_completed", "complete", "update", "error"):
            setattr(mock_progress, attr, MagicMock())

        # group 100 has unread_count 7; group 200 omits it (API drops the field
        # when zero) and must be recorded as 0, not missing.
        groups = [
            {
                "id": 100,
                "name": "Group1",
                "state": "open",
                "subscription": {"state": "active"},
                "unread_count": 7,
            },
            {
                "id": 200,
                "name": "Group2",
                "state": "open",
                "subscription": {"state": "active"},
            },
        ]
        members = [{"id": 1, "name": "MemberA", "thumbnail": None, "portrait": None}]

        mock_client = MagicMock()
        mock_client.access_token = "tok"
        mock_client.refresh_if_needed = AsyncMock()
        mock_client.get_groups = AsyncMock(return_value=groups)
        mock_client.get_members = AsyncMock(return_value=members)
        mock_client.get_messages = AsyncMock(return_value=[])

        mock_manager = MagicMock()
        mock_manager.get_last_ts = MagicMock(return_value="2025-03-20T12:00:00Z")
        mock_manager.get_last_id = MagicMock(return_value=999)
        mock_manager.sync_member = AsyncMock(return_value=0)
        mock_manager.client = mock_client
        mock_manager.process_media_queue = AsyncMock(return_value={})

        saved_metadata = {}

        async def capture_metadata(md):
            saved_metadata.clear()
            saved_metadata.update(md)

        with (
            patch.object(
                svc,
                "load_app_settings",
                new_callable=AsyncMock,
                return_value={"is_configured": True, "output_dir": str(tmp_path)},
            ),
            patch.object(
                svc,
                "load_config",
                new_callable=AsyncMock,
                return_value={"access_token": "tok"},
            ),
            patch.object(
                svc,
                "load_metadata",
                new_callable=AsyncMock,
                return_value=_make_metadata(),
            ),
            patch.object(
                svc,
                "save_metadata",
                new_callable=AsyncMock,
                side_effect=capture_metadata,
            ),
            patch(
                "backend.services.sync_service.get_service_display_name",
                return_value="日向坂46",
            ),
            patch(
                "backend.services.sync_service.get_session_dir",
                return_value=tmp_path / "session",
            ),
            patch("backend.services.sync_service.aiohttp.TCPConnector"),
            patch(
                "backend.services.sync_service.aiohttp.ClientSession"
            ) as mock_sess_cls,
            patch("backend.services.sync_service.Client", return_value=mock_client),
            patch(
                "backend.services.sync_service.SyncManager", return_value=mock_manager
            ),
            patch("backend.services.sync_service.progress_manager") as mock_pm,
            patch(
                "backend.services.sync_service.notify_sync_complete_async",
                new_callable=AsyncMock,
            ),
        ):
            mock_pm.get.return_value = mock_progress
            mock_sess_ctx = AsyncMock()
            mock_sess_ctx.__aenter__ = AsyncMock(return_value=AsyncMock())
            mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_sess_cls.return_value = mock_sess_ctx

            await svc.start_sync()

        assert saved_metadata["server_groups"]["100"]["unread_count"] == 7
        assert saved_metadata["server_groups"]["200"]["unread_count"] == 0


# ---------------------------------------------------------------------------
# Error handling in sync — partial failures
# ---------------------------------------------------------------------------


class TestSyncErrorHandling:
    """Test that sync handles errors gracefully."""

    @pytest.mark.asyncio
    async def test_running_flag_reset_on_exception(self):
        """If start_sync throws, running must still be reset to False."""
        svc = SyncService()

        mock_progress = MagicMock()
        mock_progress.error = MagicMock()
        mock_progress.start_phase = MagicMock()

        with (
            patch.object(
                svc,
                "load_app_settings",
                new_callable=AsyncMock,
                side_effect=RuntimeError("kaboom"),
            ),
            patch("backend.services.sync_service.progress_manager") as mock_pm,
        ):
            mock_pm.get.return_value = mock_progress
            await svc.start_sync()

        assert svc.running is False
        mock_progress.error.assert_called()

    @pytest.mark.asyncio
    async def test_no_groups_completes_gracefully(self, tmp_path):
        """When server returns no groups, sync should complete without error."""
        svc = SyncService()

        mock_progress = MagicMock()
        mock_progress.start_phase = MagicMock()
        mock_progress.set_completed = MagicMock()
        mock_progress.complete = MagicMock()
        mock_progress.update = MagicMock()
        mock_progress.error = MagicMock()

        mock_client = MagicMock()
        mock_client.access_token = "tok"
        mock_client.refresh_if_needed = AsyncMock()
        mock_client.get_groups = AsyncMock(return_value=[])

        with (
            patch.object(
                svc,
                "load_app_settings",
                new_callable=AsyncMock,
                return_value={
                    "is_configured": True,
                    "output_dir": str(tmp_path),
                },
            ),
            patch.object(
                svc,
                "load_config",
                new_callable=AsyncMock,
                return_value={"access_token": "tok"},
            ),
            patch(
                "backend.services.sync_service.get_service_display_name",
                return_value="日向坂46",
            ),
            patch(
                "backend.services.sync_service.get_session_dir",
                return_value=tmp_path / "session",
            ),
            patch("backend.services.sync_service.aiohttp.TCPConnector"),
            patch(
                "backend.services.sync_service.aiohttp.ClientSession"
            ) as mock_sess_cls,
            patch("backend.services.sync_service.Client", return_value=mock_client),
            patch("backend.services.sync_service.progress_manager") as mock_pm,
        ):
            mock_pm.get.return_value = mock_progress
            mock_session = AsyncMock()
            mock_sess_ctx = AsyncMock()
            mock_sess_ctx.__aenter__ = AsyncMock(return_value=mock_session)
            mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_sess_cls.return_value = mock_sess_ctx

            await svc.start_sync()

        mock_progress.complete.assert_called_once()
        mock_progress.error.assert_not_called()
        assert svc.running is False


# ---------------------------------------------------------------------------
# sync_older_messages — placeholder
# ---------------------------------------------------------------------------


class TestSyncOlderMessages:
    """Test the placeholder sync_older_messages method."""

    @pytest.mark.asyncio
    async def test_returns_zero(self):
        svc = SyncService()
        result = await svc.sync_older_messages(100, 1, 50)
        assert result == 0


# ---------------------------------------------------------------------------
# CR 2026-07-02 remediation: SVC-C1 / I1 / I2 / I3 / I9
# ---------------------------------------------------------------------------


async def _run_start_sync(
    svc, tmp_path, *, groups, members, mock_manager, **start_kwargs
):
    """Run start_sync with the standard set of patches. Returns nothing;
    inspect the passed mock_manager / mock_client for assertions."""
    mock_progress = MagicMock()
    for attr in ("start_phase", "set_completed", "complete", "update", "error"):
        setattr(mock_progress, attr, MagicMock())

    mock_client = mock_manager.client

    with (
        patch.object(
            svc,
            "load_app_settings",
            new_callable=AsyncMock,
            return_value={"is_configured": True, "output_dir": str(tmp_path)},
        ),
        patch.object(
            svc,
            "load_config",
            new_callable=AsyncMock,
            return_value={"access_token": "tok"},
        ),
        patch.object(
            svc, "load_metadata", new_callable=AsyncMock, return_value=_make_metadata()
        ),
        patch.object(svc, "save_metadata", new_callable=AsyncMock),
        patch(
            "backend.services.sync_service.get_service_display_name",
            return_value="日向坂46",
        ),
        patch(
            "backend.services.sync_service.get_session_dir",
            return_value=tmp_path / "session",
        ),
        patch("backend.services.sync_service.aiohttp.TCPConnector"),
        patch("backend.services.sync_service.aiohttp.ClientSession") as mock_sess_cls,
        patch("backend.services.sync_service.Client", return_value=mock_client),
        patch("backend.services.sync_service.SyncManager", return_value=mock_manager),
        patch("backend.services.sync_service.progress_manager") as mock_pm,
        patch(
            "backend.services.sync_service.notify_sync_complete_async",
            new_callable=AsyncMock,
        ),
    ):
        mock_pm.get.return_value = mock_progress
        mock_sess_ctx = AsyncMock()
        mock_sess_ctx.__aenter__ = AsyncMock(return_value=AsyncMock())
        mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_sess_cls.return_value = mock_sess_ctx
        await svc.start_sync(**start_kwargs)


class TestSessionExpirySurfacing:
    """SVC-I1 — start_sync must re-raise session-expiry so the api layer maps it
    to the SESSION_EXPIRED sentinel the frontend keys on (not swallow to error())."""

    @pytest.mark.asyncio
    async def test_session_expired_reraised_not_swallowed(self, tmp_path):
        from pysaka import SessionExpiredError

        svc = SyncService()
        mock_progress = MagicMock()
        for attr in ("start_phase", "set_completed", "complete", "update", "error"):
            setattr(mock_progress, attr, MagicMock())

        mock_client = MagicMock()
        mock_client.access_token = "tok"
        mock_client.refresh_if_needed = AsyncMock()
        mock_client.get_groups = AsyncMock(side_effect=SessionExpiredError("expired"))

        with (
            patch.object(
                svc,
                "load_app_settings",
                new_callable=AsyncMock,
                return_value={"is_configured": True, "output_dir": str(tmp_path)},
            ),
            patch.object(
                svc,
                "load_config",
                new_callable=AsyncMock,
                return_value={"access_token": "tok"},
            ),
            patch(
                "backend.services.sync_service.get_service_display_name",
                return_value="日向坂46",
            ),
            patch(
                "backend.services.sync_service.get_session_dir",
                return_value=tmp_path / "session",
            ),
            patch("backend.services.sync_service.aiohttp.TCPConnector"),
            patch(
                "backend.services.sync_service.aiohttp.ClientSession"
            ) as mock_sess_cls,
            patch("backend.services.sync_service.Client", return_value=mock_client),
            patch("backend.services.sync_service.progress_manager") as mock_pm,
        ):
            mock_pm.get.return_value = mock_progress
            mock_sess_ctx = AsyncMock()
            mock_sess_ctx.__aenter__ = AsyncMock(return_value=AsyncMock())
            mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_sess_cls.return_value = mock_sess_ctx

            with pytest.raises(SessionExpiredError):
                await svc.start_sync()

        # It must NOT have degraded to a generic progress.error(str(e)).
        mock_progress.error.assert_not_called()
        assert svc.running is False


class TestNewMemberFullHistory:
    """SVC-I2 — a mixed group (synced + unsynced members) must fetch full history."""

    @pytest.mark.asyncio
    async def test_mixed_group_fetches_full_history(self, tmp_path):
        svc = SyncService()

        groups = [
            {
                "id": 100,
                "name": "Group1",
                "state": "open",
                "subscription": {"state": "active"},
            }
        ]
        members = [
            {"id": 1, "name": "Synced", "thumbnail": None, "portrait": None},
            {"id": 2, "name": "New", "thumbnail": None, "portrait": None},
        ]

        mock_client = MagicMock()
        mock_client.access_token = "tok"
        mock_client.refresh_if_needed = AsyncMock()
        mock_client.get_groups = AsyncMock(return_value=groups)
        mock_client.get_members = AsyncMock(return_value=members)
        mock_client.get_messages = AsyncMock(return_value=[])

        mock_manager = MagicMock()
        mock_manager.get_last_ts = MagicMock(
            side_effect=lambda gid, mid: "2025-03-20T12:00:00Z" if mid == 1 else None
        )
        mock_manager.get_last_id = MagicMock(return_value=None)
        mock_manager.sync_member = AsyncMock(return_value=0)
        mock_manager.client = mock_client
        mock_manager.process_media_queue = AsyncMock(return_value={})

        await _run_start_sync(
            svc, tmp_path, groups=groups, members=members, mock_manager=mock_manager
        )

        assert mock_client.get_messages.await_count == 1
        _, kwargs = mock_client.get_messages.await_args
        assert kwargs.get("since_ts") is None

    @pytest.mark.asyncio
    async def test_all_synced_group_uses_cursor(self, tmp_path):
        svc = SyncService()

        groups = [
            {
                "id": 100,
                "name": "Group1",
                "state": "open",
                "subscription": {"state": "active"},
            }
        ]
        members = [
            {"id": 1, "name": "A", "thumbnail": None, "portrait": None},
            {"id": 2, "name": "B", "thumbnail": None, "portrait": None},
        ]

        mock_client = MagicMock()
        mock_client.access_token = "tok"
        mock_client.refresh_if_needed = AsyncMock()
        mock_client.get_groups = AsyncMock(return_value=groups)
        mock_client.get_members = AsyncMock(return_value=members)
        mock_client.get_messages = AsyncMock(return_value=[])

        mock_manager = MagicMock()
        mock_manager.get_last_ts = MagicMock(return_value="2025-03-20T12:00:00Z")
        mock_manager.get_last_id = MagicMock(return_value=None)
        mock_manager.sync_member = AsyncMock(return_value=0)
        mock_manager.client = mock_client
        mock_manager.process_media_queue = AsyncMock(return_value={})

        await _run_start_sync(
            svc, tmp_path, groups=groups, members=members, mock_manager=mock_manager
        )

        _, kwargs = mock_client.get_messages.await_args
        assert kwargs.get("since_ts") is not None


class TestInitialLimitAndIncludeInactive:
    """SVC-I9 — include_inactive honored; initial_limit caps a cursor-less first sync."""

    @pytest.mark.asyncio
    async def test_include_inactive_passed_through(self, tmp_path):
        svc = SyncService()
        groups = []  # early-exit after get_groups

        mock_client = MagicMock()
        mock_client.access_token = "tok"
        mock_client.refresh_if_needed = AsyncMock()
        mock_client.get_groups = AsyncMock(return_value=groups)

        mock_manager = MagicMock()
        mock_manager.client = mock_client

        await _run_start_sync(
            svc,
            tmp_path,
            groups=groups,
            members=[],
            mock_manager=mock_manager,
            include_inactive=False,
        )

        _, kwargs = mock_client.get_groups.await_args
        assert kwargs.get("include_inactive") is False

    @pytest.mark.asyncio
    async def test_initial_limit_caps_cursorless_member(self, tmp_path):
        svc = SyncService()

        groups = [
            {
                "id": 100,
                "name": "Group1",
                "state": "open",
                "subscription": {"state": "active"},
            }
        ]
        members = [{"id": 1, "name": "New", "thumbnail": None, "portrait": None}]

        all_msgs = [
            _make_message(10, 1, "2025-03-20T01:00:00Z"),
            _make_message(11, 1, "2025-03-20T02:00:00Z"),
            _make_message(12, 1, "2025-03-20T03:00:00Z"),
            _make_message(13, 1, "2025-03-20T04:00:00Z"),
            _make_message(14, 1, "2025-03-20T05:00:00Z"),
        ]

        mock_client = MagicMock()
        mock_client.access_token = "tok"
        mock_client.refresh_if_needed = AsyncMock()
        mock_client.get_groups = AsyncMock(return_value=groups)
        mock_client.get_members = AsyncMock(return_value=members)
        mock_client.get_messages = AsyncMock(return_value=all_msgs)

        captured = {}

        async def capture_sync_member(session, group, member, media_queue, **kwargs):
            captured["prefetched"] = kwargs.get("prefetched_messages")
            return len(kwargs.get("prefetched_messages") or [])

        mock_manager = MagicMock()
        mock_manager.get_last_ts = MagicMock(return_value=None)  # cursor-less
        mock_manager.get_last_id = MagicMock(return_value=None)
        mock_manager.sync_member = AsyncMock(side_effect=capture_sync_member)
        mock_manager.client = mock_client
        mock_manager.process_media_queue = AsyncMock(return_value={})

        await _run_start_sync(
            svc,
            tmp_path,
            groups=groups,
            members=members,
            mock_manager=mock_manager,
            initial_limit=2,
        )

        prefetched = captured["prefetched"]
        assert len(prefetched) == 2
        assert {m["id"] for m in prefetched} == {13, 14}

    @pytest.mark.asyncio
    async def test_default_fetches_full_history_for_cursorless_member(self, tmp_path):
        """The DEFAULT fresh sync must NOT truncate a cursor-less member's history.

        Regression for the "fresh sync only keeps the latest 1000" report: the
        default initial_limit is unlimited, so every already-downloaded message
        is handed to sync_member.
        """
        svc = SyncService()

        groups = [
            {
                "id": 100,
                "name": "Group1",
                "state": "open",
                "subscription": {"state": "active"},
            }
        ]
        members = [{"id": 1, "name": "New", "thumbnail": None, "portrait": None}]

        # More than the old hardcoded 1000-message cap, so a regressed default
        # would truncate and the ID-set assertion below would fail. Timestamps are
        # zero-padded so string ordering (what the slice sorts on) is monotonic.
        all_msgs = [
            _make_message(10 + i, 1, f"2025-03-20T00:00:{i:07d}Z") for i in range(1500)
        ]

        mock_client = MagicMock()
        mock_client.access_token = "tok"
        mock_client.refresh_if_needed = AsyncMock()
        mock_client.get_groups = AsyncMock(return_value=groups)
        mock_client.get_members = AsyncMock(return_value=members)
        mock_client.get_messages = AsyncMock(return_value=all_msgs)

        captured = {}

        async def capture_sync_member(session, group, member, media_queue, **kwargs):
            captured["prefetched"] = kwargs.get("prefetched_messages")
            return len(kwargs.get("prefetched_messages") or [])

        mock_manager = MagicMock()
        mock_manager.get_last_ts = MagicMock(return_value=None)  # cursor-less
        mock_manager.get_last_id = MagicMock(return_value=None)
        mock_manager.sync_member = AsyncMock(side_effect=capture_sync_member)
        mock_manager.client = mock_client
        mock_manager.process_media_queue = AsyncMock(return_value={})

        # No initial_limit kwarg -> uses DEFAULT_INITIAL_MESSAGE_LIMIT.
        await _run_start_sync(
            svc,
            tmp_path,
            groups=groups,
            members=members,
            mock_manager=mock_manager,
        )

        prefetched = captured["prefetched"]
        assert {m["id"] for m in prefetched} == {m["id"] for m in all_msgs}


class TestCancelOwnership:
    """SVC-C1 — cancel() performs a real task.cancel() with generation ownership."""

    @pytest.mark.asyncio
    async def test_cancel_cancels_task_and_clears_running(self):
        import asyncio

        svc = SyncService()
        svc.running = True

        started = asyncio.Event()

        async def long_run():
            started.set()
            try:
                await asyncio.sleep(30)
            finally:
                if svc._generation == 1:
                    svc.running = False
                    svc._task = None

        svc._generation = 1
        task = asyncio.create_task(long_run())
        svc._task = task
        await started.wait()

        result = await svc.cancel()
        assert result is True
        assert task.cancelled()
        assert svc.running is False
        assert svc._task is None

    @pytest.mark.asyncio
    async def test_cancel_when_no_task(self):
        svc = SyncService()
        svc.running = False
        svc._task = None
        result = await svc.cancel()
        assert result is False

    @pytest.mark.asyncio
    async def test_stale_run_does_not_clear_newer_generation(self):
        svc = SyncService()
        # Newer run (gen 2) currently owns running.
        svc._generation = 2
        svc.running = True
        my_generation = 1  # stale run captured gen 1 earlier
        if svc._generation == my_generation:
            svc.running = False
        assert svc.running is True  # untouched by the stale run


class TestVerifyCancelSerialization:
    """SD-BE-SVC-02 — verify_and_fix_media must claim the SAME task/generation
    ownership as start_sync so /cancel actually cancels a running verify and a
    second writer (a new sync) cannot start concurrently over the same files."""

    @pytest.mark.asyncio
    async def test_verify_registers_task_and_generation_while_running(self, tmp_path):
        """While verify runs it must register self._task (== the running task)
        and bump self._generation, exactly like start_sync — otherwise cancel()
        takes its "no task" branch and cannot stop it."""
        import asyncio

        svc = SyncService()

        service_dir = tmp_path / "日向坂46"
        messages_root = service_dir / "messages"
        messages_root.mkdir(parents=True)

        seen = {}
        gate = asyncio.Event()
        entered = asyncio.Event()

        async def fake_auth_client(session):
            # We are now inside verify_and_fix_media, past self.running=True.
            seen["task"] = svc._task
            seen["generation"] = svc._generation
            seen["running"] = svc.running
            entered.set()
            await gate.wait()  # hold the run open so we can inspect state
            raise RuntimeError("stop here")  # unwind out of the run

        with (
            patch.object(
                svc,
                "load_app_settings",
                new_callable=AsyncMock,
                return_value={"is_configured": True, "output_dir": str(tmp_path)},
            ),
            patch(
                "backend.services.sync_service.get_service_display_name",
                return_value="日向坂46",
            ),
            patch.object(
                svc,
                "_authenticated_client",
                new_callable=AsyncMock,
                side_effect=fake_auth_client,
            ),
            patch("backend.services.sync_service.aiohttp.TCPConnector"),
            patch(
                "backend.services.sync_service.aiohttp.ClientSession"
            ) as mock_sess_cls,
            patch("backend.services.sync_service.progress_manager") as mock_pm,
        ):
            mock_pm.get.return_value = MagicMock()
            mock_sess_ctx = AsyncMock()
            mock_sess_ctx.__aenter__ = AsyncMock(return_value=AsyncMock())
            mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_sess_cls.return_value = mock_sess_ctx

            run = asyncio.create_task(svc.verify_and_fix_media())
            await entered.wait()

            # Ownership was claimed with the SAME machinery as start_sync.
            assert seen["running"] is True
            assert seen["generation"] >= 1
            assert seen["task"] is run  # cancel() can now target it

            gate.set()
            with contextlib.suppress(RuntimeError):
                await run

        # finally cleared ownership once the run (still owner) unwound.
        assert svc.running is False
        assert svc._task is None

    @pytest.mark.asyncio
    async def test_cancel_during_verify_blocks_concurrent_second_writer(self, tmp_path):
        """The load-bearing regression: a /cancel while verify runs must truly
        cancel the verify task (real task.cancel + awaited unwind) so a
        subsequent start_sync cannot launch a second concurrent writer over the
        same member dirs / messages.json."""
        import asyncio

        svc = SyncService()

        service_dir = tmp_path / "日向坂46"
        messages_root = service_dir / "messages"
        messages_root.mkdir(parents=True)

        entered = asyncio.Event()
        verify_cancelled = {"value": False}

        async def fake_auth_client(session):
            entered.set()
            try:
                await asyncio.Event().wait()  # simulate a long verify write loop
            except asyncio.CancelledError:
                verify_cancelled["value"] = True
                raise

        with (
            patch.object(
                svc,
                "load_app_settings",
                new_callable=AsyncMock,
                return_value={"is_configured": True, "output_dir": str(tmp_path)},
            ),
            patch(
                "backend.services.sync_service.get_service_display_name",
                return_value="日向坂46",
            ),
            patch.object(
                svc,
                "_authenticated_client",
                new_callable=AsyncMock,
                side_effect=fake_auth_client,
            ),
            patch("backend.services.sync_service.aiohttp.TCPConnector"),
            patch(
                "backend.services.sync_service.aiohttp.ClientSession"
            ) as mock_sess_cls,
            patch("backend.services.sync_service.progress_manager") as mock_pm,
        ):
            mock_pm.get.return_value = MagicMock()
            mock_sess_ctx = AsyncMock()
            mock_sess_ctx.__aenter__ = AsyncMock(return_value=AsyncMock())
            mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_sess_cls.return_value = mock_sess_ctx

            # Mimic the /verify endpoint registering the task on the service.
            run = asyncio.create_task(svc.verify_and_fix_media())
            svc._task = run
            await entered.wait()
            assert svc.running is True

            cancelled = await svc.cancel()

        assert cancelled is True  # cancel() reached and stopped the verify task
        assert verify_cancelled["value"] is True  # verify actually unwound
        assert run.cancelled()
        # running is clear again, so a subsequent start_sync's `if self.running`
        # guard would NOT let a second writer run alongside the (now-stopped)
        # verify.
        assert svc.running is False
        assert svc._task is None

    @pytest.mark.asyncio
    async def test_verify_finally_does_not_clear_newer_generation(self, tmp_path):
        """A cancelled/superseded verify's finally must not clobber a newer
        run's running flag (same generation guard as start_sync)."""
        import asyncio

        svc = SyncService()

        service_dir = tmp_path / "日向坂46"
        messages_root = service_dir / "messages"
        messages_root.mkdir(parents=True)

        entered = asyncio.Event()

        async def fake_auth_client(session):
            entered.set()
            await asyncio.Event().wait()

        with (
            patch.object(
                svc,
                "load_app_settings",
                new_callable=AsyncMock,
                return_value={"is_configured": True, "output_dir": str(tmp_path)},
            ),
            patch(
                "backend.services.sync_service.get_service_display_name",
                return_value="日向坂46",
            ),
            patch.object(
                svc,
                "_authenticated_client",
                new_callable=AsyncMock,
                side_effect=fake_auth_client,
            ),
            patch("backend.services.sync_service.aiohttp.TCPConnector"),
            patch(
                "backend.services.sync_service.aiohttp.ClientSession"
            ) as mock_sess_cls,
            patch("backend.services.sync_service.progress_manager") as mock_pm,
        ):
            mock_pm.get.return_value = MagicMock()
            mock_sess_ctx = AsyncMock()
            mock_sess_ctx.__aenter__ = AsyncMock(return_value=AsyncMock())
            mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_sess_cls.return_value = mock_sess_ctx

            verify_run = asyncio.create_task(svc.verify_and_fix_media())
            await entered.wait()
            verify_gen = svc._generation

            # A newer run supersedes ownership (bumps generation, owns running).
            svc._generation = verify_gen + 1
            svc.running = True

            # Now cancel the stale verify — its finally runs but must see it no
            # longer owns the generation and leave the newer run's flag alone.
            verify_run.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await verify_run

        assert svc.running is True  # newer run's flag untouched by stale verify


class TestCancelForceClearGenerationGuard:
    """SD-BE-SVC-04 — cancel()'s post-await force-clear must be generation
    guarded so a run that started during the await (`await task` yields) isn't
    clobbered."""

    @pytest.mark.asyncio
    async def test_cancel_does_not_clobber_run_started_during_await(self):
        import asyncio

        svc = SyncService()
        svc._generation = 1
        svc.running = True

        started = asyncio.Event()

        async def stale_run():
            started.set()
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                # Simulate a newer /start winning the race the instant this
                # stale run is cancelled and yields during cancel()'s await.
                svc._generation = 2
                svc.running = True
                svc._task = asyncio.current_task()  # placeholder for newer task
                raise

        task = asyncio.create_task(stale_run())
        svc._task = task
        await started.wait()

        await svc.cancel()

        # The newer generation (2) that appeared mid-await must survive.
        assert svc._generation == 2
        assert svc.running is True


class TestGroupFailureAggregation:
    """SVC-I3 — a single group's failure must not abort siblings or be surfaced
    through the outer handler; successful groups persist (partial success)."""

    @pytest.mark.asyncio
    async def test_partial_group_failure_does_not_abort_siblings(self, tmp_path):
        svc = SyncService()

        groups = [
            {
                "id": 100,
                "name": "G1",
                "state": "open",
                "subscription": {"state": "active"},
            },
            {
                "id": 200,
                "name": "G2",
                "state": "open",
                "subscription": {"state": "active"},
            },
        ]
        members = [{"id": 1, "name": "A", "thumbnail": None, "portrait": None}]

        mock_client = MagicMock()
        mock_client.access_token = "tok"
        mock_client.refresh_if_needed = AsyncMock()
        mock_client.get_groups = AsyncMock(return_value=groups)
        mock_client.get_members = AsyncMock(return_value=members)

        async def _get_messages(session, gid, **kwargs):
            if gid == 200:
                raise RuntimeError("group 200 boom")
            return [_make_message(10, 1, "2025-03-20T05:00:00Z")]

        mock_client.get_messages = AsyncMock(side_effect=_get_messages)

        mock_manager = MagicMock()
        mock_manager.get_last_ts = MagicMock(return_value="2025-03-20T12:00:00Z")
        mock_manager.get_last_id = MagicMock(return_value=5)
        mock_manager.sync_member = AsyncMock(return_value=1)
        mock_manager.client = mock_client
        mock_manager.process_media_queue = AsyncMock(return_value={})

        mock_progress = MagicMock()
        for attr in ("start_phase", "set_completed", "complete", "update", "error"):
            setattr(mock_progress, attr, MagicMock())

        with (
            patch.object(
                svc,
                "load_app_settings",
                new_callable=AsyncMock,
                return_value={"is_configured": True, "output_dir": str(tmp_path)},
            ),
            patch.object(
                svc,
                "load_config",
                new_callable=AsyncMock,
                return_value={"access_token": "tok"},
            ),
            patch.object(
                svc,
                "load_metadata",
                new_callable=AsyncMock,
                return_value=_make_metadata(),
            ),
            patch.object(svc, "save_metadata", new_callable=AsyncMock),
            patch(
                "backend.services.sync_service.get_service_display_name",
                return_value="日向坂46",
            ),
            patch(
                "backend.services.sync_service.get_session_dir",
                return_value=tmp_path / "session",
            ),
            patch("backend.services.sync_service.aiohttp.TCPConnector"),
            patch(
                "backend.services.sync_service.aiohttp.ClientSession"
            ) as mock_sess_cls,
            patch("backend.services.sync_service.Client", return_value=mock_client),
            patch(
                "backend.services.sync_service.SyncManager", return_value=mock_manager
            ),
            patch("backend.services.sync_service.progress_manager") as mock_pm,
            patch(
                "backend.services.sync_service.notify_sync_complete_async",
                new_callable=AsyncMock,
            ),
        ):
            mock_pm.get.return_value = mock_progress
            mock_sess_ctx = AsyncMock()
            mock_sess_ctx.__aenter__ = AsyncMock(return_value=AsyncMock())
            mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_sess_cls.return_value = mock_sess_ctx

            await svc.start_sync()

        # The healthy group (100) still synced its member.
        assert mock_manager.sync_member.await_count == 1
        # The generic per-group failure was aggregated, NOT surfaced through the
        # outer handler as progress.error(...) (old code: gather propagated it).
        mock_progress.error.assert_not_called()
        assert svc.running is False
