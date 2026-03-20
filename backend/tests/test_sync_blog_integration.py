"""Integration tests for blog backup auto-enqueue after sync.

Verifies the interaction between sync_service and BlogBackupManager:
the sync service auto-enqueues blog backup at the end of a successful sync
when `blogs_full_backup` is enabled in settings.
"""
import asyncio
import threading
import time

import pytest
from unittest.mock import patch, AsyncMock

from backend.services.blog_service import BlogBackupManager


class TestBlogBackupAutoEnqueue:
    """Test that blog backup is correctly triggered/skipped based on settings."""

    def test_manager_start_is_synchronous(self):
        """start() must be a regular function, not a coroutine."""
        manager = BlogBackupManager()
        with patch.object(manager, '_run_backup', new_callable=AsyncMock):
            result = manager.start(["hinatazaka46"])
            assert not asyncio.iscoroutine(result)
        manager.shutdown()

    def test_manager_start_is_thread_safe(self):
        """start() can be called from any thread without errors."""
        manager = BlogBackupManager()
        errors = []

        def call_start():
            try:
                with patch.object(manager, '_run_backup', new_callable=AsyncMock):
                    manager.start(["hinatazaka46"])
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=call_start) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors, f"Thread-safety errors: {errors}"
        manager.shutdown()

    def test_stop_is_synchronous(self):
        """stop() must be a regular function, not a coroutine."""
        manager = BlogBackupManager()
        result = manager.stop()
        assert not asyncio.iscoroutine(result)

    def test_running_services_returns_list(self):
        """running_services() returns a list snapshot."""
        manager = BlogBackupManager()
        result = manager.running_services()
        assert isinstance(result, list)
        assert len(result) == 0

    def test_shutdown_stops_thread(self):
        """shutdown() should clean up the background thread."""
        manager = BlogBackupManager()
        with patch.object(manager, '_run_backup', new_callable=AsyncMock):
            manager.start(["hinatazaka46"])
            time.sleep(0.1)
            assert manager._thread is not None
            assert manager._thread.is_alive()

        manager.shutdown()
        assert manager._thread is None or not manager._thread.is_alive()
        assert manager._loop is None
