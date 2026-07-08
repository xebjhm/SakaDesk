import multiprocessing

multiprocessing.freeze_support()

import webview  # noqa: E402

webview.settings["ALLOW_DOWNLOADS"] = True
import threading  # noqa: E402
import uvicorn  # noqa: E402
import os  # noqa: E402
import socket  # noqa: E402
import traceback  # noqa: E402
import time  # noqa: E402
import json  # noqa: E402
import urllib.request  # noqa: E402
import ctypes  # noqa: E402
import platform  # noqa: E402
from pathlib import Path  # noqa: E402

# Explicit imports to ensure PyInstaller finds them
from backend.main import app  # noqa: E402
from backend.services.platform import get_logs_dir, get_app_data_dir  # noqa: E402
from backend.services import window_geometry  # noqa: E402
from backend.services.service_utils import atomic_write_json  # noqa: E402
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

# Global reference so cleanup can signal graceful shutdown
_uvicorn_server: uvicorn.Server | None = None

# Kept alive for the whole process so the mutex persists until the process exits.
_instance_mutex_handle: int | None = None
# NAME-SYNC: keep identical to AppMutex in tooling/windows/setup.iss. build.ps1
# runs tooling/windows/check_mutex_sync.py as a preflight and fails on drift.
INSTANCE_MUTEX_NAME = "SakaDeskInstanceMutex"


# Win32 error / message constants used by the single-instance guard.
_ERROR_ALREADY_EXISTS = 183
_SW_RESTORE = 9


def _acquire_instance_mutex() -> bool:
    """Create a named mutex the Windows installer keys off (Inno ``AppMutex``).

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
            # AppMutex protection is then absent — surface it, but fail open.
            logger.warning("CreateMutexW returned NULL; instance mutex not held")
            return True
        return kernel32.GetLastError() != _ERROR_ALREADY_EXISTS
    except Exception:
        logger.warning("Failed to create instance mutex", exc_info=True)
        return True


def _focus_existing_window() -> None:
    """Bring the already-running SakaDesk window to the foreground (best-effort).

    Called when the single-instance guard (SD-AUX-01) detects a second launch,
    so a re-click of the taskbar/desktop icon focuses the live window instead of
    silently doing nothing. Matches pywebview's window title ("SakaDesk").
    """
    if platform.system() != "Windows":
        return
    try:
        user32 = ctypes.windll.user32  # type: ignore[attr-defined]
        hwnd = user32.FindWindowW(None, "SakaDesk")
        if hwnd:
            user32.ShowWindow(hwnd, _SW_RESTORE)  # un-minimize if needed
            user32.SetForegroundWindow(hwnd)
    except Exception:
        logger.debug("Failed to focus existing window", exc_info=True)


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


def create_server_socket() -> tuple:
    """Create a bound server socket, reusing the saved port when it's free.

    Persistent app state now lives in the backend SQLite app-state store, so a
    port change no longer loses anything (the store is read at startup regardless
    of origin). The saved-port reuse is kept for ONE transitional reason: on the
    first launch after upgrading from a build that stored state in origin-scoped
    localStorage, reusing the old port makes the webview load on the origin that
    still holds that localStorage, so the one-time localStorage->backend migration
    can read it. Without the reuse the app would take a fresh port (a fresh, empty
    origin) and the migration would find nothing to carry over.

    SO_REUSEADDR lets it rebind a port still in TCP TIME_WAIT after a quick
    close-reopen. A fast reopen while the prior instance still holds the port
    (`_port_is_active`) still shifts to a new port, but that is now harmless.

    TODO(next release): once upgraders have migrated, drop this reuse entirely and
    bind an ephemeral port (this was briefly done, then reverted for the migration
    window above).

    Returns (port, socket) — bound but NOT listening; uvicorn calls listen().
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
        """Try to bind a SO_REUSEADDR socket to the given port."""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind((HOST, port))
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
        except (ValueError, OSError):
            pass  # Corrupt file or port in use — allocate new one

    # Allocate a new port and persist it
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((HOST, 0))
    port = sock.getsockname()[1]
    try:
        port_file.write_text(str(port), encoding="utf-8")
    except OSError:
        pass  # Non-fatal — app still works, just may not persist port
    return port, sock


def wait_for_server(
    host: str, port: int, timeout: float = SERVER_STARTUP_TIMEOUT
) -> bool:
    """Wait for the server to respond to HTTP requests.

    Uses the /health endpoint instead of raw TCP connect — this ensures
    the ASGI app is fully loaded and can serve routes, not just that the
    socket is listening. Prevents the 404 flash on second launch where
    WebView2 restores its cached session before uvicorn is ready.
    """
    url = f"http://{host}:{port}/health"
    start = time.time()
    while time.time() - start < timeout:
        try:
            resp = urllib.request.urlopen(url, timeout=1)
            if resp.status == 200:
                return True
        except Exception:
            pass
        time.sleep(0.1)
    return False


def start_server(sock: socket.socket) -> None:
    """Start uvicorn with a pre-bound SO_REUSEADDR socket.

    By passing our own socket, we bypass asyncio's default socket creation
    which uses SO_EXCLUSIVEADDRUSE on Windows — that flag rejects ports
    in TIME_WAIT state and would force a new port on quick restarts.
    """
    global _uvicorn_server
    config = uvicorn.Config(app, log_level="error")
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
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
            data = settings.get("window")
        except Exception:
            logger.warning("Failed to read window geometry from settings.json")

    # --- Migrate from legacy window.json if no window key in settings ---
    # Copied verbatim; parse_saved_geometry bounds the SIZE and (SD-AUX-04) drops
    # an off-screen/minimized POSITION, but is otherwise used as-is.
    if data is None and legacy_path.exists():
        try:
            data = json.loads(legacy_path.read_text(encoding="utf-8"))
            logger.info("Migrating window geometry from window.json to settings.json")
            _save_window_data_to_settings(data, settings_path)
            legacy_path.unlink(missing_ok=True)
        except Exception:
            logger.warning("Failed to migrate window.json", exc_info=True)
            data = None

    return window_geometry.parse_saved_geometry(data)


def _save_window_data_to_settings(window_data: dict, settings_path: Path) -> None:
    """Write the window data dict into settings.json under the 'window' key.

    SD-AUX-03: use the shared atomic tmp-file+``os.replace`` writer
    (``atomic_write_json``) rather than a truncating ``write_text`` — a crash or
    force-close mid-write must not leave a corrupt settings.json that
    ``settings_store`` then fails to parse. (A cross-process lock can't be taken
    from here, but atomic replace removes the corruption risk and shrinks the
    lost-update window to a single last-writer-wins.)
    """
    settings: dict = {}
    if settings_path.exists():
        try:
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    settings["window"] = window_data
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_json(settings_path, settings)


def _save_window_geometry(geom: dict) -> None:
    """Save window geometry (``window.width/height/x/y``, verbatim) to settings.json."""
    try:
        data = window_geometry.to_saved_dict(geom)
        _save_window_data_to_settings(data, get_app_data_dir() / "settings.json")
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

        # Load saved window geometry
        geom = _load_window_geometry()
        logger.info("Window geometry loaded", geom=geom)

        # Create window
        # background_color matches app's bg-[#F0F2F5] to prevent white
        # showing through Windows 11 rounded corners
        window = webview.create_window(
            title="SakaDesk",
            url=f"http://{HOST}:{port}",
            width=geom["width"],
            height=geom["height"],
            x=geom.get("x"),
            y=geom.get("y"),
            resizable=True,
            background_color="#F0F2F5",
        )

        # Save window geometry on close by reading current dimensions directly.
        # We read window.width/height/x/y properties instead of relying on
        # resize/move events — pywebview events only fire during initial
        # creation (DPI scaling), not for user-initiated resizes.
        def on_closing():
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

        window.events.closing += on_closing

        # Start native GUI loop
        # private_mode=False: persist localStorage (ToS, read states, language)
        # storage_path: store webview data in app data dir alongside settings
        webview.start(
            private_mode=False,
            storage_path=str(get_app_data_dir() / "webview"),
        )

        # Cleanup AFTER webview closes but BEFORE process exits.

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
