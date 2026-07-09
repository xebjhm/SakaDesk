import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Add project root to Python path for test discovery
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.main import app  # noqa: E402


@pytest.fixture
def client():
    """Sync TestClient for backend/tests API tests.

    backend/tests/ is a sibling of the top-level tests/ dir (which defines its
    own `client` fixture), so pytest's fixture resolution never sees that one
    here — conftest fixtures only propagate down the directory tree, not across
    siblings. This local fixture makes `client` available to tests under
    backend/tests/ directly.
    """
    return TestClient(app)
