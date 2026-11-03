"""Start SakaDesk at Windows sign-in, hidden in the tray.

The setting is one value under ``HKCU\\Software\\Microsoft\\Windows\\
CurrentVersion\\Run``: ``SakaDesk`` = ``"<exe>" --background``. It is only
managed for a frozen (installed) Windows build; a dev run logs
``autostart action=skipped_dev`` and touches nothing, so ``python desktop.py``
never registers a source checkout to start at login.

``winreg`` (Windows-only) is imported lazily inside :class:`WinregRegistry`;
tests and Linux CI inject a fake registry through the ``reg`` argument.

Every outcome is logged as ``autostart`` with ``action`` (``enabled``,
``disabled``, ``ok``, ``repaired``, ``skipped_dev`` or ``failed``) and, for a
failure, ``error_type``. Paths and registry data are never logged.
:func:`apply` and :func:`reconcile` never raise.
"""

from __future__ import annotations

import importlib
from pathlib import Path
from typing import Any, Protocol

import structlog

logger = structlog.get_logger(__name__)

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
VALUE_NAME = "SakaDesk"

ACTION_ENABLED = "enabled"
ACTION_DISABLED = "disabled"
ACTION_OK = "ok"
ACTION_REPAIRED = "repaired"
ACTION_SKIPPED_DEV = "skipped_dev"
ACTION_FAILED = "failed"


class RunRegistry(Protocol):
    """The three registry operations autostart needs (the test seam)."""

    def read(self) -> str | None:
        """The current Run value, or ``None`` when it is not set."""
        ...

    def write(self, data: str) -> None: ...

    def delete(self) -> None:
        """Remove the value; a value that is already gone is not an error."""
        ...


def _winreg() -> Any:
    """The stdlib ``winreg`` module (Windows only), imported on first use."""
    return importlib.import_module("winreg")


class WinregRegistry:
    """:class:`RunRegistry` over the stdlib ``winreg`` (Windows only)."""

    def read(self) -> str | None:
        winreg = _winreg()

        try:
            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_READ
            ) as key:
                value, _type = winreg.QueryValueEx(key, VALUE_NAME)
        except FileNotFoundError:
            return None
        return str(value)

    def write(self, data: str) -> None:
        winreg = _winreg()

        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE
        ) as key:
            winreg.SetValueEx(key, VALUE_NAME, 0, winreg.REG_SZ, data)

    def delete(self) -> None:
        winreg = _winreg()

        try:
            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE
            ) as key:
                winreg.DeleteValue(key, VALUE_NAME)
        except FileNotFoundError:
            pass


def build_command(exe: Path) -> str:
    """The Run value for ``exe``: the quoted path plus ``--background``."""
    return f'"{exe}" --background'


def _log(action: str, **extra: object) -> str:
    logger.info("autostart", action=action, **extra)
    return action


def _failed(exc: Exception) -> str:
    return _log(ACTION_FAILED, error_type=type(exc).__name__)


def apply(
    enabled: bool,
    *,
    frozen: bool,
    exe: Path,
    reg: RunRegistry | None = None,
) -> str:
    """Write (``enabled``) or delete the Run value. Never raises.

    Returns the logged action: ``enabled``, ``disabled``, ``skipped_dev``
    (not a frozen build) or ``failed``.
    """
    if not frozen:
        return _log(ACTION_SKIPPED_DEV)
    try:
        registry = reg if reg is not None else WinregRegistry()
        if enabled:
            registry.write(build_command(exe))
            return _log(ACTION_ENABLED)
        registry.delete()
        return _log(ACTION_DISABLED)
    except Exception as e:
        return _failed(e)


def reconcile(
    enabled: bool,
    *,
    frozen: bool,
    exe: Path,
    reg: RunRegistry | None = None,
) -> str:
    """Make the Run value match the setting (run at startup). Never raises.

    When ``enabled``, a missing value or one pointing elsewhere (the app was
    moved) is rewritten (``repaired``). When disabled, a leftover value is
    removed (``disabled``). Otherwise nothing changes (``ok``). Also returns
    ``skipped_dev`` or ``failed`` like :func:`apply`.
    """
    if not frozen:
        return _log(ACTION_SKIPPED_DEV)
    try:
        registry = reg if reg is not None else WinregRegistry()
        current = registry.read()
        if enabled:
            wanted = build_command(exe)
            if current == wanted:
                return _log(ACTION_OK)
            registry.write(wanted)
            return _log(ACTION_REPAIRED)
        if current is None:
            return _log(ACTION_OK)
        registry.delete()
        return _log(ACTION_DISABLED)
    except Exception as e:
        return _failed(e)
