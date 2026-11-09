"""Tests for the uvicorn configuration desktop.py serves the app with (R-i).

The browser polls /api/sync/progress every 5 s. uvicorn's default keep-alive
timeout is also 5 s, so the server kept closing idle connections at the exact
moment the browser reused them for the next poll. On Windows that race left
the browser holding a half-open socket: the request it had just sent was
never answered, and it only noticed when its TCP keep-alive gave up 495 s
later (Chromium: 45 s idle + 10 probes x 45 s). The fix keeps idle
connections open longer than the browser does, so the browser always closes
first and never sends on a socket the server is closing.

``webview`` is mocked in tests/conftest.py, so ``import desktop`` is safe.
"""

from __future__ import annotations

import socket
import threading
import time
from types import SimpleNamespace
from unittest.mock import MagicMock

import uvicorn
from structlog.testing import capture_logs

import desktop

# Chromium closes a used idle socket after this long (net/socket/
# client_socket_pool.cc: g_used_idle_socket_timeout_s = 300). The server must
# never close one sooner, or it can race the browser's next request.
CHROMIUM_USED_IDLE_SOCKET_TIMEOUT_S = 300

# The frontend's progress poll interval (useBackendSyncWatcher / useSync).
POLL_INTERVAL_S = 5


async def _tiny_app(scope, receive, send):
    """Minimal ASGI app: 200 "ok" for every HTTP request."""
    if scope["type"] == "lifespan":
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
    await send(
        {
            "type": "http.response.start",
            "status": 200,
            "headers": [(b"content-length", b"2")],
        }
    )
    await send({"type": "http.response.body", "body": b"ok"})


_REQUEST = b"GET /api/sync/progress HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"


def _read_response(conn: socket.socket) -> bytes:
    data = b""
    while not data.endswith(b"ok"):
        chunk = conn.recv(4096)
        if not chunk:
            return data  # server closed the connection
        data += chunk
    return data


class TestServerConfig:
    def test_keep_alive_outlives_browser_idle_sockets(self):
        config = desktop.build_server_config(_tiny_app)
        assert config.timeout_keep_alive > CHROMIUM_USED_IDLE_SOCKET_TIMEOUT_S

    def test_keeps_quiet_access_logging(self):
        config = desktop.build_server_config(_tiny_app)
        assert config.log_level == "error"

    def test_start_server_runs_uvicorn_with_the_config_and_logs_it(self, monkeypatch):
        server: MagicMock = MagicMock()
        created: list[uvicorn.Config] = []

        def fake_server(config: uvicorn.Config) -> MagicMock:
            created.append(config)
            return server

        monkeypatch.setattr(desktop.uvicorn, "Server", fake_server)
        monkeypatch.setattr(desktop, "_uvicorn_server", None)
        sock = SimpleNamespace()

        with capture_logs() as logs:
            desktop.start_server(sock)  # type: ignore[arg-type]

        assert len(created) == 1
        assert created[0].timeout_keep_alive == desktop.KEEP_ALIVE_TIMEOUT_S
        server.run.assert_called_once_with(sockets=[sock])
        assert desktop._uvicorn_server is server
        assert {
            "event": "server_config",
            "log_level": "info",
            "keep_alive_s": desktop.KEEP_ALIVE_TIMEOUT_S,
        }.items() <= next(
            entry for entry in logs if entry["event"] == "server_config"
        ).items()


def test_idle_connection_still_serves_the_next_poll():
    """A connection idle for a whole poll interval is still served.

    With uvicorn's default 5 s keep-alive the server has closed the socket by
    the time the next poll arrives, so the second request gets no response.
    """
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(desktop.build_server_config(_tiny_app))
    thread = threading.Thread(
        target=server.run, kwargs={"sockets": [listener]}, daemon=True
    )
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        assert server.started

        with socket.create_connection(("127.0.0.1", port), timeout=5) as conn:
            conn.sendall(_REQUEST)
            assert _read_response(conn).startswith(b"HTTP/1.1 200")
            time.sleep(POLL_INTERVAL_S + 0.5)  # idle across one poll interval
            conn.sendall(_REQUEST)
            assert _read_response(conn).startswith(b"HTTP/1.1 200")
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        listener.close()
