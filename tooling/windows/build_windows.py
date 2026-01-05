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

    print("--- Building Executable with PyInstaller ---")
    
    # Ensure frontend is built first? 
    # We assume 'frontend/dist' exists or let the user handle it. 
    # But strictly speaking, for a full build script, we might want to check.
    frontend_dist = PROJECT_ROOT / "frontend" / "dist"
    if not frontend_dist.exists():
        print("WARNING: frontend/dist not found. The GUI will be empty.")
    
    spec_file = PROJECT_ROOT / "tooling" / "build_windows.spec"
    
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--clean",
        str(spec_file)
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
