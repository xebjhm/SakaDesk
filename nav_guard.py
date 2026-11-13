"""Keep SakaDesk's windows on SakaDesk (security audit 2026-11-13,
``desktop.py/main-window/unrestricted-navigation-from-blog-links``).

The main window and the call popup have no address bar and no back button.
Without a policy, a link in remote blog content (or any script that sets
``location``) replaced the app with another site until SakaDesk quit, and
pywebview 5.3.2 handed every ``window.open`` / ``target=_blank`` URL, whatever
its scheme, to ``webbrowser.open``. This module gives both one policy
(:func:`decide`):

- a top-level navigation to the app's own origin (``http://127.0.0.1:<port>``)
  proceeds, unless its path is a backend endpoint (``/api`` and below,
  ``/docs``, ``/redoc``, ``/openapi.json``): the app's pages are ``/`` with a
  query, and downloads load in iframes, so such a navigation is cancelled
  (``app_api``);
- any other ``http``/``https`` URL is cancelled in the window and opened in
  the default browser instead (:func:`open_external`, off the GUI thread);
- a URL naming this machine (``localhost``, ``*.localhost``, ``0.0.0.0``,
  ``127.x.x.x`` in any numeric spelling such as ``2130706433`` or
  ``0x7f.0.0.1``, an IPv6 literal whose compressed form starts ``::``; the
  rule of ``frontend/src/utils/loopbackHost.ts``) other than the app origin
  is cancelled and never opened;
- every other URL (``file:``, ``ms-settings:``, ``javascript:``, ``data:``,
  malformed, containing whitespace or a control character, or longer than
  ``MAX_URL_LENGTH``) is cancelled and never opened; an ``http(s)`` URL
  containing a character ShellExecute could misread (``" < > ^`` or a
  backtick) is not refused: it is external, and :func:`open_external`
  percent-encodes those characters before handing it to the browser;
- a new-window request never becomes a window: an external web URL goes to the
  browser as above, anything else (including the app's own URLs) is dropped.

Each refusal logs ``navigation_refused`` or ``new_window_refused`` with a
``reason`` code (``external_web``, ``app_origin``, ``app_api``, ``scheme``,
``invalid``, ``loopback``, ``unreadable``) and ``external_requested``
(whether a browser launch was queued; the launch itself logs ``external_opened``
or ``external_open_failed`` from its thread); an allowed navigation logs
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

If WebView2 is missing, pywebview falls back to MSHTML, which this guard does
not patch (``install`` logs ``reason="renderer"``); SakaDesk's React UI does not
run on that renderer anyway.
"""

from __future__ import annotations

import ipaddress
import threading
import webbrowser
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
from typing import Any
from urllib.parse import unquote, urlsplit

import structlog

logger = structlog.get_logger(__name__)

VALIDATED_PYWEBVIEW = "5.3.2"
"""The pywebview release whose EdgeChromium backend :func:`install` was checked against."""

MAX_URL_LENGTH = 8192
"""Longer URLs are refused (``invalid``) and never handed to the shell."""

_APP_BACKEND_PATHS = ("/api", "/docs", "/redoc", "/openapi.json")
"""Paths on the app origin that are backend endpoints, never pages: the app's own
pages are ``/`` with a query, and downloads load in iframes, which
``NavigationStarting`` handlers here do not govern."""

_WEB_SCHEMES = frozenset({"http", "https"})

_SHELL_ESCAPES = {c: f"%{ord(c):02X}" for c in '"<>^`'}
"""Characters Windows ShellExecute can misread, percent-encoded before a URL is
handed to the browser (equivalent for HTTP). The URL standard leaves ``^`` and,
in a query, a backtick unencoded, so real links can carry them."""


class NavAction(Enum):
    ALLOW = "allow"
    EXTERNAL = "external"
    BLOCK = "block"


@dataclass(frozen=True)
class NavDecision:
    action: NavAction
    reason: str


def _ipv4_number(part: str) -> int | None:
    """One dotted part of an IPv4 host as the URL standard reads it (``0x`` hex,
    leading-``0`` octal, else decimal); ``None`` when it is none of those."""
    if not part:
        return None
    try:
        if part[:2] in ("0x", "0X"):
            return int(part[2:] or "0", 16)
        if len(part) > 1 and part[0] == "0":
            return int(part[1:], 8)
        return int(part, 10) if part.isdecimal() else None
    except ValueError:
        return None


def _ipv4_address(host: str) -> ipaddress.IPv4Address | None:
    """``host`` read as the URL standard's IPv4 parser reads it, or ``None``.

    Accepts one to four dotted parts (one trailing dot allowed); the last part
    fills the remaining bytes, so ``2130706433``, ``127.1`` and ``0x7f.0.0.1``
    all give ``127.0.0.1``. Implemented here, not with ``socket.inet_aton``,
    whose accepted forms differ between platforms.
    """
    parts = host.split(".")
    if len(parts) > 1 and parts[-1] == "":
        parts.pop()
    if not 1 <= len(parts) <= 4:
        return None
    numbers = [_ipv4_number(p) for p in parts]
    if any(n is None for n in numbers):
        return None
    *head, last = (n for n in numbers if n is not None)
    if any(n > 255 for n in head) or last >= 256 ** (5 - len(parts)):
        return None
    value = last
    for i, n in enumerate(head):
        value += n << (8 * (3 - i))
    return ipaddress.IPv4Address(value)


def is_loopback_host(hostname: str) -> bool:
    """Whether ``hostname`` (as ``urlsplit(...).hostname`` gives it, lowercase and
    without brackets) names this machine: ``localhost`` or a ``*.localhost``
    name, an IPv4 address in ``127.0.0.0/8`` or ``0.0.0.0``, or an IPv6 literal
    whose compressed form starts ``::``.

    ``urlsplit`` leaves hosts uncanonicalised, so numeric spellings are
    normalised first: IPv4 as the URL standard reads it (``2130706433``,
    ``127.1``, ``0x7f.0.0.1`` and ``0`` count) and IPv6 through ``ipaddress``
    (``0:0:0:0:0:0:0:1`` counts). Browsers canonicalise before the TypeScript
    twin, ``isLoopbackHost`` in ``frontend/src/utils/loopbackHost.ts``, sees a
    host, so it states the same rule over canonical text. Names that reach
    loopback only through DNS are not detected.
    """
    host = hostname.lower().rstrip(".")
    if host == "localhost" or host.endswith(".localhost"):
        return True
    if ":" in host:
        try:
            return ipaddress.IPv6Address(host).compressed.startswith("::")
        except ValueError:
            return host.startswith("::")
    v4 = _ipv4_address(host)
    return v4 is not None and (v4.is_loopback or v4.is_unspecified)


def _web_url_problem(url: str) -> str | None:
    """``None`` for an absolute http(s) URL with a host, else the refusal reason code.

    Reasons: ``invalid`` (empty, too long, whitespace or control characters,
    bad port, no host), ``scheme`` (not http/https).
    """
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
    """Where a navigation to ``url`` may go (see the module docstring).

    The app origin is ``http://<host>:<port>``; on it, a path (percent-decoded,
    case-folded) equal to or under ``/api``, ``/docs``, ``/redoc`` or
    ``/openapi.json`` is blocked with reason ``app_api``. Any other loopback URL
    is blocked with reason ``loopback``.
    """
    problem = _web_url_problem(url)
    if problem is not None:
        return NavDecision(NavAction.BLOCK, problem)
    parts = urlsplit(url)
    if parts.scheme.lower() == "http" and parts.hostname == host and parts.port == port:
        path = unquote(parts.path).lower()
        if any(path == p or path.startswith(f"{p}/") for p in _APP_BACKEND_PATHS):
            return NavDecision(NavAction.BLOCK, "app_api")
        return NavDecision(NavAction.ALLOW, "app_origin")
    if is_loopback_host(parts.hostname or ""):
        return NavDecision(NavAction.BLOCK, "loopback")
    return NavDecision(NavAction.EXTERNAL, "external_web")


def _spawn_daemon(work: Callable[[], None]) -> None:
    threading.Thread(target=work, name="open-external", daemon=True).start()


def open_external(
    url: str,
    *,
    opener: Callable[[str], Any] = webbrowser.open,
    spawn: Callable[[Callable[[], None]], None] = _spawn_daemon,
) -> bool:
    """Queue a default-browser launch of ``url``; True when the launch was queued.

    Only an absolute http(s) URL is opened (re-checked here, whoever calls),
    with ``" < > ^`` and backticks percent-encoded for ShellExecute;
    anything else logs ``external_open_refused`` with a ``reason`` and returns
    False. The opener runs off the GUI thread, which logs the outcome:
    ``external_opened`` when it returns truthy, ``external_open_failed`` with
    ``reason="browser_refused"`` when it returns falsy (``webbrowser.open`` does
    that on Windows when ``os.startfile`` fails), or with ``error_type`` when it
    raises. Never raises.
    """
    problem = _web_url_problem(url)
    if problem is not None:
        logger.warning("external_open_refused", reason=problem)
        return False

    shell_safe = "".join(_SHELL_ESCAPES.get(c, c) for c in url)

    def work() -> None:
        try:
            launched = opener(shell_safe)
        except Exception as e:
            logger.warning("external_open_failed", error_type=type(e).__name__)
            return
        if launched:
            logger.info("external_opened")
        else:
            logger.warning("external_open_failed", reason="browser_refused")

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
        requested = decision.action is NavAction.EXTERNAL and open_url(url)
        logger.info(
            "navigation_refused", reason=decision.reason, external_requested=requested
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
        requested = decision.action is NavAction.EXTERNAL and open_url(url)
        logger.info(
            "new_window_refused", reason=decision.reason, external_requested=requested
        )

    return on_navigation_start, on_new_window_request


def _load_edgechrome() -> Any:
    """pywebview's EdgeChromium backend class, or None when WinForms chose another renderer.

    Calls ``initialize()`` from ``webview.guilib`` first, as ``webview.start()``
    does (with no forced GUI): it imports the WinForms backend, decides the
    renderer and runs ``setup_app()``. ``from webview import guilib`` would not
    work: pywebview 5.3.2 rebinds that package attribute to None at import and
    only ``start()`` assigns it. Calling it early is safe: the backend module is
    cached in ``sys.modules`` and ``setup_app()`` returns at once on the second
    call (``_already_set_up_app``), so ``start()`` repeats it harmlessly.
    """
    from webview.guilib import initialize

    initialize()
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
    ``pywebview`` version and whether it is ``validated`` (logged at warning
    level when it is not). Never raises.
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
    validated = found == VALIDATED_PYWEBVIEW
    log = logger.info if validated else logger.warning
    log("nav_guard", installed=True, pywebview=found, validated=validated)
    return True
