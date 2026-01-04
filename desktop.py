import webview
import threading
import uvicorn
import sys
import os
import socket
import logging
import traceback
# Explicit imports to ensure PyInstaller finds them
import fastapi
import starlette.responses
import backend.main
from backend.main import app
from backend.services.platform import get_logs_dir

# Setup logging
logger = logging.getLogger(__name__)

# Constants
HOST = "127.0.0.1"

def get_free_port():
    """Find a free port on localhost."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind((HOST, 0)) # Bind to port 0 to let OS choose
    port = sock.getsockname()[1]
    sock.close()
    return port

def start_server(port):
    """Start the uvicorn server in a separate thread."""
    # We must run on the exact port we found
    uvicorn.run(app, host=HOST, port=port, log_level="error")

def show_error_dialog(error_msg: str, tb: str):
    """Show a simple error dialog with traceback."""
    try:
        import tkinter as tk
        from tkinter import messagebox, scrolledtext
        
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
    except:
        # If tkinter fails, just print to console
        print(f"FATAL ERROR: {error_msg}\n{tb}")

def main():
    try:
        # Find a free port
        port = get_free_port()
        
        # Start API server
        t = threading.Thread(target=start_server, args=(port,))
        t.daemon = True
        t.start()

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
        except:
            pass
        
        # Show dialog
        show_error_dialog(error_msg, tb)
        sys.exit(1)

if __name__ == '__main__':
    main()

