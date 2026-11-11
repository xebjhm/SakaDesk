from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_get_status_returns_all_services():
    """GET /api/auth/status returns status for all services."""
    response = client.get("/api/auth/status")
    assert response.status_code == 200
    data = response.json()
    assert "services" in data
    assert "hinatazaka46" in data["services"]
    assert "nogizaka46" in data["services"]
    assert "sakurazaka46" in data["services"]


def test_login_requires_service_param():
    """POST /api/auth/login without service param returns 422."""
    response = client.post("/api/auth/login")
    assert response.status_code == 422


def test_refresh_requires_service_param():
    """POST /api/auth/refresh-if-needed without service param returns 422."""
    response = client.post("/api/auth/refresh-if-needed")
    assert response.status_code == 422


def test_logout_requires_service_param():
    """POST /api/auth/logout without service param returns 422."""
    response = client.post("/api/auth/logout")
    assert response.status_code == 422


def test_login_invalid_service_returns_400():
    """POST /api/auth/login with invalid service returns 400."""
    response = client.post("/api/auth/login?service=invalid_service")
    assert response.status_code == 400


def test_logout_invalid_service_returns_400():
    """POST /api/auth/logout with invalid service returns 400."""
    response = client.post("/api/auth/logout?service=invalid_service")
    assert response.status_code == 400


def test_refresh_invalid_service_returns_400():
    """POST /api/auth/refresh-if-needed with invalid service returns 400."""
    response = client.post("/api/auth/refresh-if-needed?service=invalid_service")
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# POST /api/auth/login/cancel (loading UX L6). The browser login is always faked:
# a real login would end the live app's single session.
# ---------------------------------------------------------------------------

import asyncio  # noqa: E402
import contextlib  # noqa: E402
from unittest.mock import AsyncMock, MagicMock, patch  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402

from backend.api import auth as auth_api  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_login_state():
    """The module-level AuthService is shared: never leak login state."""
    yield
    svc = auth_api.auth_service
    svc._cancelled.clear()
    svc._pending_cancels.clear()
    svc._finished_attempts.clear()
    svc._clear_active_login()


def _hanging_login(started: asyncio.Event):
    async def fake_login(**_kwargs):
        started.set()
        await asyncio.Event().wait()

    return fake_login


def _async_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    )


def test_login_cancel_requires_service_param():
    assert client.post("/api/auth/login/cancel").status_code == 422


def test_login_cancel_invalid_service_returns_400():
    response = client.post("/api/auth/login/cancel?service=invalid_service")
    assert response.status_code == 400


def test_login_cancel_without_login_returns_false():
    response = client.post("/api/auth/login/cancel?service=hinatazaka46")
    assert response.status_code == 200
    assert response.json() == {"cancelled": False}


@pytest.mark.asyncio
async def test_login_cancel_during_login_answers_409_and_true():
    started = asyncio.Event()
    with patch("backend.services.auth_service.BrowserAuth") as mock_auth:
        mock_auth.login = AsyncMock(side_effect=_hanging_login(started))
        with patch.object(auth_api.auth_service, "_save_credentials") as save:
            async with _async_client() as ac:
                login = asyncio.create_task(
                    ac.post("/api/auth/login?service=hinatazaka46")
                )
                await asyncio.wait_for(started.wait(), timeout=2)
                cancel = await ac.post("/api/auth/login/cancel?service=hinatazaka46")
                login_response = await asyncio.wait_for(login, timeout=2)
    assert cancel.status_code == 200
    assert cancel.json() == {"cancelled": True}
    assert login_response.status_code == 409
    assert login_response.json() == {"detail": "login_cancelled"}
    save.assert_not_called()
    assert auth_api.auth_service._active_login_task is None
    assert not auth_api.auth_service._browser_lock.locked()


@pytest.mark.asyncio
async def test_login_cancel_after_success_keeps_credentials():
    tm = MagicMock()
    with patch("backend.services.auth_service.BrowserAuth") as mock_auth:
        mock_auth.login = AsyncMock(return_value={"access_token": "fixture-token"})
        with patch("backend.services.auth_service.get_token_manager", return_value=tm):
            async with _async_client() as ac:
                login = await ac.post("/api/auth/login?service=hinatazaka46")
                cancel = await ac.post("/api/auth/login/cancel?service=hinatazaka46")
    assert login.status_code == 200
    assert cancel.json() == {"cancelled": False}
    tm.save_session.assert_called_once()
    tm.delete_session.assert_not_called()


@pytest.mark.asyncio
async def test_login_shutdown_cancellation_still_propagates():
    """Without the user's Cancel (no marker), a cancellation, e.g. shutdown, is
    not turned into a 409: it propagates out of the route."""
    started = asyncio.Event()
    with patch("backend.services.auth_service.BrowserAuth") as mock_auth:
        mock_auth.login = AsyncMock(side_effect=_hanging_login(started))
        route = asyncio.create_task(auth_api.login("hinatazaka46", None))
        await asyncio.wait_for(started.wait(), timeout=2)
        route.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await route
    assert route.cancelled()
    assert auth_api.auth_service._active_login_task is None


# L6 fix round 1: early cancel over the API, shutdown during a cancel.


@pytest.mark.asyncio
async def test_login_cancel_before_login_arrives_answers_409_without_browser():
    with patch("backend.services.auth_service.BrowserAuth") as mock_auth:
        mock_auth.login = AsyncMock(return_value={"access_token": "fixture-token"})
        async with _async_client() as ac:
            cancel = await ac.post(
                "/api/auth/login/cancel?service=hinatazaka46&attempt=early-1"
            )
            login = await ac.post(
                "/api/auth/login?service=hinatazaka46&attempt=early-1"
            )
    assert cancel.json() == {"cancelled": True}
    assert login.status_code == 409
    assert login.json() == {"detail": "login_cancelled"}
    mock_auth.login.assert_not_called()


def test_login_attempt_must_be_a_code():
    response = client.post("/api/auth/login/cancel?service=hinatazaka46&attempt=a/b")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_shutdown_cancel_landing_with_the_users_cancel_still_propagates():
    """The user's cancel and a shutdown both request cancellation before it is
    delivered: the route must not swallow the shutdown as a 409."""
    started = asyncio.Event()
    svc = auth_api.auth_service
    with patch("backend.services.auth_service.BrowserAuth") as mock_auth:
        mock_auth.login = AsyncMock(side_effect=_hanging_login(started))
        route = asyncio.create_task(auth_api.login("hinatazaka46", None))
        await asyncio.wait_for(started.wait(), timeout=2)
        canceller = asyncio.create_task(svc.cancel_login("hinatazaka46"))
        await asyncio.sleep(0)  # the user's cancel is requested
        route.cancel()  # shutdown, before the first cancel is delivered
        with contextlib.suppress(asyncio.CancelledError):
            await route
        assert await canceller is True
    assert route.cancelled()
    assert "hinatazaka46" not in svc._cancelled


@pytest.mark.asyncio
async def test_users_cancel_during_shutdown_propagates():
    started = asyncio.Event()
    svc = auth_api.auth_service
    with patch("backend.services.auth_service.BrowserAuth") as mock_auth:
        mock_auth.login = AsyncMock(side_effect=_hanging_login(started))
        with patch("backend.api.auth.is_shutting_down", return_value=True):
            route = asyncio.create_task(auth_api.login("hinatazaka46", None))
            await asyncio.wait_for(started.wait(), timeout=2)
            assert await svc.cancel_login("hinatazaka46") is True
            with contextlib.suppress(asyncio.CancelledError):
                await route
    assert route.cancelled()
