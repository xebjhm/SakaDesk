
from fastapi import APIRouter
from pydantic import BaseModel
import platform
import sys
import os
import shutil
from pathlib import Path
from backend.services.platform import get_app_data_dir, get_settings_path, get_logs_dir

router = APIRouter(prefix="/api/diagnostics", tags=["diagnostics"])

class SystemInfo(BaseModel):
    os: str
    os_release: str
    python_version: str
    app_data_dir: str
    settings_path: str
    is_windows: bool
    
class DiagnosticsResponse(BaseModel):
    system: SystemInfo
    config_state: dict
    logs: list[str]

@router.get("", response_model=DiagnosticsResponse)
async def get_diagnostics():
    """Collect system diagnostics and recent logs."""
    
    # System Info
    sys_info = SystemInfo(
        os=platform.system(),
        os_release=platform.release(),
        python_version=sys.version.split()[0],
        app_data_dir=str(get_app_data_dir()),
        settings_path=str(get_settings_path()),
        is_windows=(platform.system() == "Windows")
    )
    
    # Config State (Safe subset)
    config_state = {}
    try:
        if get_settings_path().exists():
            with open(get_settings_path(), 'r') as f:
                import json
                data = json.load(f)
                config_state['is_configured'] = data.get('is_configured')
                config_state['output_dir_configured'] = 'output_dir' in data
                config_state['auto_sync'] = data.get('auto_sync_enabled')
    except Exception as e:
        config_state['error'] = str(e)
        
    # Logs (Last 50 lines of latest log)
    logs = []
    try:
        log_dir = get_logs_dir()
        if log_dir.exists():
            log_files = sorted(log_dir.glob("*.log"), key=os.path.getmtime, reverse=True)
            if log_files:
                latest_log = log_files[0]
                with open(latest_log, 'r', encoding='utf-8', errors='ignore') as f:
                    lines = f.readlines()
                    logs = [l.strip() for l in lines[-50:]]
    except Exception as e:
        logs.append(f"Error reading logs: {e}")
        
    return DiagnosticsResponse(
        system=sys_info,
        config_state=config_state,
        logs=logs
    )
