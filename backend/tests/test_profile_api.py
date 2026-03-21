"""Tests for profile API endpoints (backend/api/profile.py)."""

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# GET /api/profile
# ---------------------------------------------------------------------------


class TestGetProfile:
    def test_missing_service_returns_422(self):
        """Service query param is required."""
        response = client.get("/api/profile")
        assert response.status_code == 422

    def test_invalid_service_returns_error_field(self):
        """Invalid service should return ProfileResponse with error, not HTTP 400."""
        response = client.get("/api/profile?service=fake_service")
        assert response.status_code == 200
        data = response.json()
        assert data["nickname"] is None
        assert data["error"] is not None

    def test_returns_cached_nickname(self):
        """If nickname is already cached in settings, return it without API call."""
        with patch(
            "backend.api.profile._store_load", new_callable=AsyncMock
        ) as mock_load:
            mock_load.return_value = {
                "user_nicknames": {"hinatazaka46": "CachedUser"},
            }
            response = client.get("/api/profile?service=hinatazaka46")

        assert response.status_code == 200
        data = response.json()
        assert data["nickname"] == "CachedUser"
        assert data["error"] is None

    def test_fetches_from_api_when_not_cached(self):
        """No cache hit -> fetch from API, cache it, return it."""
        with patch(
            "backend.api.profile._store_load", new_callable=AsyncMock
        ) as mock_load:
            mock_load.return_value = {"user_nicknames": {}}

            with patch("backend.api.profile.get_token_manager") as mock_tm:
                mock_tm.return_value.load_session.return_value = {
                    "access_token": "tok",
                    "cookies": {},
                }

                with patch("backend.api.profile.Client") as mock_client_cls:
                    mock_client = MagicMock()
                    mock_client.get_profile = AsyncMock(
                        return_value={"name": "FreshNick"}
                    )
                    mock_client_cls.return_value = mock_client

                    with patch(
                        "backend.api.profile.aiohttp.ClientSession"
                    ) as mock_session_cls:
                        mock_session = AsyncMock()
                        mock_session_cls.return_value.__aenter__ = AsyncMock(
                            return_value=mock_session
                        )
                        mock_session_cls.return_value.__aexit__ = AsyncMock(
                            return_value=False
                        )

                        with patch(
                            "backend.api.profile._store_update", new_callable=AsyncMock
                        ) as mock_update:
                            response = client.get("/api/profile?service=hinatazaka46")

        assert response.status_code == 200
        data = response.json()
        assert data["nickname"] == "FreshNick"
        assert data["error"] is None
        # Verify the nickname was cached
        mock_update.assert_called_once()

    def test_not_authenticated_returns_error(self):
        """If no access_token in session, return error."""
        with patch(
            "backend.api.profile._store_load", new_callable=AsyncMock
        ) as mock_load:
            mock_load.return_value = {"user_nicknames": {}}
            with patch("backend.api.profile.get_token_manager") as mock_tm:
                mock_tm.return_value.load_session.return_value = None
                response = client.get("/api/profile?service=hinatazaka46")

        assert response.status_code == 200
        data = response.json()
        assert data["nickname"] is None
        assert data["error"] == "Not authenticated"

    def test_session_without_access_token_returns_error(self):
        """Session exists but has no access_token."""
        with patch(
            "backend.api.profile._store_load", new_callable=AsyncMock
        ) as mock_load:
            mock_load.return_value = {"user_nicknames": {}}
            with patch("backend.api.profile.get_token_manager") as mock_tm:
                mock_tm.return_value.load_session.return_value = {"cookies": {}}
                response = client.get("/api/profile?service=hinatazaka46")

        assert response.status_code == 200
        assert response.json()["error"] == "Not authenticated"

    def test_api_returns_no_name(self):
        """Profile API responds but without a 'name' field."""
        with patch(
            "backend.api.profile._store_load", new_callable=AsyncMock
        ) as mock_load:
            mock_load.return_value = {"user_nicknames": {}}
            with patch("backend.api.profile.get_token_manager") as mock_tm:
                mock_tm.return_value.load_session.return_value = {
                    "access_token": "tok",
                }
                with patch("backend.api.profile.Client") as mock_client_cls:
                    mock_client = MagicMock()
                    mock_client.get_profile = AsyncMock(
                        return_value={"email": "x@y.com"}
                    )
                    mock_client_cls.return_value = mock_client

                    with patch(
                        "backend.api.profile.aiohttp.ClientSession"
                    ) as mock_session_cls:
                        mock_session = AsyncMock()
                        mock_session_cls.return_value.__aenter__ = AsyncMock(
                            return_value=mock_session
                        )
                        mock_session_cls.return_value.__aexit__ = AsyncMock(
                            return_value=False
                        )

                        response = client.get("/api/profile?service=hinatazaka46")

        data = response.json()
        assert data["nickname"] is None
        assert data["error"] == "No name in profile"

    def test_api_returns_none_profile(self):
        """Profile API responds with None."""
        with patch(
            "backend.api.profile._store_load", new_callable=AsyncMock
        ) as mock_load:
            mock_load.return_value = {"user_nicknames": {}}
            with patch("backend.api.profile.get_token_manager") as mock_tm:
                mock_tm.return_value.load_session.return_value = {"access_token": "tok"}
                with patch("backend.api.profile.Client") as mock_client_cls:
                    mock_client = MagicMock()
                    mock_client.get_profile = AsyncMock(return_value=None)
                    mock_client_cls.return_value = mock_client

                    with patch(
                        "backend.api.profile.aiohttp.ClientSession"
                    ) as mock_session_cls:
                        mock_session = AsyncMock()
                        mock_session_cls.return_value.__aenter__ = AsyncMock(
                            return_value=mock_session
                        )
                        mock_session_cls.return_value.__aexit__ = AsyncMock(
                            return_value=False
                        )

                        response = client.get("/api/profile?service=hinatazaka46")

        assert response.json()["error"] == "No name in profile"

    def test_api_exception_returns_error(self):
        """Any exception during API call returns error in response body."""
        with patch(
            "backend.api.profile._store_load", new_callable=AsyncMock
        ) as mock_load:
            mock_load.return_value = {"user_nicknames": {}}
            with patch("backend.api.profile.get_token_manager") as mock_tm:
                mock_tm.return_value.load_session.side_effect = RuntimeError(
                    "keyring broken"
                )
                response = client.get("/api/profile?service=hinatazaka46")

        data = response.json()
        assert data["nickname"] is None
        assert "keyring broken" in data["error"]

    def test_different_services_cached_independently(self):
        """Each service has its own nickname cache entry."""
        with patch(
            "backend.api.profile._store_load", new_callable=AsyncMock
        ) as mock_load:
            mock_load.return_value = {
                "user_nicknames": {
                    "hinatazaka46": "HinataUser",
                    "sakurazaka46": "SakuraUser",
                },
            }
            resp1 = client.get("/api/profile?service=hinatazaka46")
            resp2 = client.get("/api/profile?service=sakurazaka46")

        assert resp1.json()["nickname"] == "HinataUser"
        assert resp2.json()["nickname"] == "SakuraUser"


# ---------------------------------------------------------------------------
# POST /api/profile/refresh
# ---------------------------------------------------------------------------


class TestRefreshProfile:
    def test_missing_service_returns_422(self):
        response = client.post("/api/profile/refresh")
        assert response.status_code == 422

    def test_invalid_service_returns_error_field(self):
        response = client.post("/api/profile/refresh?service=fake")
        assert response.status_code == 200
        data = response.json()
        assert data["error"] is not None

    def test_clears_cache_then_fetches_fresh(self):
        """Refresh should clear cached nickname and fetch from API."""
        # refresh_profile flow:
        #   1. _store_update (clear nickname)
        #   2. get_profile -> _store_load (should see empty cache now)
        #   3. get_profile -> fetches from API
        #   4. get_profile -> _store_update (cache new nickname)
        with patch(
            "backend.api.profile._store_load", new_callable=AsyncMock
        ) as mock_load:
            # After clear, get_profile sees no cached nickname
            mock_load.return_value = {"user_nicknames": {}}

            with patch(
                "backend.api.profile._store_update", new_callable=AsyncMock
            ) as mock_update:
                with patch("backend.api.profile.get_token_manager") as mock_tm:
                    mock_tm.return_value.load_session.return_value = {
                        "access_token": "tok",
                    }
                    with patch("backend.api.profile.Client") as mock_client_cls:
                        mock_client = MagicMock()
                        mock_client.get_profile = AsyncMock(
                            return_value={"name": "NewNick"}
                        )
                        mock_client_cls.return_value = mock_client

                        with patch(
                            "backend.api.profile.aiohttp.ClientSession"
                        ) as mock_session_cls:
                            mock_session = AsyncMock()
                            mock_session_cls.return_value.__aenter__ = AsyncMock(
                                return_value=mock_session
                            )
                            mock_session_cls.return_value.__aexit__ = AsyncMock(
                                return_value=False
                            )

                            response = client.post(
                                "/api/profile/refresh?service=hinatazaka46"
                            )

        assert response.status_code == 200
        data = response.json()
        assert data["nickname"] == "NewNick"
        # _store_update called twice: once to clear, once to cache new
        assert mock_update.call_count == 2

    def test_refresh_when_not_authenticated(self):
        """Refresh when no session should return 'Not authenticated' error."""
        with patch("backend.api.profile._store_update", new_callable=AsyncMock):
            with patch(
                "backend.api.profile._store_load", new_callable=AsyncMock
            ) as mock_load:
                mock_load.return_value = {"user_nicknames": {}}
                with patch("backend.api.profile.get_token_manager") as mock_tm:
                    mock_tm.return_value.load_session.return_value = None
                    response = client.post("/api/profile/refresh?service=hinatazaka46")

        assert response.status_code == 200
        assert response.json()["error"] == "Not authenticated"

    def test_refresh_clears_only_target_service(self):
        """Refreshing one service should not affect other services' caches."""
        cleared_services = []

        async def capture_update(updater):
            cfg = {
                "user_nicknames": {
                    "hinatazaka46": "Hinata",
                    "sakurazaka46": "Sakura",
                }
            }
            updater(cfg)
            remaining = list(cfg.get("user_nicknames", {}).keys())
            cleared_services.append(remaining)
            return cfg

        with patch("backend.api.profile._store_update", side_effect=capture_update):
            with patch(
                "backend.api.profile._store_load", new_callable=AsyncMock
            ) as mock_load:
                # After clear, return no cache so get_profile hits API
                mock_load.return_value = {"user_nicknames": {}}
                with patch("backend.api.profile.get_token_manager") as mock_tm:
                    mock_tm.return_value.load_session.return_value = {
                        "access_token": "t"
                    }
                    with patch("backend.api.profile.Client") as mock_client_cls:
                        mock_client = MagicMock()
                        mock_client.get_profile = AsyncMock(
                            return_value={"name": "New"}
                        )
                        mock_client_cls.return_value = mock_client

                        with patch(
                            "backend.api.profile.aiohttp.ClientSession"
                        ) as mock_session_cls:
                            mock_session = AsyncMock()
                            mock_session_cls.return_value.__aenter__ = AsyncMock(
                                return_value=mock_session
                            )
                            mock_session_cls.return_value.__aexit__ = AsyncMock(
                                return_value=False
                            )

                            client.post("/api/profile/refresh?service=hinatazaka46")

        # The first update (clear) should remove hinatazaka46 but keep sakurazaka46
        assert "sakurazaka46" in cleared_services[0]
        assert "hinatazaka46" not in cleared_services[0]
