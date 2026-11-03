"""unread_total / tooltip_text: the unread number shown in the tray tooltip."""

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from structlog.testing import capture_logs

from backend.services import unread_summary
from backend.services.i18n import get_strings
from backend.services.unread_summary import tooltip_text, unread_total

DISPLAY = "日向坂46"  # hinatazaka46


def _write_member(root: Path, rel: str, messages: list[dict]) -> None:
    member_dir = root / rel
    member_dir.mkdir(parents=True, exist_ok=True)
    (member_dir / "messages.json").write_text(
        json.dumps({"member": {"name": "金村 美玖"}, "messages": messages}),
        encoding="utf-8",
    )


def _state(service, group_id, member_id, last_read_id=0, revealed=()):
    return {
        "service": service,
        "group_id": group_id,
        "member_id": member_id,
        "last_read_id": last_read_id,
        "read_count": 0,
        "revealed_ids": list(revealed),
        "updated_at": "2026-11-04T00:00:00+00:00",
    }


@pytest.fixture
def env(tmp_path, monkeypatch):
    """A fake output dir plus a fake read-state store."""
    svc = MagicMock()
    svc.get_all_read_states = AsyncMock(return_value={})
    monkeypatch.setattr(unread_summary, "get_search_service", lambda: svc)
    monkeypatch.setattr(unread_summary, "get_output_dir", lambda: tmp_path)
    return tmp_path, svc


def _store(svc, *states) -> None:
    svc.get_all_read_states = AsyncMock(
        return_value={
            f"{s['service']}/{s['group_id']}/{s['member_id']}": s for s in states
        }
    )


def _server_unread(root: Path, display: str, counts: dict[str, int | None]) -> None:
    """Write a sync_metadata.json whose server_groups carry ``unread_count``."""
    server_groups = {
        gid: (
            {"state": "open", "is_active": True}
            | ({} if n is None else {"unread_count": n})
        )
        for gid, n in counts.items()
    }
    (root / display).mkdir(parents=True, exist_ok=True)
    (root / display / "sync_metadata.json").write_text(
        json.dumps({"groups": {}, "server_groups": server_groups}), encoding="utf-8"
    )


MEMBER = f"{DISPLAY}/messages/34 金村 美玖/58 金村 美玖"


@pytest.mark.asyncio
async def test_counts_messages_after_last_read_in_a_member_chat(env) -> None:
    root, svc = env
    _write_member(root, MEMBER, [{"id": i} for i in range(1, 6)])
    _store(svc, _state("hinatazaka46", 34, 58, last_read_id=2))
    assert await unread_total() == 3


@pytest.mark.asyncio
async def test_revealed_ids_are_not_unread(env) -> None:
    root, svc = env
    _write_member(root, MEMBER, [{"id": i} for i in range(1, 6)])
    _store(svc, _state("hinatazaka46", 34, 58, last_read_id=2, revealed=[4]))
    assert await unread_total() == 2


@pytest.mark.asyncio
async def test_withdrawn_messages_do_not_count(env) -> None:
    root, svc = env
    _write_member(
        root,
        MEMBER,
        [
            {"id": 1},
            {"id": 2, "state": "published"},
            {"id": 3, "state": "canceled"},
            {"id": 4, "state": "canceled"},
        ],
    )
    _store(svc, _state("hinatazaka46", 34, 58, last_read_id=0))
    assert await unread_total() == 2


@pytest.mark.asyncio
async def test_never_opened_chat_counts_from_zero_when_server_unread_is_unknown(
    env,
) -> None:
    root, _ = env
    _write_member(root, MEMBER, [{"id": i} for i in range(1, 5)])
    assert await unread_total() == 4  # no stored state, no server snapshot: uncapped


@pytest.mark.asyncio
async def test_never_opened_chat_is_capped_by_server_unread(env) -> None:
    root, _ = env
    _write_member(root, MEMBER, [{"id": i} for i in range(1, 11)])
    _server_unread(root, DISPLAY, {"34": 3})
    assert await unread_total() == 3


@pytest.mark.asyncio
async def test_stored_state_is_capped_by_server_unread(env) -> None:
    root, svc = env
    _write_member(root, MEMBER, [{"id": i} for i in range(1, 11)])
    _server_unread(root, DISPLAY, {"34": 2})
    _store(svc, _state("hinatazaka46", 34, 58, last_read_id=3))  # 7 local
    assert await unread_total() == 2


@pytest.mark.asyncio
async def test_server_unread_never_raises_the_local_count(env) -> None:
    root, svc = env
    _write_member(root, MEMBER, [{"id": i} for i in range(1, 6)])
    _server_unread(root, DISPLAY, {"34": 50})
    _store(svc, _state("hinatazaka46", 34, 58, last_read_id=3))
    assert await unread_total() == 2


@pytest.mark.asyncio
async def test_server_unread_zero_clears_the_chat(env) -> None:
    root, svc = env
    _write_member(root, MEMBER, [{"id": i} for i in range(1, 6)])
    _server_unread(root, DISPLAY, {"34": 0})
    _store(svc, _state("hinatazaka46", 34, 58, last_read_id=0))
    assert await unread_total() == 0


@pytest.mark.asyncio
async def test_null_server_unread_is_uncapped(env) -> None:
    root, svc = env
    _write_member(root, MEMBER, [{"id": i} for i in range(1, 6)])
    _server_unread(root, DISPLAY, {"34": None})
    _store(svc, _state("hinatazaka46", 34, 58, last_read_id=1))
    assert await unread_total() == 4


@pytest.mark.asyncio
async def test_group_chat_uses_the_room_path_and_sums_all_member_dirs(env) -> None:
    root, svc = env
    _write_member(root, f"{DISPLAY}/messages/43 {DISPLAY}/1 A", [{"id": 1}, {"id": 2}])
    _write_member(root, f"{DISPLAY}/messages/43 {DISPLAY}/2 B", [{"id": 3}])
    _store(svc, _state("hinatazaka46", 43, 0, last_read_id=1))
    assert await unread_total() == 2


@pytest.mark.asyncio
async def test_group_chat_is_capped_by_server_unread(env) -> None:
    root, svc = env
    _write_member(root, f"{DISPLAY}/messages/43 {DISPLAY}/1 A", [{"id": 1}, {"id": 2}])
    _write_member(root, f"{DISPLAY}/messages/43 {DISPLAY}/2 B", [{"id": 3}])
    _server_unread(root, DISPLAY, {"43": 1})
    _store(svc, _state("hinatazaka46", 43, 0, last_read_id=0))
    assert await unread_total() == 1


@pytest.mark.asyncio
async def test_graduated_group_chat_is_not_counted(env) -> None:
    root, _svc = env
    _write_member(root, f"{DISPLAY}/messages/43 {DISPLAY}/1 A", [{"id": 1}, {"id": 2}])
    _write_member(root, f"{DISPLAY}/messages/43 {DISPLAY}/2 B", [{"id": 3}])
    (root / DISPLAY / "sync_metadata.json").write_text(
        json.dumps({"groups": {}, "server_groups": {"43": {"state": "closed"}}}),
        encoding="utf-8",
    )
    assert await unread_total() == 0


@pytest.mark.asyncio
async def test_a_state_stored_under_a_member_id_does_not_apply_to_a_group_chat(
    env,
) -> None:
    root, svc = env
    _write_member(root, f"{DISPLAY}/messages/43 {DISPLAY}/1 A", [{"id": 1}, {"id": 2}])
    _write_member(root, f"{DISPLAY}/messages/43 {DISPLAY}/2 B", [{"id": 3}])
    _store(svc, _state("hinatazaka46", 43, 1, last_read_id=99))
    assert await unread_total() == 3  # the sidebar keys a group chat by the room


@pytest.mark.asyncio
async def test_sums_across_conversations_and_services(env) -> None:
    root, svc = env
    _write_member(root, MEMBER, [{"id": 1}, {"id": 2}])
    _write_member(root, f"{DISPLAY}/messages/35 小坂 菜緒/59 小坂 菜緒", [{"id": 5}])
    _write_member(root, "櫻坂46/messages/12 X/7 X", [{"id": 9}, {"id": 10}])
    _store(
        svc,
        _state("hinatazaka46", 34, 58),
        _state("hinatazaka46", 35, 59, last_read_id=5),
        _state("sakurazaka46", 12, 7, last_read_id=9),
    )
    assert await unread_total() == 2 + 0 + 1


@pytest.mark.asyncio
async def test_same_group_id_in_two_services_uses_its_own_state_and_cap(env) -> None:
    root, svc = env
    _write_member(root, "日向坂46/messages/12 X/7 X", [{"id": 1}, {"id": 2}])
    _write_member(root, "櫻坂46/messages/12 Y/8 Y", [{"id": 1}, {"id": 2}, {"id": 3}])
    _server_unread(root, "櫻坂46", {"12": 1})
    _store(svc, _state("hinatazaka46", 12, 7, last_read_id=1))
    assert await unread_total() == 1 + 1


@pytest.mark.asyncio
async def test_nothing_synced_is_zero(env) -> None:
    assert await unread_total() == 0


@pytest.mark.asyncio
async def test_unknown_services_and_stale_states_are_ignored(env) -> None:
    root, svc = env
    (root / DISPLAY / "messages").mkdir(parents=True)
    _write_member(root, "unknown service/messages/1 X/1 X", [{"id": 1}])
    _store(
        svc,
        _state("hinatazaka46", 999, 1),
        _state("hinatazaka46", 999, 0),
        _state("not_a_service", 1, 1),
    )
    svc.get_all_read_states.return_value["bad"] = {"service": "hinatazaka46"}
    assert await unread_total() == 0


@pytest.mark.asyncio
async def test_missing_output_dir_is_zero(env, monkeypatch) -> None:
    root, svc = env
    monkeypatch.setattr(unread_summary, "get_output_dir", lambda: root / "nope")
    _store(svc, _state("hinatazaka46", 34, 58))
    assert await unread_total() == 0


@pytest.mark.asyncio
async def test_store_failure_returns_zero_and_logs_the_error_type(env) -> None:
    _, svc = env
    svc.get_all_read_states = AsyncMock(side_effect=RuntimeError("secret 金村"))
    with capture_logs() as logs:
        assert await unread_total() == 0
    (event,) = [e for e in logs if e["event"] == "tray_tooltip_failed"]
    assert event["error_type"] == "RuntimeError"
    assert "金村" not in repr(logs)


@pytest.mark.asyncio
async def test_scan_failure_returns_zero_and_logs_the_error_type(
    env, monkeypatch
) -> None:
    root, _ = env
    _write_member(root, MEMBER, [{"id": 1}])

    def boom(*_a, **_k):
        raise OSError("disk 金村")

    monkeypatch.setattr("backend.api.content._list_group_refs", boom)
    with capture_logs() as logs:
        assert await unread_total() == 0
    (event,) = [e for e in logs if e["event"] == "tray_tooltip_failed"]
    assert event["error_type"] == "OSError"
    assert "金村" not in repr(logs)


# ------------------------------------------------------------- tooltip_text


@pytest.mark.parametrize(
    ("lang", "expected"),
    [
        ("en", "SakaDesk — 3 unread"),
        ("ja", "SakaDesk — 未読 3 件"),
        ("zh-TW", "SakaDesk — 3 則未讀"),
        ("zh-CN", "SakaDesk — 3 条未读"),
        ("yue", "SakaDesk — 3 則未讀"),
    ],
)
def test_tooltip_text_with_unread(lang, expected) -> None:
    assert tooltip_text(3, get_strings("tray", lang)) == expected


@pytest.mark.parametrize("n", [0, -1])
def test_tooltip_text_idle_when_nothing_unread(n) -> None:
    assert tooltip_text(n, get_strings("tray", "ja")) == "SakaDesk"
