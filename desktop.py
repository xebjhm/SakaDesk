import multiprocessing
multiprocessing.freeze_support()

import webview
webview.settings['ALLOW_DOWNLOADS'] = True
import threading
import uvicorn
import sys
import os
import socket
import traceback
import time
import json
import urllib.request
import ctypes
import platform
# Explicit imports to ensure PyInstaller finds them
from backend.main import app
from backend.services.platform import get_logs_dir, get_app_data_dir

# Setup logging
import structlog

# Setup logging (structlog configured in backend.main, but we need a logger here)
logger = structlog.get_logger()

# Constants
HOST = "127.0.0.1"
SERVER_STARTUP_TIMEOUT = 10  # seconds

# Global reference so cleanup can signal graceful shutdown
_uvicorn_server: uvicorn.Server | None = None


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
            saved = int(port_file.read_text(encoding='utf-8').strip())
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
        port_file.write_text(str(port), encoding='utf-8')
    except OSError:
        pass  # Non-fatal — app still works, just may not persist port
    return port, sock


def wait_for_server(host: str, port: int, timeout: float = SERVER_STARTUP_TIMEOUT) -> bool:
    """Wait for the server to respond to HTTP requests.

    Uses the /health endpoint instead of raw TCP connect — this ensures
    the ASGI app is fully loaded and can serve routes, not just that the
    socket is listening. Prevents the 404 flash on second launch where
    WebView2 restores its cached session before uvicorn is ready.
    """
    url = f'http://{host}:{port}/health'
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
        
        tk.Label(dialog, text="An error occurred:", font=("Arial", 12, "bold")).pack(pady=10)
        
        text = scrolledtext.ScrolledText(dialog, width=70, height=20)
        text.pack(padx=10, pady=5, fill=tk.BOTH, expand=True)
        text.insert(tk.END, f"{error_msg}\n\n{tb}")
        text.config(state=tk.DISABLED)
        
        def copy_to_clipboard():
            root.clipboard_clear()
            root.clipboard_append(f"{error_msg}\n\n{tb}")
            
        tk.Button(dialog, text="Copy to Clipboard", command=copy_to_clipboard).pack(pady=5)
        tk.Button(dialog, text="Close", command=root.destroy).pack(pady=5)
        
        dialog.mainloop()
    except Exception:
        # If tkinter fails, just print to console
        if 'logger' in globals():
            logger.error("FATAL ERROR", error=error_msg, traceback=tb)
        else:
            print(f"FATAL ERROR: {error_msg}\n{tb}")

def _get_window_file():
    """Path to the persisted window geometry file."""
    return get_app_data_dir() / "window.json"


def _get_dpi_scale() -> float:
    """Get the Windows DPI scale factor (e.g. 1.5 for 150%).

    pywebview's WinForms backend treats create_window(x, y) as logical
    coordinates and multiplies them by scale_factor internally, but the
    moved/resized events report physical (already-scaled) pixel values.
    We need this factor to convert between the two coordinate systems
    so that saved geometry can be correctly restored.

    Returns 1.0 on non-Windows platforms where no scaling mismatch exists.
    """
    if platform.system() != "Windows":
        return 1.0
    try:
        return ctypes.windll.shcore.GetScaleFactorForDevice(0) / 100.0  # type: ignore[attr-defined,no-any-return]
    except Exception:
        return 1.0


def _load_window_geometry() -> dict:
    """Load saved window size/position, or return defaults.

    Saved values are in logical (DPI-independent) coordinates, matching
    what pywebview's create_window() expects.  Old files (without the
    ``"format": "logical"`` marker) contain physical coordinates from
    before the DPI fix — these are converted on the fly.
    """
    defaults = {"width": 1200, "height": 800}
    path = _get_window_file()
    if not path.exists():
        return defaults
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        w = int(data.get("width", 0))
        h = int(data.get("height", 0))
        if w < 400 or h < 300 or w > 7680 or h > 4320:
            return defaults

        # Migrate old physical-coordinate files to logical
        if data.get("format") != "logical":
            scale = _get_dpi_scale()
            w = round(w / scale)
            h = round(h / scale)

        result = {"width": w, "height": h}
        if "x" in data and "y" in data:
            x = int(data["x"])
            y = int(data["y"])
            if data.get("format") != "logical":
                x = round(x / scale)
                y = round(y / scale)
            result["x"] = x
            result["y"] = y
        return result
    except Exception:
        return defaults


def _save_window_geometry(geometry: dict) -> None:
    """Save window geometry to disk in logical (DPI-independent) coordinates.

    pywebview's moved/resized events report physical pixel values, but
    create_window() expects logical values (WinForms multiplies both
    position and size by the DPI scale factor internally).  Dividing
    by the scale factor on save prevents drift on every restart.
    """
    try:
        scale = _get_dpi_scale()
        logical: dict = {
            "width": round(geometry["width"] / scale),
            "height": round(geometry["height"] / scale),
            "format": "logical",
        }
        if "x" in geometry and "y" in geometry:
            logical["x"] = round(geometry["x"] / scale)
            logical["y"] = round(geometry["y"] / scale)
        path = _get_window_file()
        path.write_text(json.dumps(logical), encoding="utf-8")
    except Exception:
        pass


def main() -> None:
    try:
        # Create server socket with SO_REUSEADDR for stable port across restarts
        port, sock = create_server_socket()

        # Start API server with the pre-bound socket
        t = threading.Thread(target=start_server, args=(sock,))
        t.daemon = True
        t.start()

        # Wait for server to be ready before creating window
        if not wait_for_server(HOST, port):
            raise RuntimeError(f"Server failed to start on port {port} within {SERVER_STARTUP_TIMEOUT}s")

        # Load saved window geometry
        geom = _load_window_geometry()

        # Create window
        # background_color matches app's bg-[#F0F2F5] to prevent white
        # showing through Windows 11 rounded corners
        window = webview.create_window(
            title='SakaDesk',
            url=f'http://{HOST}:{port}',
            width=geom["width"],
            height=geom["height"],
            x=geom.get("x"),
            y=geom.get("y"),
            resizable=True,
            background_color='#F0F2F5',
        )

        # Track window geometry changes and save on close
        _current_geom = {"width": geom["width"], "height": geom["height"]}
        if "x" in geom:
            _current_geom["x"] = geom["x"]
            _current_geom["y"] = geom["y"]

        def on_resized(width, height):
            _current_geom["width"] = width
            _current_geom["height"] = height

        def on_moved(x, y):
            _current_geom["x"] = x
            _current_geom["y"] = y

        def on_closing():
            _save_window_geometry(_current_geom)

        window.events.resized += on_resized
        window.events.moved += on_moved
        window.events.closing += on_closing

        # Start native GUI loop
        # private_mode=False: persist localStorage (ToS, read states, language)
        # storage_path: store webview data in app data dir alongside settings
        webview.start(
            private_mode=False,
            storage_path=str(get_app_data_dir() / 'webview'),
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
            with open(log_file, 'w', encoding='utf-8') as f:
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

if __name__ == '__main__':
    main()

