"""Release hygiene guards (security audit 2026-11-13).

``frontend/public`` is copied verbatim into ``frontend/dist`` and from there
into every installer, and the packaged app serves every file in it. Only real
UI assets may live there (a real paid-message export shipped from v0.1.0 to
0.5.0). The dependency list must also not pull in unrelated PyPI projects:
``tk`` on PyPI is TensorKit, not tkinter (tkinter ships with CPython).
"""

from __future__ import annotations

import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_ALLOWLIST = {"logo-192.png", "logo-32.png"}


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
