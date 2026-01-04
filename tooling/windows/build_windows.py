import os
import subprocess
import shutil
import sys
from pathlib import Path

# Paths
PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
DIST_DIR = PROJECT_ROOT / "dist"
BUILD_DIR = PROJECT_ROOT / "build"
ISS_SCRIPT = PROJECT_ROOT / "tooling" / "windows" / "setup.iss"

def run_command(cmd, cwd=None):
    print(f"Running: {' '.join(cmd)}")
    subprocess.check_call(cmd, cwd=cwd, shell=True)

def find_iscc():
    """Find Inno Setup Compiler executable."""
    # Check PATH first
    iscc = shutil.which("ISCC")
    if iscc:
        return iscc
    
    # Check standard locations
    possible_paths = [
        r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        r"C:\Program Files\Inno Setup 6\ISCC.exe",
    ]
    
    for p in possible_paths:
        if os.path.exists(p):
            return p
            
    return None

def build_exe():
    print("--- Building Executable with PyInstaller ---")
    
    # Ensure frontend is built first? 
    # We assume 'frontend/dist' exists or let the user handle it. 
    # But strictly speaking, for a full build script, we might want to check.
    frontend_dist = PROJECT_ROOT / "frontend" / "dist"
    if not frontend_dist.exists():
        print("WARNING: frontend/dist not found. The GUI will be empty.")
    
    # PyInstaller arguments matching the original build.yml
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--onedir",
        "--windowed",
        "--name", "HakoDesk",
        "--paths", str(PROJECT_ROOT),
        "--add-data", f"frontend/dist{os.pathsep}frontend/dist",
        
        # Hidden imports
        "--hidden-import", "pyhako",
        "--hidden-import", "pyhako.auth",
        "--hidden-import", "pyhako.client",
        "--hidden-import", "pyhako.utils",
        "--hidden-import", "keyring",
        "--hidden-import", "keyring.backends",
        "--hidden-import", "keyring.backends.Windows",
        "--hidden-import", "win32ctypes",
        "--hidden-import", "win32ctypes.core",
        "--hidden-import", "uvicorn",
        "--hidden-import", "uvicorn.logging",
        "--hidden-import", "uvicorn.protocols",
        "--hidden-import", "uvicorn.protocols.http",
        "--hidden-import", "uvicorn.protocols.http.auto",
        "--hidden-import", "uvicorn.protocols.websockets",
        "--hidden-import", "uvicorn.protocols.websockets.auto",
        "--hidden-import", "uvicorn.lifespan",
        "--hidden-import", "uvicorn.lifespan.on",
        "--hidden-import", "fastapi",
        "--hidden-import", "starlette",
        "--hidden-import", "starlette.responses",
        "--hidden-import", "starlette.routing",
        "--hidden-import", "starlette.middleware",
        "--hidden-import", "starlette.staticfiles",
        "--hidden-import", "pydantic",
        "--hidden-import", "multipart",
        "--hidden-import", "backend",
        "--hidden-import", "backend.main",
        "--hidden-import", "backend.api",
        "--hidden-import", "backend.api.auth",
        "--hidden-import", "backend.api.content",
        "--hidden-import", "backend.api.sync",
        "--hidden-import", "backend.services",
        "--hidden-import", "backend.services.auth_service",
        "--hidden-import", "backend.services.sync_service",
        
        # Collect all
        "--collect-all", "fastapi",
        "--collect-all", "starlette",
        "--collect-all", "uvicorn",
        "--collect-all", "pydantic",
        "--collect-all", "pydantic_core",
        "--collect-all", "pyhako",
        "--collect-all", "playwright",
        "--collect-all", "aiofiles",
        "--collect-all", "keyring",
        "--collect-all", "backend",
        
        str(PROJECT_ROOT / "desktop.py")
    ]
    
    run_command(cmd, cwd=PROJECT_ROOT)

def build_installer():
    print("--- Building Installer with Inno Setup ---")
    iscc = find_iscc()
    if not iscc:
        print("ERROR: Inno Setup (ISCC.exe) not found.")
        print("Please install Inno Setup 6: https://jrsoftware.org/isdl.php")
        sys.exit(1)
        
    cmd = [iscc, str(ISS_SCRIPT)]
    run_command(cmd, cwd=PROJECT_ROOT)

def main():
    build_exe()
    build_installer()
    print(f"--- SUCCESS ---")
    print(f"Installer created at: {DIST_DIR / 'HakoDesk-Setup.exe'}")

if __name__ == "__main__":
    main()
