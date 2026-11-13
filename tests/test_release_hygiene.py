"""Release hygiene guards (security audit 2026-11-13).

``frontend/public`` is copied verbatim into ``frontend/dist`` and from there
into every installer, and the packaged app serves every file in it. Only real
UI assets may live there (a real paid-message export shipped from v0.1.0 to
0.5.0). The dependency list must also not pull in unrelated PyPI projects:
``tk`` on PyPI is TensorKit, not tkinter (tkinter ships with CPython).
"""

from __future__ import annotations

import importlib.util
import tomllib
from pathlib import Path
from types import ModuleType

import pytest

ROOT = Path(__file__).resolve().parent.parent
# frontend/dist allows these plus index.html, which Vite builds from frontend/index.html.
PUBLIC_ALLOWLIST = {"logo-192.png", "logo-32.png"}


def _build_windows() -> ModuleType:
    """tooling/windows/build_windows.py (not a package) loaded by path."""
    path = ROOT / "tooling" / "windows" / "build_windows.py"
    spec = importlib.util.spec_from_file_location("build_windows", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _ui_build(dist: Path) -> Path:
    (dist / "assets").mkdir(parents=True)
    (dist / "assets" / "index-abc123.js").write_text("x", encoding="utf-8")
    for name in ("index.html", "logo-192.png", "logo-32.png"):
        (dist / name).write_text("x", encoding="utf-8")
    return dist


def _dist_name(requirement: str) -> str:
    """Distribution name of a PEP 508 requirement string."""
    head = requirement.split(";", 1)[0]
    for sep in ("[", "=", ">", "<", "~", "!", " "):
        head = head.split(sep, 1)[0]
    return head.strip().lower()


def test_frontend_public_holds_only_allowlisted_assets():
    names = {p.name for p in (ROOT / "frontend" / "public").iterdir()}
    unexpected = sorted(names - PUBLIC_ALLOWLIST)
    assert not unexpected, f"unexpected files in frontend/public: {unexpected}"


def test_no_unrelated_tk_distribution_dependency():
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    names = {_dist_name(d) for d in pyproject["project"]["dependencies"]}
    assert "tk" not in names


def test_ci_checks_frontend_dist_contents():
    workflow = (ROOT / ".github" / "workflows" / "build.yml").read_text(
        encoding="utf-8"
    )
    assert "Verify frontend dist contents" in workflow


def test_dist_allowlist_is_public_plus_index_html():
    assert _build_windows().DIST_ALLOWED_FILES == PUBLIC_ALLOWLIST | {"index.html"}


def test_verify_frontend_dist_accepts_the_ui_build(tmp_path):
    _build_windows().verify_frontend_dist(_ui_build(tmp_path / "dist"))


@pytest.mark.parametrize(
    ("name", "is_dir"),
    [
        ("mock_messages.json", False),
        ("data", True),
        ("assets", False),  # a file where the assets directory belongs
        ("index.html", True),  # a directory where index.html belongs
    ],
)
def test_verify_frontend_dist_stops_on_anything_else(tmp_path, capsys, name, is_dir):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "logo-32.png").write_text("x", encoding="utf-8")
    if is_dir:
        (dist / name).mkdir()
    else:
        (dist / name).write_text("x", encoding="utf-8")
    with pytest.raises(SystemExit) as exc:
        _build_windows().verify_frontend_dist(dist)
    assert exc.value.code == 1
    error_line = capsys.readouterr().out.splitlines()[0]
    assert error_line == f"ERROR: unexpected entries in frontend/dist: {name}"


def test_build_exe_checks_dist_before_bundling(tmp_path, monkeypatch):
    build = _build_windows()
    dist = _ui_build(tmp_path / "frontend" / "dist")
    (dist / "mock_messages.json").write_text("[]", encoding="utf-8")
    calls: list = []
    monkeypatch.setattr(build, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(build, "run_command", lambda *a, **k: calls.append(a))
    with pytest.raises(SystemExit):
        build.build_exe()
    assert calls == []
