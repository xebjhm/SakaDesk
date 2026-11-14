"""tooling/ci/check_locked_versions.py (hardening #3)."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parent.parent

LOCK = """
version = 1

[[package]]
name = "httpx"
version = "0.28.1"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "pysaka"
version = "0.4.8"
source = { editable = "../pysaka" }

[[package]]
name = "sakadesk"
version = "0.5.0"
source = { virtual = "." }

[[package]]
name = "typing-extensions"
version = "4.12.2"
source = { registry = "https://pypi.org/simple" }
"""


def _check() -> ModuleType:
    path = ROOT / "tooling" / "ci" / "check_locked_versions.py"
    spec = importlib.util.spec_from_file_location("check_locked_versions", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _drift(installed: dict[str, str], pin: str | None = "0.4.8") -> list[str]:
    check = _check()
    return check.drift(check.locked_versions(LOCK), installed, pin)


def test_a_matching_environment_passes():
    assert (
        _drift({"httpx": "0.28.1", "pysaka": "0.4.8", "typing-extensions": "4.12.2"})
        == []
    )


def test_names_are_compared_canonically():
    assert _check().canonical("Typing_Extensions") == "typing-extensions"


def test_a_different_version_is_reported():
    assert _drift({"httpx": "0.28.0"}) == ["httpx 0.28.0 != locked 0.28.1"]


def test_a_package_missing_from_the_lock_is_reported():
    assert _drift({"surprise": "1.0"}) == ["surprise 1.0 is not in uv.lock"]


def test_pysaka_must_match_its_pin():
    assert _drift({"pysaka": "0.4.9"}) == ["pysaka 0.4.9 != pin 0.4.8"]
    assert _drift({"pysaka": "0.4.8"}, pin=None) == ["pysaka is not pinned with =="]


def test_the_project_itself_is_ignored():
    assert _drift({"sakadesk": "0.5.0"}) == []


def test_the_pin_is_read_from_pyproject():
    check = _check()
    assert (
        check.pysaka_pin('[project]\ndependencies = ["httpx", "pysaka==0.4.8"]\n')
        == "0.4.8"
    )
    assert check.pysaka_pin('[project]\ndependencies = ["pysaka>=0.4"]\n') is None


def test_the_real_lock_parses():
    locked = _check().locked_versions((ROOT / "uv.lock").read_text(encoding="utf-8"))
    assert "fastapi" in locked and "cryptography" in locked


def _project(tmp_path: Path, module: ModuleType, monkeypatch, pin: str) -> None:
    (tmp_path / "uv.lock").write_text(LOCK, encoding="utf-8")
    (tmp_path / "pyproject.toml").write_text(
        f'[project]\ndependencies = ["httpx", "pysaka=={pin}"]\n', encoding="utf-8"
    )
    monkeypatch.setattr(module, "ROOT", tmp_path)


def test_main_exits_0_when_the_environment_matches(tmp_path, monkeypatch, capsys):
    module = _check()
    _project(tmp_path, module, monkeypatch, "0.4.8")
    monkeypatch.setattr(
        module,
        "installed_versions",
        lambda: {"httpx": "0.28.1", "pysaka": "0.4.8", "sakadesk": "0.5.0"},
    )
    assert module.main() == 0
    captured = capsys.readouterr()
    assert captured.out == "environment matches uv.lock\n"
    assert captured.err == ""


def test_main_exits_1_with_one_error_line_per_problem(tmp_path, monkeypatch, capsys):
    module = _check()
    _project(tmp_path, module, monkeypatch, "0.4.8")
    monkeypatch.setattr(
        module,
        "installed_versions",
        lambda: {"httpx": "0.28.0", "pysaka": "0.4.9", "surprise": "1.0"},
    )
    assert module.main() == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err.splitlines() == [
        "ERROR: httpx 0.28.0 != locked 0.28.1",
        "ERROR: pysaka 0.4.9 != pin 0.4.8",
        "ERROR: surprise 1.0 is not in uv.lock",
    ]


def test_installed_versions_returns_canonical_names_for_this_environment():
    versions = _check().installed_versions()
    assert versions  # this environment has distributions
    assert all(name == _check().canonical(name) for name in versions)
    assert all(isinstance(v, str) and v for v in versions.values())
    assert "pytest" in versions
