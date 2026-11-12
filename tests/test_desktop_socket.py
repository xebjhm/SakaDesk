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


def test_saved_port_squatter_cannot_listen_after_us(tmp_path, monkeypatch):
    """A bound-but-not-listening squatter on the saved port loses the race."""
    squatter = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    squatter.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    squatter.bind(("127.0.0.1", 0))
    saved = squatter.getsockname()[1]
    (tmp_path / ".port").write_text(str(saved), encoding="utf-8")
    monkeypatch.setattr(desktop, "_get_port_file", lambda: tmp_path / ".port")
    port, sock = desktop.create_server_socket()
    try:
        if port == saved:
            with pytest.raises(OSError):
                squatter.listen(1)
    finally:
        sock.close()
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
