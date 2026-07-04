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

# Setup logging
import structlog  # noqa: E402

# Setup logging (structlog configured in backend.main, but we need a logger here)
logger = structlog.get_logger()

# Constants
HOST = "127.0.0.1"
SERVER_STARTUP_TIMEOUT = 10  # seconds

# Global reference so cleanup can signal graceful shutdown
_uvicorn_server: uvicorn.Server | None = None

# Kept alive for the whole process so the mutex persists until the process exits.
_instance_mutex_handle: int | None = None
INSTANCE_MUTEX_NAME = "SakaDeskInstanceMutex"


def _acquire_instance_mutex() -> None:
    """Create a named mutex the Windows installer keys off (Inno ``AppMutex``).

    Windows keeps the mutex alive until every handle is closed — i.e. until this
    process fully terminates (``os._exit`` closes all handles). The installer
    waits for the mutex to disappear before replacing files in ``_internal``, so
    it never tries to overwrite a still-loaded DLL (e.g. ``libffi-8.dll``) while
    the app is mid-shutdown. Child workers are killed before ``os._exit`` (see
    ``main``), so the mutex releasing means the whole process tree is gone.
    """
    global _instance_mutex_handle
    if platform.system() != "Windows":
        return
    try:
        # Session-local name — app and installer run as the same user/session.
        _instance_mutex_handle = ctypes.windll.kernel32.CreateMutexW(  # type: ignore[attr-defined]
            None, False, INSTANCE_MUTEX_NAME
        )
    except Exception:
        logger.warning("Failed to create instance mutex", exc_info=True)


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
    """Create a bound server socket on a stable port with SO_REUSEADDR.

    HTTP localStorage is keyed by origin (scheme + host + port).
    To persist ToS acceptance, read states, language, etc. across restarts,
    the port must stay the same. We save it to disk on first launch and
    reuse it on every subsequent launch.

    The socket is created with SO_REUSEADDR so it can bind to ports still
    in TCP TIME_WAIT state (e.g. after a quick close-reopen cycle).
    Without this, Python 3.8+ on Windows uses SO_EXCLUSIVEADDRUSE which
    rejects TIME_WAIT ports, forcing a new port and wiping localStorage.

    Returns (port, socket) — the socket is bound but NOT listening.
    Uvicorn/asyncio will call listen() when ready.
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


def _get_dpi_scale() -> float:
    """Primary-monitor DPI scale factor (see backend.services.window_geometry)."""
    return window_geometry.dpi_scale()


def _load_window_geometry() -> dict:
    """Load saved window size/position from settings.json, or return defaults.

    Window geometry is stored under the ``"window"`` key in settings.json.
    Values are in logical (DPI-independent) coordinates, matching what
    pywebview's create_window() expects.

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
    # Copied verbatim (physical coords, no "format" key); parse_saved_geometry
    # converts it to logical on load.
    if data is None and legacy_path.exists():
        try:
            data = json.loads(legacy_path.read_text(encoding="utf-8"))
            logger.info("Migrating window geometry from window.json to settings.json")
            _save_window_data_to_settings(data, settings_path)
            legacy_path.unlink(missing_ok=True)
        except Exception:
            logger.warning("Failed to migrate window.json", exc_info=True)
            data = None

    return window_geometry.parse_saved_geometry(data, _get_dpi_scale())


def _save_window_data_to_settings(window_data: dict, settings_path: Path) -> None:
    """Write the window data dict into settings.json under the 'window' key."""
    settings: dict = {}
    if settings_path.exists():
        try:
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    settings["window"] = window_data
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(json.dumps(settings, indent=2), encoding="utf-8")


def _save_window_geometry(logical_geom: dict) -> None:
    """Save window geometry to settings.json.

    ``logical_geom`` must already be in LOGICAL coordinates — the caller converts
    the physical window properties via window_geometry.physical_to_logical.
    """
    try:
        data = window_geometry.to_saved_dict(logical_geom)
        _save_window_data_to_settings(data, get_app_data_dir() / "settings.json")
        logger.debug("Window geometry saved", geometry=data)
    except Exception:
        logger.warning("Failed to save window geometry", exc_info=True)


def main() -> None:
    try:
        # Hold a named mutex so the upgrade installer can wait for this process
        # to fully exit before replacing files it still has loaded.
        _acquire_instance_mutex()

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
            # window.width/height/x/y are PHYSICAL (scaled) pixels on WinForms;
            # convert to logical before saving so the next create_window (which
            # re-applies the scale) reproduces the same size — instead of growing
            # the window by `scale`x on every restart (the shipped bug).
            scale = _get_dpi_scale()
            physical = {
                "width": window.width,
                "height": window.height,
                "x": window.x,
                "y": window.y,
            }
            geom = window_geometry.physical_to_logical(physical, scale)
            logger.info("Window closing", physical=physical, logical=geom, scale=scale)
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
