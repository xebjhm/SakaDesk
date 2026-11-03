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


@pytest.mark.asyncio
async def test_counts_messages_after_last_read_in_a_member_chat(env) -> None:
    root, svc = env
    _write_member(
        root,
        f"{DISPLAY}/messages/34 金村 美玖/58 金村 美玖",
        [{"id": i} for i in range(1, 6)],
    )
    _store(svc, _state("hinatazaka46", 34, 58, last_read_id=2))
    assert await unread_total() == 3


@pytest.mark.asyncio
async def test_revealed_ids_are_not_unread(env) -> None:
    root, svc = env
    _write_member(
        root,
        f"{DISPLAY}/messages/34 金村 美玖/58 金村 美玖",
        [{"id": i} for i in range(1, 6)],
    )
    _store(svc, _state("hinatazaka46", 34, 58, last_read_id=2, revealed=[4]))
    assert await unread_total() == 2


@pytest.mark.asyncio
async def test_withdrawn_messages_do_not_count(env) -> None:
    root, svc = env
    _write_member(
        root,
        f"{DISPLAY}/messages/34 金村 美玖/58 金村 美玖",
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
async def test_group_chat_sums_all_member_dirs(env) -> None:
    root, svc = env
    _write_member(root, f"{DISPLAY}/messages/43 {DISPLAY}/1 A", [{"id": 1}, {"id": 2}])
    _write_member(root, f"{DISPLAY}/messages/43 {DISPLAY}/2 B", [{"id": 3}])
    _store(svc, _state("hinatazaka46", 43, 0, last_read_id=1))
    assert await unread_total() == 2


@pytest.mark.asyncio
async def test_sums_across_conversations_and_services(env) -> None:
    root, svc = env
    _write_member(
        root, f"{DISPLAY}/messages/34 金村 美玖/58 金村 美玖", [{"id": 1}, {"id": 2}]
    )
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
async def test_nothing_stored_is_zero(env) -> None:
    assert await unread_total() == 0


@pytest.mark.asyncio
async def test_states_without_matching_folders_or_services_are_skipped(env) -> None:
    root, svc = env
    (root / DISPLAY / "messages").mkdir(parents=True)
    _store(
        svc,
        _state("hinatazaka46", 999, 1),
        _state("hinatazaka46", 999, 0),
        _state("not_a_service", 1, 1),
    )
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
