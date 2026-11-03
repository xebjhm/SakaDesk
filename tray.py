"""System tray icon for SakaDesk (Windows only).

``TrayController`` wraps ``pystray``: an icon with a localized menu (Open,
Sync now, Quit) and a tooltip. ``pystray`` and ``PIL`` are imported lazily
inside :meth:`TrayController.start`, so Linux CI and dev runs never import
them; there the tray reports itself unavailable.

Menu callbacks run on pystray's thread. They are wrapped so they never raise,
and each logs ``tray_click`` (``item``). :meth:`TrayController.start` logs
``tray`` with ``action=started``, ``unavailable`` (``reason``) or ``failed``
(``error_type``). Menu text and paths are never logged.
"""

from __future__ import annotations

import importlib
import platform
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

ICON_NAME = "SakaDesk"
# NOTIFYICONDATA.szTip holds 128 UTF-16 units including the terminator.
MAX_TOOLTIP_LENGTH = 127

_ICON_RELATIVE = Path("tooling") / "windows" / "SakaDesk.ico"


def icon_path() -> Path:
    """The tray icon file: bundled under ``assets`` when frozen, else the repo copy."""
    if getattr(sys, "frozen", False):
        base = getattr(sys, "_MEIPASS", None)
        if base:
            return Path(base) / "assets" / "SakaDesk.ico"
    return Path(__file__).resolve().parent / _ICON_RELATIVE


def _load_icon_image() -> Any:
    """Load the tray icon with Pillow (imported here, on first use)."""
    image_module = importlib.import_module("PIL.Image")
    return image_module.open(icon_path())


class TrayController:
    """The tray icon and its menu. One instance per process."""

    def __init__(
        self,
        *,
        strings: dict[str, str],
        on_open: Callable[[], None],
        on_sync_now: Callable[[], None],
        on_quit: Callable[[], None],
        icon_factory: Callable[[], Any] | None = None,
    ) -> None:
        self._strings = strings
        self._on_open = on_open
        self._on_sync_now = on_sync_now
        self._on_quit = on_quit
        self._icon_factory = icon_factory or _load_icon_image
        self._icon: Any = None

    @property
    def available(self) -> bool:
        """True once :meth:`start` succeeded and until :meth:`stop`."""
        return self._icon is not None

    def _label(self, key: str) -> str:
        return self._strings.get(key) or key

    def _wrap(self, item: str, callback: Callable[[], None]) -> Callable[..., None]:
        """A pystray action that logs the click and never raises."""

        def action(*_args: Any) -> None:
            logger.info("tray_click", item=item)
            try:
                callback()
            except Exception as e:
                logger.warning(
                    "tray_click_failed", item=item, error_type=type(e).__name__
                )

        return action

    def start(self) -> None:
        """Show the icon (``run_detached``, so pywebview's loop is not blocked).

        Never raises. Leaves :attr:`available` False when this is not Windows,
        ``pystray``/Pillow cannot be imported, or the icon cannot be created.
        """
        if self._icon is not None:
            logger.debug("tray", action="already_started")
            return
        if platform.system() != "Windows":
            logger.info("tray", action="unavailable", reason="not_windows")
            return
        try:
            pystray = importlib.import_module("pystray")
        except Exception as e:
            logger.warning(
                "tray",
                action="unavailable",
                reason="import_failed",
                error_type=type(e).__name__,
            )
            return
        try:
            menu = pystray.Menu(
                pystray.MenuItem(
                    self._label("open"), self._wrap("open", self._on_open), default=True
                ),
                pystray.MenuItem(
                    self._label("sync_now"), self._wrap("sync_now", self._on_sync_now)
                ),
                pystray.MenuItem(
                    self._label("quit"), self._wrap("quit", self._on_quit)
                ),
            )
            icon = pystray.Icon(
                ICON_NAME, self._icon_factory(), self._label("tooltip_idle"), menu
            )
            icon.run_detached()
        except Exception as e:
            logger.warning("tray", action="failed", error_type=type(e).__name__)
            return
        self._icon = icon
        logger.info("tray", action="started")

    def set_tooltip(self, text: str) -> None:
        """Set the hover text. Never blocks or raises (called from the backend)."""
        icon = self._icon
        if icon is None:
            logger.debug("tray_tooltip_skipped", reason="no_icon")
            return
        try:
            icon.title = text[:MAX_TOOLTIP_LENGTH]
        except Exception as e:
            logger.warning("tray_title_failed", error_type=type(e).__name__)

    def stop(self) -> None:
        """Remove the icon. Idempotent; never raises."""
        icon, self._icon = self._icon, None
        if icon is None:
            return
        try:
            icon.stop()
            logger.info("tray", action="stopped")
        except Exception as e:
            logger.warning("tray", action="stop_failed", error_type=type(e).__name__)
