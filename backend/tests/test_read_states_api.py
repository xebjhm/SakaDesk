"""Tests for read-states API endpoints (GET/PUT /api/read-states, POST /api/read-states/batch)."""

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def _mock_search_service():
    """Create a mock SearchService with default return values for read-state methods."""
    svc = MagicMock()
    svc.get_all_read_states = AsyncMock(return_value={})
    svc.upsert_read_state = AsyncMock()
    svc.batch_upsert_read_states = AsyncMock(return_value=0)
    return svc


# ------------------------------------------------------------------
# GET /api/read-states
# ------------------------------------------------------------------


class TestGetAllReadStates:
    """Tests for GET /api/read-states."""

    @patch("backend.api.read_states.get_search_service")
    def test_returns_empty_dict_when_no_states(self, mock_get_svc):
        """Returns empty object when no read states exist."""
        svc = _mock_search_service()
        mock_get_svc.return_value = svc
        response = client.get("/api/read-states")
        assert response.status_code == 200
        assert response.json() == {}
        svc.get_all_read_states.assert_called_once()

    @patch("backend.api.read_states.get_search_service")
    def test_returns_populated_states(self, mock_get_svc):
        """Returns read states keyed by service:group:member."""
        svc = _mock_search_service()
        svc.get_all_read_states = AsyncMock(
            return_value={
                "hinatazaka46:1:10": {
                    "last_read_id": 500,
                    "read_count": 42,
                    "revealed_ids": [1, 2, 3],
                    "updated_at": "2025-01-15T12:00:00+00:00",
                },
                "sakurazaka46:2:20": {
                    "last_read_id": 100,
                    "read_count": 5,
                    "revealed_ids": [],
                    "updated_at": "2025-02-01T00:00:00+00:00",
                },
            }
        )
        mock_get_svc.return_value = svc
        response = client.get("/api/read-states")
        assert response.status_code == 200
        data = response.json()
        assert "hinatazaka46:1:10" in data
        assert data["hinatazaka46:1:10"]["last_read_id"] == 500
        assert data["sakurazaka46:2:20"]["read_count"] == 5


# ------------------------------------------------------------------
# PUT /api/read-states
# ------------------------------------------------------------------


class TestUpsertReadState:
    """Tests for PUT /api/read-states."""

    @patch("backend.api.read_states.get_search_service")
    def test_upsert_minimal_payload(self, mock_get_svc):
        """Upsert with required fields only (defaults for optional fields)."""
        svc = _mock_search_service()
        mock_get_svc.return_value = svc
        response = client.put(
            "/api/read-states",
            json={
                "service": "hinatazaka46",
                "group_id": 1,
                "member_id": 10,
            },
        )
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
        svc.upsert_read_state.assert_called_once_with(
            "hinatazaka46",
            1,
            10,
            0,
            0,
            [],
        )

    @patch("backend.api.read_states.get_search_service")
    def test_upsert_full_payload(self, mock_get_svc):
        """Upsert with all fields specified."""
        svc = _mock_search_service()
        mock_get_svc.return_value = svc
        response = client.put(
            "/api/read-states",
            json={
                "service": "sakurazaka46",
                "group_id": 2,
                "member_id": 20,
                "last_read_id": 999,
                "read_count": 50,
                "revealed_ids": [10, 20, 30],
            },
        )
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
        svc.upsert_read_state.assert_called_once_with(
            "sakurazaka46",
            2,
            20,
            999,
            50,
            [10, 20, 30],
        )

    def test_upsert_missing_required_fields(self):
        """Missing required fields returns 422."""
        response = client.put(
            "/api/read-states",
            json={
                "service": "hinatazaka46",
            },
        )
        assert response.status_code == 422

    def test_upsert_empty_body(self):
        """Empty body returns 422."""
        response = client.put("/api/read-states", json={})
        assert response.status_code == 422

    def test_upsert_invalid_types(self):
        """Wrong types for fields returns 422."""
        response = client.put(
            "/api/read-states",
            json={
                "service": "hinatazaka46",
                "group_id": "not_an_int",
                "member_id": 10,
            },
        )
        assert response.status_code == 422


# ------------------------------------------------------------------
# POST /api/read-states/batch
# ------------------------------------------------------------------


class TestBatchUpsertReadStates:
    """Tests for POST /api/read-states/batch."""

    @patch("backend.api.read_states.get_search_service")
    def test_batch_empty_list(self, mock_get_svc):
        """Batch upsert with empty list returns count 0."""
        svc = _mock_search_service()
        svc.batch_upsert_read_states = AsyncMock(return_value=0)
        mock_get_svc.return_value = svc
        response = client.post("/api/read-states/batch", json=[])
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["count"] == 0

    @patch("backend.api.read_states.get_search_service")
    def test_batch_single_entry(self, mock_get_svc):
        """Batch upsert with one entry."""
        svc = _mock_search_service()
        svc.batch_upsert_read_states = AsyncMock(return_value=1)
        mock_get_svc.return_value = svc
        response = client.post(
            "/api/read-states/batch",
            json=[
                {
                    "service": "hinatazaka46",
                    "group_id": 1,
                    "member_id": 10,
                    "last_read_id": 100,
                    "read_count": 5,
                    "revealed_ids": [1, 2],
                },
            ],
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["count"] == 1
        # Verify model_dump() was called and dicts were passed
        call_args = svc.batch_upsert_read_states.call_args[0][0]
        assert len(call_args) == 1
        assert call_args[0]["service"] == "hinatazaka46"
        assert call_args[0]["last_read_id"] == 100

    @patch("backend.api.read_states.get_search_service")
    def test_batch_multiple_entries(self, mock_get_svc):
        """Batch upsert with multiple entries."""
        svc = _mock_search_service()
        svc.batch_upsert_read_states = AsyncMock(return_value=3)
        mock_get_svc.return_value = svc
        entries = [
            {
                "service": "hinatazaka46",
                "group_id": 1,
                "member_id": i,
                "last_read_id": i * 100,
            }
            for i in range(1, 4)
        ]
        response = client.post("/api/read-states/batch", json=entries)
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 3
        call_args = svc.batch_upsert_read_states.call_args[0][0]
        assert len(call_args) == 3

    @patch("backend.api.read_states.get_search_service")
    def test_batch_entries_use_defaults(self, mock_get_svc):
        """Batch entries without optional fields get pydantic defaults via model_dump."""
        svc = _mock_search_service()
        svc.batch_upsert_read_states = AsyncMock(return_value=1)
        mock_get_svc.return_value = svc
        response = client.post(
            "/api/read-states/batch",
            json=[
                {"service": "hinatazaka46", "group_id": 1, "member_id": 10},
            ],
        )
        assert response.status_code == 200
        call_args = svc.batch_upsert_read_states.call_args[0][0]
        assert call_args[0]["last_read_id"] == 0
        assert call_args[0]["read_count"] == 0
        assert call_args[0]["revealed_ids"] == []

    def test_batch_invalid_entry_in_list(self):
        """Invalid entry in batch returns 422."""
        response = client.post(
            "/api/read-states/batch",
            json=[
                {"service": "hinatazaka46"},  # missing group_id and member_id
            ],
        )
        assert response.status_code == 422

    def test_batch_not_a_list(self):
        """Sending a single object instead of a list returns 422."""
        response = client.post(
            "/api/read-states/batch",
            json={
                "service": "hinatazaka46",
                "group_id": 1,
                "member_id": 10,
            },
        )
        assert response.status_code == 422
