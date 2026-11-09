"""unread_total / tooltip_text: the unread number shown in the tray tooltip.

The read states are seeded the way the frontend writes them: an app_state
conversation row ``read_state_<folder path>`` holding ``{"value": "<JSON>"}``.
"""

import json
from pathlib import Path

import pytest
from structlog.testing import capture_logs

from backend.services import app_state, unread_summary
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


@pytest.fixture
def env(tmp_path, monkeypatch):
    """A fake output dir plus an empty app_state database."""
    out = tmp_path / "out"
    out.mkdir()
    app_state.set_db_path(tmp_path / "app_state.db")
    app_state.init_db()
    monkeypatch.setattr(unread_summary, "get_output_dir", lambda: out)
    return out


def _read(rel: str, last_read_id=0, revealed=()) -> None:
    """Store a read state exactly as ``persisted.setConv`` does."""
    state = {"lastReadId": last_read_id, "readCount": 0, "revealedIds": list(revealed)}
    app_state.set_conversation(f"read_state_{rel}", {"value": json.dumps(state)})


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


REL = f"{DISPLAY}/messages/34 金村 美玖/58 金村 美玖"
ROOM = f"{DISPLAY}/messages/43 {DISPLAY}"


def _write_room(root: Path) -> None:
    _write_member(root, f"{ROOM}/1 A", [{"id": 1}, {"id": 2}])
    _write_member(root, f"{ROOM}/2 B", [{"id": 3}])


@pytest.mark.asyncio
async def test_counts_messages_after_last_read_in_a_member_chat(env) -> None:
    _write_member(env, REL, [{"id": i} for i in range(1, 6)])
    _read(REL, last_read_id=2)
    assert await unread_total() == 3


@pytest.mark.asyncio
async def test_an_empty_search_database_does_not_inflate_the_count(
    env, monkeypatch
) -> None:
    """The search DB read_states copy is not the source: losing it changes nothing."""
    _write_member(env, REL, [{"id": i} for i in range(1, 6)])
    _read(REL, last_read_id=4)

    def never(*_a, **_k):
        raise AssertionError("the tooltip must not touch the search service")

    monkeypatch.setattr("backend.services.search_service.get_search_service", never)
    assert await unread_total() == 1


@pytest.mark.asyncio
async def test_revealed_ids_are_not_unread(env) -> None:
    _write_member(env, REL, [{"id": i} for i in range(1, 6)])
    _read(REL, last_read_id=2, revealed=[4])
    assert await unread_total() == 2


@pytest.mark.asyncio
async def test_withdrawn_messages_do_not_count(env) -> None:
    _write_member(
        env,
        REL,
        [
            {"id": 1},
            {"id": 2, "state": "published"},
            {"id": 3, "state": "canceled"},
            {"id": 4, "state": "canceled"},
        ],
    )
    _read(REL)
    assert await unread_total() == 2


@pytest.mark.asyncio
async def test_never_opened_chat_counts_from_zero_when_server_unread_is_unknown(
    env,
) -> None:
    _write_member(env, REL, [{"id": i} for i in range(1, 5)])
    assert await unread_total() == 4  # no stored state, no server snapshot: uncapped


@pytest.mark.asyncio
async def test_never_opened_chat_is_capped_by_server_unread(env) -> None:
    _write_member(env, REL, [{"id": i} for i in range(1, 11)])
    _server_unread(env, DISPLAY, {"34": 3})
    assert await unread_total() == 3


@pytest.mark.asyncio
async def test_stored_state_is_capped_by_server_unread(env) -> None:
    _write_member(env, REL, [{"id": i} for i in range(1, 11)])
    _server_unread(env, DISPLAY, {"34": 2})
    _read(REL, last_read_id=3)  # 7 local
    assert await unread_total() == 2


@pytest.mark.asyncio
async def test_server_unread_never_raises_the_local_count(env) -> None:
    _write_member(env, REL, [{"id": i} for i in range(1, 6)])
    _server_unread(env, DISPLAY, {"34": 50})
    _read(REL, last_read_id=3)
    assert await unread_total() == 2


@pytest.mark.asyncio
async def test_server_unread_zero_clears_the_chat(env) -> None:
    _write_member(env, REL, [{"id": i} for i in range(1, 6)])
    _server_unread(env, DISPLAY, {"34": 0})
    _read(REL)
    assert await unread_total() == 0


@pytest.mark.asyncio
async def test_null_server_unread_is_uncapped(env) -> None:
    _write_member(env, REL, [{"id": i} for i in range(1, 6)])
    _server_unread(env, DISPLAY, {"34": None})
    _read(REL, last_read_id=1)
    assert await unread_total() == 4


@pytest.mark.asyncio
async def test_group_chat_uses_the_room_path_and_sums_all_member_dirs(env) -> None:
    _write_room(env)
    _read(ROOM, last_read_id=1)
    assert await unread_total() == 2


@pytest.mark.asyncio
async def test_single_member_room_in_group_chat_ids_uses_the_room_path(env) -> None:
    """A room listed in GROUP_CHAT_IDS counts as a group chat even with one sender."""
    _write_member(env, f"{ROOM}/1 A", [{"id": 1}, {"id": 2}])
    # Keyed by the room folder, as the sidebar does; a state stored under the
    # lone sender's folder must not apply.
    _read(ROOM, last_read_id=1)
    _read(f"{ROOM}/1 A", last_read_id=99)
    assert await unread_total() == 1


@pytest.mark.asyncio
async def test_group_chat_is_capped_by_server_unread(env) -> None:
    _write_room(env)
    _server_unread(env, DISPLAY, {"43": 1})
    _read(ROOM)
    assert await unread_total() == 1


@pytest.mark.asyncio
async def test_graduated_group_chat_is_not_counted(env) -> None:
    _write_room(env)
    (env / DISPLAY / "sync_metadata.json").write_text(
        json.dumps({"groups": {}, "server_groups": {"43": {"state": "closed"}}}),
        encoding="utf-8",
    )
    assert await unread_total() == 0


@pytest.mark.asyncio
async def test_a_state_stored_under_a_member_folder_does_not_apply_to_a_group_chat(
    env,
) -> None:
    _write_room(env)
    _read(f"{ROOM}/1 A", last_read_id=99)
    assert await unread_total() == 3  # the sidebar keys a group chat by the room


@pytest.mark.asyncio
async def test_sums_across_conversations_and_services(env) -> None:
    second = f"{DISPLAY}/messages/35 小坂 菜緒/59 小坂 菜緒"
    third = "櫻坂46/messages/12 X/7 X"
    _write_member(env, REL, [{"id": 1}, {"id": 2}])
    _write_member(env, second, [{"id": 5}])
    _write_member(env, third, [{"id": 9}, {"id": 10}])
    _read(REL)
    _read(second, last_read_id=5)
    _read(third, last_read_id=9)
    assert await unread_total() == 2 + 0 + 1


@pytest.mark.asyncio
async def test_same_group_id_in_two_services_uses_its_own_state_and_cap(env) -> None:
    hinata = "日向坂46/messages/12 X/7 X"
    sakura = "櫻坂46/messages/12 Y/8 Y"
    _write_member(env, hinata, [{"id": 1}, {"id": 2}])
    _write_member(env, sakura, [{"id": 1}, {"id": 2}, {"id": 3}])
    _server_unread(env, "櫻坂46", {"12": 1})
    _read(hinata, last_read_id=1)
    assert await unread_total() == 1 + 1


@pytest.mark.asyncio
async def test_output_dir_and_database_are_read_off_the_event_loop(
    env, monkeypatch
) -> None:
    """get_output_dir() reads settings.json and app_state reads SQLite: worker thread."""
    import threading

    seen: list[int] = []

    def resolve():
        seen.append(threading.get_ident())
        return env

    real_all = app_state.get_all_conversations

    def all_rows():
        seen.append(threading.get_ident())
        return real_all()

    monkeypatch.setattr(unread_summary, "get_output_dir", resolve)
    monkeypatch.setattr(app_state, "get_all_conversations", all_rows)
    assert await unread_total() == 0
    assert len(seen) == 2 and threading.get_ident() not in seen


@pytest.mark.asyncio
async def test_nothing_synced_is_zero(env) -> None:
    assert await unread_total() == 0


@pytest.mark.asyncio
async def test_unrelated_and_stale_rows_are_ignored(env) -> None:
    (env / DISPLAY / "messages").mkdir(parents=True)
    _write_member(env, "unknown service/messages/1 X/1 X", [{"id": 1}])
    _read(f"{DISPLAY}/messages/999 Gone/1 Gone", last_read_id=3)  # no such folder
    app_state.set_conversation("sakadesk_scroll_58", {"value": "12"})
    app_state.set_conversation("bg_settings_x", {"value": "{}"})
    assert await unread_total() == 0


@pytest.mark.asyncio
async def test_a_row_without_a_value_counts_from_zero(env) -> None:
    _write_member(env, REL, [{"id": i} for i in range(1, 4)])
    app_state.set_conversation(f"read_state_{REL}", {"value": None})
    assert await unread_total() == 3


@pytest.mark.asyncio
async def test_missing_last_read_id_or_revealed_ids_default_like_the_sidebar(
    env,
) -> None:
    _write_member(env, REL, [{"id": i} for i in range(1, 4)])
    app_state.set_conversation(f"read_state_{REL}", {"value": json.dumps({})})
    assert await unread_total() == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("legacy", ["12345", '"12345"', "true", "[1, 2, 3]", "0"])
async def test_non_object_json_counts_from_zero_like_the_sidebar(env, legacy) -> None:
    _write_member(env, REL, [{"id": i} for i in range(1, 4)])
    app_state.set_conversation(f"read_state_{REL}", {"value": legacy})
    with capture_logs() as logs:
        assert await unread_total() == 3
    assert not [e for e in logs if e["event"] == "tray_tooltip_state_skipped"]
    (event,) = [e for e in logs if e["event"] == "tray_tooltip_state_defaulted"]
    assert event["reason"] == "non_object"
    assert event["count"] == 1


@pytest.mark.asyncio
async def test_json_null_row_is_skipped_like_the_sidebar_and_logged(env) -> None:
    other = f"{DISPLAY}/messages/35 小坂 菜緒/59 小坂 菜緒"
    _write_member(env, REL, [{"id": 1}, {"id": 2}])
    _write_member(env, other, [{"id": 5}])
    app_state.set_conversation(f"read_state_{REL}", {"value": "null"})
    with capture_logs() as logs:
        assert await unread_total() == 1  # null.lastReadId throws in the sidebar
    (event,) = [e for e in logs if e["event"] == "tray_tooltip_state_skipped"]
    assert event["count"] == 1


@pytest.mark.asyncio
async def test_falsy_or_null_fields_default_like_the_sidebar(env) -> None:
    _write_member(env, REL, [{"id": i} for i in range(1, 4)])
    value = json.dumps({"lastReadId": None, "revealedIds": None})
    app_state.set_conversation(f"read_state_{REL}", {"value": value})
    assert await unread_total() == 3


@pytest.mark.asyncio
async def test_an_unparsable_row_is_skipped_like_the_sidebar_and_logged(env) -> None:
    other = f"{DISPLAY}/messages/35 小坂 菜緒/59 小坂 菜緒"
    _write_member(env, REL, [{"id": 1}, {"id": 2}])
    _write_member(env, other, [{"id": 5}])
    app_state.set_conversation(f"read_state_{REL}", {"value": "{not json 金村"})
    with capture_logs() as logs:
        assert await unread_total() == 1  # only the readable conversation counts
    (event,) = [e for e in logs if e["event"] == "tray_tooltip_state_skipped"]
    assert event["count"] == 1
    assert "金村" not in repr(logs)


@pytest.mark.asyncio
async def test_missing_output_dir_is_zero(env, monkeypatch) -> None:
    monkeypatch.setattr(unread_summary, "get_output_dir", lambda: env / "nope")
    _read(REL)
    assert await unread_total() == 0


@pytest.mark.asyncio
async def test_store_failure_returns_none_and_logs_the_error_type(
    env, monkeypatch
) -> None:
    def boom():
        raise RuntimeError("secret 金村")

    monkeypatch.setattr(app_state, "get_all_conversations", boom)
    with capture_logs() as logs:
        assert await unread_total() is None  # unknown, never "nothing unread"
    (event,) = [e for e in logs if e["event"] == "tray_tooltip_failed"]
    assert event["error_type"] == "RuntimeError"
    assert "金村" not in repr(logs)


@pytest.mark.asyncio
async def test_scan_failure_returns_none_and_logs_the_error_type(
    env, monkeypatch
) -> None:
    _write_member(env, REL, [{"id": 1}])

    def boom(*_a, **_k):
        raise OSError("disk 金村")

    monkeypatch.setattr("backend.api.content._list_group_refs", boom)
    with capture_logs() as logs:
        assert await unread_total() is None
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
