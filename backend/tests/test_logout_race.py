"""Logout wins over a renewal in flight; exports end with the session (security audit 2026-11-13).

report-hardening #25: a renewal still running could re-save the session after
logout deleted it. #43: a held export stayed fetchable after logout.
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest
from structlog.testing import capture_logs

from backend.services import refresh_gate
from backend.services.auth_service import AuthService
from backend.services.memories import exports


@pytest.mark.asyncio
async def test_logout_deletes_after_the_renewal_that_holds_the_gate():
    order: list[str] = []
    with patch("backend.services.auth_service.get_token_manager") as tm:
        tm.return_value.delete_session.side_effect = lambda _s: order.append("delete")
        holding = asyncio.Event()

        async def renewal():
            async with refresh_gate.hold("hinatazaka46"):
                holding.set()
                await asyncio.sleep(0.05)
                order.append("renewal_saved")

        task = asyncio.create_task(renewal())
        await holding.wait()
        await AuthService().logout("hinatazaka46")
        await task
    assert order == ["renewal_saved", "delete"]


@pytest.mark.asyncio
async def test_logout_still_deletes_when_the_gate_never_frees(monkeypatch):
    monkeypatch.setattr(refresh_gate, "GATE_WAIT_SECONDS", 0.05)
    release = asyncio.Event()
    holding = asyncio.Event()

    async def stuck():
        async with refresh_gate.hold("sakurazaka46"):
            holding.set()
            await release.wait()

    task = asyncio.create_task(stuck())
    await holding.wait()
    with (
        patch("backend.services.auth_service.get_token_manager") as tm,
        capture_logs() as logs,
    ):
        await AuthService().logout("sakurazaka46")
    release.set()
    await task
    tm.return_value.delete_session.assert_called_once_with("sakurazaka46")
    assert {
        "event": "logout_gate_timeout",
        "service": "sakurazaka46",
        "log_level": "warning",
    } in logs


@pytest.mark.asyncio
async def test_logout_drops_pending_exports():
    exports.store.clear()
    exports.store.put("png", b"poster")
    with (
        patch("backend.services.auth_service.get_token_manager"),
        capture_logs() as logs,
    ):
        await AuthService().logout("hinatazaka46")
    assert len(exports.store) == 0
    assert {"event": "logout_exports_cleared", "count": 1, "log_level": "info"} in logs
