import os
import sys
from pathlib import Path

import keyring
import keyring.backend
import keyring.errors
import pytest
from fastapi.testclient import TestClient

# Add project root to Python path for test discovery
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.main import app  # noqa: E402


class _InMemoryKeyring(keyring.backend.KeyringBackend):
    """Dict-backed keyring so the suite NEVER touches the OS credential store.

    backend/tests historically ran against the real Windows Credential
    Manager: two unmocked /api/translation/configure tests overwrote and then
    deleted the developer's real `pysaka:llm_provider_api_key` entry on every
    full-suite run (misdiagnosed for days as an installer upgrade bug).
    Unlike a MagicMock of pysaka.credentials (the top-level tests/ approach),
    this keeps pysaka's real KeyringStore/TokenManager code in play — only
    the storage is fake.
    """

    priority = 1  # type: ignore[assignment]

    def __init__(self) -> None:
        super().__init__()
        self._store: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self._store.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self._store[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        try:
            del self._store[(service, username)]
        except KeyError:
            raise keyring.errors.PasswordDeleteError(
                f"no credential for {service}/{username}"
            ) from None


@pytest.fixture(autouse=True, scope="session")
def _isolate_machine_state(tmp_path_factory: pytest.TempPathFactory):
    """Session-wide barrier between the suite and the developer's machine.

    (a) Swaps the process keyring for an in-memory one — no test can read,
    overwrite, or delete real credentials, mocked or not.
    (b) Points SAKADESK_DATA_DIR at a temp dir so settings.json / app DBs
    are never the real ones (platform.get_app_data_dir honors it per call).
    """
    original_keyring = keyring.get_keyring()
    keyring.set_keyring(_InMemoryKeyring())

    original_data_dir = os.environ.get("SAKADESK_DATA_DIR")
    os.environ["SAKADESK_DATA_DIR"] = str(tmp_path_factory.mktemp("sakadesk-data"))

    yield

    keyring.set_keyring(original_keyring)
    if original_data_dir is None:
        os.environ.pop("SAKADESK_DATA_DIR", None)
    else:
        os.environ["SAKADESK_DATA_DIR"] = original_data_dir


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
