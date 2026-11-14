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
