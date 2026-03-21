"""Tests for search API endpoints (GET /api/search, /api/search/status, etc.)."""

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def _mock_search_service():
    """Create a mock SearchService with default return values."""
    svc = MagicMock()
    svc.search = AsyncMock(
        return_value={
            "results": [],
            "total": 0,
            "query": "test",
        }
    )
    svc.get_status = AsyncMock(
        return_value={
            "indexed_messages": 100,
            "indexed_blogs": 50,
            "is_building": False,
            "last_build": "2025-01-01T00:00:00Z",
        }
    )
    svc.rebuild = AsyncMock()
    svc.get_members = AsyncMock(
        return_value={
            "members": [],
            "services": [],
            "is_building": False,
        }
    )
    return svc


class TestSearchEndpoint:
    """Tests for GET /api/search."""

    def test_search_missing_query(self):
        """Missing query parameter returns 422."""
        response = client.get("/api/search")
        assert response.status_code == 422

    @patch("backend.api.search.get_search_service")
    def test_search_basic(self, mock_get_svc):
        """Basic search with query returns results."""
        svc = _mock_search_service()
        svc.search = AsyncMock(
            return_value={
                "results": [{"id": 1, "content": "hello"}],
                "total": 1,
            }
        )
        mock_get_svc.return_value = svc
        response = client.get("/api/search?q=hello")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1

    @patch("backend.api.search.get_search_service")
    def test_search_with_service_filter(self, mock_get_svc):
        """Search with service filter."""
        svc = _mock_search_service()
        mock_get_svc.return_value = svc
        response = client.get("/api/search?q=test&service=hinatazaka46")
        assert response.status_code == 200
        svc.search.assert_called_once()
        call_args = svc.search.call_args
        assert call_args[0][1] == "hinatazaka46"  # second positional arg

    @patch("backend.api.search.get_search_service")
    def test_search_with_member_filter(self, mock_get_svc):
        """Search with group_id and member_id filter."""
        svc = _mock_search_service()
        mock_get_svc.return_value = svc
        response = client.get("/api/search?q=test&group_id=1&member_id=10")
        assert response.status_code == 200
        call_args = svc.search.call_args
        assert call_args[0][2] == 1  # group_id
        assert call_args[0][3] == 10  # member_id

    @patch("backend.api.search.get_search_service")
    def test_search_with_services_list(self, mock_get_svc):
        """Search with comma-separated services filter."""
        svc = _mock_search_service()
        mock_get_svc.return_value = svc
        response = client.get("/api/search?q=test&services=hinatazaka46,sakurazaka46")
        assert response.status_code == 200
        call_kwargs = svc.search.call_args[1]
        assert call_kwargs["services"] == ["hinatazaka46", "sakurazaka46"]

    @patch("backend.api.search.get_search_service")
    def test_search_with_member_ids_list(self, mock_get_svc):
        """Search with comma-separated member IDs."""
        svc = _mock_search_service()
        mock_get_svc.return_value = svc
        response = client.get("/api/search?q=test&member_ids=10,20,30")
        assert response.status_code == 200
        call_kwargs = svc.search.call_args[1]
        assert call_kwargs["member_ids"] == [10, 20, 30]

    def test_search_invalid_member_ids(self):
        """Non-integer member_ids returns 400."""
        response = client.get("/api/search?q=test&member_ids=abc")
        assert response.status_code == 400

    @patch("backend.api.search.get_search_service")
    def test_search_with_member_filters(self, mock_get_svc):
        """Search with service:member_id pair filters."""
        svc = _mock_search_service()
        mock_get_svc.return_value = svc
        response = client.get(
            "/api/search?q=test&member_filters=hinatazaka46:58,sakurazaka46:12"
        )
        assert response.status_code == 200
        call_kwargs = svc.search.call_args[1]
        assert call_kwargs["member_filters"] == [
            ("hinatazaka46", 58),
            ("sakurazaka46", 12),
        ]

    def test_search_invalid_member_filters(self):
        """Invalid member_filters format returns 400."""
        response = client.get("/api/search?q=test&member_filters=hinatazaka46:abc")
        assert response.status_code == 400

    @patch("backend.api.search.get_search_service")
    def test_search_with_pagination(self, mock_get_svc):
        """Search with limit and offset."""
        svc = _mock_search_service()
        mock_get_svc.return_value = svc
        response = client.get("/api/search?q=test&limit=10&offset=20")
        assert response.status_code == 200
        call_args = svc.search.call_args[0]
        assert call_args[4] == 10  # limit
        assert call_args[5] == 20  # offset

    @patch("backend.api.search.get_search_service")
    def test_search_with_exact_only(self, mock_get_svc):
        """Search with exact_only flag."""
        svc = _mock_search_service()
        mock_get_svc.return_value = svc
        response = client.get("/api/search?q=test&exact_only=true")
        assert response.status_code == 200
        call_kwargs = svc.search.call_args[1]
        assert call_kwargs["exact_only"] is True

    @patch("backend.api.search.get_search_service")
    def test_search_with_date_filters(self, mock_get_svc):
        """Search with date_from and date_to filters."""
        svc = _mock_search_service()
        mock_get_svc.return_value = svc
        response = client.get(
            "/api/search?q=test&date_from=2025-01-01&date_to=2025-12-31"
        )
        assert response.status_code == 200
        call_kwargs = svc.search.call_args[1]
        assert call_kwargs["date_from"] == "2025-01-01"
        assert call_kwargs["date_to"] == "2025-12-31"

    @patch("backend.api.search.get_search_service")
    def test_search_with_content_type(self, mock_get_svc):
        """Search with content_type filter."""
        svc = _mock_search_service()
        mock_get_svc.return_value = svc
        response = client.get("/api/search?q=test&content_type=blogs")
        assert response.status_code == 200
        call_kwargs = svc.search.call_args[1]
        assert call_kwargs["content_type"] == "blogs"


class TestSearchStatus:
    """Tests for GET /api/search/status."""

    @patch("backend.api.search.get_search_service")
    def test_search_status(self, mock_get_svc):
        """Returns search index status."""
        svc = _mock_search_service()
        mock_get_svc.return_value = svc
        response = client.get("/api/search/status")
        assert response.status_code == 200
        data = response.json()
        assert data["indexed_messages"] == 100
        assert data["is_building"] is False


class TestRebuildIndex:
    """Tests for POST /api/search/rebuild."""

    @patch("backend.api.search.get_search_service")
    def test_rebuild_index(self, mock_get_svc):
        """Triggers index rebuild."""
        svc = _mock_search_service()
        mock_get_svc.return_value = svc
        response = client.post("/api/search/rebuild")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "started"
        svc.rebuild.assert_called_once()


class TestSearchMembers:
    """Tests for GET /api/search/members."""

    @patch("backend.api.search.get_search_service")
    def test_get_members(self, mock_get_svc):
        """Returns indexed members for autocomplete."""
        svc = _mock_search_service()
        svc.get_members = AsyncMock(
            return_value={
                "members": [{"id": 1, "name": "Test Member"}],
                "services": ["hinatazaka46"],
                "is_building": False,
            }
        )
        mock_get_svc.return_value = svc
        response = client.get("/api/search/members")
        assert response.status_code == 200
        data = response.json()
        assert len(data["members"]) == 1
        assert data["services"] == ["hinatazaka46"]
