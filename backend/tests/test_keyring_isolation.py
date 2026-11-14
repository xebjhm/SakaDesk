"""The test suite can never reach the developer's real keyring file.

pysaka's ``KeyringStore.delete`` builds ``keyrings.alt.file.PlaintextKeyring()``
itself and deletes from it, bypassing whatever backend ``keyring.set_keyring``
installed. Left alone, a clear-key or logout test deleted entries from the
developer's real ``~/.local/share/python_keyring/keyring_pass.cfg``. The
autouse ``_isolate_keyring`` fixture in the root ``conftest.py`` must keep that
constructor off the real file.
"""

from __future__ import annotations

import os
from pathlib import Path

import keyrings.alt.file
import keyrings.alt.file_base
import pytest
from fastapi.testclient import TestClient
from keyring.util import platform_
from pysaka.credentials import SERVICE_NAME, _ENTRY_USERNAME, _service_for

from backend.api.translation import _API_KEY_CREDENTIAL_GROUP
from backend.main import app

client = TestClient(app)


class _RealPlaintext(keyrings.alt.file_base.Keyring):
    """The same on-disk format as the real PlaintextKeyring (unpatched)."""

    filename = "keyring_pass.cfg"
    scheme = "no encyption"
    version = "1.0"

    def encrypt(self, password, assoc=None):
        return password

    def decrypt(self, password_encrypted, assoc=None):
        return password_encrypted


def _outside(path: Path, real_root: Path) -> bool:
    """``path`` is neither the real keyring folder nor inside it."""
    return path != real_root and real_root not in path.parents


def test_keyring_file_locations_point_into_the_test_tmp_dir(real_keyring_data_root):
    """Even an unpatched constructor could only write away from the real folder.

    Compared with the real ``data_root()`` captured before any patching, not with
    the home folder: pytest's temp dir may itself live under it (local Windows).
    """
    assert _outside(platform_.data_root(), real_keyring_data_root)
    for var in ("XDG_DATA_HOME", "XDG_CONFIG_HOME", "LOCALAPPDATA", "APPDATA"):
        value = os.environ.get(var)
        assert value is not None
        assert _outside(Path(value), real_keyring_data_root)


def test_the_plaintext_constructor_is_not_the_real_class():
    assert not isinstance(
        keyrings.alt.file.PlaintextKeyring(), keyrings.alt.file_base.Keyring
    )


def test_clear_api_key_and_logout_leave_a_seeded_file_entry_alone(
    real_keyring_data_root,
):
    real = _RealPlaintext()
    path = Path(real.file_path)
    assert path != real_keyring_data_root / "keyring_pass.cfg"
    assert _outside(path, real_keyring_data_root), "would touch the real keyring"
    seeded = [
        (_service_for(_API_KEY_CREDENTIAL_GROUP), _ENTRY_USERNAME),
        (SERVICE_NAME, _API_KEY_CREDENTIAL_GROUP),
        (_service_for("hinatazaka46"), _ENTRY_USERNAME),
    ]
    for service, username in seeded:
        real.set_password(service, username, "seeded-secret")
    before = path.read_bytes()

    assert client.post("/api/translation/clear-api-key").status_code == 200
    assert client.post("/api/auth/logout?service=hinatazaka46").status_code == 200

    assert path.read_bytes() == before
    for service, username in seeded:
        assert real.get_password(service, username) == "seeded-secret"


@pytest.mark.parametrize("name", ["PlaintextKeyring", "EncryptedKeyring"])
def test_every_file_keyring_class_is_replaced(name):
    assert not isinstance(
        getattr(keyrings.alt.file, name)(), keyrings.alt.file_base.Keyring
    )
