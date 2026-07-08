"""SD-BE-SVC-10 — app_state SQLite off the event loop + safe RMW merge.

Every app-state call opens a fresh connection and does blocking SQLite I/O; on
the event loop that is a potential multi-second (busy_timeout) stall of the UI
backend. ``set_conversation``'s read-modify-write also spanned two separate
connections, so it was only race-free by accident (single event-loop thread).

These tests pin:
1. Async offload wrappers exist and run the blocking call via asyncio.to_thread.
2. ``set_conversation`` merges within a single connection and still preserves
   existing keys (including patches that set a value to null / None).
"""

import asyncio

from backend.services import app_state


def _fresh(tmp_path):
    app_state.set_db_path(tmp_path / "app_state.db")
    app_state.init_db()
    return app_state


def test_set_conversation_merges_and_preserves_none(tmp_path):
    """A partial patch keeps prior keys; a null value is stored as None (dict.update
    semantics), not treated as a delete."""
    s = _fresh(tmp_path)
    s.set_conversation("hina/1", {"scroll_msg_id": 42, "bg": "dark"})
    s.set_conversation("hina/1", {"bg": None})  # explicit null must set, not drop
    got = s.get_conversation("hina/1")
    assert got["scroll_msg_id"] == 42
    assert "bg" in got and got["bg"] is None


def test_async_wrappers_offload_to_thread(tmp_path):
    """The async wrappers run their blocking body via asyncio.to_thread."""
    s = _fresh(tmp_path)
    from unittest.mock import patch

    async def run():
        with patch(
            "backend.services.app_state.asyncio.to_thread",
            wraps=asyncio.to_thread,
        ) as mock_to_thread:
            await s.aset_conversation("a/1", {"read_up_to": 9})
            got = await s.aget_conversation("a/1")
            prefs = await s.aget_prefs()
            await s.aset_prefs({"language": "ja"})
            await s.aput_translations({"1:ja": "hi"})
            tr = await s.aget_translations(["1:ja"])
            allc = await s.aget_all_conversations()
            await s.aclear_translations()
            return got, prefs, tr, allc, mock_to_thread.call_count

    got, prefs, tr, allc, calls = asyncio.run(run())
    assert got == {"read_up_to": 9}
    assert prefs == {}  # before aset_prefs took effect in the same run order
    assert tr == {"1:ja": "hi"}
    assert allc == {"a/1": {"read_up_to": 9}}
    # One to_thread hop per wrapper call above (8 calls).
    assert calls == 8


def test_async_migrate_wrappers(tmp_path):
    s = _fresh(tmp_path)

    async def run():
        assert await s.ais_migrated() is False
        await s.amigrate_dump({"prefs": {"language": "yue"}})
        return await s.ais_migrated()

    assert asyncio.run(run()) is True
