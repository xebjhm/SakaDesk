"""Real pysaka-built media paths must pass SakaDesk's containment filter.

``SyncService._contained_media`` keeps a queue item only if its path is inside
``self.service_data_dir``. That is correct only while the base object SakaDesk
hands to pysaka's ``SyncManager`` is the very same ``service_data_dir`` the
filter compares against. If output-dir resolution is ever changed so the two
drift apart (different spelling, relative vs absolute, a symlinked parent),
EVERY item is rejected, no media downloads, and the only symptom is a
``media_item_rejected`` warning. This test drives a real ``SyncManager`` with
picture, voice and video rows and fails if any item is dropped.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from structlog.testing import capture_logs

from pysaka.client import Client, Group
from backend.services.sync_service import SyncService

pytestmark = pytest.mark.asyncio


def _msg(i: int, typ: str, url: str) -> dict:
    return {
        "id": i,
        "member_id": 10,
        "published_at": f"2025-03-20T00:00:{i:02d}Z",
        "type": typ,
        "text": "",
        "file": url,
    }


async def _run(tmp_path: Path, output_dir: str):
    svc = SyncService()
    group = {
        "id": 1,
        "name": "Grp: x/..",
        "state": "open",
        "subscription": {"state": "active"},
    }
    member = {"id": 10, "name": " 名前 ", "portrait": None, "thumbnail": None}
    msgs = [
        _msg(1, "picture", "https://cdn.example/1.jpg"),
        _msg(2, "voice", "https://cdn.example/2.m4a"),
        _msg(3, "video", "https://cdn.example/3.mp4"),
    ]
    written: list[Path] = []

    async def download(session, url, path, *a, **kw):
        written.append(Path(path))
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_bytes(b"x")
        return True

    client = MagicMock(spec=Client)
    client.group = Group.HINATAZAKA46
    client.get_groups = AsyncMock(return_value=[group])
    client.get_members = AsyncMock(return_value=[member])
    client.get_messages = AsyncMock(return_value=msgs)
    client.get_past_messages = AsyncMock(return_value=None)
    client.get_letters = AsyncMock(return_value=[])
    client.download_file = AsyncMock(side_effect=download)
    with (
        patch.object(
            svc,
            "load_app_settings",
            new_callable=AsyncMock,
            return_value={"is_configured": True, "output_dir": output_dir},
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
        patch("backend.services.sync_service.aiohttp.ClientSession") as sess,
        patch("backend.services.sync_service.progress_manager") as pm,
        patch("backend.services.sync_service.send_planned", new_callable=AsyncMock),
    ):
        pm.get.return_value = MagicMock()
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=AsyncMock())
        ctx.__aexit__ = AsyncMock(return_value=False)
        sess.return_value = ctx
        with capture_logs() as logs:
            ok = await svc.start_sync()
    return ok, written, logs, svc


@pytest.mark.parametrize("suffix", ["", "/", "/sub/..", "/./"])
async def test_real_manager_media_passes_the_containment_filter(tmp_path, suffix):
    ok, written, logs, svc = await _run(tmp_path, str(tmp_path) + suffix)
    assert ok is True
    assert not [e for e in logs if e["event"] == "media_item_rejected"]
    assert len(written) == 3
    assert all(p.is_relative_to(svc.service_data_dir) for p in written)


async def test_real_manager_media_passes_with_a_relative_output_dir(
    tmp_path, monkeypatch
):
    monkeypatch.chdir(tmp_path)
    ok, written, logs, _ = await _run(tmp_path, "relout")
    assert ok is True
    assert not [e for e in logs if e["event"] == "media_item_rejected"]
    assert len(written) == 3
