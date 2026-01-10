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

# MOCK PYHAKO CREDENTIALS BEFORE IMPORTING
# This prevents Keyring access during test collection
sys.modules["pyhako.credentials"] = MagicMock()
# We need to make sure TokenManager is a class we can instantiate
sys.modules["pyhako.credentials"].TokenManager = MagicMock()

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
    """Global mock for PyHako TokenManager to prevent keyring access during tests."""
    # Since we mocked it in sys.modules, we can just configure that mock
    # But for safety and clean state per test, we can use patch which handles restoration
    with patch("pyhako.credentials.TokenManager") as MockTM:
        instance = MockTM.return_value
        instance.load_session.return_value = {"access_token": "mock_token"}
        yield MockTM
