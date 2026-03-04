"""
Settings API for HakoDesk
Handles output folder configuration and auto-sync settings.
Uses platform-appropriate paths for Windows deployment.
"""
import json
import structlog
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, Optional

from backend.services.platform import get_settings_path
from backend.services.service_utils import validate_service
from backend.services.notification_service import set_notifications_enabled
from backend.services.settings_store import (
    load_config as _store_load,
    save_config as _store_save,
    update_config as _store_update,
)

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])

# Get settings file path from platform utilities
SETTINGS_FILE = get_settings_path()

def get_default_output_dir() -> str:
    """Returns the default output directory path."""
    return str(Path.cwd() / "output")


# ---------------------------------------------------------------------------
# Backward-compatible sync helpers (used by tests that patch SETTINGS_FILE).
# Production code should use the async _store_* functions instead.
# ---------------------------------------------------------------------------

def load_config() -> dict[str, Any]:
    """Load configuration from file (sync, for tests only)."""
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                result: dict[str, Any] = json.load(f)
                logger.debug("Settings loaded", settings_file=str(SETTINGS_FILE), keys=list(result.keys()), is_configured=result.get("is_configured"))
                return result
        except Exception as e:
            logger.error("Failed to load settings", settings_file=str(SETTINGS_FILE), error=str(e))
    return {}

def save_config(config: dict):
    """Save configuration to file (sync, for tests only)."""
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2)
    logger.debug("Settings saved", settings_file=str(SETTINGS_FILE), keys=list(config.keys()), is_configured=config.get("is_configured"))

class SettingsResponse(BaseModel):
    output_dir: str
    auto_sync_enabled: bool
    sync_interval_minutes: int
    adaptive_sync_enabled: bool = True  # Randomize intervals based on activity patterns
    is_configured: bool  # True if user has set up the app
    user_nickname: Optional[str] = None  # User's nickname for %%% placeholder replacement
    notifications_enabled: bool = True  # Desktop notifications for new messages

class SettingsUpdate(BaseModel):
    output_dir: Optional[str] = None
    auto_sync_enabled: Optional[bool] = None
    sync_interval_minutes: Optional[int] = None
    adaptive_sync_enabled: Optional[bool] = None
    notifications_enabled: Optional[bool] = None

class FreshCheckResponse(BaseModel):
    is_fresh: bool  # True if output folder is empty or doesn't exist
    output_dir: str


class ServiceSettings(BaseModel):
    """Per-service settings model."""
    sync_enabled: bool = True
    adaptive_sync_enabled: bool = True
    last_sync: Optional[str] = None
    blogs_full_backup: bool = False

@router.get("", response_model=SettingsResponse)
async def get_settings():
    """Get current settings."""
    config = await _store_load()
    output_dir = config.get("output_dir", get_default_output_dir())

    # Sync notification service state with persisted setting
    notifications_enabled = config.get("notifications_enabled", True)
    set_notifications_enabled(notifications_enabled)

    return SettingsResponse(
        output_dir=output_dir,
        auto_sync_enabled=config.get("auto_sync_enabled", True),
        sync_interval_minutes=config.get("sync_interval_minutes", 1),
        adaptive_sync_enabled=config.get("adaptive_sync_enabled", True),
        is_configured=config.get("is_configured", False),
        user_nickname=config.get("user_nickname"),
        notifications_enabled=notifications_enabled,
    )

@router.post("", response_model=SettingsResponse)
async def update_settings(update: SettingsUpdate):
    """Update settings."""
    def _apply(config: dict) -> None:
        if update.output_dir is not None:
            config["output_dir"] = update.output_dir
            config["is_configured"] = True
        if update.auto_sync_enabled is not None:
            config["auto_sync_enabled"] = update.auto_sync_enabled
        if update.sync_interval_minutes is not None:
            config["sync_interval_minutes"] = update.sync_interval_minutes
        if update.adaptive_sync_enabled is not None:
            config["adaptive_sync_enabled"] = update.adaptive_sync_enabled
        if update.notifications_enabled is not None:
            config["notifications_enabled"] = update.notifications_enabled
            set_notifications_enabled(update.notifications_enabled)

    config = await _store_update(_apply)

    return SettingsResponse(
        output_dir=config.get("output_dir", get_default_output_dir()),
        auto_sync_enabled=config.get("auto_sync_enabled", True),
        sync_interval_minutes=config.get("sync_interval_minutes", 1),
        adaptive_sync_enabled=config.get("adaptive_sync_enabled", True),
        is_configured=config.get("is_configured", False),
        user_nickname=config.get("user_nickname"),
        notifications_enabled=config.get("notifications_enabled", True),
    )

@router.get("/fresh", response_model=FreshCheckResponse)
async def check_fresh_install():
    """Check if output folder is empty (fresh install)."""
    config = await _store_load()
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
    
    selected_path: list[Optional[str]] = [None]

    def open_dialog() -> None:
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


@router.get("/service/{service}", response_model=ServiceSettings)
async def get_service_settings(service: str):
    """Get settings for a specific service."""
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    config = await _store_load()
    services = config.get("services", {})
    service_config = services.get(service, {})

    return ServiceSettings(
        sync_enabled=service_config.get("sync_enabled", True),
        adaptive_sync_enabled=service_config.get("adaptive_sync_enabled", True),
        last_sync=service_config.get("last_sync"),
        blogs_full_backup=service_config.get("blogs_full_backup", False),
    )


@router.post("/service/{service}", response_model=ServiceSettings)
async def update_service_settings(service: str, update: ServiceSettings):
    """Update settings for a specific service."""
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    def _apply(config: dict) -> None:
        if "services" not in config:
            config["services"] = {}
        config["services"][service] = {
            "sync_enabled": update.sync_enabled,
            "adaptive_sync_enabled": update.adaptive_sync_enabled,
            "last_sync": update.last_sync,
            "blogs_full_backup": update.blogs_full_backup,
        }

    await _store_update(_apply)
    return update


@router.post("/service/{service}/init", response_model=ServiceSettings)
async def init_service_settings(service: str):
    """Initialize settings for a newly connected service.

    Called after successful login to ensure the service has an entry in settings.
    Uses default values if not already configured.
    """
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    initialized = False

    def _apply(config: dict) -> None:
        nonlocal initialized
        if "services" not in config:
            config["services"] = {}
        # Only initialize if not already configured
        if service not in config["services"]:
            config["services"][service] = {
                "sync_enabled": True,
                "adaptive_sync_enabled": True,
                "last_sync": None,
                "blogs_full_backup": False,
            }
            initialized = True

    config = await _store_update(_apply)

    if initialized:
        logger.info(f"Initialized settings for newly connected service: {service}")

    return ServiceSettings(**config["services"][service])
