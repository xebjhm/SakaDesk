"""CI: fail when the synced environment differs from uv.lock (hardening #3).

CI syncs with ``uv sync --no-sources`` (pysaka from PyPI instead of the
editable ``../pysaka`` the lock records), which re-resolves instead of
installing the lock. uv prefers locked versions, but nothing enforced it.
This compares every installed distribution with ``uv.lock`` (the project
itself excepted) and pysaka with its ``==`` pin in ``pyproject.toml``. It
binds versions, not hashes (Plan E Decision 11).

    uv run --no-sources python tooling/ci/check_locked_versions.py

Exit code 0 when everything matches, 1 with one ``ERROR:`` line per problem.
"""

from __future__ import annotations

import re
import sys
import tomllib
from importlib.metadata import distributions
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IGNORED = frozenset({"sakadesk"})
_PIN = re.compile(r"^pysaka\s*==\s*([0-9][^,;\s]*)$")


def canonical(name: str) -> str:
    """PEP 503 normalised distribution name."""
    return re.sub(r"[-_.]+", "-", name).lower()


def locked_versions(lock_text: str) -> dict[str, str]:
    """{canonical name: version} for every package in a ``uv.lock``."""
    data = tomllib.loads(lock_text)
    return {
        canonical(p["name"]): p["version"]
        for p in data.get("package", [])
        if "name" in p and "version" in p
    }


def pysaka_pin(pyproject_text: str) -> str | None:
    """The ``==`` version pysaka is pinned to in ``pyproject.toml``, else None."""
    deps = tomllib.loads(pyproject_text).get("project", {}).get("dependencies", [])
    for dep in deps:
        match = _PIN.match(dep.strip())
        if match:
            return match.group(1)
    return None


def installed_versions() -> dict[str, str]:
    """{canonical name: version} of every distribution in this environment."""
    return {canonical(d.name): d.version for d in distributions() if d.name}


def drift(
    locked: dict[str, str], installed: dict[str, str], pin: str | None
) -> list[str]:
    """One line per installed distribution that the lock (or the pin) does not allow."""
    problems: list[str] = []
    for name, version in sorted(installed.items()):
        if name in IGNORED:
            continue
        if name == "pysaka":
            if pin is None:
                problems.append("pysaka is not pinned with ==")
            elif version != pin:
                problems.append(f"pysaka {version} != pin {pin}")
            continue
        want = locked.get(name)
        if want is None:
            problems.append(f"{name} {version} is not in uv.lock")
        elif want != version:
            problems.append(f"{name} {version} != locked {want}")
    return problems


def main() -> int:
    problems = drift(
        locked_versions((ROOT / "uv.lock").read_text(encoding="utf-8")),
        installed_versions(),
        pysaka_pin((ROOT / "pyproject.toml").read_text(encoding="utf-8")),
    )
    for problem in problems:
        sys.stderr.write(f"ERROR: {problem}\n")
    if problems:
        return 1
    sys.stdout.write("environment matches uv.lock\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
