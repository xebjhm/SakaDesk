import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.append(str(Path(__file__).parent.parent))

# MOCK WEBVIEW BEFORE IMPORTING DESKTOP/BACKEND
# This prevents Tkinter/GTK/QT from trying to initialize
sys.modules["webview"] = MagicMock()

# MOCK PYSAKA CREDENTIALS BEFORE IMPORTING
# This prevents Keyring access during test collection
mock_pysaka_credentials = MagicMock()
mock_pysaka_credentials.TokenManager = MagicMock()
mock_pysaka_credentials.get_token_manager = MagicMock(return_value=MagicMock())
sys.modules["pysaka.credentials"] = mock_pysaka_credentials

# Mock pysaka module with get_auth_dir that returns a real Path
# Note: pysaka is a real installed package, we just mock specific parts
# We need to mock pysaka.logging to prevent actual logging configuration
sys.modules["pysaka.logging"] = MagicMock()

# Set up get_auth_dir for shared browser session tests
_test_auth_dir = Path.home() / ".local" / "share" / "pysaka" / "auth_data"
_test_auth_dir.mkdir(parents=True, exist_ok=True)

# Patch pysaka.get_auth_dir at import time
import pysaka as real_pysaka
real_pysaka.get_auth_dir = lambda: _test_auth_dir

from backend.main import app

@pytest.fixture
def client():
    """Sync client for simple API tests."""
    return TestClient(app)

@pytest.fixture
def mock_webview():
    """Mock the pywebview module."""
    with patch("backend.main.webview") as mock:
        yield mock

@pytest.fixture(autouse=True)
def mock_token_manager():
    """Global mock for pysaka TokenManager to prevent keyring access during tests."""
    # Since we mocked it in sys.modules, we can just configure that mock
    # But for safety and clean state per test, we can use patch which handles restoration
    with patch("pysaka.credentials.TokenManager") as MockTM:
        instance = MockTM.return_value
        instance.load_session.return_value = {"access_token": "mock_token"}
        yield MockTM
