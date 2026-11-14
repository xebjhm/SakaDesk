"""Generate the Ed25519 key pair that signs SakaDesk updates (owner, run locally once).

    uv run python scripts/generate_release_key.py --out ~/sakadesk-release-key.pem

Writes the PRIVATE key (PKCS#8 PEM, unencrypted: the release workflow reads
it as is) to ``--out`` with owner-only permissions (POSIX; run it from WSL)
and never overwrites a file. Prints the key id, the public key and the line
to add to ``backend/services/release_keys.py``; never prints the private key.
Next steps: CONTRIBUTING.md, "Release signing".
"""

from __future__ import annotations

import argparse
import base64
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import (  # noqa: E402
    Ed25519PrivateKey,
)

from backend.services.release_signing import key_id  # noqa: E402


def generate(out: Path) -> tuple[str, str]:
    """Write a new private key to ``out``; return (key id, base64 raw public key)."""
    key = Ed25519PrivateKey.generate()
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    raw = key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(pem)
    return key_id(raw), base64.b64encode(raw).decode("ascii")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate the SakaDesk release signing key."
    )
    parser.add_argument(
        "--out", type=Path, required=True, help="where to write the private key"
    )
    args = parser.parse_args(argv)
    out = args.out.expanduser()
    try:
        kid, public = generate(out)
    except FileExistsError:
        sys.stderr.write("ERROR: exists\n")
        return 1
    except OSError:
        sys.stderr.write("ERROR: write_failed\n")
        return 1
    sys.stdout.write(
        f"Private key written to {out} (owner-only). Do not share it.\n"
        f"key id:     {kid}\n"
        f"public key: {public}\n"
        "\n"
        "Line for TRUSTED_RELEASE_KEYS in backend/services/release_keys.py:\n"
        f'    "{kid}": "{public}",\n'
        "\n"
        'Next: CONTRIBUTING.md, "Release signing".\n'
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
