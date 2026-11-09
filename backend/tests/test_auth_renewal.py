"""get_status renews an expired token before saying "log in" (spec B1 §1)."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from pysaka import RefreshFailedError, SessionExpiredError

from backend.services import session_alert
from backend.services.auth_service import AuthService

EXPIRED = {
    "authenticated": False,
    "token_expired": True,
    "expires_at": 1,
    "message": "x",
}
VALID = {
    "authenticated": True,
    "expires_at": 9,
    "app_id": None,
    "storage_type": "secure",
}


@pytest.fixture(autouse=True)
def _reset():
    session_alert._reset_for_tests()
    with patch.object(
        session_alert, "report", AsyncMock(side_effect=lambda s, k: k == "expired")
    ) as rep:
        yield rep
    session_alert._reset_for_tests()


def _svc(statuses, outcome):
    svc = AuthService()
    seq = iter(statuses)
    svc._get_service_auth_status = lambda s: next(seq)  # type: ignore[method-assign]
    svc.renew_expired = AsyncMock(return_value=outcome)  # type: ignore[method-assign]
    return svc


@pytest.mark.asyncio
async def test_renewed_token_reads_authenticated(_reset):
    svc = _svc([EXPIRED, VALID], "ok")
    with patch("backend.services.auth_service.is_test_mode", return_value=False):
        status = await svc.get_status("sakurazaka46")
    assert status["authenticated"] is True
    _reset.assert_not_awaited()


@pytest.mark.asyncio
async def test_dead_session_is_marked(_reset):
    svc = _svc([EXPIRED], "dead")
    with patch("backend.services.auth_service.is_test_mode", return_value=False):
        status = await svc.get_status("sakurazaka46")
    assert status["session_expired"] is True and status["authenticated"] is False
    _reset.assert_awaited_once_with("sakurazaka46", "expired")


@pytest.mark.asyncio
async def test_network_error_is_not_marked(_reset):
    svc = _svc([EXPIRED], "error")
    with patch("backend.services.auth_service.is_test_mode", return_value=False):
        status = await svc.get_status("sakurazaka46")
    assert status.get("session_expired") is None and status["token_expired"] is True
    _reset.assert_not_awaited()


@pytest.mark.asyncio
async def test_concurrent_renewals_refresh_once():
    svc = AuthService()
    calls = 0

    async def fake_refresh(self, session):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return True

    tokens = iter([("old", True), ("new", False), ("new", False)])

    def load(_svc):
        token, expired = next(tokens)
        return {"access_token": token, "cookies": {"session": "c"}}, expired

    svc._load_token_for_renewal = load  # type: ignore[method-assign]
    svc._save_refreshed = lambda service, client: None  # type: ignore[method-assign]
    with patch(
        "backend.services.auth_service.Client.refresh_access_token", fake_refresh
    ):
        results = await asyncio.gather(
            svc.renew_expired("yodel"), svc.renew_expired("yodel")
        )
    assert calls == 1
    assert sorted(results) == ["not_expired", "ok"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc,outcome",
    [
        (SessionExpiredError("x"), "dead"),
        (RefreshFailedError("x"), "refresh_failed"),
        (OSError("x"), "error"),
    ],
)
async def test_renew_maps_failures(exc, outcome):
    svc = AuthService()
    svc._load_token_for_renewal = lambda s: (
        {"access_token": "t", "cookies": {"session": "c"}},
        True,
    )  # type: ignore[method-assign]
    with patch(
        "backend.services.auth_service.Client.refresh_access_token",
        AsyncMock(side_effect=exc),
    ):
        assert await svc.renew_expired("yodel") == outcome


@pytest.mark.asyncio
async def test_no_cookies_is_dead():
    svc = AuthService()
    svc._load_token_for_renewal = lambda s: ({"access_token": "t", "cookies": {}}, True)  # type: ignore[method-assign]
    assert await svc.renew_expired("yodel") == "no_cookies"
