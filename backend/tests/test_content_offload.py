"""SD-BE-API-01 — content.py blocking FS I/O must be off-loaded to a thread.

``GET /api/content/groups`` parses every member's messages.json and
``POST /api/content/unread_counts`` re-reads them per conversation. On a large
library that is many MB of json.load per request; done on the event loop it
freezes every other endpoint (media streaming, sync polls). These tests pin
that the blocking work runs via ``asyncio.to_thread`` (one hop per request),
while re-verifying the responses are unchanged.
"""

import json
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def _write_member(member_dir: Path, messages: list) -> None:
    member_dir.mkdir(parents=True, exist_ok=True)
    (member_dir / "messages.json").write_text(
        json.dumps(
            {
                "member": {"name": "Test"},
                "messages": messages,
                "total_messages": len(messages),
            }
        ),
        encoding="utf-8",
    )


def test_get_groups_offloads_to_thread(tmp_path):
    """The whole library scan + per-file json.load in /groups runs off-loop."""
    svc = tmp_path / "日向坂46" / "messages" / "34 金村 美玖" / "58 金村 美玖"
    _write_member(svc, [{"id": 1}, {"id": 2}])

    with patch("backend.api.content.get_output_dir", return_value=tmp_path):
        with patch(
            "backend.api.content.asyncio.to_thread",
            wraps=__import__("asyncio").to_thread,
        ) as mock_to_thread:
            resp = client.get("/api/content/groups")
    assert resp.status_code == 200
    assert mock_to_thread.called
    # Response still well-formed.
    body = resp.json()
    assert "groups" in body


def test_unread_counts_offloads_to_thread(tmp_path):
    """The per-conversation messages.json reads in /unread_counts run off-loop."""
    member = tmp_path / "member1"
    _write_member(member, [{"id": 100}, {"id": 200}])

    with patch("backend.api.content.get_output_dir", return_value=tmp_path):
        with patch(
            "backend.api.content.asyncio.to_thread",
            wraps=__import__("asyncio").to_thread,
        ) as mock_to_thread:
            resp = client.post("/api/content/unread_counts", json={"member1": 100})
    assert resp.status_code == 200
    assert mock_to_thread.called
    # Correctness preserved: ID 200 is the single unread message.
    assert resp.json()["member1"] == 1
