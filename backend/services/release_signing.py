"""Signed update manifests (security audit 2026-11-13: N6, hardening #61/#62).

The in-app updater installs an installer only when a manifest signed by a
release key the app trusts (:mod:`backend.services.release_keys`) names
exactly that installer: product, platform, version, file name, size and
SHA-256. The release workflow writes the manifest
(``tooling/release/sign_manifest.py``); the updater checks it before the
download, checks the downloaded bytes against it, and hashes the file again
right before starting Setup (:mod:`backend.services.upgrade_service`).

File ``SakaDesk-<version>-manifest.json``::

    {"payload": "<base64 of the payload bytes>",
     "schema": 1,
     "signatures": [{"key_id": "<16 hex digits>", "signature": "<base64, 64 bytes>"}]}

The payload is :func:`manifest_payload`. Each signature is Ed25519 over
``SIGNING_CONTEXT + payload``, and the signed bytes are checked before they
are parsed. Up to ``MAX_SIGNATURES`` signatures let a release carry the
current and the next key while keys are rotated; one valid signature from a
trusted key is enough.

``cryptography`` is imported only inside :func:`_ed25519_verify`, so the
release workflow's signer can import this module with the standard library
alone. Nothing here logs: callers log the :class:`ManifestRefused` reason.

Command line (:func:`main`, used by the release workflow's ``verify-manifest``
job to check a release before it is published)::

    python -m backend.services.release_signing --manifest M --installer I --version V [--keys-file F]

It checks the manifest against ``release_keys.TRUSTED_RELEASE_KEYS``, or
against the ``TRUSTED_RELEASE_KEYS`` of the ``release_keys.py`` copy ``F``
(read with :mod:`ast`, never executed), then checks the installer's name, size
and SHA-256 against the signed values. Exit code 0 and ``manifest OK: ...`` on
stdout, or 1 and ``ERROR: <code>`` on stderr.
"""

from __future__ import annotations

import argparse
import ast
import base64
import binascii
import hashlib
import json
import re
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import BinaryIO

from backend.services import release_keys

PRODUCT = "SakaDesk"
PLATFORM = "windows-x64"
SCHEMA = 1
SIGNING_CONTEXT = b"SakaDesk update manifest v1\n"
MAX_ENVELOPE_BYTES = 64 * 1024
MAX_SIGNATURES = 4
MAX_INSTALLER_BYTES = 500 * 1024 * 1024
MAX_VERSION_LENGTH = 32
MAX_KEYS_FILE_BYTES = 64 * 1024
# 1.2.3 plus up to three suffix parts: 0.3.3-hotfix1, 0.4.0rc1, 0.3.2.dev0.
_VERSION = re.compile(
    r"\d{1,4}\.\d{1,4}\.\d{1,4}(?:[.-]?[0-9A-Za-z]{1,16}){0,3}", re.ASCII
)
_SHA256_HEX = re.compile(r"[0-9a-f]{64}")
_KEY_ID = re.compile(r"[0-9a-f]{16}")
_PAYLOAD_KEYS = frozenset(
    {"asset", "platform", "product", "schema", "sha256", "size", "version"}
)
_CHUNK = 1024 * 1024


class ManifestRefused(Exception):
    """The manifest cannot be trusted. ``reason`` is a log code, never data from the file."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class ReleaseManifest:
    """What a valid signature vouches for.

    ``key_id`` is the (public) id of the trusted key whose signature verified
    the manifest; it is empty on the result of :func:`parse_manifest`, which
    checks no signature.
    """

    product: str
    platform: str
    version: str
    asset: str
    size: int
    sha256: str
    key_id: str = ""


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def installer_asset_name(version: str) -> str:
    """``SakaDesk-<version>-Setup.exe`` (Inno Setup's OutputBaseFilename)."""
    return f"SakaDesk-{version}-Setup.exe"


def manifest_asset_name(version: str) -> str:
    """``SakaDesk-<version>-manifest.json``."""
    return f"SakaDesk-{version}-manifest.json"


def is_valid_version(version: object) -> bool:
    """True for a bare release version such as ``0.5.1`` or ``0.4.0rc1`` (no ``v``)."""
    return (
        isinstance(version, str)
        and len(version) <= MAX_VERSION_LENGTH
        and _VERSION.fullmatch(version) is not None
    )


def is_sha256_hex(value: object) -> bool:
    """True for 64 lower-case hex digits."""
    return isinstance(value, str) and _SHA256_HEX.fullmatch(value) is not None


def key_id(public_key_raw: bytes) -> str:
    """The id of a raw 32-byte Ed25519 public key: the first 16 hex digits of its SHA-256."""
    return hashlib.sha256(public_key_raw).hexdigest()[:16]


def _canonical(body: Mapping[str, object]) -> bytes:
    return json.dumps(
        body, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode("ascii")


def manifest_payload(*, version: str, asset: str, size: int, sha256: str) -> bytes:
    """The bytes the release workflow signs: canonical JSON (sorted keys, no spaces, ASCII)."""
    body = {
        "asset": asset,
        "platform": PLATFORM,
        "product": PRODUCT,
        "schema": SCHEMA,
        "sha256": sha256,
        "size": size,
        "version": version,
    }
    return _canonical(body)


def build_envelope(payload: bytes, signatures: Sequence[tuple[str, bytes]]) -> bytes:
    """The manifest file for ``payload`` with ``signatures`` (key id, 64-byte signature)."""
    envelope = {
        "payload": base64.b64encode(payload).decode("ascii"),
        "schema": SCHEMA,
        "signatures": [
            {"key_id": kid, "signature": base64.b64encode(sig).decode("ascii")}
            for kid, sig in signatures
        ],
    }
    return (json.dumps(envelope, sort_keys=True, indent=2) + "\n").encode("ascii")


def _b64(text: object) -> bytes:
    if not isinstance(text, str):
        raise ManifestRefused("malformed")
    try:
        return base64.b64decode(text.encode("ascii"), validate=True)
    except (binascii.Error, UnicodeEncodeError, ValueError):
        raise ManifestRefused("malformed") from None


def parse_envelope(data: bytes) -> tuple[bytes, list[tuple[str, bytes]]]:
    """The payload bytes and the (key id, signature) pairs of a manifest file.

    Raises ManifestRefused: ``too_large``, ``malformed`` or ``unsigned``.
    """
    if len(data) > MAX_ENVELOPE_BYTES:
        raise ManifestRefused("too_large")
    try:
        envelope = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise ManifestRefused("malformed") from None
    if not isinstance(envelope, dict):
        raise ManifestRefused("malformed")
    schema = envelope.get("schema")
    if not _is_int(schema) or schema != SCHEMA:
        raise ManifestRefused("malformed")
    signatures = envelope.get("signatures")
    if not isinstance(signatures, list):
        raise ManifestRefused("malformed")
    if not signatures:
        raise ManifestRefused("unsigned")
    if len(signatures) > MAX_SIGNATURES:
        raise ManifestRefused("malformed")
    payload = _b64(envelope.get("payload"))
    parsed: list[tuple[str, bytes]] = []
    for entry in signatures:
        if not isinstance(entry, dict):
            raise ManifestRefused("malformed")
        kid = entry.get("key_id")
        if not isinstance(kid, str) or _KEY_ID.fullmatch(kid) is None:
            raise ManifestRefused("malformed")
        signature = _b64(entry.get("signature"))
        if len(signature) != 64:
            raise ManifestRefused("malformed")
        parsed.append((kid, signature))
    return payload, parsed


def _ed25519_verify(public_key_raw: bytes, signature: bytes, message: bytes) -> bool:
    """True when ``signature`` is a valid Ed25519 signature of ``message``.

    The one place that imports ``cryptography`` (lazily) and verifies;
    :func:`verify_signatures` and :func:`self_check` both go through it.
    Raises ValueError when ``public_key_raw`` is not a 32-byte public key.
    """
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    public = Ed25519PublicKey.from_public_bytes(public_key_raw)
    try:
        public.verify(signature, message)
    except InvalidSignature:
        return False
    return True


def verify_signatures(
    payload: bytes,
    signatures: Sequence[tuple[str, bytes]],
    trusted_keys: Mapping[str, str],
) -> str:
    """The id of a trusted key whose signature over ``SIGNING_CONTEXT + payload`` is valid.

    Raises ManifestRefused: ``unknown_key`` (no signature from a trusted key),
    ``keys_invalid`` (a trusted key that carries a signature is not a base64
    32-byte Ed25519 public key) or ``bad_signature`` (none of those signatures
    is valid).
    """
    candidates = [(kid, sig) for kid, sig in signatures if kid in trusted_keys]
    if not candidates:
        raise ManifestRefused("unknown_key")
    message = SIGNING_CONTEXT + payload
    for kid, signature in candidates:
        try:
            valid = _ed25519_verify(
                base64.b64decode(trusted_keys[kid], validate=True), signature, message
            )
        except (binascii.Error, ValueError):
            raise ManifestRefused("keys_invalid") from None
        if valid:
            return kid
    raise ManifestRefused("bad_signature")


# RFC 8032 section 7.1, TEST 1 (empty message).
_SELF_CHECK_PUBLIC_KEY = bytes.fromhex(
    "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
)
_SELF_CHECK_SIGNATURE = bytes.fromhex(
    "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155"
    "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
)


def self_check() -> None:
    """Prove the Ed25519 verifier works in this process; used by the build.

    Verifies the RFC 8032 section 7.1 TEST 1 signature through the same
    ``cryptography`` code path as :func:`verify_signatures`, and checks that
    the same signature with one byte changed is rejected. The Windows build
    runs the frozen app with ``--self-check-updater`` so a build that
    bundled a broken or missing ``cryptography`` cannot ship (an app that
    cannot verify would refuse every update). Raises ManifestRefused
    (``self_check_failed``) when the valid signature is rejected or the
    altered one is accepted; an ImportError or other exception from the
    verifier propagates.
    """
    if not _ed25519_verify(_SELF_CHECK_PUBLIC_KEY, _SELF_CHECK_SIGNATURE, b""):
        raise ManifestRefused("self_check_failed")
    altered = bytes([_SELF_CHECK_SIGNATURE[0] ^ 1]) + _SELF_CHECK_SIGNATURE[1:]
    if _ed25519_verify(_SELF_CHECK_PUBLIC_KEY, altered, b""):
        raise ManifestRefused("self_check_failed")


def parse_manifest(payload: bytes) -> ReleaseManifest:
    """The fields of a signed payload. Raises ManifestRefused(``malformed``).

    Only the canonical form is accepted: the payload bytes must equal
    canonical JSON (the form :func:`manifest_payload` writes) of the fields
    they carry, so duplicate keys, whitespace and escape variants are refused.
    """
    try:
        body = json.loads(payload.decode("ascii"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise ManifestRefused("malformed") from None
    if not isinstance(body, dict) or set(body) != _PAYLOAD_KEYS:
        raise ManifestRefused("malformed")
    if not _is_int(body["schema"]) or body["schema"] != SCHEMA:
        raise ManifestRefused("malformed")
    texts = [body[k] for k in ("product", "platform", "version", "asset")]
    if not all(isinstance(t, str) for t in texts):
        raise ManifestRefused("malformed")
    size, sha256 = body["size"], body["sha256"]
    if not _is_int(size) or not 0 < size <= MAX_INSTALLER_BYTES:
        raise ManifestRefused("malformed")
    if not is_sha256_hex(sha256):
        raise ManifestRefused("malformed")
    if payload != _canonical(body):
        raise ManifestRefused("malformed")
    return ReleaseManifest(
        product=body["product"],
        platform=body["platform"],
        version=body["version"],
        asset=body["asset"],
        size=size,
        sha256=sha256,
    )


def verify_update_manifest(
    data: bytes,
    *,
    version: str,
    trusted_keys: Mapping[str, str] | None = None,
) -> ReleaseManifest:
    """The manifest in ``data`` when a trusted key signed it for ``version``'s installer.

    The result's ``key_id`` is the key that verified it.

    ``trusted_keys`` defaults to ``release_keys.TRUSTED_RELEASE_KEYS`` (read at
    call time). Raises ManifestRefused: ``too_large``, ``malformed``,
    ``unsigned``, ``unknown_key``, ``keys_invalid``, ``bad_signature``, ``wrong_product``,
    ``wrong_platform``, ``wrong_version`` or ``wrong_asset``.
    """
    keys = release_keys.TRUSTED_RELEASE_KEYS if trusted_keys is None else trusted_keys
    payload, signatures = parse_envelope(data)
    verifying_key_id = verify_signatures(payload, signatures, keys)
    manifest = replace(parse_manifest(payload), key_id=verifying_key_id)
    if manifest.product != PRODUCT:
        raise ManifestRefused("wrong_product")
    if manifest.platform != PLATFORM:
        raise ManifestRefused("wrong_platform")
    if manifest.version != version:
        raise ManifestRefused("wrong_version")
    if manifest.asset != installer_asset_name(version):
        raise ManifestRefused("wrong_asset")
    return manifest


def stream_digest(stream: BinaryIO) -> tuple[str, int]:
    """SHA-256 hex digest and byte count of everything left in ``stream``."""
    digest = hashlib.sha256()
    size = 0
    while chunk := stream.read(_CHUNK):
        digest.update(chunk)
        size += len(chunk)
    return digest.hexdigest(), size


_KEYS_NAME = "TRUSTED_RELEASE_KEYS"


def _keys_dict(node: ast.stmt) -> ast.Dict | None:
    """The dict literal of ``TRUSTED_RELEASE_KEYS = {...}`` (plain or annotated), else None."""
    if (
        isinstance(node, ast.Assign)
        and len(node.targets) == 1
        and isinstance(node.targets[0], ast.Name)
        and node.targets[0].id == _KEYS_NAME
        and isinstance(node.value, ast.Dict)
    ):
        return node.value
    if (
        isinstance(node, ast.AnnAssign)
        and isinstance(node.target, ast.Name)
        and node.target.id == _KEYS_NAME
        and isinstance(node.value, ast.Dict)
    ):
        return node.value
    return None


def _keys_value(tree: ast.Module) -> ast.Dict:
    """The dict literal of the one allowed statement. Raises ManifestRefused(``keys_file_invalid``)."""
    body = list(tree.body)
    if (
        body
        and isinstance(body[0], ast.Expr)
        and isinstance(body[0].value, ast.Constant)
        and isinstance(body[0].value.value, str)
    ):
        body.pop(0)
    if (
        body
        and isinstance(body[0], ast.ImportFrom)
        and body[0].module == "__future__"
        and body[0].level == 0
        and [(a.name, a.asname) for a in body[0].names] == [("annotations", None)]
    ):
        body.pop(0)
    value = _keys_dict(body[0]) if len(body) == 1 else None
    if value is None:
        raise ManifestRefused("keys_file_invalid")
    return value


def load_trusted_keys(path: Path) -> dict[str, str]:
    """``TRUSTED_RELEASE_KEYS`` from a copy of ``release_keys.py``, read with ``ast``.

    Used for an older release's file, so it is parsed, never executed. The
    file must be at most ``MAX_KEYS_FILE_BYTES`` and its module body must be
    exactly: an optional docstring, an optional
    ``from __future__ import annotations``, and one top-level statement
    ``TRUSTED_RELEASE_KEYS = {...}`` or ``TRUSTED_RELEASE_KEYS: <annotation> =
    {...}`` whose value is a literal ``str`` to ``str`` dict. Anything else
    (a second statement, a later assignment, ``.update(...)``, an ``if`` block,
    another import) is refused, because Python would run it and the app could
    end up with other keys than the check used. Whether each value is a usable
    public key is checked later by :func:`verify_signatures`
    (``keys_invalid``). Raises ManifestRefused(``keys_file_invalid``).
    """
    try:
        with path.open("rb") as f:
            raw = f.read(MAX_KEYS_FILE_BYTES + 1)
        if len(raw) > MAX_KEYS_FILE_BYTES:
            raise ManifestRefused("keys_file_invalid")
        tree = ast.parse(raw.decode("utf-8"))
        value = _keys_value(tree)
        keys = ast.literal_eval(value)
    except (OSError, SyntaxError, ValueError, TypeError, RecursionError):
        raise ManifestRefused("keys_file_invalid") from None
    if isinstance(keys, dict) and all(
        isinstance(k, str) and isinstance(v, str) for k, v in keys.items()
    ):
        return keys
    raise ManifestRefused("keys_file_invalid")


def _fail(code: str) -> int:
    sys.stderr.write(f"ERROR: {code}\n")
    return 1


def main(argv: Sequence[str] | None = None) -> int:
    """Check a release's manifest and installer against the keys an app trusts.

    Exit code 0 and ``manifest OK: ...`` on stdout, or 1 and ``ERROR: <code>``
    on stderr: ``version_invalid``, ``keys_file_invalid``, ``no_trusted_keys``,
    ``manifest_unreadable``, a :class:`ManifestRefused` reason,
    ``installer_unreadable`` or ``installer_mismatch`` (``wrong_asset`` when
    the installer's file name is not the signed one). ``--keys-file`` checks
    against an older ``release_keys.py`` (the previous release's) instead of
    this app's keys.
    """
    parser = argparse.ArgumentParser(
        prog="python -m backend.services.release_signing",
        description="Check a signed update manifest and its installer.",
    )
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--installer", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--keys-file", type=Path, default=None)
    args = parser.parse_args(argv)
    if not is_valid_version(args.version):
        return _fail("version_invalid")
    try:
        keys = (
            load_trusted_keys(args.keys_file)
            if args.keys_file is not None
            else release_keys.TRUSTED_RELEASE_KEYS
        )
    except ManifestRefused as e:
        return _fail(e.reason)
    if not keys:
        return _fail("no_trusted_keys")
    try:
        data = args.manifest.read_bytes()
    except OSError:
        return _fail("manifest_unreadable")
    try:
        manifest = verify_update_manifest(data, version=args.version, trusted_keys=keys)
    except ManifestRefused as e:
        return _fail(e.reason)
    if args.installer.name != manifest.asset:
        return _fail("wrong_asset")
    try:
        with args.installer.open("rb") as f:
            sha256, size = stream_digest(f)
    except OSError:
        return _fail("installer_unreadable")
    if (sha256, size) != (manifest.sha256, manifest.size):
        return _fail("installer_mismatch")
    sys.stdout.write(
        f"manifest OK: {manifest.asset} {manifest.size} bytes sha256 {manifest.sha256}\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
