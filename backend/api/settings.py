"""
Settings API for HakoDesk
Handles output folder configuration and auto-sync settings.
Uses platform-appropriate paths for Windows deployment.
"""
import json
import logging
from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from backend.services.platform import get_settings_path, get_app_data_dir

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])

# Get settings file path from platform utilities
SETTINGS_FILE = get_settings_path()

def get_default_output_dir() -> str:
    """Returns the default output directory path."""
    return str(Path.cwd() / "output")

def load_config() -> dict:
    """Load configuration from file."""
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, 'r') as f:
                return json.load(f)
        except:
            pass
    return {}

def save_config(config: dict):
    """Save configuration to file."""
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_FILE, 'w') as f:
        json.dump(config, f, indent=2)

class SettingsResponse(BaseModel):
    output_dir: str
    auto_sync_enabled: bool
    sync_interval_minutes: int
    is_configured: bool  # True if user has set up the app

class SettingsUpdate(BaseModel):
    output_dir: Optional[str] = None
    auto_sync_enabled: Optional[bool] = None
    sync_interval_minutes: Optional[int] = None

class FreshCheckResponse(BaseModel):
    is_fresh: bool  # True if output folder is empty or doesn't exist
    output_dir: str

@router.get("", response_model=SettingsResponse)
async def get_settings():
    """Get current settings."""
    config = load_config()
    output_dir = config.get("output_dir", get_default_output_dir())
    
    return SettingsResponse(
        output_dir=output_dir,
        auto_sync_enabled=config.get("auto_sync_enabled", True),
        sync_interval_minutes=config.get("sync_interval_minutes", 1),
        is_configured=config.get("is_configured", False)
    )

@router.post("", response_model=SettingsResponse)
async def update_settings(update: SettingsUpdate):
    """Update settings."""
    config = load_config()
    
    if update.output_dir is not None:
        config["output_dir"] = update.output_dir
        config["is_configured"] = True
    if update.auto_sync_enabled is not None:
        config["auto_sync_enabled"] = update.auto_sync_enabled
    if update.sync_interval_minutes is not None:
        config["sync_interval_minutes"] = update.sync_interval_minutes
    
    save_config(config)
    
    return SettingsResponse(
        output_dir=config.get("output_dir", get_default_output_dir()),
        auto_sync_enabled=config.get("auto_sync_enabled", True),
        sync_interval_minutes=config.get("sync_interval_minutes", 1),
        is_configured=config.get("is_configured", False)
    )

@router.get("/fresh", response_model=FreshCheckResponse)
async def check_fresh_install():
    """Check if output folder is empty (fresh install)."""
    config = load_config()
    output_dir = config.get("output_dir", get_default_output_dir())
    output_path = Path(output_dir)
    
    # Fresh if: doesn't exist, is empty, or only has sync_metadata.json
    is_fresh = True
    if output_path.exists():
        contents = list(output_path.iterdir())
        # Filter out metadata files
        data_contents = [c for c in contents if c.name not in ("sync_metadata.json", ".gitkeep")]
        is_fresh = len(data_contents) == 0
    
    return FreshCheckResponse(
        is_fresh=is_fresh,
        output_dir=output_dir
    )


@router.post("/select-folder")
async def select_folder():
    """Open a native folder picker dialog."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        import threading
    except ImportError as e:
        logger.warning(f"Tkinter not available: {e}")
        return {"path": None, "error": "Folder picker not available (tkinter missing)"}

    # Run in a separate thread to avoid blocking the async event loop
    # although tkinter mainloop usually needs main thread, we are just opening a dialog.
    # On linux this might be tricky if no X11/Wayland context in this specific process,
    # but for a GUI app it should be fine.
    
    selected_path = [None]
    
    def open_dialog():
        try:
            root = tk.Tk()
            root.withdraw() # Hide the main window
            root.attributes('-topmost', True) # Bring to front
            
            folder = filedialog.askdirectory(title="Select Output Folder")
            if folder:
                selected_path[0] = folder
            
            root.destroy()
        except Exception as e:
            logger.error(f"Dialog error: {e}")

    # For thread safety with tkinter
    # In some envs, tk must run in main thread. 
    # But FastAPI runs in async.
    # We'll try running it directly first? No, that blocks.
    # We'll run in a thread.
    
    # Timeout after 5 minutes (user should have selected a folder by then)
    DIALOG_TIMEOUT_SECONDS = 300

    try:
        thread = threading.Thread(target=open_dialog)
        thread.start()
        thread.join(timeout=DIALOG_TIMEOUT_SECONDS)

        if thread.is_alive():
            logger.warning("Folder dialog timed out after 5 minutes")
            return {"path": None, "error": "Dialog timed out"}
    except Exception as e:
        logger.error(f"Thread error: {e}")
        return {"path": None, "error": str(e)}

    if selected_path[0]:
        return {"path": selected_path[0]}
    return {"path": None}
