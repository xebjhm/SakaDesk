"""Server socket and readiness probe of desktop.py (security audit 2026-11-13).

``webview`` is mocked in tests/conftest.py, so ``import desktop`` is safe.
"""

from __future__ import annotations

import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

import pytest
from structlog.testing import capture_logs

import desktop
from backend.services import api_auth


def test_app_url_carries_the_token_in_the_fragment():
    assert desktop._app_url(8123) == f"http://127.0.0.1:8123/#t={api_auth.LAUNCH_TOKEN}"
    assert desktop._app_url(8123, "?view=call-popup") == (
        f"http://127.0.0.1:8123/?view=call-popup#t={api_auth.LAUNCH_TOKEN}"
    )


def test_bind_option_prefers_exclusive_address_use(monkeypatch):
    monkeypatch.setattr(desktop.socket, "SO_EXCLUSIVEADDRUSE", 4, raising=False)
    assert desktop._bind_option() == 4
    monkeypatch.delattr(desktop.socket, "SO_EXCLUSIVEADDRUSE", raising=False)
    assert desktop._bind_option() == socket.SO_REUSEADDR


def test_create_server_socket_returns_a_listening_socket(tmp_path, monkeypatch):
    monkeypatch.setattr(desktop, "_get_port_file", lambda: tmp_path / ".port")
    port, sock = desktop.create_server_socket()
    try:
        assert sock.getsockopt(socket.SOL_SOCKET, socket.SO_ACCEPTCONN) == 1
        assert (tmp_path / ".port").read_text(encoding="utf-8") == str(port)
    finally:
        sock.close()


def _bound_squatter() -> tuple[socket.socket, int]:
    """A socket bound (SO_REUSEADDR) but not listening on a free loopback port."""
    squatter = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    squatter.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    squatter.bind(("127.0.0.1", 0))
    return squatter, squatter.getsockname()[1]


@pytest.mark.skipif(
    hasattr(socket, "SO_EXCLUSIVEADDRUSE"),
    reason="Windows refuses the exclusive bind; see the Windows variant below",
)
def test_saved_port_squatter_cannot_listen_after_us(tmp_path, monkeypatch):
    """A bound-but-not-listening squatter on the saved port loses the race."""
    squatter, saved = _bound_squatter()
    (tmp_path / ".port").write_text(str(saved), encoding="utf-8")
    monkeypatch.setattr(desktop, "_get_port_file", lambda: tmp_path / ".port")
    port, sock = desktop.create_server_socket()
    try:
        # SO_REUSEADDR on Linux lets us bind over a bound-but-not-listening socket.
        assert port == saved
        with pytest.raises(OSError):
            squatter.listen(1)
    finally:
        sock.close()
        squatter.close()


@pytest.mark.skipif(
    not hasattr(socket, "SO_EXCLUSIVEADDRUSE"), reason="Windows-only socket option"
)
def test_saved_port_squatter_moves_us_to_a_fresh_port_on_windows(tmp_path, monkeypatch):
    """SO_EXCLUSIVEADDRUSE refuses a port another socket holds: take a fresh one."""
    squatter, saved = _bound_squatter()
    (tmp_path / ".port").write_text(str(saved), encoding="utf-8")
    monkeypatch.setattr(desktop, "_get_port_file", lambda: tmp_path / ".port")
    try:
        with capture_logs() as logs:
            port, sock = desktop.create_server_socket()
        try:
            assert port != saved
            assert "server_port_saved_unavailable" in _events(logs)
            assert (tmp_path / ".port").read_text(encoding="utf-8") == str(port)
        finally:
            sock.close()
    finally:
        squatter.close()


def _serve(proof_for):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 (http.server API)
            nonce = parse_qs(urlparse(self.path).query).get("nonce", [""])[0]
            body = json.dumps({"status": "ok", "proof": proof_for(nonce)}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def test_wait_for_server_accepts_only_the_real_proof():
    real = _serve(api_auth.health_proof)
    fake = _serve(lambda nonce: "0" * 64)
    try:
        assert desktop.wait_for_server("127.0.0.1", real.server_address[1], timeout=3)
        assert not desktop.wait_for_server(
            "127.0.0.1", fake.server_address[1], timeout=1
        )
    finally:
        real.shutdown()
        fake.shutdown()


def _events(logs):
    return [entry["event"] for entry in logs]


def test_saved_port_socket_is_closed_when_listen_fails(tmp_path, monkeypatch):
    """A socket whose listen() fails is closed; a fresh port is then allocated."""
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    saved = probe.getsockname()[1]
    probe.close()
    (tmp_path / ".port").write_text(str(saved), encoding="utf-8")
    monkeypatch.setattr(desktop, "_get_port_file", lambda: tmp_path / ".port")

    real_socket = socket.socket
    created: list = []
    closed: list = []

    class FlakySocket(real_socket):
        def listen(self, *args):
            if not failed:
                failed.append(self)
                raise OSError("listen failed")
            return super().listen(*args)

        def close(self):
            closed.append(self)
            super().close()

    failed: list = []

    def factory(*args, **kwargs):
        sock = FlakySocket(*args, **kwargs)
        created.append(sock)
        return sock

    monkeypatch.setattr(desktop.socket, "socket", factory)
    with capture_logs() as logs:
        port, sock = desktop.create_server_socket()
    try:
        assert len(failed) == 1
        assert failed[0] in closed
        assert sock is not failed[0]
        assert sock.getsockopt(socket.SOL_SOCKET, socket.SO_ACCEPTCONN) == 1
        assert "server_port_saved_unavailable" in _events(logs)
        assert "server_port_allocated" in _events(logs)
    finally:
        sock.close()


def test_unreadable_port_file_is_logged_and_a_port_allocated(tmp_path, monkeypatch):
    (tmp_path / ".port").write_text("not-a-number", encoding="utf-8")
    monkeypatch.setattr(desktop, "_get_port_file", lambda: tmp_path / ".port")
    with capture_logs() as logs:
        port, sock = desktop.create_server_socket()
    sock.close()
    events = _events(logs)
    assert "server_port_saved_unreadable" in events
    assert "server_port_allocated" in events


def test_out_of_range_saved_port_is_logged(tmp_path, monkeypatch):
    (tmp_path / ".port").write_text("80", encoding="utf-8")
    monkeypatch.setattr(desktop, "_get_port_file", lambda: tmp_path / ".port")
    with capture_logs() as logs:
        _, sock = desktop.create_server_socket()
    sock.close()
    assert "server_port_saved_out_of_range" in _events(logs)


def test_in_use_saved_port_is_logged(tmp_path, monkeypatch):
    live = socket.socket()
    live.bind(("127.0.0.1", 0))
    live.listen(1)
    (tmp_path / ".port").write_text(str(live.getsockname()[1]), encoding="utf-8")
    monkeypatch.setattr(desktop, "_get_port_file", lambda: tmp_path / ".port")
    try:
        with capture_logs() as logs:
            port, sock = desktop.create_server_socket()
        sock.close()
        assert port != live.getsockname()[1]
        assert "server_port_saved_in_use" in _events(logs)
    finally:
        live.close()


def test_http_error_answer_warns_once_without_leaking_secrets():
    class NotFound(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 (http.server API)
            self.send_response(404)
            self.end_headers()

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), NotFound)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with capture_logs() as logs:
            assert not desktop.wait_for_server(
                "127.0.0.1", server.server_address[1], timeout=1
            )
    finally:
        server.shutdown()
    assert _events(logs).count("server_identity_mismatch") == 1
    dumped = json.dumps(logs, default=str)
    assert api_auth.LAUNCH_TOKEN not in dumped
    assert "nonce" not in dumped


@pytest.mark.parametrize("payload", [b"not json", b"[1, 2]"])
def test_non_proof_bodies_warn_once(payload):
    class Odd(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 (http.server API)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Odd)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with capture_logs() as logs:
            assert not desktop.wait_for_server(
                "127.0.0.1", server.server_address[1], timeout=1
            )
    finally:
        server.shutdown()
    assert _events(logs).count("server_identity_mismatch") == 1
