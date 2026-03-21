import os
import re
import subprocess
import shutil
import sys
import tomllib
from pathlib import Path

# Paths
PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
DIST_DIR = PROJECT_ROOT / "dist"
BUILD_DIR = PROJECT_ROOT / "build"
ISS_SCRIPT = PROJECT_ROOT / "tooling" / "windows" / "setup.iss"
PYPROJECT_TOML = PROJECT_ROOT / "pyproject.toml"


def get_version() -> str:
    """Extract version from pyproject.toml."""
    with open(PYPROJECT_TOML, "rb") as f:
        data = tomllib.load(f)
    return data["project"]["version"]


def run_command(cmd, cwd=None):
    print(f"Running: {' '.join(cmd)}")
    subprocess.check_call(cmd, cwd=cwd)


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
    """Build the executable with PyInstaller."""
    print("--- Building Executable with PyInstaller ---")

    # Ensure frontend is built first?
    # We assume 'frontend/dist' exists or let the user handle it.
    # But strictly speaking, for a full build script, we might want to check.
    frontend_dist = PROJECT_ROOT / "frontend" / "dist"
    if not frontend_dist.exists():
        print("WARNING: frontend/dist not found. The GUI will be empty.")

    spec_file = PROJECT_ROOT / "tooling" / "build_windows.spec"

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        str(spec_file),
    ]

    run_command(cmd, cwd=PROJECT_ROOT)


def _validate_version(version: str) -> None:
    """Validate version string to prevent command injection via ISCC args."""
    if not re.fullmatch(r"\d+\.\d+\.\d+([.a-zA-Z0-9-]*)", version):
        print(f"ERROR: Invalid version string: {version!r}")
        sys.exit(1)


def build_installer():
    print("--- Building Installer with Inno Setup ---")
    iscc = find_iscc()
    if not iscc:
        print("ERROR: Inno Setup (ISCC.exe) not found.")
        print("Please install Inno Setup 6: https://jrsoftware.org/isdl.php")
        sys.exit(1)

    version = get_version()
    _validate_version(version)
    print(f"Building installer for version: {version}")
    cmd = [iscc, f"/DAppVersion={version}", str(ISS_SCRIPT)]
    run_command(cmd, cwd=PROJECT_ROOT)


def main():
    build_exe()
    build_installer()
    version = get_version()
    print("--- SUCCESS ---")
    print(f"Installer created at: {DIST_DIR / f'SakaDesk-{version}-Setup.exe'}")


if __name__ == "__main__":
    main()
