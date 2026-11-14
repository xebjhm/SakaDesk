"""Release hygiene guards (security audit 2026-11-13).

``frontend/public`` is copied verbatim into ``frontend/dist`` and from there
into every installer, and the packaged app serves every file in it. Only real
UI assets may live there (a real paid-message export shipped from v0.1.0 to
0.5.0). The dependency list must also not pull in unrelated PyPI projects:
``tk`` on PyPI is TensorKit, not tkinter (tkinter ships with CPython).
"""

from __future__ import annotations

import importlib.util
import subprocess
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


def test_ci_builds_through_the_dist_gate_once():
    """The dist allowlist lives in build_windows.verify_frontend_dist (tested below);
    the CI build runs that script, and no second copy of the rule exists in CI."""
    workflow = (ROOT / ".github" / "workflows" / "build.yml").read_text(
        encoding="utf-8"
    )
    assert "python tooling/windows/build_windows.py" in workflow
    assert "Verify frontend dist contents" not in workflow


def test_the_spec_ships_no_tests_and_no_debug_bootloader():
    """report-hardening #7 and #74 (audit 2026-11-13)."""
    spec = (ROOT / "tooling" / "build_windows.spec").read_text(encoding="utf-8")
    assert "debug=False" in spec and "debug=True" not in spec
    assert "excludes=['backend.tests']" in spec
    assert "exclude_datas=['tests/**']" in spec


def test_the_local_build_uses_the_locked_build_tools():
    """report-hardening #8 and OD-7: build.ps1 builds with the locked build group."""
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    pins = pyproject["dependency-groups"]["build"]
    assert sorted(p.split("==")[0] for p in pins) == ["pyinstaller", "pywebview"]
    assert all("==" in pin for pin in pins)
    build_ps1 = (ROOT / "build.ps1").read_text(encoding="utf-8")
    assert "'--group', 'build'" in build_ps1
    assert "'--with'" not in build_ps1


def test_the_ci_build_tools_come_from_the_locked_build_group():
    """OD-7: no `uv pip install` in CI; the build job syncs the `build` group."""
    workflow = (ROOT / ".github" / "workflows" / "build.yml").read_text(
        encoding="utf-8"
    )
    assert "uv pip install" not in workflow
    assert "uv sync --no-sources --group build" in workflow
    lock = tomllib.loads((ROOT / "uv.lock").read_text(encoding="utf-8"))
    locked = {p["name"]: p["version"] for p in lock["package"]}
    assert locked["pyinstaller"] == "6.13.0"
    assert locked["pywebview"] == "5.3.2"


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


def test_ci_runs_the_security_e2e_specs_before_building():
    """Plan D2 Decision 11: CSP / eval, launch token and entry flow in a real browser."""
    workflow = (ROOT / ".github" / "workflows" / "build.yml").read_text(
        encoding="utf-8"
    )
    assert "\n  e2e:\n" in workflow
    for spec in (
        "e2e/csp.spec.ts",
        "e2e/launch-auth.spec.ts",
        "e2e/entry-flow.spec.ts",
    ):
        assert spec in workflow
    assert "needs: [lint, test-backend, test-frontend, e2e]" in workflow
    assert "SAKADESK_E2E_UV_RUN: uv run --no-sources" in workflow
    assert "SAKADESK_DATA_DIR=" in workflow


def test_the_build_stops_without_the_update_signature_checker(tmp_path, capsys):
    """Plan E: cryptography is imported lazily, so only this gate catches a packaging slip."""
    app = tmp_path / "SakaDesk"
    (app / "_internal").mkdir(parents=True)
    with pytest.raises(SystemExit) as exc:
        _build_windows().verify_update_verifier_bundled(app)
    assert exc.value.code == 1
    assert capsys.readouterr().out.startswith("ERROR: the update signature checker")


def test_the_build_accepts_a_bundled_signature_checker(tmp_path):
    bindings = (
        tmp_path / "SakaDesk" / "_internal" / "cryptography" / "hazmat" / "bindings"
    )
    bindings.mkdir(parents=True)
    (bindings / "_rust.pyd").write_bytes(b"x")
    _build_windows().verify_update_verifier_bundled(tmp_path / "SakaDesk")


def test_build_exe_checks_the_bundle_after_pyinstaller(tmp_path, monkeypatch):
    build = _build_windows()
    _ui_build(tmp_path / "frontend" / "dist")
    calls: list = []
    monkeypatch.setattr(build, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(build, "DIST_DIR", tmp_path / "dist")
    monkeypatch.setattr(build, "run_command", lambda *a, **k: calls.append(a))
    with pytest.raises(SystemExit):
        build.build_exe()
    assert len(calls) == 1  # PyInstaller ran, then the bundle gate stopped the build


def _bundle(tmp_path):
    bindings = (
        tmp_path
        / "dist"
        / "SakaDesk"
        / "_internal"
        / "cryptography"
        / "hazmat"
        / "bindings"
    )
    bindings.mkdir(parents=True)
    (bindings / "_rust.pyd").write_bytes(b"x")


def _patch_build(build, monkeypatch, tmp_path, events):
    monkeypatch.setattr(build, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(build, "DIST_DIR", tmp_path / "dist")
    monkeypatch.setattr(
        build, "run_command", lambda *a, **k: events.append("pyinstaller")
    )


def test_build_exe_self_checks_after_pyinstaller_and_the_bundle_gate(
    tmp_path, monkeypatch
):
    """OD-6: PyInstaller, then the bundle gate, then the self-check."""
    build = _build_windows()
    _ui_build(tmp_path / "frontend" / "dist")
    _bundle(tmp_path)
    events: list = []
    _patch_build(build, monkeypatch, tmp_path, events)
    real_gate = build.verify_update_verifier_bundled
    monkeypatch.setattr(
        build,
        "verify_update_verifier_bundled",
        lambda app: (events.append("gate"), real_gate(app))[1],
    )

    def fake_run(cmd, **kwargs):
        events.append(("self-check", cmd, kwargs["timeout"]))
        return subprocess.CompletedProcess(cmd, 0)

    monkeypatch.setattr(build.subprocess, "run", fake_run)
    build.build_exe()
    expected = str(tmp_path / "dist" / "SakaDesk" / "SakaDesk.exe")
    assert events == [
        "pyinstaller",
        "gate",
        ("self-check", [expected, "--self-check-updater"], 120),
    ]


@pytest.mark.parametrize("outcome", [1, "timeout"])
def test_the_build_stops_when_the_updater_self_check_fails(
    tmp_path, monkeypatch, capsys, outcome
):
    build = _build_windows()

    def fake_run(cmd, **kwargs):
        if outcome == "timeout":
            raise subprocess.TimeoutExpired(cmd, kwargs["timeout"])
        return subprocess.CompletedProcess(cmd, outcome)

    monkeypatch.setattr(build.subprocess, "run", fake_run)
    with pytest.raises(SystemExit) as exc:
        build.run_updater_self_check(tmp_path)
    assert exc.value.code == 1
    assert capsys.readouterr().out == (
        "ERROR: the update signature checker failed its self-check in the built app\n"
    )


def test_the_build_continues_when_the_updater_self_check_passes(tmp_path, monkeypatch):
    build = _build_windows()
    monkeypatch.setattr(
        build.subprocess, "run", lambda cmd, **kw: subprocess.CompletedProcess(cmd, 0)
    )
    build.run_updater_self_check(tmp_path)
