"""desktop._register_app_identity wires the identity helpers by frozen state."""

from __future__ import annotations

import sys
from pathlib import Path

import desktop


def test_dev_run_only_ensures_with_frozen_false(monkeypatch) -> None:
    calls: list[tuple] = []
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.setattr(desktop, "set_process_aumid", lambda: calls.append(("aumid",)))
    monkeypatch.setattr(
        desktop,
        "ensure_start_menu_shortcut",
        lambda **kw: calls.append(("ensure", kw["frozen"])),
    )
    desktop._register_app_identity()
    assert calls == [("ensure", False)]


def test_frozen_sets_aumid_then_ensures_in_user_start_menu(monkeypatch) -> None:
    calls: list[tuple] = []
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setenv("APPDATA", "AppDataRoaming")
    monkeypatch.setattr(desktop, "set_process_aumid", lambda: calls.append(("aumid",)))
    monkeypatch.setattr(
        desktop, "ensure_start_menu_shortcut", lambda **kw: calls.append(("ensure", kw))
    )
    desktop._register_app_identity()
    assert calls[0] == ("aumid",)
    kw = calls[1][1]
    assert kw["frozen"] is True
    assert kw["exe"] == Path(sys.executable)
    assert kw["programs_dir"] == (
        Path("AppDataRoaming") / "Microsoft" / "Windows" / "Start Menu" / "Programs"
    )


def test_never_raises(monkeypatch) -> None:
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.delenv("APPDATA", raising=False)
    desktop._register_app_identity()  # KeyError swallowed
