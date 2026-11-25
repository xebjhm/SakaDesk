"""tooling/ci/pin_actions.py: SHA pins for actions and pre-commit hooks."""

from __future__ import annotations

import importlib.util
import subprocess
from pathlib import Path
from types import ModuleType

import pytest

ROOT = Path(__file__).resolve().parent.parent
A, B, C = "a" * 40, "b" * 40, "c" * 40


def _pin() -> ModuleType:
    path = ROOT / "tooling" / "ci" / "pin_actions.py"
    spec = importlib.util.spec_from_file_location("pin_actions", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


LS_REMOTE = "\n".join(
    [
        f"{A}\trefs/tags/v4",  # moving major tag (lightweight)
        f"{B}\trefs/tags/v4.2.2",  # annotated tag object ...
        f"{A}\trefs/tags/v4.2.2^{{}}",  # ... peeled to the commit
        f"{C}\trefs/tags/v4.2.1",
        f"{A}\trefs/heads/main",
    ]
)


def test_peeled_tags_resolve_to_commits():
    assert _pin().parse_ls_remote(LS_REMOTE) == {"v4": A, "v4.2.2": A, "v4.2.1": C}


def test_the_comment_names_the_most_specific_version_on_that_commit():
    assert _pin().pick(_pin().parse_ls_remote(LS_REMOTE), "v4") == (A, "v4.2.2")


def _fake(calls):
    def resolve(repo_url, ref):
        calls.append((repo_url, ref))
        return A, "v4.2.2"

    return resolve


def test_workflow_uses_are_pinned_and_local_or_pinned_ones_kept():
    text = (
        "    - uses: actions/checkout@v4\n"
        "      with:\n"
        "    - uses: ./.github/actions/local\n"
        f"    - uses: actions/setup-node@{C} # v4.1.0\n"
        "      uses: github/codeql-action/init@v3\n"
    )
    calls: list = []
    out, unpinned = _pin().pin_workflow(text, _fake(calls))
    assert unpinned == ["actions/checkout@v4", "github/codeql-action@v3"]
    assert f"    - uses: actions/checkout@{A} # v4.2.2\n" in out
    assert f"      uses: github/codeql-action/init@{A} # v4.2.2\n" in out
    assert "    - uses: ./.github/actions/local\n" in out
    assert f"    - uses: actions/setup-node@{C} # v4.1.0\n" in out
    assert calls == [
        ("https://github.com/actions/checkout", "v4"),
        ("https://github.com/github/codeql-action", "v3"),
    ]


def test_check_mode_reports_without_rewriting():
    text = "    - uses: actions/checkout@v4\n"
    out, unpinned = _pin().pin_workflow(text, None)
    assert out == text and unpinned == ["actions/checkout@v4"]


def test_pre_commit_hooks_are_frozen_without_a_version_change():
    text = (
        "repos:\n"
        "  - repo: https://github.com/pre-commit/pre-commit-hooks\n"
        "    rev: v5.0.0\n"
        "  - repo: local\n"
        "    hooks:\n"
        "      - id: mypy\n"
    )
    calls: list = []
    out, unpinned = _pin().pin_pre_commit(text, _fake(calls))
    assert unpinned == ["https://github.com/pre-commit/pre-commit-hooks@v5.0.0"]
    assert f"    rev: {A}  # frozen: v5.0.0\n" in out
    assert calls == [("https://github.com/pre-commit/pre-commit-hooks", "v5.0.0")]


def _project(tmp_path: Path, module: ModuleType, monkeypatch) -> tuple[Path, Path]:
    """A throwaway project with one workflow and one pre-commit file, wired into ``module``."""
    workflows = tmp_path / ".github" / "workflows"
    workflows.mkdir(parents=True)
    workflow = workflows / "ci.yml"
    workflow.write_text("    - uses: actions/checkout@v4\n", encoding="utf-8")
    hooks = tmp_path / ".pre-commit-config.yaml"
    hooks.write_text(
        "repos:\n  - repo: https://example.invalid/hooks\n    rev: v1.0.0\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(module, "WORKFLOWS", workflows)
    monkeypatch.setattr(module, "PRE_COMMIT", hooks)
    return workflow, hooks


def test_check_mode_reports_unpinned_references_and_exits_1(
    tmp_path, monkeypatch, capsys
):
    module = _pin()
    workflow, hooks = _project(tmp_path, module, monkeypatch)
    before = (workflow.read_text(encoding="utf-8"), hooks.read_text(encoding="utf-8"))

    def never() -> object:
        raise AssertionError("check mode must not resolve anything")

    assert module.main(["--check"], resolve_factory=never) == 1
    captured = capsys.readouterr()
    assert "UNPINNED: .github/workflows/ci.yml: actions/checkout@v4\n" in captured.err
    assert "UNPINNED: .pre-commit-config.yaml: " in captured.err
    assert captured.out == ""
    assert (
        workflow.read_text(encoding="utf-8"),
        hooks.read_text(encoding="utf-8"),
    ) == before


def test_check_mode_passes_when_everything_is_pinned(tmp_path, monkeypatch, capsys):
    module = _pin()
    workflow, hooks = _project(tmp_path, module, monkeypatch)
    workflow.write_text(f"    - uses: actions/checkout@{A} # v4\n", encoding="utf-8")
    hooks.write_text(
        f"repos:\n  - repo: https://example.invalid/hooks\n    rev: {B}  # frozen: v1\n",
        encoding="utf-8",
    )
    assert module.main(["--check"]) == 0
    assert capsys.readouterr().out == "checked: 0 unpinned reference(s)\n"


def test_rewrite_mode_pins_both_files(tmp_path, monkeypatch, capsys):
    module = _pin()
    workflow, hooks = _project(tmp_path, module, monkeypatch)
    calls: list = []
    assert module.main([], resolve_factory=lambda: _fake(calls)) == 0
    assert workflow.read_text(encoding="utf-8") == (
        f"    - uses: actions/checkout@{A} # v4.2.2\n"
    )
    assert f"    rev: {A}  # frozen: v1.0.0\n" in hooks.read_text(encoding="utf-8")
    assert calls == [
        ("https://github.com/actions/checkout", "v4"),
        ("https://example.invalid/hooks", "v1.0.0"),
    ]
    assert capsys.readouterr().out == "pinned: 2 unpinned reference(s)\n"


def test_git_resolver_asks_git_once_per_repository(monkeypatch):
    module = _pin()
    runs: list[list[str]] = []

    def fake_run(command, **kwargs):
        runs.append(command)
        assert kwargs["check"] is True and kwargs["encoding"] == "utf-8"
        return subprocess.CompletedProcess(command, 0, stdout=LS_REMOTE, stderr="")

    monkeypatch.setattr(module.subprocess, "run", fake_run)
    resolve = module.git_resolver()
    assert resolve("https://example.invalid/r", "v4") == (A, "v4.2.2")
    assert resolve("https://example.invalid/r", "v4.2.1") == (C, "v4.2.1")
    assert runs == [["git", "ls-remote", "--tags", "https://example.invalid/r"]]
    assert resolve("https://example.invalid/other", "v4") == (A, "v4.2.2")
    assert len(runs) == 2


def test_git_resolver_raises_for_an_unknown_ref(monkeypatch):
    module = _pin()
    monkeypatch.setattr(
        module.subprocess,
        "run",
        lambda command, **kwargs: subprocess.CompletedProcess(
            command, 0, stdout=LS_REMOTE, stderr=""
        ),
    )
    with pytest.raises(KeyError):
        module.git_resolver()("https://example.invalid/r", "v9")
