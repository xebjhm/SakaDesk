"""L6 — diagnostics must answer at once; disk usage is computed in the background.

On a real 34 GB archive ``GET /api/diagnostics`` used to walk every file of the
output folder before responding (~160 s), so the panel's request timed out.
These tests pin the background design:

- the summary returns without walking the tree (``disk_usage.state`` is
  ``pending`` while the walk runs off the request path);
- the walk is single-flight (concurrent requests share one computation) and
  its result is cached for the app run, with an explicit refresh;
- a failed walk reports ``failed`` and logs the failure without paths.
"""

import json
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.api import diagnostics
from backend.main import app

client = TestClient(app)


@pytest.fixture
def tracker(monkeypatch):
    """A fresh tracker per test so cached results never leak between cases."""
    fresh = diagnostics._DiskUsageTracker()
    monkeypatch.setattr(diagnostics, "_disk_usage_tracker", fresh)
    yield fresh
    fresh.wait_idle(5)


@pytest.fixture
def settings(tmp_path):
    """Patch settings/logs/keyring so the endpoint sees ``tmp_path/output``."""
    output_dir = tmp_path / "output"
    (output_dir / "日向坂46" / "messages").mkdir(parents=True)
    (output_dir / "日向坂46" / "messages" / "a.bin").write_bytes(b"x" * 4096)
    settings_path = tmp_path / "settings.json"
    settings_path.write_text(
        json.dumps({"is_configured": True, "output_dir": str(output_dir)}),
        encoding="utf-8",
    )
    with (
        patch("backend.api.diagnostics.get_settings_path", return_value=settings_path),
        patch("backend.api.diagnostics.get_logs_dir", return_value=tmp_path / "logs"),
        patch(
            "backend.api.diagnostics.get_token_manager",
            return_value=MagicMock(load_session=MagicMock(return_value=None)),
        ),
    ):
        yield output_dir


def _blocking_walker(release: threading.Event, calls: list):
    real = diagnostics._walk_disk_usage

    def walker(path: Path):
        calls.append(path)
        assert release.wait(5), "test never released the walk"
        return real(path)

    return walker


def test_summary_returns_pending_without_waiting_for_the_walk(tracker, settings):
    release = threading.Event()
    calls: list = []
    with patch.object(
        diagnostics, "_walk_disk_usage", _blocking_walker(release, calls)
    ):
        resp = client.get("/api/diagnostics")
        assert resp.status_code == 200
        body = resp.json()
        # The rest of the summary is there at once...
        assert body["sync_state"]["services"][0]["display_name"] == "日向坂46"
        # ...while disk usage is still being computed.
        assert body["disk_usage"]["state"] == "pending"
        assert body["disk_usage"]["file_count"] == 0
        assert body["sync_state"]["disk_usage_detailed"] is None
        release.set()
        assert tracker.wait_idle(5)
    assert len(calls) == 1


def test_background_result_is_served_once_ready(tracker, settings):
    client.get("/api/diagnostics")
    assert tracker.wait_idle(5)

    body = client.get("/api/diagnostics").json()
    usage = body["disk_usage"]
    assert usage["state"] == "ready"
    assert usage["file_count"] == 1
    assert usage["detailed"]["total_bytes"] == 4096
    assert usage["detailed"]["services"][0]["name"] == "日向坂46"
    assert usage["detailed"]["services"][0]["categories"] == [
        {"name": "messages", "bytes": 4096}
    ]
    assert isinstance(usage["duration_ms"], int)
    assert usage["computed_at"].endswith("Z")
    # Backward-compatible mirrors in sync_state.
    assert body["sync_state"]["file_count"] == 1
    assert body["sync_state"]["disk_usage_detailed"]["total_bytes"] == 4096


def test_disk_usage_endpoint_polls_the_same_cache(tracker, settings):
    first = client.get("/api/diagnostics/disk-usage").json()
    assert first["state"] in ("pending", "ready")
    assert tracker.wait_idle(5)
    ready = client.get("/api/diagnostics/disk-usage").json()
    assert ready["state"] == "ready"
    assert ready["file_count"] == 1


def test_concurrent_requests_share_one_walk(tracker, settings):
    release = threading.Event()
    calls: list = []
    with patch.object(
        diagnostics, "_walk_disk_usage", _blocking_walker(release, calls)
    ):
        for _ in range(3):
            assert tracker.snapshot(str(settings)).state == "pending"
        # A refresh while a walk is running joins it rather than starting another.
        assert tracker.snapshot(str(settings), refresh=True).state == "pending"
        release.set()
        assert tracker.wait_idle(5)
        assert tracker.snapshot(str(settings)).state == "ready"
    assert len(calls) == 1


def test_result_is_cached_for_the_run_until_refreshed(tracker, settings):
    tracker.snapshot(str(settings))
    assert tracker.wait_idle(5)
    (settings / "日向坂46" / "messages" / "b.bin").write_bytes(b"y" * 10)

    cached = tracker.snapshot(str(settings))
    assert cached.state == "ready"
    assert cached.file_count == 1  # served from cache, tree not re-walked

    refreshing = tracker.snapshot(str(settings), refresh=True)
    assert refreshing.state == "pending"
    assert tracker.wait_idle(5)
    assert tracker.snapshot(str(settings)).file_count == 2


def test_refresh_query_param_recomputes(tracker, settings):
    client.get("/api/diagnostics")
    assert tracker.wait_idle(5)
    (settings / "日向坂46" / "messages" / "b.bin").write_bytes(b"y" * 10)
    resp = client.get("/api/diagnostics", params={"refresh_disk_usage": "true"})
    assert resp.json()["disk_usage"]["state"] == "pending"
    assert tracker.wait_idle(5)
    assert client.get("/api/diagnostics").json()["disk_usage"]["file_count"] == 2


def test_changed_output_dir_is_walked_afresh(tracker, tmp_path):
    a = tmp_path / "a"
    b = tmp_path / "b"
    a.mkdir()
    b.mkdir()
    (b / "f.bin").write_bytes(b"z")
    tracker.snapshot(str(a))
    assert tracker.wait_idle(5)
    assert tracker.snapshot(str(a)).file_count == 0
    assert tracker.snapshot(str(b)).state == "pending"
    assert tracker.wait_idle(5)
    assert tracker.snapshot(str(b)).file_count == 1


def test_failed_walk_reports_failed_and_logs_without_paths(tracker, settings):
    def boom(path: Path):
        raise PermissionError(f"denied: {path}")

    with capture_logs() as logs, patch.object(diagnostics, "_walk_disk_usage", boom):
        tracker.snapshot(str(settings))
        assert tracker.wait_idle(5)
        failed = tracker.snapshot(str(settings))

    assert failed.state == "failed"
    assert failed.file_count == 0
    events = {e["event"]: e for e in logs}
    assert "diagnostics_disk_usage_started" in events
    entry = events["diagnostics_disk_usage_failed"]
    assert entry["log_level"] == "warning"
    assert entry["error_type"] == "PermissionError"
    assert isinstance(entry["duration_ms"], int)
    assert str(settings) not in json.dumps(logs, default=str)


def test_failed_walk_is_retried_on_refresh(tracker, settings):
    with patch.object(
        diagnostics, "_walk_disk_usage", MagicMock(side_effect=OSError("x"))
    ):
        tracker.snapshot(str(settings))
        assert tracker.wait_idle(5)
    # A failure is cached like a result (no re-walk on every poll)...
    assert tracker.snapshot(str(settings)).state == "failed"
    # ...and the panel's Refresh retries it.
    tracker.snapshot(str(settings), refresh=True)
    assert tracker.wait_idle(5)
    assert tracker.snapshot(str(settings)).state == "ready"


def test_start_and_finish_are_logged_with_counts_but_no_paths(tracker, settings):
    with capture_logs() as logs:
        tracker.snapshot(str(settings))
        assert tracker.wait_idle(5)
    events = {e["event"]: e for e in logs}
    assert events["diagnostics_disk_usage_started"]["reason"] == "first"
    finished = events["diagnostics_disk_usage_finished"]
    assert finished["file_count"] == 1
    assert isinstance(finished["duration_ms"], int)
    assert finished["skipped"] == 0
    assert str(settings) not in json.dumps(logs, default=str)
    assert "日向坂46" not in json.dumps(logs, default=str, ensure_ascii=False)


def test_no_output_dir_needs_no_walk(tracker):
    with patch.object(diagnostics, "_walk_disk_usage") as walker:
        usage = tracker.snapshot(None)
    assert usage.state == "ready"
    assert usage.file_count == 0
    walker.assert_not_called()


def test_disk_usage_endpoint_with_unreadable_settings_logs_and_walks_nothing(
    tracker, tmp_path
):
    bad = tmp_path / "settings.json"
    bad.write_text("{not json", encoding="utf-8")
    with (
        capture_logs() as logs,
        patch("backend.api.diagnostics.get_settings_path", return_value=bad),
        patch.object(diagnostics, "_walk_disk_usage") as walker,
    ):
        body = client.get("/api/diagnostics/disk-usage").json()
    assert body["state"] == "ready"
    assert body["file_count"] == 0
    walker.assert_not_called()
    [entry] = [e for e in logs if e["event"] == "diagnostics_settings_read_failed"]
    assert entry["error_type"] == "JSONDecodeError"


class TestWalkDiskUsage:
    """The single-pass walk that feeds both the total and the breakdown."""

    def test_missing_dir(self, tmp_path):
        result = diagnostics._walk_disk_usage(tmp_path / "missing")
        assert result.file_count == 0
        assert result.total_bytes == 0
        assert result.detailed == {"total_bytes": 0, "services": []}

    def test_counts_every_file_and_breaks_down_by_service_and_category(self, tmp_path):
        (tmp_path / "top.json").write_bytes(b"t" * 10)
        cat = tmp_path / "櫻坂46" / "blogs" / "nested"
        cat.mkdir(parents=True)
        (cat / "photo.jpg").write_bytes(b"p" * 100)
        (tmp_path / "櫻坂46" / "sync_metadata.json").write_bytes(b"m" * 5)
        (tmp_path / "櫻坂46" / "messages").mkdir()
        (tmp_path / "櫻坂46" / "messages" / "😀.txt").write_bytes(b"e" * 7)

        result = diagnostics._walk_disk_usage(tmp_path)

        assert result.file_count == 4
        assert result.total_bytes == 122
        [svc] = result.detailed["services"]
        assert svc["name"] == "櫻坂46"
        assert svc["categories"] == [
            {"name": "blogs", "bytes": 100},
            {"name": "messages", "bytes": 7},
        ]
        assert svc["total_bytes"] == 107
        assert result.detailed["total_bytes"] == 107

    @staticmethod
    def _flaky_scandir(monkeypatch, *, unlistable=(), bad_stat=(), bad_kind=()):
        """Patch ``os.scandir`` so named folders/entries raise like a live archive."""
        real_scandir = diagnostics.os.scandir

        class _Entry:
            def __init__(self, entry):
                self._entry = entry
                self.name = entry.name
                self.path = entry.path

            def is_dir(self, follow_symlinks=True):
                if self.name in bad_kind:
                    raise PermissionError("no access")
                return self._entry.is_dir(follow_symlinks=follow_symlinks)

            def is_file(self, follow_symlinks=True):
                return self._entry.is_file(follow_symlinks=follow_symlinks)

            def stat(self, follow_symlinks=True):
                if self.name in bad_stat:
                    raise FileNotFoundError("vanished mid-walk")
                return self._entry.stat(follow_symlinks=follow_symlinks)

        class _Iter:
            def __init__(self, path):
                if Path(path).name in unlistable:
                    raise PermissionError("no access")
                self._it = real_scandir(path)

            def __enter__(self):
                return (_Entry(e) for e in self._it)

            def __exit__(self, *exc):
                self._it.close()

        monkeypatch.setattr(diagnostics.os, "scandir", _Iter)

    def test_unreadable_entries_are_skipped_not_fatal(self, tmp_path, monkeypatch):
        cat = tmp_path / "svc" / "cat"
        cat.mkdir(parents=True)
        (cat / "ok.bin").write_bytes(b"o" * 3)
        (cat / "gone.bin").write_bytes(b"g" * 3)  # stat fails
        (cat / "locked").mkdir()  # cannot be listed
        (cat / "locked" / "x.bin").write_bytes(b"x")
        (tmp_path / "svc" / "weird").mkdir()  # type check fails
        (tmp_path / "loose-gone.json").write_bytes(b"l")  # loose file, stat fails
        (tmp_path / "locked-svc").mkdir()  # service folder cannot be listed
        self._flaky_scandir(
            monkeypatch,
            unlistable={"locked", "locked-svc"},
            bad_stat={"gone.bin", "loose-gone.json"},
            bad_kind={"weird"},
        )

        result = diagnostics._walk_disk_usage(tmp_path)

        assert result.file_count == 1
        assert result.total_bytes == 3
        assert result.skipped == 5

    def test_unlistable_root_fails_the_walk(self, tmp_path, monkeypatch):
        root = tmp_path / "root"
        root.mkdir()
        self._flaky_scandir(monkeypatch, unlistable={"root"})
        with pytest.raises(PermissionError):
            diagnostics._walk_disk_usage(root)

    def test_symlinks_are_not_followed(self, tmp_path):
        (tmp_path / "svc" / "cat").mkdir(parents=True)
        (tmp_path / "svc" / "cat" / "a.bin").write_bytes(b"a" * 4)
        try:
            (tmp_path / "link").symlink_to(tmp_path / "svc", target_is_directory=True)
            (tmp_path / "svc" / "cat" / "loop").symlink_to(
                tmp_path, target_is_directory=True
            )
        except OSError:
            pytest.skip("symlinks not permitted on this platform")
        result = diagnostics._walk_disk_usage(tmp_path)
        assert result.file_count == 1
        assert [svc["name"] for svc in result.detailed["services"]] == ["svc"]
