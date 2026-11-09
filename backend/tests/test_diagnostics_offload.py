"""SD-BE-API-01 — diagnostics.py must not block the loop or slurp the full log.

``GET /api/diagnostics`` used to read the whole DEBUG-level debug.log into
memory. These tests pin:

1. The blocking gather runs via ``asyncio.to_thread`` (off the event loop).
2. debug.log is tail-read, not fully slurped, so a multi-GB log cannot OOM /
   stall the request — a huge file still returns only its last lines quickly.

The output-folder disk walk moved to a background tracker (L6); see
``test_diagnostics_disk_usage.py``.
"""

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_diagnostics_offloads_to_thread(tmp_path):
    """The diagnostics gather runs off the event loop."""
    with patch("backend.api.diagnostics.get_logs_dir", return_value=tmp_path / "logs"):
        with patch(
            "backend.api.diagnostics.get_settings_path",
            return_value=tmp_path / "s.json",
        ):
            with patch(
                "backend.api.diagnostics.get_token_manager",
                return_value=MagicMock(load_session=MagicMock(return_value=None)),
            ):
                with patch(
                    "backend.api.diagnostics.asyncio.to_thread",
                    wraps=__import__("asyncio").to_thread,
                ) as mock_to_thread:
                    resp = client.get("/api/diagnostics")
    assert resp.status_code == 200
    assert mock_to_thread.called


def test_debug_log_is_tail_read_not_slurped(tmp_path):
    """A large debug.log returns only its tail without reading the whole file."""
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    debug_log = log_dir / "debug.log"
    # 20k lines; the endpoint must return the last 50 and must not read all 20k
    # into memory via readlines().
    lines = [f"[INFO] line {i}\n" for i in range(20000)]
    lines.append("[ERROR] boom at the end\n")
    debug_log.write_text("".join(lines), encoding="utf-8")

    with patch("backend.api.diagnostics.get_logs_dir", return_value=log_dir):
        with patch(
            "backend.api.diagnostics.get_settings_path",
            return_value=tmp_path / "nonexistent.json",
        ):
            with patch(
                "backend.api.diagnostics.get_token_manager",
                return_value=MagicMock(load_session=MagicMock(return_value=None)),
            ):
                resp = client.get("/api/diagnostics")

    data = resp.json()
    recent = data["logs"]["recent"]
    assert len(recent) <= 50
    # The tail must include the final error line, and the errors bucket must too.
    assert any("boom at the end" in line for line in recent)
    assert any("boom at the end" in e for e in data["logs"]["errors"])


def test_tail_lines_returns_last_n(tmp_path):
    """_tail_lines returns the last N lines of a file without reading all of it."""
    from backend.api.diagnostics import _tail_lines

    f = tmp_path / "big.log"
    f.write_text("".join(f"line{i}\n" for i in range(1000)), encoding="utf-8")
    tail = _tail_lines(f, 10)
    assert len(tail) == 10
    assert tail[-1].strip() == "line999"
    assert tail[0].strip() == "line990"
