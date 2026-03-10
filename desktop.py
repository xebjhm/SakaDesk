import webview
import threading
import uvicorn
import sys
import socket
import traceback
import time
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
    """Wait for the server to become available."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            result = sock.connect_ex((host, port))
            sock.close()
            if result == 0:
                return True
        except OSError:
            pass
        time.sleep(0.1)
    return False


def start_server(sock: socket.socket) -> None:
    """Start uvicorn with a pre-bound SO_REUSEADDR socket.

    By passing our own socket, we bypass asyncio's default socket creation
    which uses SO_EXCLUSIVEADDRUSE on Windows — that flag rejects ports
    in TIME_WAIT state and would force a new port on quick restarts.
    """
    config = uvicorn.Config(app, log_level="error")
    server = uvicorn.Server(config)
    server.run(sockets=[sock])

def show_error_dialog(error_msg: str, tb: str):
    """Show a simple error dialog with traceback."""
    try:
        import tkinter as tk
        from tkinter import scrolledtext
        
        root = tk.Tk()
        root.withdraw()
        
        # Create a custom dialog
        dialog = tk.Toplevel(root)
        dialog.title("HakoDesk Error")
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

        # Create window
        # background_color matches app's bg-[#F0F2F5] to prevent white
        # showing through Windows 11 rounded corners
        webview.create_window(
            title='HakoDesk',
            url=f'http://{HOST}:{port}',
            width=1200,
            height=800,
            resizable=True,
            background_color='#F0F2F5',
        )

        # Start native GUI loop
        # private_mode=False: persist localStorage (ToS, read states, language)
        # storage_path: store webview data in app data dir alongside settings
        webview.start(
            private_mode=False,
            storage_path=str(get_app_data_dir() / 'webview'),
        )

        # Cleanup AFTER webview closes but BEFORE process exits.
        # The uvicorn thread is a daemon — Python kills it instantly when
        # main() returns, so @app.on_event("shutdown") never fires.
        # We must release file handles here so the uninstaller can delete them.
        import logging
        try:
            from backend.services.search_service import shutdown_search_service
            shutdown_search_service()
        except Exception:
            pass
        for handler in logging.root.handlers[:]:
            try:
                handler.flush()
                handler.close()
            except Exception:
                pass

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
        sys.exit(1)

if __name__ == '__main__':
    main()

