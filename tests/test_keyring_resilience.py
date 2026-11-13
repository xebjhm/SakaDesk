from unittest.mock import patch

import pytest
from pysaka.credentials import KeyringStore, NoSecureKeyringError


def test_keyring_failure_does_not_silently_fall_back_to_plaintext():
    """When the OS keyring fails its probe write, KeyringStore must refuse
    (PY-I7/SEC-3) instead of quietly storing credentials in a plaintext file.

    The plaintext fallback is never opted into here: it would write a real
    file under the developer's home.
    """
    with patch(
        "keyring.set_password", side_effect=Exception("Simulated Keyring Failure")
    ):
        with pytest.raises(NoSecureKeyringError):
            KeyringStore()
