"""First-sync smoke test — end-to-end, real SyncManager, real disk write.

Unlike test_sync_service_core (which mocks the SyncManager and only inspects the
prefetched slice), this drives the REAL pysaka SyncManager through start_sync and
asserts the full history actually lands in messages.json. Only the network client
is faked. This is the guard that would have caught the "fresh sync keeps only the
latest 1000 messages" truncation at the layer that writes user data.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from pysaka.client import Client, Group
from backend.services.sync_service import SyncService


def _make_message(msg_id: int, member_id: int, published_at: str) -> dict:
    return {
        "id": msg_id,
        "member_id": member_id,
        "published_at": published_at,
        "text": f"Message {msg_id}",
    }


@pytest.mark.asyncio
async def test_first_sync_writes_full_history_to_disk(tmp_path):
    svc = SyncService()
    svc._service = "hinatazaka46"

    group = {
        "id": 1,
        "name": "Grp",
        "state": "open",
        "subscription": {"state": "active"},
    }
    member = {"id": 10, "name": "Mem", "portrait": None, "thumbnail": None}

    # 1500 messages > the old hardcoded 1000 cap: a regressed default would
    # truncate and the on-disk count below would drop to 1000.
    all_msgs = [
        _make_message(1000 + i, 10, f"2025-03-20T00:00:{i:07d}Z") for i in range(1500)
    ]

    # Fake network client: only get_groups/get_members/get_messages are hit.
    client = MagicMock(spec=Client)
    client.group = Group.HINATAZAKA46
    client.get_groups = AsyncMock(return_value=[group])
    client.get_members = AsyncMock(return_value=[member])
    client.get_messages = AsyncMock(return_value=all_msgs)

    mock_progress = MagicMock()
    for attr in ("start_phase", "set_completed", "complete", "update", "error"):
        setattr(mock_progress, attr, MagicMock())

    with (
        patch.object(
            svc,
            "load_app_settings",
            new_callable=AsyncMock,
            return_value={"is_configured": True, "output_dir": str(tmp_path)},
        ),
        patch.object(
            svc,
            "load_config",
            new_callable=AsyncMock,
            return_value={"access_token": "tok"},
        ),
        patch.object(
            svc,
            "load_metadata",
            new_callable=AsyncMock,
            return_value={"groups": {}, "last_sync": None},
        ),
        patch.object(svc, "save_metadata", new_callable=AsyncMock),
        patch.object(
            svc, "_authenticated_client", new_callable=AsyncMock, return_value=client
        ),
        patch(
            "backend.services.sync_service.get_service_display_name",
            return_value="日向坂46",
        ),
        patch(
            "backend.services.sync_service.get_session_dir",
            return_value=tmp_path / "session",
        ),
        patch("backend.services.sync_service.aiohttp.TCPConnector"),
        patch("backend.services.sync_service.aiohttp.ClientSession") as mock_sess_cls,
        patch("backend.services.sync_service.progress_manager") as mock_pm,
        patch(
            "backend.services.sync_service.notify_sync_complete_async",
            new_callable=AsyncMock,
        ),
    ):
        mock_pm.get.return_value = mock_progress
        mock_sess_ctx = AsyncMock()
        mock_sess_ctx.__aenter__ = AsyncMock(return_value=AsyncMock())
        mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_sess_cls.return_value = mock_sess_ctx

        await svc.start_sync()

    # The real SyncManager wrote one messages.json for member 10.
    json_paths = list(tmp_path.rglob("messages.json"))
    assert len(json_paths) == 1, f"expected one messages.json, found {json_paths}"

    data = json.loads(json_paths[0].read_text(encoding="utf-8"))
    written_ids = {m["id"] for m in data["messages"]}
    assert written_ids == {m["id"] for m in all_msgs}
    assert data["total_messages"] == 1500
