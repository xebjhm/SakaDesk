"""Only the user can change the archive root (security audit 2026-11-13,
backend/api/settings.py:output-dir-unvalidated-archive-trust-root).

A caller of POST /api/settings could set output_dir to any folder (the user's
profile, SakaDesk's app data) and then read files there through the media
routes. A new output_dir is now accepted only when the native folder picker
returned it in this process (once) or it is the default folder, and it must
pass output_dir_policy.check_output_dir. The saved value is accepted unchanged.
"""

from __future__ import annotations

import json
import sys
import threading
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.api import settings as settings_api
from backend.main import app
from backend.services import output_dir_policy
from backend.services.i18n import SUPPORTED, get_strings

client = TestClient(app)


@pytest.fixture
def settings_file(tmp_path, monkeypatch):
    path = tmp_path / "appdata" / "settings.json"
    path.parent.mkdir()
    path.write_text(
        json.dumps({"output_dir": str(tmp_path / "current"), "is_configured": True}),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "backend.services.settings_store.get_settings_path", lambda: path
    )
    monkeypatch.setattr(output_dir_policy, "get_app_data_dir", lambda: path.parent)
    monkeypatch.setattr(output_dir_policy, "_home", lambda: tmp_path / "home")
    monkeypatch.setattr(
        settings_api,
        "get_default_output_dir",
        lambda: str(tmp_path / "home" / "Documents" / "SakaDesk"),
    )
    output_dir_policy.clear_grants_for_tests()
    monkeypatch.setattr(settings_api, "_picker_cooldown_until", 0.0)
    yield path
    output_dir_policy.clear_grants_for_tests()


def _saved(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _pick(monkeypatch, chosen):
    """Make the native dialog return ``chosen`` (a str or None), then call the picker route."""
    monkeypatch.setattr(
        settings_api, "_ask_directory", lambda title, initialdir=None: chosen
    )
    return client.post("/api/settings/select-folder").json()


def test_a_folder_nobody_picked_is_refused_and_nothing_is_saved(
    settings_file, tmp_path
):
    before = settings_file.read_text(encoding="utf-8")
    for value in (
        str(tmp_path / "victimhome"),
        str(settings_file.parent),
        "\\\\attacker.invalid\\share",
        "/",
        "",
        "relative",
    ):
        with capture_logs() as logs:
            response = client.post(
                "/api/settings", json={"output_dir": value, "auto_sync_enabled": False}
            )
        assert response.status_code == 400
        assert response.json()["detail"] == {
            "code": "output_dir_rejected",
            "reason": "not_picked",
        }
        assert settings_file.read_text(encoding="utf-8") == before
        rejected = [e for e in logs if e["event"] == "output_dir_rejected"]
        assert [(e["reason"], e["source"]) for e in rejected] == [("not_picked", "api")]
        assert str(tmp_path) not in str(logs) and "attacker" not in str(logs)


def test_a_picked_folder_can_be_saved_once(settings_file, tmp_path, monkeypatch):
    chosen = tmp_path / "archive"
    chosen.mkdir()
    with capture_logs() as logs:
        assert _pick(monkeypatch, str(chosen)) == {"path": str(chosen)}
        response = client.post("/api/settings", json={"output_dir": str(chosen)})
    assert response.status_code == 200
    assert response.json()["output_dir"] == str(chosen)
    assert _saved(settings_file)["output_dir"] == str(chosen)
    assert [e["outcome"] for e in logs if e["event"] == "output_dir_picker"] == [
        "picked"
    ]
    assert [e["source"] for e in logs if e["event"] == "output_dir_accepted"] == [
        "picker"
    ]
    assert str(tmp_path) not in str(logs)
    # The pick is used up: once another folder is saved, it needs a new pick.
    other = tmp_path / "other"
    other.mkdir()
    _pick(monkeypatch, str(other))
    assert (
        client.post("/api/settings", json={"output_dir": str(other)}).status_code == 200
    )
    again = client.post("/api/settings", json={"output_dir": str(chosen)})
    assert again.status_code == 400
    assert again.json()["detail"]["reason"] == "not_picked"


def test_the_saved_folder_is_accepted_unchanged_without_checks(
    settings_file, monkeypatch
):
    legacy = "//nas/share/SakaDesk"
    settings_file.write_text(
        json.dumps({"output_dir": legacy, "is_configured": True}), encoding="utf-8"
    )

    def boom(_raw):
        raise AssertionError("the saved folder was checked")

    monkeypatch.setattr(output_dir_policy, "check_output_dir", boom)
    for posted in (legacy, legacy + "/"):
        response = client.post("/api/settings", json={"output_dir": posted})
        assert response.status_code == 200
        assert _saved(settings_file)["output_dir"] == legacy


def test_the_default_folder_is_accepted_without_a_pick(settings_file, tmp_path):
    default = tmp_path / "home" / "Documents" / "SakaDesk"
    settings_file.write_text(json.dumps({"is_configured": False}), encoding="utf-8")
    with capture_logs() as logs:
        response = client.post("/api/settings", json={"output_dir": str(default)})
    assert response.status_code == 200
    assert response.json()["is_configured"] is True
    assert default.is_dir()
    assert [e["source"] for e in logs if e["event"] == "output_dir_accepted"] == [
        "default"
    ]


def test_a_default_folder_that_breaks_a_rule_is_refused(settings_file, monkeypatch):
    def deny(_raw):
        raise output_dir_policy.OutputDirRejected("not_writable")

    monkeypatch.setattr(output_dir_policy, "check_output_dir", deny)
    default = settings_api.get_default_output_dir()
    before = settings_file.read_text(encoding="utf-8")
    response = client.post("/api/settings", json={"output_dir": default})
    assert response.status_code == 400
    assert response.json()["detail"]["reason"] == "not_writable"
    assert settings_file.read_text(encoding="utf-8") == before


@pytest.mark.parametrize(
    "pick,reason",
    [
        (lambda t: str(t / "home"), "profile"),
        (lambda t: str(t / "appdata"), "app_data"),
        (lambda t: "/", "root"),
    ],
)
def test_a_picked_folder_that_breaks_a_rule_is_refused_and_not_granted(
    settings_file, tmp_path, monkeypatch, pick, reason
):
    chosen = pick(tmp_path)
    with capture_logs() as logs:
        assert _pick(monkeypatch, chosen) == {"path": None, "error": reason}
    picker = [e for e in logs if e["event"] == "output_dir_picker"]
    assert [(e["outcome"], e.get("reason")) for e in picker] == [("rejected", reason)]
    response = client.post("/api/settings", json={"output_dir": chosen})
    assert response.json()["detail"]["reason"] == "not_picked"


def test_the_picker_reports_a_cancel(settings_file, monkeypatch):
    with capture_logs() as logs:
        assert _pick(monkeypatch, None) == {"path": None}
    assert [e["outcome"] for e in logs if e["event"] == "output_dir_picker"] == [
        "cancelled"
    ]


def test_the_picker_reports_a_missing_tkinter(settings_file, monkeypatch):
    def unavailable(title, initialdir=None):
        raise settings_api._PickerUnavailable()

    monkeypatch.setattr(settings_api, "_ask_directory", unavailable)
    assert client.post("/api/settings/select-folder").json() == {
        "path": None,
        "error": "unavailable",
    }


def test_a_dialog_failure_gives_a_code_not_the_error_text(settings_file, monkeypatch):
    def broken(title, initialdir=None):
        raise RuntimeError("C:\\Users\\victim secret detail")

    monkeypatch.setattr(settings_api, "_ask_directory", broken)
    with capture_logs() as logs:
        body = client.post("/api/settings/select-folder").json()
    assert body == {"path": None, "error": "failed"}
    assert "victim" not in str(logs)


def test_a_thread_that_cannot_start_releases_the_picker(settings_file, monkeypatch):
    def no_thread(title, initialdir=None):
        raise RuntimeError("can't start new thread")

    monkeypatch.setattr(settings_api, "_start_picker", no_thread)
    assert client.post("/api/settings/select-folder").json() == {
        "path": None,
        "error": "failed",
    }
    assert settings_api._picker_lock.acquire(blocking=False)
    settings_api._picker_lock.release()


def test_a_second_picker_is_refused_while_one_is_open(settings_file):
    assert settings_api._picker_lock.acquire(blocking=False)
    try:
        assert client.post("/api/settings/select-folder").json() == {
            "path": None,
            "error": "busy",
        }
    finally:
        settings_api._picker_lock.release()


def test_a_picker_left_open_times_out_and_stays_busy_until_closed(
    settings_file, monkeypatch
):
    closed = threading.Event()

    def slow(title, initialdir=None):
        closed.wait(5)
        return None

    monkeypatch.setattr(settings_api, "_PICKER_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(settings_api, "_ask_directory", slow)
    assert client.post("/api/settings/select-folder").json() == {
        "path": None,
        "error": "timeout",
    }
    assert client.post("/api/settings/select-folder").json() == {
        "path": None,
        "error": "busy",
    }
    closed.set()
    assert settings_api._picker_lock.acquire(timeout=5)
    settings_api._picker_lock.release()


def test_the_dialog_title_follows_the_ui_language(settings_file, monkeypatch):
    seen: list[str] = []
    monkeypatch.setattr(settings_api, "resolve_ui_language", lambda config: "ja")
    monkeypatch.setattr(
        settings_api,
        "_ask_directory",
        lambda title, initialdir=None: seen.append(title),
    )
    client.post("/api/settings/select-folder")
    assert seen == ["SakaDesk のデータ保存先フォルダを選択"]


@pytest.mark.parametrize("lang", SUPPORTED)
def test_every_language_has_a_picker_title(lang):
    path = Path(__file__).resolve().parent.parent / "i18n" / lang / "folder_picker.json"
    assert set(json.loads(path.read_text(encoding="utf-8"))) == {"title"}
    assert get_strings("folder_picker", lang)["title"].strip()


def test_ask_directory_uses_a_hidden_topmost_root(monkeypatch):
    tk = MagicMock()
    tk.filedialog.askdirectory.return_value = "C:/Users/x/Documents/SakaDesk"
    monkeypatch.setitem(sys.modules, "tkinter", tk)
    monkeypatch.setitem(sys.modules, "tkinter.filedialog", tk.filedialog)
    assert settings_api._ask_directory("T") == "C:/Users/x/Documents/SakaDesk"
    root = tk.Tk.return_value
    root.withdraw.assert_called_once_with()
    root.attributes.assert_called_once_with("-topmost", True)
    tk.filedialog.askdirectory.assert_called_once_with(
        title="T", mustexist=True, initialdir=None
    )
    root.destroy.assert_called_once_with()


def test_ask_directory_returns_none_for_a_cancel(monkeypatch):
    tk = MagicMock()
    tk.filedialog.askdirectory.return_value = ""
    monkeypatch.setitem(sys.modules, "tkinter", tk)
    monkeypatch.setitem(sys.modules, "tkinter.filedialog", tk.filedialog)
    assert settings_api._ask_directory("T") is None


def test_ask_directory_without_tkinter(monkeypatch):
    monkeypatch.setitem(sys.modules, "tkinter", None)
    with pytest.raises(settings_api._PickerUnavailable):
        settings_api._ask_directory("T")


def test_grants_keep_only_the_newest_picks():
    output_dir_policy.clear_grants_for_tests()
    try:
        for i in range(output_dir_policy.MAX_GRANTS + 2):
            output_dir_policy.grant(f"/picks/{i}")
        assert not output_dir_policy.has_grant("/picks/0")
        assert not output_dir_policy.has_grant("/picks/1")
        assert output_dir_policy.has_grant("/picks/2/")
        assert output_dir_policy.take_grant("/picks/2") == "/picks/2"
        assert output_dir_policy.take_grant("/picks/2") is None
    finally:
        output_dir_policy.clear_grants_for_tests()


def test_get_treats_a_spaces_only_saved_folder_as_the_default(settings_file, tmp_path):
    settings_file.write_text(
        json.dumps({"output_dir": "   ", "is_configured": True}), encoding="utf-8"
    )
    response = client.get("/api/settings")
    assert response.status_code == 200
    assert response.json()["output_dir"] == str(
        tmp_path / "home" / "Documents" / "SakaDesk"
    )


# ---- fix round 1 -----------------------------------------------------------


def test_ask_directory_opens_at_the_given_folder(monkeypatch):
    tk = MagicMock()
    tk.filedialog.askdirectory.return_value = ""
    monkeypatch.setitem(sys.modules, "tkinter", tk)
    monkeypatch.setitem(sys.modules, "tkinter.filedialog", tk.filedialog)
    settings_api._ask_directory("T", "C:/Archive")
    tk.filedialog.askdirectory.assert_called_once_with(
        title="T", mustexist=True, initialdir="C:/Archive"
    )


def test_ask_directory_destroys_the_root_when_the_dialog_raises(monkeypatch):
    tk = MagicMock()
    tk.filedialog.askdirectory.side_effect = RuntimeError("boom")
    monkeypatch.setitem(sys.modules, "tkinter", tk)
    monkeypatch.setitem(sys.modules, "tkinter.filedialog", tk.filedialog)
    with pytest.raises(RuntimeError):
        settings_api._ask_directory("T")
    tk.Tk.return_value.destroy.assert_called_once_with()


def test_the_picker_opens_at_the_saved_folder(settings_file, tmp_path, monkeypatch):
    seen: list = []
    monkeypatch.setattr(
        settings_api,
        "_ask_directory",
        lambda title, initialdir=None: seen.append(initialdir),
    )
    client.post("/api/settings/select-folder")
    assert seen == [str(tmp_path / "current")]


def test_the_picker_opens_at_the_default_when_nothing_is_saved(
    settings_file, tmp_path, monkeypatch
):
    settings_file.write_text("{}", encoding="utf-8")
    seen: list = []
    monkeypatch.setattr(
        settings_api,
        "_ask_directory",
        lambda title, initialdir=None: seen.append(initialdir),
    )
    client.post("/api/settings/select-folder")
    assert seen == [str(tmp_path / "home" / "Documents" / "SakaDesk")]


def test_the_dialog_runs_off_the_event_loop_thread(settings_file, monkeypatch):
    threads: list = []
    loop_thread: list = []

    def dialog(title, initialdir=None):
        threads.append(threading.get_ident())
        return None

    monkeypatch.setattr(settings_api, "_ask_directory", dialog)

    async def go():
        loop_thread.append(threading.get_ident())
        return await settings_api.select_folder()

    import asyncio

    asyncio.run(go())
    assert threads and threads[0] != loop_thread[0]


def test_a_cancel_starts_a_short_cooldown(settings_file, monkeypatch):
    now = [100.0]
    monkeypatch.setattr(settings_api, "_monotonic", lambda: now[0])
    calls: list = []
    monkeypatch.setattr(
        settings_api,
        "_ask_directory",
        lambda title, initialdir=None: calls.append(1),
    )
    assert client.post("/api/settings/select-folder").json() == {"path": None}
    with capture_logs() as logs:
        assert client.post("/api/settings/select-folder").json() == {
            "path": None,
            "error": "cooldown",
        }
    assert [e["outcome"] for e in logs if e["event"] == "output_dir_picker"] == [
        "cooldown"
    ]
    assert len(calls) == 1
    now[0] += settings_api._PICKER_COOLDOWN_SECONDS + 0.1
    assert client.post("/api/settings/select-folder").json() == {"path": None}
    assert len(calls) == 2


def test_a_pick_does_not_start_a_cooldown(settings_file, tmp_path, monkeypatch):
    chosen = tmp_path / "archive"
    chosen.mkdir()
    assert _pick(monkeypatch, str(chosen)) == {"path": str(chosen)}
    assert _pick(monkeypatch, str(chosen)) == {"path": str(chosen)}


@pytest.fixture
def fresh_settings_lock(monkeypatch):
    """A lock of this test's own: asyncio.run() in a concurrency test would
    otherwise tie the module-level settings lock to a loop that then closes."""
    import asyncio

    from backend.services import settings_store

    monkeypatch.setattr(settings_store, "_lock", asyncio.Lock())


def test_simultaneous_posts_use_one_grant_once(
    settings_file, tmp_path, monkeypatch, fresh_settings_lock
):
    import asyncio
    import time

    import httpx

    picked = tmp_path / "picked"
    picked.mkdir()
    output_dir_policy.grant(str(picked))
    real = output_dir_policy.check_output_dir

    def slow(raw):
        time.sleep(0.2)
        return real(raw)

    monkeypatch.setattr(output_dir_policy, "check_output_dir", slow)

    async def go():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as c:
            return await asyncio.gather(
                *[
                    c.post("/api/settings", json={"output_dir": str(picked)})
                    for _ in range(3)
                ]
            )

    responses = asyncio.run(go())
    codes = sorted(r.status_code for r in responses)
    assert codes == [200, 400, 400]
    for r in responses:
        if r.status_code == 400:
            assert r.json()["detail"]["reason"] == "not_picked"
    assert _saved(settings_file)["output_dir"] == str(picked)


def test_a_posted_old_value_cannot_undo_a_picker_save(
    settings_file, tmp_path, monkeypatch, fresh_settings_lock
):
    import asyncio

    import httpx

    old = _saved(settings_file)["output_dir"]
    newdir = tmp_path / "newpick"
    newdir.mkdir()
    output_dir_policy.grant(str(newdir))
    real_load = settings_api._store_load

    async def slow_load():
        config = await real_load()
        await asyncio.sleep(0.2)  # the stale read the old-value POST decides on
        return config

    async def go():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as c:
            monkeypatch.setattr(settings_api, "_store_load", slow_load)
            stale = asyncio.create_task(
                c.post(
                    "/api/settings",
                    json={"output_dir": old, "auto_sync_enabled": False},
                )
            )
            await asyncio.sleep(0.05)
            monkeypatch.setattr(settings_api, "_store_load", real_load)
            fresh = await c.post("/api/settings", json={"output_dir": str(newdir)})
            return fresh, await stale

    fresh, stale = asyncio.run(go())
    assert fresh.status_code == 200
    assert stale.status_code == 200
    assert _saved(settings_file)["output_dir"] == str(newdir)
    assert _saved(settings_file)["auto_sync_enabled"] is False


def test_posting_the_saved_folder_never_rewrites_it(settings_file, tmp_path):
    current = _saved(settings_file)["output_dir"]
    r = client.post(
        "/api/settings",
        json={"output_dir": current, "auto_sync_enabled": False},
    )
    assert r.status_code == 200
    saved = _saved(settings_file)
    assert saved["output_dir"] == current
    assert saved["is_configured"] is True
    assert saved["auto_sync_enabled"] is False


def test_the_picked_string_is_saved_not_the_request_text(
    settings_file, tmp_path, monkeypatch
):
    picked = tmp_path / "Archive"
    picked.mkdir()
    monkeypatch.setattr(
        output_dir_policy, "_key", lambda v: str(v).lower().replace("\\", "/")
    )
    output_dir_policy.grant(str(picked))
    r = client.post("/api/settings", json={"output_dir": str(picked).lower()})
    assert r.status_code == 200
    assert _saved(settings_file)["output_dir"] == str(picked)


def test_a_save_clears_the_remaining_grants(settings_file, tmp_path, monkeypatch):
    a = tmp_path / "a"
    b = tmp_path / "b"
    a.mkdir()
    b.mkdir()
    output_dir_policy.grant(str(a))
    output_dir_policy.grant(str(b))
    assert client.post("/api/settings", json={"output_dir": str(a)}).status_code == 200
    r = client.post("/api/settings", json={"output_dir": str(b)})
    assert r.status_code == 400
    assert r.json()["detail"]["reason"] == "not_picked"


def test_a_grant_expires(settings_file, tmp_path, monkeypatch):
    picked = tmp_path / "picked"
    picked.mkdir()
    now = [1000.0]
    monkeypatch.setattr(output_dir_policy, "_now", lambda: now[0])
    output_dir_policy.grant(str(picked))
    assert output_dir_policy.has_grant(str(picked))
    now[0] += output_dir_policy.GRANT_LIFETIME_SECONDS + 1
    assert not output_dir_policy.has_grant(str(picked))
    r = client.post("/api/settings", json={"output_dir": str(picked)})
    assert r.status_code == 400
    assert r.json()["detail"]["reason"] == "not_picked"


def test_take_grant_reports_whether_it_removed_one():
    output_dir_policy.clear_grants_for_tests()
    output_dir_policy.grant("/x/y")
    assert output_dir_policy.take_grant("/x/y") == "/x/y"
    assert output_dir_policy.take_grant("/x/y") is None
