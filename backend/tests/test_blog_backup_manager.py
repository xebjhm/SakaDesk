"""Tests for BlogBackupManager thread isolation."""

import asyncio
import threading

from unittest.mock import patch, AsyncMock

from backend.services.blog_service import BlogBackupManager


class TestBlogBackupManagerThreading:
    """Verify BlogBackupManager runs backup on a separate thread."""

    def test_start_creates_background_thread(self):
        """start() should spawn a daemon thread named 'blog-backup'."""
        manager = BlogBackupManager()
        entered = threading.Event()

        async def mock_run_backup(service, cancel_event):
            entered.set()
            # Keep running so thread stays alive for assertions
            while not cancel_event.is_set():
                await asyncio.sleep(0.01)

        with patch.object(manager, "_run_backup", side_effect=mock_run_backup):
            manager.start(["hinatazaka46"])
            assert entered.wait(timeout=5), "_run_backup was never called"

            assert manager._thread is not None
            assert manager._thread.is_alive()
            assert manager._thread.name == "blog-backup"
            assert manager._thread.daemon is True

        manager.shutdown()

    def test_backup_runs_on_separate_thread(self):
        """The backup coroutine should execute on the blog-backup thread, not the caller's."""
        manager = BlogBackupManager()
        captured_thread = []
        done = threading.Event()

        async def fake_run_backup(service, cancel_event):
            captured_thread.append(threading.current_thread().name)
            done.set()

        with patch.object(manager, "_run_backup", side_effect=fake_run_backup):
            manager.start(["hinatazaka46"])
            assert done.wait(timeout=5), "_run_backup never completed"

        assert captured_thread == ["blog-backup"]
        assert threading.current_thread().name != "blog-backup"
        manager.shutdown()

    def test_start_is_synchronous(self):
        """start() should be a regular method, not async."""
        manager = BlogBackupManager()
        with patch.object(manager, "_run_backup", new_callable=AsyncMock):
            result = manager.start(["hinatazaka46"])
            assert not asyncio.iscoroutine(result)
        manager.shutdown()

    def test_stop_signals_cancel_event(self):
        """stop() should set the threading.Event for the service."""
        manager = BlogBackupManager()
        entered = threading.Event()
        stopped = threading.Event()

        async def slow_backup(service, cancel_event):
            entered.set()
            while not cancel_event.is_set():
                await asyncio.sleep(0.01)
            stopped.set()

        with patch.object(manager, "_run_backup", side_effect=slow_backup):
            manager.start(["hinatazaka46"])
            assert entered.wait(timeout=5), "_run_backup was never entered"
            assert manager.is_running("hinatazaka46")

            manager.stop(["hinatazaka46"])
            assert stopped.wait(timeout=5), "_run_backup never observed cancellation"
            assert not manager.is_running("hinatazaka46")

        manager.shutdown()

    def test_is_running_thread_safe(self):
        """is_running() should be safe to call from any thread."""
        manager = BlogBackupManager()
        entered = threading.Event()

        async def slow_backup(service, cancel_event):
            entered.set()
            while not cancel_event.is_set():
                await asyncio.sleep(0.01)

        with patch.object(manager, "_run_backup", side_effect=slow_backup):
            manager.start(["hinatazaka46"])
            assert entered.wait(timeout=5), "_run_backup was never entered"

            results = []

            def check():
                results.append(manager.is_running("hinatazaka46"))

            threads = [threading.Thread(target=check) for _ in range(10)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            assert all(results)

        manager.stop()
        manager.shutdown()

    def test_skip_already_running(self):
        """start() should skip services already running."""
        manager = BlogBackupManager()
        call_count = 0
        entered = threading.Event()

        async def fake_run_backup(service, cancel_event):
            nonlocal call_count
            call_count += 1
            entered.set()
            while not cancel_event.is_set():
                await asyncio.sleep(0.01)

        with patch.object(manager, "_run_backup", side_effect=fake_run_backup):
            manager.start(["hinatazaka46"])
            assert entered.wait(timeout=5), "_run_backup was never entered"
            manager.start(["hinatazaka46"])
            # Second start returns immediately (skipped), so call_count stays 1
            assert call_count == 1

        manager.stop()
        manager.shutdown()

    def test_shutdown_stops_thread(self):
        """shutdown() should stop the event loop and join the thread."""
        manager = BlogBackupManager()
        entered = threading.Event()

        async def mock_run_backup(service, cancel_event):
            entered.set()
            while not cancel_event.is_set():
                await asyncio.sleep(0.01)

        with patch.object(manager, "_run_backup", side_effect=mock_run_backup):
            manager.start(["hinatazaka46"])
            assert entered.wait(timeout=5), "_run_backup was never entered"
            assert manager._thread.is_alive()

        manager.shutdown()
        assert manager._thread is None or not manager._thread.is_alive()

    def test_running_services(self):
        """running_services() should return snapshot of running service IDs."""
        manager = BlogBackupManager()
        all_entered = threading.Event()
        entered_count = 0
        count_lock = threading.Lock()

        async def slow_backup(service, cancel_event):
            nonlocal entered_count
            with count_lock:
                entered_count += 1
                if entered_count == 2:
                    all_entered.set()
            while not cancel_event.is_set():
                await asyncio.sleep(0.01)

        with patch.object(manager, "_run_backup", side_effect=slow_backup):
            manager.start(["hinatazaka46", "sakurazaka46"])
            assert all_entered.wait(timeout=5), "Not all backups entered"

            services = manager.running_services()
            assert sorted(services) == ["hinatazaka46", "sakurazaka46"]

        manager.stop()
        manager.shutdown()
