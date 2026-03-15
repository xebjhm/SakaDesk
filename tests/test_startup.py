
import pytest
import shutil
import subprocess
from pathlib import Path
from fastapi.testclient import TestClient

# 1. Backend Startup Test
def test_backend_startup_success():
    """
    Verify the backend initializes correctly and responds to health checks.
    This effectively tests that all module imports (including Keyring/DBus) 
    are resolved and the FastAPI app is created without crashing.
    """
    from backend.main import app
    client = TestClient(app)
    
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    
    # Also verify auth status doesn't crash (logic check)
    response = client.get("/api/auth/status")
    # It might return unauthenticated, but shouldn't crash (500)
    assert response.status_code in [200, 401] 

# 2. Frontend Startup/Integrity Test
def test_frontend_integrity():
    """
    Verify the frontend project structure is valid and dependencies are defined.
    """
    frontend_dir = Path("frontend")
    assert frontend_dir.exists(), "Frontend directory missing"
    assert (frontend_dir / "package.json").exists(), "frontend/package.json missing"
    assert (frontend_dir / "tsconfig.json").exists(), "frontend/tsconfig.json missing"
    assert (frontend_dir / "vite.config.ts").exists(), "frontend/vite.config.ts missing"

@pytest.mark.slow
def test_frontend_compilation():
    """
    Attempt to compile the frontend typescript to ensure no breaking syntax errors.
    Marked as slow because it requires npm/node.
    """
    frontend_dir = Path("frontend").resolve()
    
    # Check if npm is installed
    if not shutil.which("npm"):
        pytest.skip("npm not found, skipping frontend build test")
        
    # Check if node_modules exists (approximate check if installed)
    if not (frontend_dir / "node_modules").exists():
        pytest.skip("frontend/node_modules missing, please run 'npm install' first")

    # Run Type Check (tsc) -> Faster than full build, good enough for "startup/syntax" check
    # We use 'npx' to use the local typescript version
    try:
        # We assume 'tsc' is available via npx 
        result = subprocess.run(
            ["npx", "tsc", "--noEmit"], 
            cwd=str(frontend_dir),
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            pytest.fail(f"Frontend compilation failed:\n{result.stderr}\n{result.stdout}")
            
    except Exception as e:
        pytest.fail(f"Failed to run frontend type check: {e}")
