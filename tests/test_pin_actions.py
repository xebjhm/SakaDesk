"""tooling/ci/pin_actions.py: SHA pins for actions and pre-commit hooks."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

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
