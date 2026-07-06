import pytest

pytest.importorskip("webview")  # desktop.py needs the GUI backend to import
import desktop  # noqa: E402


def test_create_server_socket_binds_ephemeral():
    port, sock = desktop.create_server_socket()
    try:
        assert 1024 < port < 65536
        assert sock.getsockname()[1] == port
    finally:
        sock.close()


def test_no_dot_port_helpers():
    assert not hasattr(desktop, "_port_is_active")
    assert not hasattr(desktop, "_get_port_file")
