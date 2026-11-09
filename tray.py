"""System tray icon for SakaDesk (Windows only).

``TrayController`` wraps ``pystray``: an icon with a localized menu (Open,
Sync now, Quit), a tooltip and a login-needed badge (:meth:`TrayController.set_alert`). ``pystray`` and ``PIL`` are imported lazily
inside :meth:`TrayController.start`, so Linux CI and dev runs never import
them; there the tray reports itself unavailable.

Menu labels are callables that read the current UI language, but on Windows
pystray builds the native menu only when it is created and again on
``update_menu``. A language change therefore shows up after the next menu action
or the next :meth:`TrayController.set_tooltip` call (which rebuilds the menu
through :meth:`TrayController.refresh_menu`), not instantly.

Menu callbacks run on pystray's thread. They are wrapped so they never raise,
and each logs ``tray_click`` (``item``). :meth:`TrayController.start` logs
``tray`` with ``action=started``, ``unavailable`` (``reason``) or ``failed``
(``error_type``). Menu text and paths are never logged.
"""

from __future__ import annotations

import importlib
import platform
import sys
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

ICON_NAME = "SakaDesk"
# NOTIFYICONDATA.szTip holds 128 UTF-16 units including the terminator.
MAX_TOOLTIP_LENGTH = 127
MENU_LABEL_KEYS = ("open", "sync_now", "quit")

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


def _alert_image(base: Any) -> Any:
    """The tray icon with an amber warning dot at the bottom right (login needed).

    The tray is a native surface outside the web design system, so the colour
    is a literal RGB tuple (the semantic warning amber).
    """
    from PIL import ImageDraw

    img = base.convert("RGBA").copy()
    w, h = img.size
    r = max(4, w // 4)
    draw = ImageDraw.Draw(img)
    draw.ellipse(
        (w - 2 * r - 1, h - 2 * r - 1, w - 1, h - 1),
        fill=(217, 119, 6, 255),
        outline=(255, 255, 255, 255),
        width=max(1, w // 32),
    )
    return img


class TrayController:
    """The tray icon and its menu. One instance per process."""

    def __init__(
        self,
        *,
        strings: Mapping[str, str] | Callable[[], Mapping[str, str]],
        on_open: Callable[[], None],
        on_sync_now: Callable[[], None],
        on_quit: Callable[[], None],
        icon_factory: Callable[[], Any] | None = None,
    ) -> None:
        # A callable is re-evaluated for every label, so the menu follows the
        # current UI language; a mapping is fixed.
        self._strings = strings
        self._on_open = on_open
        self._on_sync_now = on_sync_now
        self._on_quit = on_quit
        self._icon_factory = icon_factory or _load_icon_image
        self._icon: Any = None
        # The image the icon was created with (restored when the alert clears).
        self._base_image: Any = None
        # The menu labels the pystray menu was last built with (None until started).
        self._built_labels: dict[str, str] | None = None

    @property
    def available(self) -> bool:
        """True once :meth:`start` succeeded and until :meth:`stop`."""
        return self._icon is not None

    def _label(self, key: str) -> str:
        """The label for ``key`` in the current language (the key if unavailable)."""
        try:
            strings = self._strings() if callable(self._strings) else self._strings
            return strings.get(key) or key
        except Exception as e:
            logger.warning("tray_label_failed", error_type=type(e).__name__)
            return key

    def _menu_labels(self) -> dict[str, str]:
        """The resolved label of every menu item, in the current language."""
        return {key: self._label(key) for key in MENU_LABEL_KEYS}

    def _dynamic_label(self, key: str) -> Callable[[Any], str]:
        """A pystray ``text(item)`` callable, evaluated whenever pystray builds the menu."""
        return lambda _item: self._label(key)

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
                    self._dynamic_label("open"),
                    self._wrap("open", self._on_open),
                    default=True,
                ),
                pystray.MenuItem(
                    self._dynamic_label("sync_now"),
                    self._wrap("sync_now", self._on_sync_now),
                ),
                pystray.MenuItem(
                    self._dynamic_label("quit"), self._wrap("quit", self._on_quit)
                ),
            )
            base_image = self._icon_factory()
            icon = pystray.Icon(
                ICON_NAME, base_image, self._label("tooltip_idle"), menu
            )
            icon.run_detached()
        except Exception as e:
            logger.warning("tray", action="failed", error_type=type(e).__name__)
            return
        self._icon = icon
        self._base_image = base_image
        self._built_labels = self._menu_labels()
        logger.info("tray", action="started")

    def refresh_menu(self) -> None:
        """Rebuild the menu only when its resolved labels changed. Never raises.

        pystray destroys and recreates the native menu on every rebuild, which
        can glitch a menu the user has open, so an unchanged label set (the
        common case: a tooltip update) is skipped. Logs ``tray
        action=menu_refreshed`` when a rebuild happens; after a failed rebuild
        the labels are not recorded, so the next call retries.
        """
        icon = self._icon
        if icon is None:
            logger.debug("tray_menu_refresh_skipped", reason="no_icon")
            return
        labels = self._menu_labels()
        if labels == self._built_labels:
            logger.debug("tray_menu_refresh_skipped", reason="unchanged")
            return
        try:
            icon.update_menu()
        except Exception as e:
            logger.warning("tray_menu_refresh_failed", error_type=type(e).__name__)
            return
        self._built_labels = labels
        logger.info("tray", action="menu_refreshed")

    def set_tooltip(self, text: str) -> None:
        """Set the hover text and refresh the menu labels if they changed.

        Never blocks or raises (called from the backend).
        """
        icon = self._icon
        if icon is None:
            logger.debug("tray_tooltip_skipped", reason="no_icon")
            return
        try:
            icon.title = text[:MAX_TOOLTIP_LENGTH]
        except Exception as e:
            logger.warning("tray_title_failed", error_type=type(e).__name__)
        self.refresh_menu()

    def set_alert(self, on: bool) -> None:
        """Show (or remove) the login-needed badge on the icon. Never raises.

        Logs ``tray_alert`` (``on``), ``tray_alert_skipped`` (``reason``) or
        ``tray_alert_failed`` (``error_type``).
        """
        icon = self._icon
        if icon is None or self._base_image is None:
            logger.debug("tray_alert_skipped", reason="no_icon")
            return
        try:
            icon.icon = _alert_image(self._base_image) if on else self._base_image
            logger.info("tray_alert", on=on)
        except Exception as e:
            logger.warning("tray_alert_failed", error_type=type(e).__name__)

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
