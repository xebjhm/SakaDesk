"""Windows Proactor reset guard (R-h Task 12).

On Windows, ``_ProactorBasePipeTransport._call_connection_lost`` calls
``sock.shutdown()`` after notifying the protocol; for a peer that already
reset the connection that raises ``OSError`` (WinError 10022 / 10054), the
socket is never closed and the server never detaches the transport. The guard
finishes that cleanup instead of letting the callback blow up.
"""

from __future__ import annotations

from asyncio import proactor_events
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from structlog.testing import capture_logs

from backend.services import proactor_resets
from backend.services.proactor_resets import (
    install_proactor_reset_guard,
    tolerate_reset_on_close,
)


def _transport():
    return SimpleNamespace(
        _sock=MagicMock(),
        _server=MagicMock(),
        _called_connection_lost=False,
    )


def test_reset_during_shutdown_still_closes_and_detaches():
    t = _transport()
    sock, server = t._sock, t._server

    def original(self, exc):
        # Mirrors CPython: protocol notified, then shutdown() raises in finally.
        raise OSError(10022, "An invalid argument was supplied")

    guarded = tolerate_reset_on_close(original)
    with capture_logs() as logs:
        guarded(t, None)

    sock.close.assert_called_once_with()
    server._detach.assert_called_once()
    assert t._sock is None and t._server is None
    assert t._called_connection_lost is True
    (e,) = [e for e in logs if e["event"] == "proactor_reset_on_close"]
    assert e["errno"] == 10022
    assert e["close_failed"] is False
    assert e["log_level"] == "debug"


def test_reset_with_socket_already_gone():
    t = SimpleNamespace(_sock=None, _server=None, _called_connection_lost=False)

    def original(self, exc):
        raise ConnectionResetError(10054, "reset by peer")

    tolerate_reset_on_close(original)(t, None)
    assert t._called_connection_lost is True


def test_close_failure_is_swallowed():
    t = _transport()
    t._sock.close.side_effect = OSError("already closed")

    def original(self, exc):
        raise OSError(10054, "reset")

    with capture_logs() as logs:
        tolerate_reset_on_close(original)(t, None)
    assert t._sock is None
    assert t._called_connection_lost is True
    (e,) = [e for e in logs if e["event"] == "proactor_reset_on_close"]
    assert e["close_failed"] is True


def test_oserror_after_completed_cleanup_is_not_swallowed():
    # If the original finished its cleanup, an OSError came from the protocol
    # itself — that is not ours to hide.
    t = _transport()

    def original(self, exc):
        self._called_connection_lost = True
        raise OSError("protocol bug")

    with pytest.raises(OSError, match="protocol bug"):
        tolerate_reset_on_close(original)(t, None)


def test_normal_close_passes_through():
    t = _transport()
    original = MagicMock()
    tolerate_reset_on_close(original)(t, "exc")
    original.assert_called_once_with(t, "exc")
    t._sock.close.assert_not_called()


def test_install_is_noop_off_windows(monkeypatch):
    before = proactor_events._ProactorBasePipeTransport._call_connection_lost
    with capture_logs() as logs:
        assert install_proactor_reset_guard(platform="linux") is False
    assert proactor_events._ProactorBasePipeTransport._call_connection_lost is before
    (e,) = [e for e in logs if e["event"] == "proactor_reset_guard"]
    assert e["installed"] is False and e["reason"] == "not_windows"


def test_install_on_windows_patches_once(monkeypatch):
    cls = proactor_events._ProactorBasePipeTransport
    original = cls._call_connection_lost
    monkeypatch.setattr(cls, "_call_connection_lost", original)
    with capture_logs() as logs:
        assert install_proactor_reset_guard(platform="win32") is True
        patched = cls._call_connection_lost
        assert patched is not original
        assert getattr(patched, proactor_resets._GUARD_MARK) is True
        # Idempotent: a second call keeps the same wrapper.
        assert install_proactor_reset_guard(platform="win32") is False
        assert cls._call_connection_lost is patched
    reasons = [e.get("reason") for e in logs if e["event"] == "proactor_reset_guard"]
    assert reasons == ["installed", "already_installed"]


class _Server312:
    def __init__(self):
        self.calls: list[tuple] = []

    def _detach(self):
        self.calls.append(())


class _Server313:
    def __init__(self):
        self.calls: list[tuple] = []

    def _detach(self, transport):
        self.calls.append((transport,))


@pytest.mark.parametrize("server_cls", [_Server312, _Server313])
def test_detach_matches_server_signature(server_cls):
    server = server_cls()
    t = SimpleNamespace(_sock=None, _server=server, _called_connection_lost=False)

    def original(self, exc):
        raise OSError(10054, "reset")

    tolerate_reset_on_close(original)(t, None)
    expected = [()] if server_cls is _Server312 else [(t,)]
    assert server.calls == expected


def test_detach_with_uninspectable_callable(monkeypatch):
    server = MagicMock()
    monkeypatch.setattr(
        proactor_resets.inspect,
        "signature",
        MagicMock(side_effect=ValueError("no signature")),
    )
    proactor_resets._detach(server, object())
    server._detach.assert_called_once_with()
