"""Release-build preflight: assert pysaka is pinned exactly (XREPO-01).

Release builds run ``uv sync --no-sources``, which ignores the editable
``../pysaka`` sibling and the lock and re-resolves pysaka from PyPI. With an
unbounded ``pysaka>=X.Y.Z`` floor that means "the same release" can ship three
different pysaka contents (dev sibling in local testing, whatever PyPI's newest
release is in CI, and a *different* newest on any future rebuild of an old
tag) -- non-reproducible releases whose changelog can assert pysaka behavior
the shipped artifact does not have.

For a tagged release this preflight therefore requires the pysaka dependency in
``pyproject.toml`` to be pinned with ``==`` and asserts the pysaka version uv
actually resolved matches that pin. Run by ``.github/workflows/build.yml`` only
on tag builds; dev/main builds are unaffected.

Exit code 0 on success, 1 on any mismatch (fails the build).
"""

from __future__ import annotations

import re
import sys
import tomllib
from importlib.metadata import PackageNotFoundError, version as installed_version
from pathlib import Path
from typing import NoReturn

PYPROJECT_TOML = Path(__file__).parent.parent.parent / "pyproject.toml"

# Matches a dependency string that names pysaka (start of string, followed by a
# version operator, whitespace, an extras/marker separator, or end of string).
_PYSAKA_DEP = re.compile(r"^pysaka(\s|[<>=!~;\[]|$)")
# The required exact pin form: pysaka==X.Y.Z[...] (no floor/ceiling operators).
_EXACT_PIN = re.compile(r"^pysaka\s*==\s*([0-9][^,;\s]*)$")


def get_pinned_version(pyproject_path: Path = PYPROJECT_TOML) -> str:
    """Return the exactly-pinned pysaka version, or exit(1) if not pinned.

    Raises SystemExit(1) (via ``_fail``) when pysaka is absent or is not an
    exact ``==`` pin (e.g. the default unbounded ``pysaka>=0.4.2``).
    """
    data = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))
    deps = data.get("project", {}).get("dependencies", [])
    spec = next((d for d in deps if _PYSAKA_DEP.match(d.strip())), None)
    if spec is None:
        _fail("pysaka is not listed in [project].dependencies")
    match = _EXACT_PIN.match(spec.strip())
    if not match:
        _fail(
            "pysaka must be pinned with '==' for a release build "
            f"(so the artifact is reproducible), got: {spec!r}"
        )
    return match.group(1)


def _fail(message: str) -> NoReturn:
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    pin = get_pinned_version()
    try:
        resolved = installed_version("pysaka")
    except PackageNotFoundError:
        _fail("pysaka is not installed; did `uv sync` run?")
    if resolved != pin:
        _fail(
            f"resolved pysaka ({resolved}) does not match the pin in "
            f"pyproject.toml ({pin})"
        )
    print(f"pysaka pinned and resolved to {pin}")


if __name__ == "__main__":
    main()
