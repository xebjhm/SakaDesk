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

# Everything in frontend/dist is bundled into the installer and served by the app
# (a real paid-message export once shipped this way; security audit 2026-11-13).
# frontend/public's allowlist (tests/test_release_hygiene.py) lacks index.html,
# which Vite builds from frontend/index.html.
DIST_ALLOWED_FILES = frozenset({"index.html", "logo-192.png", "logo-32.png"})
DIST_ALLOWED_DIRS = frozenset({"assets"})


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


def verify_frontend_dist(dist: Path) -> None:
    """Stop the build when frontend/dist holds anything but the UI build.

    Allowed: the files in DIST_ALLOWED_FILES and the directories in
    DIST_ALLOWED_DIRS. Anything else is named and the build exits with code 1
    before PyInstaller bundles it.
    """
    unexpected = sorted(
        entry.name
        for entry in dist.iterdir()
        if not (
            (entry.is_file() and entry.name in DIST_ALLOWED_FILES)
            or (entry.is_dir() and entry.name in DIST_ALLOWED_DIRS)
        )
    )
    if unexpected:
        print(f"ERROR: unexpected entries in frontend/dist: {', '.join(unexpected)}")
        print(
            "Only the UI build may ship (index.html, logo-192.png, logo-32.png, "
            "assets/). Remove them (check frontend/public) and rebuild."
        )
        sys.exit(1)


def build_exe():
    """Build the executable with PyInstaller."""
    print("--- Building Executable with PyInstaller ---")

    # We assume 'frontend/dist' exists or let the user handle it; when it does,
    # it must hold only the UI build, because PyInstaller bundles all of it.
    frontend_dist = PROJECT_ROOT / "frontend" / "dist"
    if not frontend_dist.exists():
        print("WARNING: frontend/dist not found. The GUI will be empty.")
    else:
        verify_frontend_dist(frontend_dist)

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
