"""Keep SakaDesk's windows on SakaDesk (security audit 2026-11-13,
``desktop.py/main-window/unrestricted-navigation-from-blog-links``).

The main window and the call popup have no address bar and no back button.
Without a policy, a link in remote blog content (or any script that sets
``location``) replaced the app with another site until SakaDesk quit, and
pywebview 5.3.2 handed every ``window.open`` / ``target=_blank`` URL, whatever
its scheme, to ``webbrowser.open``. This module gives both one policy
(:func:`decide`):

- a top-level navigation to the app's own origin (``http://127.0.0.1:<port>``)
  proceeds;
- any other ``http``/``https`` URL is cancelled in the window and opened in
  the default browser instead (:func:`open_external`, off the GUI thread);
- every other URL (``file:``, ``ms-settings:``, ``javascript:``, ``data:``,
  malformed, or longer than ``MAX_URL_LENGTH``) is cancelled and never opened;
- a new-window request never becomes a window: an external web URL goes to the
  browser as above, anything else (including the app's own URLs) is dropped.

Each refusal logs ``navigation_refused`` or ``new_window_refused`` with a
``reason`` code (``external_web``, ``app_origin``, ``scheme``, ``invalid``,
``unreadable``) and ``opened_externally``; an allowed navigation logs
``navigation_allowed`` at debug. URLs are never logged: the app's own URL
carries the launch token in its fragment.

pywebview 5.3.2 has no navigation API. :func:`install` replaces two methods of
its EdgeChromium (WebView2) backend class before any window exists:
``on_navigation_start`` (a no-op there, subscribed to every window's
``NavigationStarting``) and ``on_new_window_request`` (subscribed to
``NewWindowRequested``). pywebview binds both when it builds each window inside
``webview.start()``, so :func:`install` must run before that.
``VALIDATED_PYWEBVIEW`` is the version this was checked against;
``tests/test_nav_guard.py`` fails when the build pins another. pywebview and
WebView2 are never touched at import: the backend loader, the opener and the
thread spawner are injectable seams, so Linux CI tests this module.
"""

from __future__ import annotations

import threading
import webbrowser
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
from typing import Any
from urllib.parse import urlsplit

import structlog

logger = structlog.get_logger(__name__)

VALIDATED_PYWEBVIEW = "5.3.2"
"""The pywebview release whose EdgeChromium backend :func:`install` was checked against."""

MAX_URL_LENGTH = 8192
"""Longer URLs are refused (``invalid``) and never handed to the shell."""

_WEB_SCHEMES = frozenset({"http", "https"})


class NavAction(Enum):
    ALLOW = "allow"
    EXTERNAL = "external"
    BLOCK = "block"


@dataclass(frozen=True)
class NavDecision:
    action: NavAction
    reason: str


def _web_url_problem(url: str) -> str | None:
    """``None`` for an absolute http(s) URL with a host, else the refusal reason code."""
    if (
        not url
        or len(url) > MAX_URL_LENGTH
        or any(ord(c) <= 0x20 or ord(c) == 0x7F for c in url)
    ):
        return "invalid"
    try:
        parts = urlsplit(url)
        _ = parts.port  # raises ValueError on a bad port
    except ValueError:
        return "invalid"
    if parts.scheme.lower() not in _WEB_SCHEMES:
        return "scheme"
    if not parts.hostname:
        return "invalid"
    return None


def decide(url: str, *, host: str, port: int) -> NavDecision:
    """Where a navigation to ``url`` may go (see the module docstring)."""
    problem = _web_url_problem(url)
    if problem is not None:
        return NavDecision(NavAction.BLOCK, problem)
    parts = urlsplit(url)
    if parts.scheme.lower() == "http" and parts.hostname == host and parts.port == port:
        return NavDecision(NavAction.ALLOW, "app_origin")
    return NavDecision(NavAction.EXTERNAL, "external_web")


def _spawn_daemon(work: Callable[[], None]) -> None:
    threading.Thread(target=work, name="open-external", daemon=True).start()


def open_external(
    url: str,
    *,
    opener: Callable[[str], Any] = webbrowser.open,
    spawn: Callable[[Callable[[], None]], None] = _spawn_daemon,
) -> bool:
    """Ask the default browser to open ``url``; True when handed over.

    Only an absolute http(s) URL is opened (re-checked here, whoever calls);
    anything else logs ``external_open_refused`` with a ``reason`` and returns
    False. The opener runs off the GUI thread; a failure there logs
    ``external_open_failed`` with ``error_type``. Never raises.
    """
    problem = _web_url_problem(url)
    if problem is not None:
        logger.warning("external_open_refused", reason=problem)
        return False

    def work() -> None:
        try:
            opener(url)
        except Exception as e:
            logger.warning("external_open_failed", error_type=type(e).__name__)

    spawn(work)
    return True


def make_handlers(
    *, host: str, port: int, open_url: Callable[[str], bool] = open_external
) -> tuple[Callable[[Any, Any, Any], None], Callable[[Any, Any, Any], None]]:
    """The two EdgeChrome methods :func:`install` puts in place (``self, sender, args``).

    A navigation whose URL cannot be read is cancelled; a new-window request is
    always marked handled before anything else, so WebView2 never opens a window.
    """

    def on_navigation_start(_backend: Any, _sender: Any, args: Any) -> None:
        try:
            url = str(args.Uri)
        except Exception as e:
            args.Cancel = True
            logger.warning(
                "navigation_refused", reason="unreadable", error_type=type(e).__name__
            )
            return
        decision = decide(url, host=host, port=port)
        if decision.action is NavAction.ALLOW:
            logger.debug("navigation_allowed")
            return
        args.Cancel = True
        opened = decision.action is NavAction.EXTERNAL and open_url(url)
        logger.info(
            "navigation_refused", reason=decision.reason, opened_externally=opened
        )

    def on_new_window_request(_backend: Any, _sender: Any, args: Any) -> None:
        args.set_Handled(True)
        try:
            url = str(args.get_Uri())
        except Exception as e:
            logger.warning(
                "new_window_refused", reason="unreadable", error_type=type(e).__name__
            )
            return
        decision = decide(url, host=host, port=port)
        opened = decision.action is NavAction.EXTERNAL and open_url(url)
        logger.info(
            "new_window_refused", reason=decision.reason, opened_externally=opened
        )

    return on_navigation_start, on_new_window_request


def _load_edgechrome() -> Any:
    """pywebview's EdgeChromium backend class, or None when WinForms chose another renderer.

    Calls ``webview.guilib.initialize()`` first: the same idempotent call
    ``webview.start()`` makes, which imports the WinForms backend and decides
    the renderer.
    """
    from webview import guilib

    guilib.initialize()
    from webview.platforms import winforms

    if not getattr(winforms, "is_chromium", False):
        return None
    return winforms.Chromium.EdgeChrome


def _pywebview_version() -> str:
    try:
        from webview._version import version
    except Exception:
        return "unknown"
    return str(version)


def install(
    *,
    host: str,
    port: int,
    load_backend: Callable[[], Any] = _load_edgechrome,
    open_url: Callable[[str], bool] = open_external,
    version: Callable[[], str] = _pywebview_version,
) -> bool:
    """Put the policy on pywebview's EdgeChromium backend; True when installed.

    Call on the main thread before ``webview.start()``. Logs ``nav_guard`` with
    ``installed`` and, when not installed, a ``reason`` (``load_failed`` with
    ``error_type``, ``renderer`` when WebView2 is not the renderer,
    ``backend_changed`` when the two methods are missing); when installed, the
    ``pywebview`` version and whether it is ``validated``. Never raises.
    """
    try:
        backend = load_backend()
    except Exception as e:
        logger.warning(
            "nav_guard",
            installed=False,
            reason="load_failed",
            error_type=type(e).__name__,
        )
        return False
    if backend is None:
        logger.warning("nav_guard", installed=False, reason="renderer")
        return False
    if not all(
        callable(getattr(backend, name, None))
        for name in ("on_navigation_start", "on_new_window_request")
    ):
        logger.warning("nav_guard", installed=False, reason="backend_changed")
        return False
    on_navigation_start, on_new_window_request = make_handlers(
        host=host, port=port, open_url=open_url
    )
    backend.on_navigation_start = on_navigation_start
    backend.on_new_window_request = on_new_window_request
    found = version()
    logger.info(
        "nav_guard",
        installed=True,
        pywebview=found,
        validated=found == VALIDATED_PYWEBVIEW,
    )
    return True
