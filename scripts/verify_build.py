#!/usr/bin/env python3
"""
Build verification script for ZakaDesk.

Verifies that the application can be built and runs correctly on the current platform.

Usage:
    uv run python scripts/verify_build.py           # Full verification (build + test)
    uv run python scripts/verify_build.py --quick   # Skip slow tests
    uv run python scripts/verify_build.py --build   # Also create Windows installer (requires Inno Setup)

Cross-platform support:
    - On Linux/WSL: Runs tests directly
    - On Windows with WSL path: Triggers build_windows.bat (copies to temp, builds natively)
    - On Windows native: Runs tests directly

Tests:
    1. Frontend builds successfully
    2. Python backend imports work
    3. pytest tests pass
    4. Application health endpoint responds
"""
import subprocess
import platform
import sys
import time
import socket
from pathlib import Path


def get_project_root() -> Path:
    """Get path to project root."""
    return Path(__file__).parent.parent


def is_wsl_path() -> bool:
    """Check if we're running on Windows but accessing a WSL path."""
    if platform.system() != "Windows":
        return False
    project_path = str(get_project_root())
    return "wsl.localhost" in project_path or "wsl$" in project_path


def run_windows_build_from_wsl() -> int:
    """
    When running from Windows against WSL path, trigger the batch script
    which copies to Windows temp and builds natively.
    """
    print("=" * 60)
    print("  Cross-platform build detected")
    print("=" * 60)
    print()
    print("  Running Windows Python against WSL project.")
    print("  Triggering build_windows.bat to copy and build natively...")
    print()

    project_root = get_project_root()
    batch_script = project_root / "scripts" / "build_windows.bat"

    if not batch_script.exists():
        print(f"ERROR: build_windows.bat not found at {batch_script}")
        return 1

    # Run the batch script
    try:
        result = subprocess.run(
            [str(batch_script)],
            shell=True,
            cwd=str(project_root)
        )
        return result.returncode
    except Exception as e:
        print(f"ERROR: Failed to run build script: {e}")
        return 1


def check_environment() -> bool:
    """Check if we're running in a valid environment (non-WSL-path case)."""
    project_root = get_project_root()

    # Check if pyproject.toml exists (we're in project root)
    if not (project_root / "pyproject.toml").exists():
        print("ERROR: pyproject.toml not found. Run from project root.")
        return False

    # Check if .venv exists or uv is available
    venv_path = project_root / ".venv"
    if not venv_path.exists():
        print("WARNING: .venv not found. Run 'uv sync' first to install dependencies.")

    return True


def run_command(
    cmd: list[str],
    cwd: Path | None = None,
    timeout: int = 120,
    check: bool = True
) -> tuple[int, str, str]:
    """Run command and return (returncode, stdout, stderr)."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            timeout=timeout,
            cwd=cwd
        )
        if check and result.returncode != 0:
            print(f"   Command failed: {' '.join(cmd)}")
            print(f"   stderr: {result.stderr[:500]}")
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "Command timed out"
    except Exception as e:
        return -1, "", str(e)


def find_free_port() -> int:
    """Find a free port on localhost."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def test_frontend_build() -> bool:
    """Test that frontend builds successfully."""
    print("📋 Testing frontend build...")
    project_root = get_project_root()
    frontend_dir = project_root / "frontend"

    if not frontend_dir.exists():
        print("   ❌ Frontend directory not found")
        return False

    # Check if node_modules exists, if not install
    if not (frontend_dir / "node_modules").exists():
        print("   📦 Installing npm dependencies...")
        code, _, stderr = run_command(["npm", "ci"], cwd=frontend_dir, timeout=180)
        if code != 0:
            print(f"   ❌ npm ci failed: {stderr[:200]}")
            return False

    # Build frontend
    print("   🔨 Building frontend...")
    code, _, stderr = run_command(["npm", "run", "build"], cwd=frontend_dir, timeout=120)
    if code != 0:
        print("   ❌ Frontend build failed")
        return False

    # Verify dist exists
    if not (frontend_dir / "dist" / "index.html").exists():
        print("   ❌ Frontend build output not found")
        return False

    print("   ✅ Frontend builds successfully")
    return True


def test_python_imports() -> bool:
    """Test that all Python imports work."""
    print("📋 Testing Python imports...")
    project_root = get_project_root()

    imports_to_test = [
        "fastapi",
        "uvicorn",
        "pyzaka",
        "keyring",
        "structlog",
        "backend.main",
        "backend.api.auth",
        "backend.api.content",
        "backend.api.sync",
        "backend.api.settings",
        "backend.services.platform",
        "backend.services.auth_service",
        "backend.services.sync_service",
    ]

    failed = []
    for module in imports_to_test:
        code, _, stderr = run_command(
            [sys.executable, "-c", f"import {module}"],
            cwd=project_root,
            check=False
        )
        if code != 0:
            failed.append(module)

    if failed:
        print(f"   ❌ Failed imports: {', '.join(failed)}")
        return False

    print(f"   ✅ All {len(imports_to_test)} imports work")
    return True


def test_pytest() -> bool:
    """Run pytest tests."""
    print("📋 Running pytest...")
    project_root = get_project_root()

    code, stdout, stderr = run_command(
        [sys.executable, "-m", "pytest", "-v", "--tb=short"],
        cwd=project_root,
        timeout=300,
        check=False
    )

    # Count passed/failed from output
    if "passed" in stdout:
        # Extract summary line
        for line in stdout.split('\n'):
            if "passed" in line or "failed" in line:
                print(f"   {line.strip()}")
                break

    if code != 0:
        print("   ❌ Some tests failed")
        return False

    print("   ✅ All tests passed")
    return True


def test_health_endpoint() -> bool:
    """Test that the application starts and responds to health check."""
    print("📋 Testing health endpoint...")
    project_root = get_project_root()

    # Find a free port
    port = find_free_port()

    # Start the server in background
    server_process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "error"],
        cwd=project_root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    try:
        # Wait for server to start
        time.sleep(3)

        # Check if process is still running
        if server_process.poll() is not None:
            _, stderr = server_process.communicate(timeout=5)
            print(f"   ❌ Server failed to start: {stderr[:200]}")
            return False

        # Try to connect
        import http.client
        try:
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
            conn.request("GET", "/health")
            response = conn.getresponse()

            if response.status == 200:
                data = response.read().decode()
                if '"status":"ok"' in data or "'status': 'ok'" in data:
                    print("   ✅ Health endpoint responds correctly")
                    return True
                else:
                    print(f"   ❌ Unexpected response: {data}")
                    return False
            else:
                print(f"   ❌ Health check returned status {response.status}")
                return False
        except Exception as e:
            print(f"   ❌ Could not connect to server: {e}")
            return False
    finally:
        # Stop the server
        server_process.terminate()
        try:
            server_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server_process.kill()


def build_windows_installer() -> bool:
    """Build Windows installer (Windows only, requires Inno Setup)."""
    if platform.system() != "Windows":
        print("   ⏭️  Skipping Windows installer (not on Windows)")
        return True

    print("📋 Building Windows installer...")
    project_root = get_project_root()

    build_script = project_root / "tooling" / "windows" / "build_windows.py"
    if not build_script.exists():
        print("   ❌ Build script not found")
        return False

    code, stdout, stderr = run_command(
        [sys.executable, str(build_script)],
        cwd=project_root,
        timeout=600,
        check=False
    )

    if code != 0:
        print(f"   ❌ Installer build failed: {stderr[:200]}")
        return False

    # Check if installer was created (name matches setup.iss OutputBaseFilename)
    import tomllib
    try:
        with open(project_root / "pyproject.toml", "rb") as f:
            version = tomllib.load(f)["project"]["version"]
    except Exception:
        version = "0.1.0"
    installer_path = project_root / "dist" / f"ZakaDesk-{version}-Setup.exe"
    if installer_path.exists():
        size_mb = installer_path.stat().st_size / 1024 / 1024
        print(f"   ✅ Installer created: {installer_path.name} ({size_mb:.1f} MB)")
        return True
    else:
        print(f"   ❌ Installer not found: {installer_path.name}")
        return False


def main():
    args = sys.argv[1:]
    quick_mode = "--quick" in args
    build_mode = "--build" in args

    print("=" * 50)
    print("  ZakaDesk Build Verification")
    print("=" * 50)
    print(f"  Platform: {platform.system()} {platform.machine()}")
    print(f"  Python:   {sys.version.split()[0]}")
    print(f"  Mode:     {'Quick' if quick_mode else 'Full'}")
    print("=" * 50)
    print()

    # Handle cross-platform case: Windows Python accessing WSL path
    # Trigger the batch script which copies to temp and builds natively
    if is_wsl_path():
        sys.exit(run_windows_build_from_wsl())

    # Check environment for normal execution
    if not check_environment():
        sys.exit(1)

    results = []

    # Always run these
    results.append(("Frontend build", test_frontend_build()))
    results.append(("Python imports", test_python_imports()))

    if not quick_mode:
        results.append(("Pytest", test_pytest()))
        results.append(("Health endpoint", test_health_endpoint()))

    if build_mode:
        results.append(("Windows installer", build_windows_installer()))

    # Summary
    print()
    print("=" * 50)
    print("  Summary")
    print("=" * 50)

    all_passed = True
    for name, passed in results:
        status = "✅" if passed else "❌"
        print(f"  {status} {name}")
        if not passed:
            all_passed = False

    print()
    if all_passed:
        print("🎉 All verifications passed!")
        sys.exit(0)
    else:
        print("⚠️  Some verifications failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
