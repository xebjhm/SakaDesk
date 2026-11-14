"""scripts/generate_release_key.py: the owner's one-off key generator."""

from __future__ import annotations

import base64
import importlib.util
import stat
import sys
from pathlib import Path
from types import ModuleType

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from backend.services import release_signing as rs

ROOT = Path(__file__).resolve().parent.parent


def _script() -> ModuleType:
    path = ROOT / "scripts" / "generate_release_key.py"
    spec = importlib.util.spec_from_file_location("generate_release_key", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_writes_an_owner_only_pem_and_prints_only_the_public_half(tmp_path, capsys):
    out = tmp_path / "release-key.pem"
    assert _script().main(["--out", str(out)]) == 0
    key = serialization.load_pem_private_key(out.read_bytes(), password=None)
    assert isinstance(key, Ed25519PrivateKey)
    raw = key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )
    public = base64.b64encode(raw).decode("ascii")
    printed = capsys.readouterr().out
    assert f'    "{rs.key_id(raw)}": "{public}",' in printed
    assert "PRIVATE KEY" not in printed
    body = "".join(out.read_text(encoding="ascii").strip().splitlines()[1:-1])
    assert body not in printed
    if sys.platform != "win32":
        assert stat.S_IMODE(out.stat().st_mode) == 0o600


def test_never_overwrites_an_existing_file(tmp_path, capsys):
    out = tmp_path / "release-key.pem"
    out.write_text("keep", encoding="utf-8")
    assert _script().main(["--out", str(out)]) == 1
    assert out.read_text(encoding="utf-8") == "keep"
    assert capsys.readouterr().err == "ERROR: exists\n"
