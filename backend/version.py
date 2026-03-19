"""Single source of truth for SakaDesk app version, read from pyproject.toml."""

import sys
from pathlib import Path

try:
    from importlib.metadata import version
    APP_VERSION = version("zakadesk")
except Exception:
    # Fallback: parse pyproject.toml directly (dev mode or PyInstaller bundle)
    import tomllib
    # PyInstaller extracts bundled data to sys._MEIPASS
    _base = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent.parent))
    _pyproject = _base / "pyproject.toml"
    with open(_pyproject, "rb") as f:
        APP_VERSION = tomllib.load(f)["project"]["version"]
