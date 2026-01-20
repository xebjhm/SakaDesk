import webview
import threading
import uvicorn
import sys
import socket
import traceback
import time
# Explicit imports to ensure PyInstaller finds them
from backend.main import app
from backend.services.platform import get_logs_dir

# Setup logging
import structlog

# Setup logging (structlog configured in backend.main, but we need a logger here)
logger = structlog.get_logger()

# Constants
HOST = "127.0.0.1"
SERVER_STARTUP_TIMEOUT = 10  # seconds


def get_free_port() -> int:
    """Find a free port on localhost."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind((HOST, 0))  # Bind to port 0 to let OS choose
    port = sock.getsockname()[1]
    sock.close()
    return port


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


def start_server(port: int) -> None:
    """Start the uvicorn server in a separate thread."""
    uvicorn.run(app, host=HOST, port=port, log_level="error")

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
        # Find a free port
        port = get_free_port()

        # Start API server
        t = threading.Thread(target=start_server, args=(port,))
        t.daemon = True
        t.start()

        # Wait for server to be ready before creating window
        if not wait_for_server(HOST, port):
            raise RuntimeError(f"Server failed to start on port {port} within {SERVER_STARTUP_TIMEOUT}s")

        # Create window
        webview.create_window(
            title='HakoDesk',
            url=f'http://{HOST}:{port}',
            width=1200,
            height=800,
            resizable=True
        )

        # Start native GUI loop
        webview.start()
        
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

