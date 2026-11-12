import multiprocessing

multiprocessing.freeze_support()

import webview  # noqa: E402

webview.settings["ALLOW_DOWNLOADS"] = True
import asyncio  # noqa: E402
import threading  # noqa: E402
import uvicorn  # noqa: E402
import os  # noqa: E402
import sys  # noqa: E402
import socket  # noqa: E402
import traceback  # noqa: E402
import time  # noqa: E402
import json  # noqa: E402
import hmac  # noqa: E402
import secrets  # noqa: E402
import urllib.request  # noqa: E402
import ctypes  # noqa: E402
import platform  # noqa: E402
from dataclasses import asdict  # noqa: E402
from pathlib import Path  # noqa: E402
from typing import Any, Callable  # noqa: E402

# Explicit imports to ensure PyInstaller finds them
from backend.main import app  # noqa: E402
from backend.services.platform import get_logs_dir, get_app_data_dir  # noqa: E402
from backend.services import api_auth  # noqa: E402
from backend.services import window_geometry  # noqa: E402
from backend.services import desktop_bridge  # noqa: E402
from backend.services import session_alert  # noqa: E402
from backend.services.app_identity import (  # noqa: E402
    ensure_start_menu_shortcut,
    set_process_aumid,
)
from backend.services import settings_store  # noqa: E402
from backend.services import autostart  # noqa: E402
from backend.services.i18n import get_strings, resolve_ui_language  # noqa: E402
from backend.services.notification_planner import UiState  # noqa: E402
from backend.services.tray_tooltip import refresh_tray_tooltip  # noqa: E402
from backend.services.ui_state import set_ui_state  # noqa: E402
from tray import TrayController  # noqa: E402
from call_popup_window import CallPopupWindow  # noqa: E402
from window_chrome import make_title_bar_handler  # noqa: E402
from window_diagnostics import attach_window_diagnostics  # noqa: E402
from backend.services.desktop_runtime import harden_frozen_windows  # noqa: E402

# Setup logging
import structlog  # noqa: E402

# Setup logging (structlog configured in backend.main, but we need a logger here)
logger = structlog.get_logger()

# Constants
HOST = "127.0.0.1"
# SD-AUX-01: must stay comfortably LARGER than the data-dir lock timeout awaited
# inside lifespan startup (data_lock.acquire(timeout=10.0) in backend/main.py) --
# uvicorn does not accept /health until lifespan startup completes, so during a
# close->reopen drain the incoming instance can legitimately take ~10s to become
# ready. A 10s health window collided with that exactly and produced a spurious
# "Server failed to start" crash dialog on every second launch / quick reopen.
SERVER_STARTUP_TIMEOUT = 30  # seconds; > backend data-lock acquire timeout (10s)

# How long the server keeps an idle HTTP connection open. It must outlast
# Chromium's own idle-socket lifetime (300 s), so the browser always closes an
# idle connection first. With uvicorn's 5 s default, the server closed idle
# connections just as the 5 s progress poll reused them. On Windows the browser
# was then left with a half-open socket: the poll it had just sent was never
# answered until Chromium's TCP keep-alive gave up 495 s later, and the stuck
# request blocked other requests to the same URL.
KEEP_ALIVE_TIMEOUT_S = 600

# Global reference so cleanup can signal graceful shutdown
_uvicorn_server: uvicorn.Server | None = None

# Set by the tray's Quit item (and the session-end guard) so the closing handler
# lets the window close.
_quitting = False

# How long the one-time tray hint waits before sending, so the session-end guard
# (which runs synchronously on the GUI thread right after the closing handler) has
# had its chance to flag a Windows shutdown / Task Manager / installer close.
TRAY_HINT_GUARD_DELAY_S = 0.5


def _mark_quitting() -> None:
    """Remember that the app is quitting, so the closing handler lets it close."""
    global _quitting
    _quitting = True


# Kept alive for the whole process so the mutex persists until the process exits.
_instance_mutex_handle: int | None = None
# NAME-SYNC: keep identical to MyAppMutex in tooling/windows/setup.iss. build.ps1
# runs tooling/windows/check_mutex_sync.py as a preflight and fails on drift.
INSTANCE_MUTEX_NAME = "SakaDeskInstanceMutex"


# Win32 error / message constants used by the single-instance guard.
_ERROR_ALREADY_EXISTS = 183
_SW_RESTORE = 9  # un-minimize (also un-maximizes a maximized window)
_SW_SHOW = 5  # show in its current size state


def _acquire_instance_mutex() -> bool:
    """Create a named mutex the Windows installer waits on (``MyAppMutex``).

    Windows keeps the mutex alive until every handle is closed — i.e. until this
    process fully terminates (``os._exit`` closes all handles). The installer
    waits for the mutex to disappear before replacing files in ``_internal``, so
    it never tries to overwrite a still-loaded DLL (e.g. ``libffi-8.dll``) while
    the app is mid-shutdown. Child workers are killed before ``os._exit`` (see
    ``main``), so the mutex releasing means the whole process tree is gone.

    SD-AUX-01: the same mutex now also serves as the single-instance guard.
    ``CreateMutexW`` succeeds even when the named mutex already exists (returning
    a handle to it) but sets ``GetLastError()==ERROR_ALREADY_EXISTS``; checking
    that lets a second launch bail out cleanly instead of racing the running
    instance for the port/data-lock and then dying with a crash dialog.

    Returns ``True`` if this process is the first/only instance (or on
    non-Windows / on failure — fail-open so the app still starts), ``False`` if
    another instance already holds the mutex.
    """
    global _instance_mutex_handle
    if platform.system() != "Windows":
        return True
    try:
        # Session-local name — app and installer run as the same user/session.
        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        _instance_mutex_handle = kernel32.CreateMutexW(None, False, INSTANCE_MUTEX_NAME)
        if not _instance_mutex_handle:
            # NULL handle: CreateMutexW failed (does not raise). The installer's
            # wait-for-exit protection is then absent — surface it, but fail open.
            logger.warning("CreateMutexW returned NULL; instance mutex not held")
            return True
        return kernel32.GetLastError() != _ERROR_ALREADY_EXISTS
    except Exception:
        logger.warning("Failed to create instance mutex", exc_info=True)
        return True


def _native_hwnd(window) -> int | None:
    """The pywebview window's own HWND (WinForms ``window.native.Handle``), or None.

    Never raises: any failure (no native form yet, a cross-thread access
    error) returns None so the caller falls back to finding the window by
    title, and is logged as ``window_native_handle_unavailable`` (error type
    only). A missing handle (``None``) is not an error and is not logged.
    """
    try:
        handle = window.native.Handle
        if handle is None:
            return None
        to_int = getattr(handle, "ToInt64", None)  # pythonnet IntPtr
        return int(to_int()) if to_int is not None else int(handle)
    except Exception as e:
        logger.warning("window_native_handle_unavailable", error_type=type(e).__name__)
        return None


def _configure_user32(user32) -> None:
    """Declare the HWND/BOOL signatures of the user32 calls ``_focus_window`` makes.

    Without them ctypes passes the handle as a 32-bit int and returns an int,
    which truncates 64-bit handles. Windows only (``wintypes`` is not used
    elsewhere); ``FindWindowW`` is left at its defaults.
    """
    from ctypes import wintypes

    user32.IsIconic.argtypes = [wintypes.HWND]
    user32.IsIconic.restype = wintypes.BOOL
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.ShowWindow.restype = wintypes.BOOL
    user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    user32.SetForegroundWindow.restype = wintypes.BOOL


def _focus_window(hwnd: int | None = None, *, user32=None) -> None:
    """Bring the SakaDesk window to the foreground (best-effort, never raises).

    Uses ``hwnd`` when given, else ``FindWindowW(None, "SakaDesk")`` (pywebview's
    window title). A minimized window is restored (``SW_RESTORE``); any other
    window, and a window hidden to the tray, is shown (``SW_SHOW``) so a
    maximized window stays maximized; a window that is both hidden and
    minimized is restored. ``user32`` is injectable for tests; without it this
    is a no-op off Windows.
    Logs ``window_focus`` (``minimized``, ``visible``, ``source``,
    ``foreground`` = the ``SetForegroundWindow`` result), ``window_focus_skipped`` or
    ``window_focus_failed`` (error type only).
    """
    if user32 is None and platform.system() != "Windows":
        return
    try:
        if user32 is None:
            user32 = ctypes.windll.user32  # type: ignore[attr-defined]
            _configure_user32(user32)
        source = "native"
        if not hwnd:
            source = "find_window"
            hwnd = user32.FindWindowW(None, "SakaDesk")
        if not hwnd:
            logger.info("window_focus_skipped", reason="no_window")
            return
        visible = bool(user32.IsWindowVisible(hwnd))
        minimized = bool(user32.IsIconic(hwnd))
        # A hidden window needs SW_SHOW to appear at all; SW_RESTORE would
        # un-maximize a visible maximized one, so it is only for minimized.
        user32.ShowWindow(hwnd, _SW_RESTORE if minimized else _SW_SHOW)
        foreground = bool(user32.SetForegroundWindow(hwnd))
        logger.debug(
            "window_focus",
            minimized=minimized,
            visible=visible,
            source=source,
            foreground=foreground,
        )
    except Exception as e:
        logger.warning("window_focus_failed", error_type=type(e).__name__)


def _focus_existing_window() -> None:
    """Bring the already-running SakaDesk window to the foreground (best-effort).

    Called when the single-instance guard (SD-AUX-01) detects a second launch,
    so a re-click of the taskbar/desktop icon focuses the live window instead of
    silently doing nothing. Finds the window by pywebview's title ("SakaDesk").
    """
    _focus_window(None)


def make_open_chat_handler(window, focus_fn):
    """Build the toast-click handler that brings ``window`` forward on a chat.

    The handler runs on a WinRT thread. It shows the window (never
    ``window.restore()``, which would un-maximize it), calls
    ``focus_fn(hwnd)`` with the window's own handle (or None), then asks the
    frontend to navigate via ``window.__sakadeskOpenChat``. The payload is the
    target's fields plus ``message_id`` (an int, the message to scroll to)
    when one is given. The script returns whether that function existed: it
    logs ``notify_open_chat`` (service, is_group_chat, has_target,
    ``delivered=True``) or ``notify_open_chat_failed`` with
    ``reason=not_ready`` (frontend not mounted yet) or ``error_type``.
    It never raises. Names and paths are never logged.
    """

    def handler(target, message_id: int | None = None) -> None:
        try:
            window.show()
            focus_fn(_native_hwnd(window))
            fields = asdict(target)
            if message_id is not None:
                fields["message_id"] = message_id
            payload = json.dumps(fields, ensure_ascii=False)
            delivered = window.evaluate_js(
                "window.__sakadeskOpenChat ? (window.__sakadeskOpenChat("
                + payload
                + "), true) : false"
            )
            if delivered is True:
                logger.info(
                    "notify_open_chat",
                    service=target.service,
                    is_group_chat=target.is_group_chat,
                    has_target=message_id is not None,
                    delivered=True,
                )
            else:
                logger.warning(
                    "notify_open_chat_failed",
                    service=target.service,
                    reason="not_ready",
                )
        except Exception as e:
            logger.warning(
                "notify_open_chat_failed",
                service=getattr(target, "service", None),
                error_type=type(e).__name__,
            )

    return handler


def make_open_login_handler(window, focus_fn):
    """Build the "log in again" toast-click handler: show ``window``, open the login.

    Like :func:`make_open_chat_handler`: shows the window (never ``restore()``),
    calls ``focus_fn(hwnd)``, then asks the frontend to open that service's
    login dialog via ``window.__sakadeskOpenLogin(service)``, which returns
    whether it did. Logs ``notify_open_login`` (``service``, ``delivered=True``)
    or ``notify_open_login_failed`` with ``reason=not_ready`` (frontend not
    mounted, or an unknown service) or ``error_type``. It never raises.
    """

    def handler(service: str) -> None:
        try:
            window.show()
            focus_fn(_native_hwnd(window))
            delivered = window.evaluate_js(
                "window.__sakadeskOpenLogin ? window.__sakadeskOpenLogin("
                + json.dumps(service)
                + ") === true : false"
            )
            if delivered is True:
                logger.info("notify_open_login", service=service, delivered=True)
            else:
                logger.warning(
                    "notify_open_login_failed", service=service, reason="not_ready"
                )
        except Exception as e:
            logger.warning(
                "notify_open_login_failed",
                service=service,
                error_type=type(e).__name__,
            )

    return handler


_MEMORIES_TARGETS = {"onThisDay": "on_this_day", "memoir": "memoir", "recap": "recap"}


def _memories_target(route: object) -> str:
    """The snake_case log code of ``route``'s page, else ``unknown``."""
    page = route.get("page") if isinstance(route, dict) else None
    return (
        _MEMORIES_TARGETS.get(page, "unknown") if isinstance(page, str) else "unknown"
    )


def make_open_memories_handler(window, focus_fn):
    """Build the Memories toast-click handler: show ``window``, open Memories.

    Like :func:`make_open_login_handler`: shows the window (never
    ``restore()``), calls ``focus_fn(hwnd)``, then asks the frontend to open
    Memories via ``window.__sakadeskOpenMemories({"service", "route"})``,
    which returns whether it navigated. The payload is JSON-encoded, so a
    member path can never break out of the script. Logs
    ``notify_open_memories`` (``service``, ``target`` = page code,
    ``delivered=True``) or ``notify_open_memories_failed`` with
    ``reason=refused`` (the frontend answered false: a malformed link, an
    unknown group or onboarding; its own breadcrumb has the exact code),
    ``reason=not_ready`` (the bridge is not mounted yet) or ``error_type``.
    Never logs the route; never raises.
    """

    def handler(service: str, route: dict) -> None:
        target = _memories_target(route)
        try:
            window.show()
            focus_fn(_native_hwnd(window))
            payload = json.dumps(
                {"service": service, "route": route}, ensure_ascii=False
            )
            # json.dumps leaves "</" alone; escape it so the payload can never
            # close a <script> element wherever the string ends up.
            payload = payload.replace("</", "<\\/")
            delivered = window.evaluate_js(
                "window.__sakadeskOpenMemories ? window.__sakadeskOpenMemories("
                + payload
                + ") === true : null"
            )
            if delivered is True:
                logger.info(
                    "notify_open_memories",
                    service=service,
                    target=target,
                    delivered=True,
                )
            else:
                logger.warning(
                    "notify_open_memories_failed",
                    service=service,
                    target=target,
                    reason="refused" if delivered is False else "not_ready",
                )
        except Exception as e:
            logger.warning(
                "notify_open_memories_failed",
                service=service,
                target=target,
                error_type=type(e).__name__,
            )

    return handler


def parse_background(argv: list[str]) -> bool:
    """True when ``--background`` is among the command-line arguments.

    ``argv[0]`` (the program) is ignored. Autostart launches SakaDesk with it
    so the app starts hidden in the tray.
    """
    return "--background" in argv[1:]


def make_open_window_handler(window, focus_fn):
    """Build the tray's Open handler: show ``window`` and bring it forward.

    Runs on pystray's thread (or whichever thread calls
    ``desktop_bridge.open_window``). It shows the window (works on a window
    hidden to the tray; never ``restore()``, which would un-maximize it), then
    calls ``focus_fn(hwnd)`` with the window's own handle (or None). The
    frontend reports focus through ui-state on its own. Exceptions propagate to
    the caller, which logs them.
    """

    def handler() -> None:
        window.show()
        focus_fn(_native_hwnd(window))
        logger.info("window_shown")

    return handler


def make_quit_handler(*, mark_quitting, stop_tray, destroy_popup, destroy_window):
    """Build the tray Quit handler.

    Runs ``mark_quitting``, ``stop_tray``, ``destroy_popup`` and
    ``destroy_window`` in that order. The popup is destroyed before the main
    window because pywebview exits only when no window is left, so a hidden
    popup would keep the process (and its single-instance mutex) alive. A
    callback that raises does not skip the later ones: the failure is logged as
    ``quit_step_failed`` (``step``, ``error_type``) and the next step runs.
    """
    steps = (
        ("mark_quitting", mark_quitting),
        ("stop_tray", stop_tray),
        ("destroy_popup", destroy_popup),
        ("destroy_window", destroy_window),
    )

    def handler() -> None:
        for step, fn in steps:
            try:
                fn()
            except Exception as e:
                logger.warning(
                    "quit_step_failed", step=step, error_type=type(e).__name__
                )

    return handler


def make_popup_preloader(ensure, read_settings):
    """Build the main window's ``loaded`` handler that creates the call popup.

    The first ``loaded`` event (it fires for a window started hidden with
    ``--background`` too) runs ``ensure()`` once, when the ``call_popup_enabled``
    setting is on (default on; a missing key counts as on). Later ``loaded``
    events (page reloads) are ignored, and so are positional arguments (pywebview
    may pass the window). A once-flag under a lock keeps two threads from
    creating it twice. Logs ``call_popup_window action=preload_skipped`` with
    ``reason`` ``disabled`` or ``settings_unreadable`` (``error_type``) and never
    raises: ``ensure()`` reports its own failures.
    """
    lock = threading.Lock()
    done = False

    def handler(*_args) -> None:
        nonlocal done
        with lock:
            if done:
                return
            done = True
        try:
            enabled = read_settings().get("call_popup_enabled", True)
        except Exception as e:
            logger.warning(
                "call_popup_window",
                action="preload_skipped",
                reason="settings_unreadable",
                error_type=type(e).__name__,
            )
            return
        if not enabled:
            logger.info(
                "call_popup_window", action="preload_skipped", reason="disabled"
            )
            return
        ensure()

    return handler


def make_closing_handler(
    *,
    is_quitting,
    tray_available,
    get_settings,
    hide_fn,
    reset_ui_state,
    notify_hint,
    save_geometry,
):
    """Build pywebview's ``closing`` handler; returning ``False`` cancels the close.

    Runs on pywebview's GUI thread, so it never waits on async work. It always
    saves the window geometry first. The window then closes (the app exits,
    handler returns ``True``) when Quit was chosen (``is_quitting()``), the tray
    is not running (``tray_available()`` is false: a hidden window could never
    be reopened), ``close_to_tray`` is off, the settings cannot be read, or
    ``hide_fn()`` fails. Otherwise the window is hidden, ``reset_ui_state()``
    marks it unfocused with no open chat (so toasts are not suppressed), and the
    one-time "still running" hint is queued. The handler returns ``False``.

    The hint is queued when ``tray_hint_shown`` is false and no hint is already
    pending: a "pending" flag, set here synchronously, makes two quick closes
    queue one hint. ``notify_hint(on_done)`` must schedule the toast without
    waiting and call ``on_done()`` once it has finished (any outcome), which
    clears the flag; the flag is only about the in-flight attempt. Persisting
    ``tray_hint_shown`` is the toast coroutine's job, after the toast was
    really sent (see :func:`_show_tray_hint`), so a failed send is retried on a
    later close. The toast coroutine also waits briefly and skips itself when
    the session-end guard marked the app as quitting meanwhile, because that
    guard runs only after this handler.

    Logs ``window_close`` with ``action`` (``hidden``/``quit``), ``reason`` for
    a quit, and for a hide ``hint`` (``queued``/``pending``/``skipped``). It
    never raises.
    """
    pending_lock = threading.Lock()
    hint_pending = False

    def release_hint() -> None:
        nonlocal hint_pending
        with pending_lock:
            hint_pending = False

    def handler() -> bool:
        nonlocal hint_pending
        try:
            save_geometry()
        except Exception as e:
            logger.warning("window_close_save_failed", error_type=type(e).__name__)

        def quit_with(reason: str) -> bool:
            logger.info("window_close", action="quit", reason=reason)
            return True

        if is_quitting():
            return quit_with("quitting")
        if not tray_available():
            return quit_with("no_tray")
        try:
            settings = get_settings()
        except Exception as e:
            logger.warning("window_close_settings_failed", error_type=type(e).__name__)
            return quit_with("settings_unreadable")
        if not settings.get("close_to_tray", True):
            return quit_with("close_to_tray_off")
        try:
            hide_fn()
        except Exception as e:
            logger.warning("window_close_hide_failed", error_type=type(e).__name__)
            return quit_with("hide_failed")

        hint = "skipped"
        try:
            reset_ui_state()
            if not settings.get("tray_hint_shown"):
                with pending_lock:
                    already_pending = hint_pending
                    hint_pending = True
                if already_pending:
                    hint = "pending"
                else:
                    try:
                        notify_hint(release_hint)
                    except Exception:
                        release_hint()
                        raise
                    hint = "queued"
        except Exception as e:
            logger.warning("window_close_hint_failed", error_type=type(e).__name__)
        logger.info("window_close", action="hidden", hint=hint)
        return False

    return handler


def _load_session_end_reasons():
    """The ``CloseReason`` values meaning the session, not the user, is closing.

    Imported lazily: ``System.Windows.Forms`` exists only on Windows (pythonnet).
    """
    from System.Windows.Forms import CloseReason  # type: ignore[import-not-found]

    return (CloseReason.WindowsShutDown, CloseReason.TaskManagerClosing)


def make_session_end_guard(*, mark_quitting, stop_tray, load_reasons=None):
    """Build a native ``FormClosing`` handler that lets a session end through.

    The ``closing`` hook cannot tell the user pressing X from Windows
    shutting down, so close-to-tray would cancel a shutdown, logoff or an
    installer's Restart Manager close ("SakaDesk is preventing shutdown").
    This guard is subscribed to the form's own ``FormClosing`` after pywebview's
    handler, so it runs after it and sees the ``Cancel`` pywebview set. When
    ``args.CloseReason`` is ``WindowsShutDown`` or ``TaskManagerClosing`` it
    calls ``mark_quitting()`` and ``stop_tray()`` (the same state as the Quit
    item), sets ``args.Cancel = False`` and logs ``window_close`` with
    ``action=quit`` and ``reason=session_end``. Any other reason is left
    untouched. ``load_reasons()`` returns the session-end values (the lazy
    ``System.Windows.Forms`` import by default). It never raises; a failure
    logs ``session_end_guard_failed`` (``error_type``).
    """
    reasons_loader = (
        load_reasons if load_reasons is not None else _load_session_end_reasons
    )

    def guard(_sender, args) -> None:
        try:
            if args.CloseReason not in reasons_loader():
                return
            args.Cancel = False
            logger.info("window_close", action="quit", reason="session_end")
            mark_quitting()
            stop_tray()
        except Exception as e:
            logger.warning("session_end_guard_failed", error_type=type(e).__name__)

    return guard


def attach_session_end_guard(window, guard) -> bool:
    """Subscribe ``guard`` to ``window.native.FormClosing``; return success.

    Call it from ``window.events.before_show``: by then pywebview's BrowserForm
    exists (``window.native``) and has already subscribed its own handler, so
    ``guard`` runs after it. Logs ``session_end_guard`` (``attached``, and a
    ``reason`` when not). Never raises; a failure logs ``error_type``.
    """
    native = getattr(window, "native", None)
    if native is None:
        logger.warning("session_end_guard", attached=False, reason="no_native")
        return False
    try:
        native.FormClosing += guard
    except Exception as e:
        logger.warning(
            "session_end_guard",
            attached=False,
            reason="attach_failed",
            error_type=type(e).__name__,
        )
        return False
    logger.info("session_end_guard", attached=True)
    return True


async def _show_tray_hint(
    mark_hint_shown=None, *, delay: float | None = None, is_quitting=None
) -> None:
    """Show the one-time "still running in the tray" toast. Never raises.

    The closing handler queues this before the session-end guard has run (the
    guard is subscribed after pywebview's handler), so a Task Manager "End task",
    a Windows shutdown or an installer's Restart Manager close would otherwise get
    the hint while the app is exiting. It therefore first waits ``delay`` seconds
    (default :data:`TRAY_HINT_GUARD_DELAY_S`) and then checks ``is_quitting()``
    (default: the module's ``_quitting`` flag, set by the guard and the Quit
    item). If the app is quitting it sends nothing, persists nothing (so the
    user still gets the hint at a real close) and logs ``tray_hint`` with
    ``shown=False`` and ``reason=quitting``.

    Runs on the server loop (``send_simple`` needs it). The text follows the
    UI language and is never logged. Only when ``send_simple`` returns True is
    ``tray_hint_shown`` persisted (``mark_hint_shown``, default
    ``settings_store.mark_tray_hint_shown``, off the loop thread); a failed
    send leaves it unset so a later close retries. Logs ``tray_hint`` with
    ``shown`` and, when shown, ``persisted``.
    """
    quitting_fn = is_quitting if is_quitting is not None else (lambda: _quitting)
    mark_fn = (
        mark_hint_shown
        if mark_hint_shown is not None
        else settings_store.mark_tray_hint_shown
    )
    try:
        await asyncio.sleep(TRAY_HINT_GUARD_DELAY_S if delay is None else delay)
        if quitting_fn():
            logger.info("tray_hint", shown=False, reason="quitting")
            return
        from backend.services.notification_service import send_simple
        from backend.services.settings_store import load_config

        config = await load_config()
        language = await asyncio.to_thread(resolve_ui_language, config)
        strings = get_strings("tray", language)
        shown = bool(
            await send_simple(
                strings["still_running_title"], strings["still_running_body"]
            )
        )
        if shown:
            persisted = bool(await asyncio.to_thread(mark_fn))
            logger.info("tray_hint", shown=True, persisted=persisted)
        else:
            logger.info("tray_hint", shown=False)
    except Exception as e:
        logger.warning("tray_hint_failed", error_type=type(e).__name__)


def _notify_tray_hint(on_done=None) -> None:
    """Queue the hint toast on the server loop without waiting for it.

    ``on_done()`` is called when the toast coroutine finishes (or is cancelled),
    or at once when it could not be scheduled (no server loop).
    """
    future = desktop_bridge.run_on_server_loop(_show_tray_hint())
    if on_done is None:
        return
    if future is None:
        on_done()
    else:
        future.add_done_callback(lambda _f: on_done())


async def _default_is_authenticated(service: str) -> bool:
    from backend.api.auth import auth_service

    status = await auth_service.get_status(service)
    return bool(status.get("authenticated"))


async def sync_all_authenticated(
    services, is_authenticated=_default_is_authenticated, launch=None
) -> None:
    """Start a sync (origin ``tray``) for each authenticated service. Never raises.

    Services are enqueued in the fixed sync order (乃木坂46, 櫻坂46, 日向坂46,
    Yodel) and run one at a time by the sync coordinator. Logs
    ``tray_sync_now`` (``services`` = how many were authenticated, ``started``
    = how many were started or queued; the rest were already running or
    queued, refused for shutdown, or failed).
    A failing service is logged (``tray_sync_now_failed``, service and error
    type) and does not stop the others.
    """
    from backend.services.sync_coordinator import order_services
    from backend.services.sync_launcher import LAUNCH_ACCEPTED, launch_sync

    launch_fn = launch if launch is not None else launch_sync
    authenticated = 0
    started = 0
    for service in order_services(services):
        try:
            if not await is_authenticated(service):
                continue
            authenticated += 1
            result = await launch_fn(
                service,
                include_inactive=True,
                force_resync=False,
                origin="tray",
            )
            if result in LAUNCH_ACCEPTED:
                started += 1
        except Exception as e:
            logger.warning(
                "tray_sync_now_failed", service=service, error_type=type(e).__name__
            )
    logger.info("tray_sync_now", services=authenticated, started=started)


async def _tray_sync_now() -> None:
    from backend.services.service_utils import get_all_services

    await sync_all_authenticated(get_all_services())


def _request_tray_sync() -> None:
    """The tray's Sync now: run ``_tray_sync_now`` on the server loop (no wait)."""
    desktop_bridge.run_on_server_loop(_tray_sync_now())


def request_initial_tooltip(run=None, refresh=None) -> bool:
    """Ask the server loop for one tooltip refresh; return whether it was queued.

    Without it the tooltip would read "SakaDesk" until the first sync ends or
    the first read-state write. Logs ``tray_tooltip_initial`` (``scheduled``).
    The loop is registered by the lifespan before ``/health`` answers and
    ``main`` only gets here after ``wait_for_server``, so it exists in
    practice; if not, the next sync or read-state write refreshes the tooltip
    anyway (and ``server_loop_unavailable`` is logged by the bridge).
    """
    run_fn = run if run is not None else desktop_bridge.run_on_server_loop
    refresh_fn = refresh if refresh is not None else refresh_tray_tooltip
    scheduled = run_fn(refresh_fn()) is not None
    logger.info("tray_tooltip_initial", scheduled=scheduled)
    return scheduled


def _reconcile_autostart() -> None:
    """Make the Windows Run entry match the ``autostart`` setting. Never raises."""
    try:
        enabled = bool(settings_store.read_config_sync().get("autostart"))
        autostart.reconcile(
            enabled,
            frozen=bool(getattr(sys, "frozen", False)),
            exe=Path(sys.executable),
        )
    except Exception as e:
        logger.warning("autostart", action="failed", error_type=type(e).__name__)


def _tray_strings() -> dict[str, str]:
    """The tray menu strings in the UI language (English if it cannot be read)."""
    try:
        language = resolve_ui_language(settings_store.read_config_sync())
    except Exception as e:
        logger.warning("tray_language_failed", error_type=type(e).__name__)
        language = None
    return get_strings("tray", language)


def _register_app_identity() -> None:
    """Register the Start Menu shortcut + AUMID so Windows shows toast banners.

    Frozen builds set the process AUMID and ensure the per-user Start Menu
    shortcut; dev runs only log ``skipped_dev``. Never raises or blocks startup.
    """
    try:
        frozen = bool(getattr(sys, "frozen", False))
        if frozen:
            set_process_aumid()
            programs_dir = (
                Path(os.environ["APPDATA"])
                / "Microsoft"
                / "Windows"
                / "Start Menu"
                / "Programs"
            )
        else:
            programs_dir = Path()
        ensure_start_menu_shortcut(
            frozen=frozen, exe=Path(sys.executable), programs_dir=programs_dir
        )
    except Exception as e:
        logger.warning("app_identity", action="failed", error_type=type(e).__name__)


def _kill_children(children: list) -> None:
    """Terminate then kill a list of multiprocessing.Process objects."""
    for child in children:
        try:
            if child.is_alive():
                child.terminate()
                child.join(timeout=3)
                if child.is_alive():
                    child.kill()
        except Exception:
            pass


def _get_port_file():
    """Path to the persisted port file."""
    return get_app_data_dir() / ".port"


def _bind_option() -> int:
    """Socket option for the backend listener.

    Windows: SO_EXCLUSIVEADDRUSE, so no other socket — including one of another
    Windows account — can bind SakaDesk's address and answer the window in its
    place (security audit 2026-11-13). Elsewhere SO_REUSEADDR: Linux and macOS
    never let a second socket take over an active listener.
    """
    return getattr(socket, "SO_EXCLUSIVEADDRUSE", socket.SO_REUSEADDR)


def _app_url(port: int, query: str = "") -> str:
    """URL of a SakaDesk window, with the launch token in the fragment.

    The fragment never reaches the server, the logs or a command line. The page
    moves it into sessionStorage and strips it on load
    (frontend/src/core/api/launchAuth.ts). Never log this URL.
    """
    return f"http://{HOST}:{port}/{query}#t={api_auth.LAUNCH_TOKEN}"


def create_server_socket() -> tuple:
    """Create a bound, listening server socket, reusing the saved port when it's free.

    Persistent app state now lives in the backend SQLite app-state store, so a
    port change no longer loses anything (the store is read at startup regardless
    of origin). The saved-port reuse is kept for ONE transitional reason: on the
    first launch after upgrading from a build that stored state in origin-scoped
    localStorage, reusing the old port makes the webview load on the origin that
    still holds that localStorage, so the one-time localStorage->backend migration
    can read it. Without the reuse the app would take a fresh port (a fresh, empty
    origin) and the migration would find nothing to carry over.

    On Windows the socket is bound with SO_EXCLUSIVEADDRUSE (see _bind_option), so
    a port still in TIME_WAIT after a quick close-reopen shifts to a new port; that
    is harmless now that state lives in the backend store.

    TODO(next release): once upgraders have migrated, drop this reuse entirely and
    bind an ephemeral port (this was briefly done, then reverted for the migration
    window above).

    Returns (port, socket) — bound AND listening, so no other socket can win the
    address between bind and uvicorn's start.
    """
    port_file = _get_port_file()

    def _port_is_active(port: int) -> bool:
        """Check if something is actually listening on the port.

        SO_REUSEADDR on Windows allows bind() to succeed even when another
        process is actively listening — so bind() alone can't tell us if
        the port is truly free.  A TCP connect check catches this.
        """
        try:
            conn = socket.create_connection((HOST, port), timeout=0.5)
            conn.close()
            return True
        except (ConnectionRefusedError, OSError, TimeoutError):
            return False

    def _try_bind(port: int):
        """Try to bind and listen on the given port."""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, _bind_option(), 1)
            sock.bind((HOST, port))
            sock.listen(128)
            return sock
        except OSError:
            sock.close()
            return None

    # Try to reuse saved port
    if port_file.exists():
        try:
            saved = int(port_file.read_text(encoding="utf-8").strip())
            if 1024 < saved < 65536:
                # On Windows, SO_REUSEADDR lets bind() succeed even if an old
                # process is still listening. Check with a connect() first.
                if not _port_is_active(saved):
                    sock = _try_bind(saved)
                    if sock is not None:
                        return saved, sock
                logger.info("server_port_saved_unavailable")
        except (ValueError, OSError):
            pass  # Corrupt file or port in use — allocate new one

    # Allocate a new port and persist it
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, _bind_option(), 1)
    sock.bind((HOST, 0))
    sock.listen(128)
    port = sock.getsockname()[1]
    try:
        port_file.write_text(str(port), encoding="utf-8")
    except OSError:
        pass  # Non-fatal — app still works, just may not persist port
    return port, sock


def wait_for_server(
    host: str, port: int, timeout: float = SERVER_STARTUP_TIMEOUT
) -> bool:
    """Wait until SakaDesk's own backend answers on the port.

    Polls /health with a fresh nonce and accepts only a response carrying
    HMAC(launch token, nonce): /health proves the ASGI app is loaded (no 404
    flash on second launch), and the proof proves the answering process is
    this backend and not a squatter on the port (security audit 2026-11-13).
    """
    nonce = secrets.token_urlsafe(24)
    expected = api_auth.health_proof(nonce)
    url = f"http://{host}:{port}/health?nonce={nonce}"
    warned = False
    start = time.time()
    while time.time() - start < timeout:
        try:
            with urllib.request.urlopen(url, timeout=1) as resp:
                if resp.status == 200:
                    body = json.loads(resp.read().decode("utf-8"))
                    if hmac.compare_digest(str(body.get("proof", "")), expected):
                        return True
                    if not warned:
                        logger.warning("server_identity_mismatch")
                        warned = True
        except Exception:
            pass
        time.sleep(0.1)
    return False


def build_server_config(asgi_app: Callable[..., Any]) -> uvicorn.Config:
    """uvicorn settings for the local backend.

    ``timeout_keep_alive`` is KEEP_ALIVE_TIMEOUT_S rather than uvicorn's
    5 s default: the browser always closes an idle connection before the
    server does, so the server never closes one the browser is reusing.
    """
    return uvicorn.Config(
        asgi_app, log_level="error", timeout_keep_alive=KEEP_ALIVE_TIMEOUT_S
    )


def start_server(sock: socket.socket) -> None:
    """Start uvicorn with a pre-bound, listening socket.

    By passing our own pre-bound, already-listening socket (see
    create_server_socket), uvicorn serves on exactly the address we claimed.
    """
    global _uvicorn_server
    config = build_server_config(app)
    logger.info("server_config", keep_alive_s=config.timeout_keep_alive)
    _uvicorn_server = uvicorn.Server(config)
    _uvicorn_server.run(sockets=[sock])


def show_error_dialog(error_msg: str, tb: str):
    """Show a simple error dialog with traceback."""
    try:
        import tkinter as tk
        from tkinter import scrolledtext

        root = tk.Tk()
        root.withdraw()

        # Create a custom dialog
        dialog = tk.Toplevel(root)
        dialog.title("SakaDesk Error")
        dialog.geometry("600x400")

        # SD-AUX-02: the window-manager [X] on the Toplevel otherwise runs the
        # default handler that destroys only the Toplevel, leaving the withdrawn
        # root Tk alive so mainloop() never returns — the process hangs as an
        # invisible zombie (holding the instance mutex / port). Route [X] to
        # root.destroy so closing the dialog any way fully exits the loop.
        dialog.protocol("WM_DELETE_WINDOW", root.destroy)

        tk.Label(dialog, text="An error occurred:", font=("Arial", 12, "bold")).pack(
            pady=10
        )

        text = scrolledtext.ScrolledText(dialog, width=70, height=20)
        text.pack(padx=10, pady=5, fill=tk.BOTH, expand=True)
        text.insert(tk.END, f"{error_msg}\n\n{tb}")
        text.config(state=tk.DISABLED)

        def copy_to_clipboard():
            root.clipboard_clear()
            root.clipboard_append(f"{error_msg}\n\n{tb}")

        tk.Button(dialog, text="Copy to Clipboard", command=copy_to_clipboard).pack(
            pady=5
        )
        tk.Button(dialog, text="Close", command=root.destroy).pack(pady=5)

        dialog.mainloop()
    except Exception:
        # If tkinter fails, just print to console
        if "logger" in globals():
            logger.error("FATAL ERROR", error=error_msg, traceback=tb)
        else:
            print(f"FATAL ERROR: {error_msg}\n{tb}")


def _main_window_kwargs(geom: dict, port: int, background: bool) -> dict[str, Any]:
    """``webview.create_window`` arguments of the main window.

    ``min_size`` keeps the window at least ``window_geometry.MIN_LOGICAL``
    (960 x 640 CSS px) so no page collapses; pywebview's default minimum is
    200 x 100. Unlike the geometry (device pixels), ``min_size`` is LOGICAL:
    WinForms DPI-scales it itself (see ``window_geometry.min_window_size``).
    """
    min_size = window_geometry.min_window_size()
    logger.info("window_min_size", width=min_size[0], height=min_size[1])
    return {
        "title": "SakaDesk",
        "url": _app_url(port),
        "width": geom["width"],
        "height": geom["height"],
        "x": geom.get("x"),
        "y": geom.get("y"),
        "resizable": True,
        "min_size": min_size,
        "background_color": "#F0F2F5",
        "hidden": background,
    }


def _load_window_geometry() -> dict:
    """Load saved window size/position from settings.json, or return defaults.

    Window geometry is stored under the ``"window"`` key in settings.json, in the
    same device-pixel coordinates that ``create_window()`` round-trips verbatim.

    Migrates from the legacy ``window.json`` file on first run after upgrade.
    """
    settings_path = get_app_data_dir() / "settings.json"
    legacy_path = get_app_data_dir() / "window.json"

    # --- Try loading from settings.json ---
    data = None
    if settings_path.exists():
        try:
            # Locked, retried and last-good (settings_store.read_settings_file):
            # never a half-swapped file on Windows.
            settings = settings_store.read_settings_file(settings_path)
            data = settings.get("window") if isinstance(settings, dict) else None
        except Exception:
            logger.warning("Failed to read window geometry from settings.json")

    # --- Migrate from legacy window.json if no window key in settings ---
    # Copied verbatim; parse_saved_geometry bounds the SIZE and (SD-AUX-04) drops
    # an off-screen/minimized POSITION, but is otherwise used as-is.
    if data is None and legacy_path.exists():
        try:
            data = json.loads(legacy_path.read_text(encoding="utf-8"))
            logger.info("Migrating window geometry from window.json to settings.json")
            # Keep window.json when settings.json was not written (it exists
            # but is unreadable), so a later launch can still migrate it.
            if _save_window_data_to_settings(data, settings_path):
                legacy_path.unlink(missing_ok=True)
            else:
                logger.info("window_migration_deferred", reason="settings_unwritten")
        except Exception:
            logger.warning("Failed to migrate window.json", exc_info=True)
            data = None

    return window_geometry.parse_saved_geometry(data)


def _save_window_data_to_settings(window_data: dict, settings_path: Path) -> bool:
    """Write the window data dict into settings.json under the 'window' key.

    SD-AUX-03: goes through ``settings_store.update_raw_sync``, which writes
    atomically (tmp file + ``os.replace``) so a crash or force-close mid-write
    cannot leave a corrupt settings.json, and takes the same cross-thread lock
    as ``update_config`` / ``mark_tray_hint_shown`` so this GUI-thread save and
    a concurrent API settings update cannot overwrite each other. Returns
    whether the file was written: ``False`` when settings.json exists but is
    unreadable, which ``update_raw_sync`` leaves untouched rather than wipe.
    """
    return settings_store.update_raw_sync(settings_path, {"window": window_data})


def _save_window_geometry(geom: dict) -> None:
    """Save window geometry (``window.width/height/x/y``, verbatim) to settings.json."""
    try:
        data = window_geometry.to_saved_dict(geom)
        if _save_window_data_to_settings(data, get_app_data_dir() / "settings.json"):
            logger.debug("Window geometry saved", geometry=data)
    except Exception:
        logger.warning("Failed to save window geometry", exc_info=True)


def main() -> None:
    try:
        # Packaged-app hardening (frozen Windows only): keep child processes from
        # flashing a console window, and pin the silent token-refresh to the
        # user's installed browser so it never downloads Chromium at runtime.
        # No-op in dev. See backend.services.desktop_runtime.
        harden_frozen_windows()

        # Hold a named mutex so the upgrade installer can wait for this process
        # to fully exit before replacing files it still has loaded. It also acts
        # as the single-instance guard (SD-AUX-01): if another instance already
        # holds it, focus that window and exit BEFORE touching the .port file or
        # racing the running instance for the port / data-lock (which otherwise
        # ended in a spurious "Server failed to start" crash dialog).
        if not _acquire_instance_mutex():
            logger.info("Another SakaDesk instance is already running; exiting")
            _focus_existing_window()
            os._exit(0)

        # Create server socket with SO_REUSEADDR for stable port across restarts
        port, sock = create_server_socket()

        # Start API server with the pre-bound socket
        t = threading.Thread(target=start_server, args=(sock,))
        t.daemon = True
        t.start()

        # Wait for server to be ready before creating window
        if not wait_for_server(HOST, port):
            raise RuntimeError(
                f"Server failed to start on port {port} within {SERVER_STARTUP_TIMEOUT}s"
            )

        # Start Menu shortcut + AUMID so toast banners show (frozen only).
        _register_app_identity()

        # Keep the Windows autostart entry in step with the setting (frozen only).
        _reconcile_autostart()

        # Autostart launches with --background: start hidden in the tray.
        background = parse_background(sys.argv)
        logger.info(
            "app_start",
            background=background,
            frozen=bool(getattr(sys, "frozen", False)),
        )

        # Load saved window geometry
        geom = _load_window_geometry()
        logger.info("Window geometry loaded", geom=geom)

        # Create window
        # background_color matches app's bg-[#F0F2F5] to prevent white
        # showing through Windows 11 rounded corners
        window = webview.create_window(**_main_window_kwargs(geom, port, background))

        # Windows 11: recolour the native title bar to the app surface. Only
        # non-locking events (``before_show`` is locking: the GUI thread waits
        # on its handlers); the handler stops after the first success and
        # never raises.
        _title_bar = make_title_bar_handler(window)
        window.events.shown += _title_bar
        window.events.loaded += _title_bar

        # N-R4-1: numeric breadcrumbs of the form's size state (window_geometry
        # phase=...). Log only: nothing changes the window. The form exists at
        # before_show; never raises.
        if platform.system() == "Windows":
            window.events.before_show += lambda: attach_window_diagnostics(window)

        # Save window geometry on close by reading current dimensions directly.
        # We read window.width/height/x/y properties instead of relying on
        # resize/move events — pywebview events only fire during initial
        # creation (DPI scaling), not for user-initiated resizes.
        def save_geometry():
            # pywebview round-trips geometry verbatim: create_window() reproduces
            # exactly what window.width/height/x/y report (the same device-pixel
            # space on this backend), so persist them AS-IS. A previous version
            # divided these by the DPI scale here, which the load never re-applied,
            # so the window shrank by `scale`x on every restart.
            geom = {
                "width": window.width,
                "height": window.height,
                "x": window.x,
                "y": window.y,
            }
            logger.info("Window closing", geometry=geom)
            _save_window_geometry(geom)

        # Toast click -> show, focus and open that chat (runs on a WinRT thread).
        desktop_bridge.set_open_chat_handler(
            make_open_chat_handler(window, _focus_window)
        )
        # "Log in again" toast click -> show, focus and open that login dialog.
        desktop_bridge.set_open_login_handler(
            make_open_login_handler(window, _focus_window)
        )
        # Memories toast click -> show, focus and open Memories at the route.
        desktop_bridge.set_open_memories_handler(
            make_open_memories_handler(window, _focus_window)
        )

        show_window = make_open_window_handler(window, _focus_window)

        # Background call popup (Windows only): one hidden window, created after
        # the main window first loads and reused for every call.
        popup: CallPopupWindow | None = None
        if platform.system() == "Windows":
            popup = CallPopupWindow(
                main_window=window,
                url=_app_url(port, "?view=call-popup"),
                is_quitting=lambda: _quitting,
            )
            desktop_bridge.set_call_popup_host(popup)
            window.events.loaded += make_popup_preloader(
                popup.ensure, settings_store.read_config_sync
            )
            # Whatever closes the main window also closes the popup, so
            # webview.start() can return and the process (and its mutex) exits.
            window.events.closed += popup.destroy_on_main_closed

        on_quit = make_quit_handler(
            mark_quitting=_mark_quitting,
            stop_tray=lambda: tray.stop(),
            destroy_popup=popup.destroy if popup is not None else (lambda: None),
            destroy_window=window.destroy,
        )

        # System tray: Open / Sync now / Quit, and the unread tooltip.
        tray = TrayController(
            strings=_tray_strings,
            on_open=show_window,
            on_sync_now=_request_tray_sync,
            on_quit=on_quit,
        )
        tray.start()
        # A toast's "open the window" request works with or without the tray.
        desktop_bridge.set_open_window_handler(show_window)
        if tray.available:
            desktop_bridge.set_tray_tooltip_handler(tray.set_tooltip)
            desktop_bridge.set_tray_alert_handler(tray.set_alert)
            tray.set_alert(bool(session_alert.needs_login_services()))
            request_initial_tooltip()

        # X hides to the tray (or quits: see make_closing_handler).
        window.events.closing += make_closing_handler(
            is_quitting=lambda: _quitting,
            tray_available=lambda: tray.available,
            get_settings=settings_store.read_config_sync,
            hide_fn=window.hide,
            reset_ui_state=lambda: set_ui_state(UiState(None, None, None, False)),
            notify_hint=_notify_tray_hint,
            save_geometry=save_geometry,
        )
        if tray.available:
            # Windows shutdown, logoff and installer closes must not be
            # cancelled by close-to-tray. Subscribed once pywebview's own
            # FormClosing handler exists, so it runs after it.
            guard = make_session_end_guard(
                mark_quitting=_mark_quitting, stop_tray=tray.stop
            )
            window.events.before_show += lambda: attach_session_end_guard(window, guard)

        def reveal_without_tray() -> None:
            # A hidden window with no tray icon could never be reopened.
            logger.warning("background_start_without_tray")
            window.show()

        # Start native GUI loop
        # private_mode=False: persist localStorage (ToS, read states, language)
        # storage_path: store webview data in app data dir alongside settings
        webview.start(
            reveal_without_tray if background and not tray.available else None,
            private_mode=False,
            storage_path=str(get_app_data_dir() / "webview"),
        )

        # Cleanup AFTER webview closes but BEFORE process exits.
        desktop_bridge.set_call_popup_host(None)
        tray.stop()

        # Snapshot child processes NOW, before any shutdown logic can
        # clear the tracking set.  Python's ProcessPoolExecutor management
        # thread removes workers from multiprocessing._children when it
        # joins them during shutdown(). Capturing first ensures we can
        # still kill them even after the reference is gone.
        import multiprocessing

        children_snapshot = list(multiprocessing.active_children())

        # Signal uvicorn to shut down gracefully so it releases the socket.
        if _uvicorn_server is not None:
            _uvicorn_server.should_exit = True
            # Wait for lifespan shutdown (blog backup stop + executor teardown)
            t.join(timeout=8)

        # Fallback: if lifespan didn't finish in time, force-cleanup from here.
        import logging

        try:
            from backend.services.search_service import shutdown_search_service

            shutdown_search_service()
        except Exception:
            pass

        _kill_children(children_snapshot)

        for handler in logging.root.handlers[:]:
            try:
                handler.flush()
                handler.close()
            except Exception:
                pass

        # Force-exit to kill any lingering threads (e.g. asyncio loops,
        # background tasks). On Windows, daemon threads aren't reliably
        # terminated by normal exit and can keep the process alive.
        os._exit(0)

    except Exception as e:
        error_msg = str(e)
        tb = traceback.format_exc()

        # Log to file
        try:
            log_file = get_logs_dir() / "crash.log"
            with open(log_file, "w", encoding="utf-8") as f:
                f.write(f"Error: {error_msg}\n\n{tb}")
            logger.error(f"Crash log saved to {log_file}")
        except Exception:
            pass  # Logging failure shouldn't prevent error dialog

        # Show dialog
        show_error_dialog(error_msg, tb)

        # Kill child processes even on crash path — sys.exit() does NOT
        # terminate them, and os._exit() only kills the current process.
        import multiprocessing

        _kill_children(multiprocessing.active_children())
        os._exit(1)


if __name__ == "__main__":
    main()
