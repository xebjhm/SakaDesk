"""Sync version from pyproject.toml to frontend/package.json.

Usage:
    python tooling/bump_version.py           # sync current version
    python tooling/bump_version.py 0.3.0     # set specific version in both files
"""

import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYPROJECT = ROOT / "pyproject.toml"
PACKAGE_JSON = ROOT / "frontend" / "package.json"


def read_pyproject_version() -> str:
    with open(PYPROJECT, "rb") as f:
        data = tomllib.load(f)
    return data["project"]["version"]


def set_pyproject_version(version: str) -> None:
    text = PYPROJECT.read_text(encoding="utf-8")
    text = re.sub(
        r'^version\s*=\s*"[^"]*"',
        f'version = "{version}"',
        text,
        count=1,
        flags=re.MULTILINE,
    )
    PYPROJECT.write_text(text, encoding="utf-8")


def set_package_json_version(version: str) -> None:
    text = PACKAGE_JSON.read_text(encoding="utf-8")
    text = re.sub(
        r'"version"\s*:\s*"[^"]*"',
        f'"version": "{version}"',
        text,
        count=1,
    )
    PACKAGE_JSON.write_text(text, encoding="utf-8")


def main() -> None:
    if len(sys.argv) > 1:
        version = sys.argv[1].lstrip("v")
        set_pyproject_version(version)
        set_package_json_version(version)
        print(f"Set version to {version} in pyproject.toml and package.json")
    else:
        version = read_pyproject_version()
        set_package_json_version(version)
        print(f"Synced package.json to {version} from pyproject.toml")


if __name__ == "__main__":
    main()
