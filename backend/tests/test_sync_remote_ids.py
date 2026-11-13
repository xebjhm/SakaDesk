"""Remote message-API ids never become paths outside the service folder (security audit
2026-11-13, backend/services/sync_service.py:media_queue:remote-ids-unvalidated-paths-escape-service-data-dir).

pysaka builds ``messages/<group id> <name>/<member id> <name>/<subdir>/<message id>.<ext>``
from the raw ids; a string id such as ``../../x`` or ``/abs/x`` put files with
the remote's bytes outside the archive, in sync phase 3 and again in Verify &
Fix. SakaDesk now keeps only rows with true int ids and downloads only queue
items whose paths stay inside the service folder.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from structlog.testing import capture_logs

from backend.services.sync_service import SyncService, _int_id_rows
from backend.services.safe_paths import is_within
from backend.tests.test_sync_service_core import (
    _make_message,
    _mock_sync_manager,
    _run_start_sync,
)

pytestmark = pytest.mark.asyncio

GROUP = {"id": 43, "name": "G", "state": "open", "subscription": {"state": "active"}}
MEMBER = {"id": 79, "name": "M", "thumbnail": None, "portrait": None}
TS = "2026-02-01T00:00:00Z"


def _manager(*, groups=None, members=None, messages=None, sync_member=None):
    client = MagicMock()
    client.access_token = "tok"
    client.refresh_if_needed = AsyncMock()
    client.get_groups = AsyncMock(return_value=[GROUP] if groups is None else groups)
    client.get_members = AsyncMock(
        return_value=[MEMBER] if members is None else members
    )
    client.get_messages = AsyncMock(
        return_value=[_make_message(1, 79, TS)] if messages is None else messages
    )
    m = _mock_sync_manager()
    m.client = client
    m.get_last_ts = MagicMock(return_value=None)
    m.get_last_id = MagicMock(return_value=None)
    m.sync_member = sync_member or AsyncMock(return_value=0)
    m.backfill_past_messages = AsyncMock(return_value=0)
    m.sync_letters = AsyncMock(return_value=0)
    m.process_media_queue = AsyncMock(return_value={})
    m.finalize_deferred_media = MagicMock(return_value={})
    return m


def _events(logs, name, **match):
    return [
        e
        for e in logs
        if e["event"] == name and all(e.get(k) == v for k, v in match.items())
    ]


async def test_a_group_with_a_non_int_id_is_never_synced(tmp_path):
    evil = {**GROUP, "id": "../../../../../ver3-room"}
    m = _manager(groups=[GROUP, evil])
    with capture_logs() as logs:
        result = await _run_start_sync(
            SyncService(),
            tmp_path,
            groups=[GROUP, evil],
            members=[MEMBER],
            mock_manager=m,
        )
    assert result is True
    assert [c.args[1] for c in m.client.get_members.await_args_list] == [43]
    assert [c.args[1]["id"] for c in m.sync_member.await_args_list] == [43]
    (event,) = _events(logs, "remote_id_rejected", kind="group")
    assert (event["count"], event["id_types"]) == (1, ["str"])
    assert "ver3-room" not in str(logs)


async def test_members_with_non_int_ids_are_never_synced(tmp_path):
    members = [MEMBER, {"id": "../x", "name": "X"}, {"id": True, "name": "T"}]
    m = _manager(members=members)
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(), tmp_path, groups=[GROUP], members=members, mock_manager=m
        )
    assert [c.args[2]["id"] for c in m.sync_member.await_args_list] == [79]
    (event,) = _events(logs, "remote_id_rejected", kind="member")
    assert (event["count"], event["id_types"]) == (2, ["bool", "str"])


async def test_messages_with_non_int_ids_never_reach_pysaka(tmp_path):
    good = _make_message(1, 79, TS)
    messages = [
        good,
        {**_make_message(2, 79, TS), "id": "../../../../../../../../ver3-escape/rel"},
        {**_make_message(3, 79, TS), "id": "/home/x/ver3-abs/abs-dummy"},
        {**_make_message(4, 79, TS), "id": 4.0},
    ]
    m = _manager(messages=messages)
    with capture_logs() as logs:
        result = await _run_start_sync(
            SyncService(), tmp_path, groups=[GROUP], members=[MEMBER], mock_manager=m
        )
    assert result is True
    (call,) = m.sync_member.await_args_list
    assert call.kwargs["prefetched_messages"] == [good]
    (event,) = _events(logs, "remote_id_rejected", kind="message")
    assert (event["count"], event["id_types"]) == (3, ["float", "str"])
    assert "ver3" not in str(logs)


async def test_queue_items_outside_the_service_folder_are_never_downloaded(tmp_path):
    base = tmp_path / "日向坂46" / "messages" / "43 G" / "79 M"

    def item(path, member_dir=base):
        return {
            "url": "https://cdn.example/x",
            "path": path,
            "timestamp": TS,
            "message_id": 1,
            "media_type": "picture",
            "member_dir": member_dir,
        }

    good = item(base / "picture" / "1.jpg")
    letter = {
        "url": "https://cdn.example/l",
        "path": base / "letters" / "9.jpg",
        "timestamp": None,
        "media_type": "picture",
        "kind": "letter",
    }
    escaping = [
        item(base / "picture" / "../../../../../../ver3-escape/rel-dummy.png"),
        item(tmp_path / "ver3-abs" / "abs-dummy.mp3"),
        item(base / "picture" / "2.jpg", member_dir=tmp_path / "elsewhere"),
        item("../../relative.png"),
    ]

    async def sync_member(session, group, member, queue, **kw):
        queue.extend([good, *escaping, letter])
        return 1

    m = _manager(sync_member=AsyncMock(side_effect=sync_member))
    progress = MagicMock()
    with capture_logs() as logs:
        await _run_start_sync(
            SyncService(),
            tmp_path,
            groups=[GROUP],
            members=[MEMBER],
            mock_manager=m,
            progress_mock=progress,
        )
    (downloading,) = [
        c for c in progress.start_phase.call_args_list if c.args[0] == "downloading"
    ]
    assert downloading.args[3] == 2  # total counts only the contained items
    downloaded = [i for c in m.process_media_queue.await_args_list for i in c.args[1]]
    assert downloaded == [good, letter]
    (event,) = _events(logs, "media_item_rejected")
    assert (event["phase"], event["reason"], event["count"]) == (
        "sync",
        "outside_service_dir",
        4,
    )
    assert "ver3" not in str(logs)


async def test_verify_never_recreates_a_file_outside_the_service_folder(
    tmp_path, monkeypatch
):
    output_dir = tmp_path / "out"
    member_dir = output_dir / "日向坂46" / "messages" / "10 G" / "20 M"
    (member_dir / "picture").mkdir(parents=True)
    (member_dir / "messages.json").write_text(
        json.dumps(
            {
                "messages": [
                    {
                        "id": 103,
                        "type": "picture",
                        "media_file": "messages/10 G/20 M/picture/103.jpg",
                        "timestamp": "2026-01-03T00:00:00Z",
                    },
                    {
                        "id": 104,
                        "type": "picture",
                        "media_file": "messages/10 G/20 M/picture/../../../../../../ver3-escape.png",
                        "timestamp": "2026-01-04T00:00:00Z",
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    svc = SyncService(service="hinatazaka46")

    async def settings():
        return {"output_dir": str(output_dir), "is_configured": True}

    monkeypatch.setattr(svc, "load_app_settings", settings)
    monkeypatch.setattr(
        "backend.services.sync_service.get_service_display_name",
        lambda service: "日向坂46",
    )
    written: list[Path] = []

    class StubClient:
        async def get_messages(self, session, gid, since_ts=None):
            return [
                {"id": 103, "file": "https://cdn.example/103.jpg", "type": "picture"},
                {"id": 104, "file": "https://cdn.example/104.png", "type": "picture"},
                {"id": "../x", "file": "https://cdn.example/x.png", "type": "picture"},
            ]

        async def download_file(self, session, url, path, timestamp=None, **kw):
            written.append(Path(path))
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            Path(path).write_bytes(b"FRESH")
            return True

    async def fake_auth(session):
        return StubClient()

    monkeypatch.setattr(svc, "_authenticated_client", fake_auth)
    with capture_logs() as logs:
        result = await svc.verify_and_fix_media()
    assert (result["missing"], result["repaired"]) == (1, 1)
    assert written == [member_dir / "picture" / "103.jpg"]
    assert not (tmp_path / "ver3-escape.png").exists()
    (event,) = _events(logs, "media_item_rejected")
    assert (event["phase"], event["count"]) == ("verify", 1)
    (rejected,) = _events(logs, "remote_id_rejected", kind="message")
    assert rejected["count"] == 1


@pytest.mark.parametrize("rows", [{"id": 1}, "x", 7])
async def test_int_id_rows_treats_a_non_list_as_empty_and_logs_it(rows):
    with capture_logs() as logs:
        assert _int_id_rows(rows, kind="group", service="svc") == []
    (event,) = _events(logs, "remote_id_rejected")
    assert (event["kind"], event["reason"]) == ("group", "not_list")


async def test_int_id_rows_treats_none_as_empty_silently():
    with capture_logs() as logs:
        assert _int_id_rows(None, kind="group", service="svc") == []
    assert logs == []


async def test_int_id_rows_logs_the_type_of_a_non_dict_row():
    with capture_logs() as logs:
        assert _int_id_rows(
            [{"id": 1}, "str-row", None], kind="member", service="s"
        ) == [{"id": 1}]
    (event,) = _events(logs, "remote_id_rejected")
    assert (event["count"], event["id_types"]) == (2, ["NoneType", "str"])


async def test_contained_media_skips_non_dict_items_and_checks_each_member_dir_once(
    tmp_path,
):
    svc = SyncService()
    svc.service_data_dir = tmp_path / "svc"
    base = svc.service_data_dir / "m"
    good = [{"path": base / f"{i}.jpg", "member_dir": base} for i in range(3)]
    items = ["not-a-dict", None, *good]
    with (
        patch("backend.services.sync_service.is_within", wraps=is_within) as spy,
        capture_logs() as logs,
    ):
        assert svc._contained_media(items, phase="sync") == good
    # 3 path checks + one shared member_dir check
    assert spy.call_count == 4
    (event,) = _events(logs, "media_item_rejected")
    assert event["count"] == 2
