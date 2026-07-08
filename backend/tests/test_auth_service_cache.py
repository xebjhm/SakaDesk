"""SD-BE-API-04 — in-process session cache + off-loop keyring reads.

The OS keyring (Windows Credential Manager) read can take hundreds of ms per
service, and ``GET /api/auth/status`` (polled by the frontend) reads every
service on every call. These tests pin the two required behaviours:

1. ``get_status()`` caches the loaded session in-process so a second poll does
   NOT hit the keyring again (one WCM round-trip per service, not per poll).
2. ``logout`` / ``_save_credentials`` / a successful refresh invalidate the
   cache so the next status read reflects the change.
"""

import asyncio
from unittest.mock import MagicMock, patch

import pytest

from backend.services.auth_service import AuthService


@pytest.fixture
def auth_service():
    return AuthService()


def test_status_caches_session_across_polls(auth_service):
    """A second get_status() must not re-read the keyring for a service whose
    session is already cached (avoids repeated WCM reads on every poll)."""
    with patch("backend.services.auth_service.get_token_manager") as mock_tm:
        load = mock_tm.return_value.load_session
        load.return_value = {"access_token": "tok"}
        with patch.object(auth_service, "_is_token_expired", return_value=False):
            with patch.object(
                auth_service, "_get_token_expiry_timestamp", return_value=None
            ):
                asyncio.run(auth_service.get_status())
                first_calls = load.call_count
                assert first_calls > 0  # first poll populated the cache
                asyncio.run(auth_service.get_status())
                # Second poll served entirely from cache -> no new keyring reads.
                assert load.call_count == first_calls


def test_logout_invalidates_cached_session(auth_service):
    """After logout, the cached session for that service is dropped so the next
    status read hits the keyring again (and now sees no session)."""
    with patch("backend.services.auth_service.get_token_manager") as mock_tm:
        load = mock_tm.return_value.load_session
        load.return_value = {"access_token": "tok"}
        with patch.object(auth_service, "_is_token_expired", return_value=False):
            with patch.object(
                auth_service, "_get_token_expiry_timestamp", return_value=None
            ):
                status = asyncio.run(auth_service.get_status(service="hinatazaka46"))
                assert status["authenticated"] is True

                # Log out -> cache for hinatazaka46 must be invalidated.
                auth_service.logout("hinatazaka46")
                load.return_value = None

                status2 = asyncio.run(auth_service.get_status(service="hinatazaka46"))
                assert status2["authenticated"] is False


def test_save_credentials_invalidates_cache(auth_service):
    """Saving new credentials must invalidate the cached (old/absent) session so
    a subsequent status read reflects the freshly-saved token."""
    with patch("backend.services.auth_service.get_token_manager") as mock_tm:
        load = mock_tm.return_value.load_session
        load.return_value = None
        with patch.object(auth_service, "_is_token_expired", return_value=False):
            with patch.object(
                auth_service, "_get_token_expiry_timestamp", return_value=None
            ):
                # Prime the cache with "no session".
                assert (
                    asyncio.run(auth_service.get_status(service="hinatazaka46"))[
                        "authenticated"
                    ]
                    is False
                )

                # Now a login saves credentials; keyring starts returning a token.
                auth_service._save_credentials("hinatazaka46", {"access_token": "tok"})
                load.return_value = {"access_token": "tok"}

                assert (
                    asyncio.run(auth_service.get_status(service="hinatazaka46"))[
                        "authenticated"
                    ]
                    is True
                )


def test_status_offloads_keyring_read_to_thread(auth_service):
    """The per-service keyring read must run via asyncio.to_thread so it never
    blocks the event loop."""
    with patch("backend.services.auth_service.get_token_manager") as mock_tm:
        mock_tm.return_value.load_session.return_value = None
        with patch(
            "backend.services.auth_service.asyncio.to_thread",
            wraps=asyncio.to_thread,
        ) as mock_to_thread:
            asyncio.run(auth_service.get_status(service="hinatazaka46"))
            assert mock_to_thread.called


def test_refresh_invalidates_cache(auth_service):
    """A successful refresh writes a new token and must invalidate the cache so
    the next status read does not serve the stale (soon-to-expire) session."""
    from unittest.mock import AsyncMock

    async def run():
        with patch("backend.services.auth_service.get_token_manager") as mock_tm:
            mock_tm.return_value.load_session.return_value = {
                "access_token": "old.tok",
            }
            # Prime the cache via a status read.
            with patch.object(auth_service, "_is_token_expired", return_value=False):
                with patch.object(
                    auth_service, "_get_token_expiry_timestamp", return_value=None
                ):
                    await auth_service.get_status(service="hinatazaka46")

            with patch.object(auth_service, "_get_token_remaining_seconds") as mock_rem:
                mock_rem.side_effect = [300.0, 3600.0]
                with patch("backend.services.auth_service.Client") as mock_client_cls:
                    mock_client = MagicMock()
                    mock_client.access_token = "new.tok"
                    mock_client.cookies = {}
                    mock_client.refresh_token = None
                    mock_client.refresh_access_token = AsyncMock(return_value=True)
                    mock_client_cls.return_value = mock_client
                    with patch(
                        "backend.services.auth_service.aiohttp.ClientSession"
                    ) as mock_session_cls:
                        mock_session_cls.return_value.__aenter__ = AsyncMock(
                            return_value=AsyncMock()
                        )
                        mock_session_cls.return_value.__aexit__ = AsyncMock(
                            return_value=False
                        )
                        await auth_service.refresh_if_needed("hinatazaka46")

            # Cache must have been invalidated -> next status read re-loads.
            return auth_service._session_cache.get("hinatazaka46", "MISSING")

    cached = asyncio.run(run())
    assert cached == "MISSING"
