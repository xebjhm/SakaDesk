"""Throwaway Ed25519 keys and signed update manifests for the updater tests.

Keys are generated per test run and never written anywhere: no key material
lives in the repository.
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from backend.services import release_signing as rs


def new_key() -> Ed25519PrivateKey:
    return Ed25519PrivateKey.generate()


def public_raw(key: Ed25519PrivateKey) -> bytes:
    return key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )


def trusted(*keys: Ed25519PrivateKey) -> dict[str, str]:
    """A ``TRUSTED_RELEASE_KEYS``-shaped mapping for ``keys``."""
    return {
        rs.key_id(public_raw(k)): base64.b64encode(public_raw(k)).decode("ascii")
        for k in keys
    }


def signed_manifest(
    content: bytes, version: str, *keys: Ed25519PrivateKey, asset: str | None = None
) -> bytes:
    """The manifest file the release workflow would publish for ``content``."""
    payload = rs.manifest_payload(
        version=version,
        asset=asset or rs.installer_asset_name(version),
        size=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
    )
    signatures = [
        (rs.key_id(public_raw(k)), k.sign(rs.SIGNING_CONTEXT + payload)) for k in keys
    ]
    return rs.build_envelope(payload, signatures)
