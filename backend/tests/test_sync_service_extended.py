"""Extended tests for sync_service.py — metadata, init, and utility functions."""

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from backend.services.sync_service import (
    DEFAULT_INITIAL_MESSAGE_LIMIT,
    SyncService,
)


# ── Constants ────────────────────────────────────────────────────────


def test_default_initial_message_limit():
    assert isinstance(DEFAULT_INITIAL_MESSAGE_LIMIT, int)
    assert DEFAULT_INITIAL_MESSAGE_LIMIT > 0


# ── SyncService.__init__ ────────────────────────────────────────────


class TestSyncServiceInit:
    """Tests for SyncService initialization and properties."""

    def test_default_service(self):
        svc = SyncService()
        assert svc._service == "hinatazaka46"

    def test_custom_service(self):
        svc = SyncService(service="sakurazaka46")
        assert svc._service == "sakurazaka46"

    def test_nogizaka(self):
        svc = SyncService(service="nogizaka46")
        assert svc._service == "nogizaka46"

    def test_invalid_service_raises(self):
        with pytest.raises(ValueError):
            SyncService(service="invalid_service")

    def test_initial_running_state(self):
        svc = SyncService()
        assert svc.running is False

    def test_initial_metadata_file_is_none(self):
        svc = SyncService()
        assert svc.metadata_file is None

    def test_initial_manager_is_none(self):
        svc = SyncService()
        assert svc.manager is None

    def test_output_dir_is_path(self):
        svc = SyncService()
        assert isinstance(svc.output_dir, Path)


# ── SyncService._get_group ──────────────────────────────────────────


class TestGetGroup:
    """Tests for the _get_group method (Group enum lookup)."""

    def test_hinatazaka_group(self):
        from pysaka import Group

        svc = SyncService(service="hinatazaka46")
        assert svc._get_group() == Group.HINATAZAKA46

    def test_sakurazaka_group(self):
        from pysaka import Group

        svc = SyncService(service="sakurazaka46")
        assert svc._get_group() == Group.SAKURAZAKA46

    def test_nogizaka_group(self):
        from pysaka import Group

        svc = SyncService(service="nogizaka46")
        assert svc._get_group() == Group.NOGIZAKA46


# ── SyncService.load_metadata ───────────────────────────────────────


class TestLoadMetadata:
    """Tests for loading sync metadata from JSON files."""

    @pytest.mark.asyncio
    async def test_missing_file_returns_default(self):
        svc = SyncService()
        with patch.object(svc, "get_output_dir", new_callable=AsyncMock) as mock_dir:
            mock_dir.return_value = Path("/nonexistent/dir")
            with patch(
                "backend.services.sync_service.get_service_display_name",
                return_value="日向坂46",
            ):
                result = await svc.load_metadata()
        assert result == {"groups": {}, "last_sync": None}

    @pytest.mark.asyncio
    async def test_valid_metadata_file(self, tmp_path):
        svc = SyncService()
        service_dir = tmp_path / "日向坂46"
        service_dir.mkdir()
        metadata_file = service_dir / "sync_metadata.json"
        data = {
            "groups": {"1": {"name": "test"}},
            "last_sync": "2025-01-01T00:00:00Z",
        }
        metadata_file.write_text(json.dumps(data), encoding="utf-8")

        with patch.object(svc, "get_output_dir", new_callable=AsyncMock) as mock_dir:
            mock_dir.return_value = tmp_path
            with patch(
                "backend.services.sync_service.get_service_display_name",
                return_value="日向坂46",
            ):
                result = await svc.load_metadata()
        assert result["last_sync"] == "2025-01-01T00:00:00Z"
        assert "1" in result["groups"]

    @pytest.mark.asyncio
    async def test_corrupt_metadata_returns_default(self, tmp_path):
        svc = SyncService()
        service_dir = tmp_path / "日向坂46"
        service_dir.mkdir()
        metadata_file = service_dir / "sync_metadata.json"
        metadata_file.write_text("not valid json {{{", encoding="utf-8")

        with patch.object(svc, "get_output_dir", new_callable=AsyncMock) as mock_dir:
            mock_dir.return_value = tmp_path
            with patch(
                "backend.services.sync_service.get_service_display_name",
                return_value="日向坂46",
            ):
                result = await svc.load_metadata()
        assert result == {"groups": {}, "last_sync": None}


# ── SyncService.save_metadata ───────────────────────────────────────


class TestSaveMetadata:
    """Tests for saving sync metadata atomically."""

    @pytest.mark.asyncio
    async def test_save_raises_when_no_metadata_file(self):
        svc = SyncService()
        # metadata_file is None before start_sync
        with pytest.raises(
            RuntimeError, match="save_metadata called before start_sync"
        ):
            await svc.save_metadata({"test": True})

    @pytest.mark.asyncio
    async def test_save_writes_valid_json(self, tmp_path):
        svc = SyncService()
        svc.service_data_dir = tmp_path
        svc.metadata_file = tmp_path / "sync_metadata.json"
        data = {
            "groups": {"1": {"name": "group1"}},
            "last_sync": "2025-06-01T00:00:00Z",
        }
        await svc.save_metadata(data)
        assert svc.metadata_file.exists()
        loaded = json.loads(svc.metadata_file.read_text(encoding="utf-8"))
        assert loaded == data

    @pytest.mark.asyncio
    async def test_save_creates_parent_dirs(self, tmp_path):
        svc = SyncService()
        svc.service_data_dir = tmp_path / "deep" / "nested"
        svc.metadata_file = svc.service_data_dir / "sync_metadata.json"
        await svc.save_metadata({"test": True})
        assert svc.metadata_file.exists()

    @pytest.mark.asyncio
    async def test_save_unicode_content(self, tmp_path):
        svc = SyncService()
        svc.service_data_dir = tmp_path
        svc.metadata_file = tmp_path / "sync_metadata.json"
        data = {"groups": {"1": {"name": "日向坂46 テスト"}}}
        await svc.save_metadata(data)
        loaded = json.loads(svc.metadata_file.read_text(encoding="utf-8"))
        assert loaded["groups"]["1"]["name"] == "日向坂46 テスト"


# ── SyncService.get_output_dir ──────────────────────────────────────


class TestGetOutputDir:
    """Tests for output directory resolution."""

    @pytest.mark.asyncio
    async def test_returns_default_when_no_setting(self):
        svc = SyncService()
        with patch.object(
            svc,
            "load_app_settings",
            new_callable=AsyncMock,
            return_value={"is_configured": False},
        ):
            result = await svc.get_output_dir()
        assert isinstance(result, Path)

    @pytest.mark.asyncio
    async def test_returns_configured_path(self, tmp_path):
        svc = SyncService()
        with patch.object(
            svc,
            "load_app_settings",
            new_callable=AsyncMock,
            return_value={"output_dir": str(tmp_path)},
        ):
            result = await svc.get_output_dir()
        assert result == tmp_path


# ── SyncService.start_sync guard ────────────────────────────────────


class TestStartSyncGuard:
    """Tests for the running-state guard in start_sync."""

    @pytest.mark.asyncio
    async def test_returns_false_when_already_running(self):
        svc = SyncService()
        svc.running = True
        result = await svc.start_sync()
        assert result is False
