"""Release workflow: write the signed update manifest for one installer.

Runs in the ``sign`` job with the standard library and the runner's OpenSSL 3
only (plus this repository's ``backend.services.release_signing``, which
imports nothing outside the standard library until it verifies), so no package
from PyPI shares a process with the signing key. Keys come from
``SAKADESK_RELEASE_SIGNING_KEY`` (required) and
``SAKADESK_RELEASE_SIGNING_KEY_NEXT`` (optional, while keys are rotated), each
a PKCS#8 PEM Ed25519 private key. A key is written to a private temporary
directory for OpenSSL and deleted right after use; key material is never
printed. The manifest format is defined in
``backend/services/release_signing.py``, and the payload bytes come from its
``manifest_payload``.

Usage (repository root):
    uv run --no-project python tooling/release/sign_manifest.py \\
        --installer SakaDesk-0.5.1-Setup/SakaDesk-0.5.1-Setup.exe \\
        --version 0.5.1 --out SakaDesk-0.5.1-manifest.json

Exit code 0 on success, 1 with ``ERROR: <code>`` on stderr otherwise.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from collections.abc import Mapping, Sequence
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services import release_signing as rs  # noqa: E402

KEY_ENV = "SAKADESK_RELEASE_SIGNING_KEY"
NEXT_KEY_ENV = "SAKADESK_RELEASE_SIGNING_KEY_NEXT"
# Split only so detect-private-key doesn't flag this constant; the hook still
# scans this file and would catch a pasted real key.
_PEM_HEADER = "-----BEGIN " + "PRIVATE KEY-----"
# DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows.
_ED25519_SPKI_PREFIX = bytes.fromhex("302a300506032b6570032100")
_OPENSSL_TIMEOUT_S = 30
# Left out of OpenSSL's environment: the signing keys themselves, and the
# variables that make OpenSSL load a config file or engine from elsewhere.
_OPENSSL_ENV_DROPPED = frozenset(
    {KEY_ENV, NEXT_KEY_ENV, "OPENSSL_CONF", "OPENSSL_ENGINES"}
)


class SignError(Exception):
    """Signing stopped; ``code`` is printed, never key material."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _openssl(args: Sequence[str]) -> bytes:
    try:
        done = subprocess.run(
            ["openssl", *args],
            capture_output=True,
            env={k: v for k, v in os.environ.items() if k not in _OPENSSL_ENV_DROPPED},
            timeout=_OPENSSL_TIMEOUT_S,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise SignError("openssl_unavailable") from None
    if done.returncode != 0:
        raise SignError("openssl_failed")
    return done.stdout


def signing_keys(environ: Mapping[str, str]) -> list[str]:
    """The PEM keys to sign with: the current key, then the next one if set."""
    current = environ.get(KEY_ENV, "").strip()
    if not current:
        raise SignError("no_signing_key")
    pems = [current]
    following = environ.get(NEXT_KEY_ENV, "").strip()
    if following:
        pems.append(following)
    for pem in pems:
        if not pem.startswith(_PEM_HEADER) or not pem.isascii():
            raise SignError("key_invalid")
    return [pem + "\n" for pem in pems]


def sign_with_pem(pem: str, message: bytes, workdir: Path) -> tuple[str, bytes]:
    """(key id, signature) of ``message`` signed by ``pem``; the key file is gone on return."""
    key_path = workdir / "key.pem"
    message_path = workdir / "message.bin"
    message_path.write_bytes(message)
    fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="ascii") as f:
            f.write(pem)
        spki = _openssl(["pkey", "-in", str(key_path), "-pubout", "-outform", "DER"])
        if len(spki) != 44 or not spki.startswith(_ED25519_SPKI_PREFIX):
            raise SignError("not_ed25519")
        signature = _openssl(
            [
                "pkeyutl",
                "-sign",
                "-rawin",
                "-inkey",
                str(key_path),
                "-in",
                str(message_path),
            ]
        )
    finally:
        key_path.unlink(missing_ok=True)
    if len(signature) != 64:
        raise SignError("bad_signature_length")
    return rs.key_id(spki[len(_ED25519_SPKI_PREFIX) :]), signature


def build_manifest(installer: Path, version: str, pems: Sequence[str]) -> bytes:
    """The manifest file for ``installer`` (named for ``version``), signed by every key."""
    if not rs.is_valid_version(version):
        raise SignError("version_invalid")
    asset = rs.installer_asset_name(version)
    if installer.name != asset:
        raise SignError("wrong_asset")
    try:
        with installer.open("rb") as f:
            sha256, size = rs.stream_digest(f)
    except OSError:
        raise SignError("installer_unreadable") from None
    if not 0 < size <= rs.MAX_INSTALLER_BYTES:
        raise SignError("installer_size")
    payload = rs.manifest_payload(
        version=version, asset=asset, size=size, sha256=sha256
    )
    message = rs.SIGNING_CONTEXT + payload
    with tempfile.TemporaryDirectory(prefix="sakadesk-sign-") as tmp:
        signatures = [sign_with_pem(pem, message, Path(tmp)) for pem in pems]
    if len({kid for kid, _ in signatures}) != len(signatures):
        raise SignError("duplicate_key")
    return rs.build_envelope(payload, signatures)


def main(
    argv: Sequence[str] | None = None, environ: Mapping[str, str] | None = None
) -> int:
    """Write the signed manifest to ``--out``; return the exit code (0, or 1 after ``ERROR: <code>``)."""
    parser = argparse.ArgumentParser(description="Sign the SakaDesk update manifest.")
    parser.add_argument("--installer", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        pems = signing_keys(os.environ if environ is None else environ)
        envelope = build_manifest(args.installer, args.version, pems)
        args.out.write_bytes(envelope)
    except SignError as e:
        sys.stderr.write(f"ERROR: {e.code}\n")
        return 1
    except OSError:
        sys.stderr.write("ERROR: write_failed\n")
        return 1
    sys.stdout.write(f"signed {args.out.name} with {len(pems)} key(s)\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
