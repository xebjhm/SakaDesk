"""release_signing: the signed update manifest (security audit 2026-11-13, N6)."""

from __future__ import annotations

import base64
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

from backend.services import release_keys
from backend.services import release_signing as rs
from backend.tests.signing_helpers import new_key, public_raw, signed_manifest, trusted

ROOT = Path(__file__).resolve().parents[2]
CONTENT = b"MZ" + b"\x00" * 1022
VERSION = "0.5.1"


def _payload(**overrides: object) -> bytes:
    body: dict[str, object] = {
        "asset": rs.installer_asset_name(VERSION),
        "platform": rs.PLATFORM,
        "product": rs.PRODUCT,
        "schema": rs.SCHEMA,
        "sha256": hashlib.sha256(CONTENT).hexdigest(),
        "size": len(CONTENT),
        "version": VERSION,
    }
    body.update(overrides)
    return json.dumps(body, sort_keys=True, separators=(",", ":")).encode("ascii")


def _envelope(payload: bytes, *keys) -> bytes:
    sigs = [
        (rs.key_id(public_raw(k)), k.sign(rs.SIGNING_CONTEXT + payload)) for k in keys
    ]
    return rs.build_envelope(payload, sigs)


def _refused(data: bytes, keys: dict[str, str], version: str = VERSION) -> str:
    with pytest.raises(rs.ManifestRefused) as exc:
        rs.verify_update_manifest(data, version=version, trusted_keys=keys)
    return exc.value.reason


class TestRoundTrip:
    def test_a_manifest_signed_by_a_trusted_key_verifies(self):
        key = new_key()
        manifest = rs.verify_update_manifest(
            signed_manifest(CONTENT, VERSION, key),
            version=VERSION,
            trusted_keys=trusted(key),
        )
        assert manifest == rs.ReleaseManifest(
            product="SakaDesk",
            platform="windows-x64",
            version=VERSION,
            asset="SakaDesk-0.5.1-Setup.exe",
            size=len(CONTENT),
            sha256=hashlib.sha256(CONTENT).hexdigest(),
        )

    def test_the_payload_is_canonical_json(self):
        payload = rs.manifest_payload(
            version="1.2.3", asset="SakaDesk-1.2.3-Setup.exe", size=7, sha256="a" * 64
        )
        assert payload == (
            b'{"asset":"SakaDesk-1.2.3-Setup.exe","platform":"windows-x64",'
            b'"product":"SakaDesk","schema":1,"sha256":"'
            + b"a" * 64
            + b'","size":7,"version":"1.2.3"}'
        )

    def test_one_trusted_signature_is_enough_while_rotating(self):
        current, following = new_key(), new_key()
        data = signed_manifest(CONTENT, VERSION, current, following)
        for key in (current, following):
            manifest = rs.verify_update_manifest(
                data, version=VERSION, trusted_keys=trusted(key)
            )
            assert manifest.version == VERSION

    def test_the_default_trust_store_is_release_keys(self, monkeypatch):
        key = new_key()
        monkeypatch.setattr(release_keys, "TRUSTED_RELEASE_KEYS", trusted(key))
        manifest = rs.verify_update_manifest(
            signed_manifest(CONTENT, VERSION, key), version=VERSION
        )
        assert manifest.sha256 == hashlib.sha256(CONTENT).hexdigest()

    def test_stream_digest_hashes_in_chunks(self, tmp_path):
        path = tmp_path / "x.bin"
        path.write_bytes(b"ab" * 700_000)
        with path.open("rb") as f:
            assert rs.stream_digest(f) == (
                hashlib.sha256(b"ab" * 700_000).hexdigest(),
                1_400_000,
            )


class TestSignatures:
    def test_a_tampered_payload_is_refused(self):
        key = new_key()
        env = json.loads(signed_manifest(CONTENT, VERSION, key))
        env["payload"] = base64.b64encode(_payload(sha256="0" * 64)).decode("ascii")
        assert (
            _refused(json.dumps(env).encode("ascii"), trusted(key)) == "bad_signature"
        )

    def test_a_key_the_app_does_not_trust_is_refused(self):
        assert (
            _refused(signed_manifest(CONTENT, VERSION, new_key()), trusted(new_key()))
            == "unknown_key"
        )

    def test_a_signature_relabelled_with_a_trusted_key_id_is_refused(self):
        good, evil = new_key(), new_key()
        payload = _payload()
        forged = rs.build_envelope(
            payload,
            [(rs.key_id(public_raw(good)), evil.sign(rs.SIGNING_CONTEXT + payload))],
        )
        assert _refused(forged, trusted(good)) == "bad_signature"

    def test_a_signature_without_the_context_string_is_refused(self):
        key = new_key()
        payload = _payload()
        data = rs.build_envelope(
            payload, [(rs.key_id(public_raw(key)), key.sign(payload))]
        )
        assert _refused(data, trusted(key)) == "bad_signature"

    def test_a_manifest_without_signatures_is_refused(self):
        assert (
            _refused(rs.build_envelope(_payload(), []), trusted(new_key()))
            == "unsigned"
        )

    def test_an_empty_trust_store_refuses_everything(self):
        assert (
            _refused(signed_manifest(CONTENT, VERSION, new_key()), {}) == "unknown_key"
        )


class TestBinding:
    @pytest.mark.parametrize(
        ("override", "reason"),
        [
            ({"product": "OtherApp"}, "wrong_product"),
            ({"platform": "macos-arm64"}, "wrong_platform"),
            ({"version": "0.5.0"}, "wrong_version"),
            ({"asset": "SakaDesk-0.5.1-Setup-x64.exe"}, "wrong_asset"),
        ],
    )
    def test_a_manifest_for_something_else_is_refused(self, override, reason):
        key = new_key()
        assert _refused(_envelope(_payload(**override), key), trusted(key)) == reason

    def test_an_older_genuine_manifest_offered_as_a_newer_version_is_refused(self):
        key = new_key()
        assert (
            _refused(signed_manifest(CONTENT, "0.4.2", key), trusted(key))
            == "wrong_version"
        )


def _raw_envelope(**fields: object) -> bytes:
    return json.dumps(fields).encode("ascii")


_SIG = base64.b64encode(b"x" * 64).decode("ascii")


class TestMalformed:
    @pytest.mark.parametrize(
        "data",
        [
            b"",
            b"not json",
            b"[]",
            b"[" * 60000,
            b'{"a":' * 12000,
            _raw_envelope(schema=True, payload="", signatures=[]),
            _raw_envelope(
                schema=1,
                payload="@@@",
                signatures=[{"key_id": "0" * 16, "signature": _SIG}],
            ),
            _raw_envelope(
                schema=1, payload="", signatures=[{"key_id": "XYZ", "signature": _SIG}]
            ),
            _raw_envelope(
                schema=1,
                payload="",
                signatures=[
                    {
                        "key_id": "0" * 16,
                        "signature": base64.b64encode(b"short").decode("ascii"),
                    }
                ],
            ),
            _raw_envelope(schema=1, payload="", signatures="nope"),
            _raw_envelope(
                schema=1,
                payload="",
                signatures=[{"key_id": "0" * 16, "signature": _SIG}] * 5,
            ),
        ],
    )
    def test_a_broken_envelope_is_malformed(self, data):
        assert _refused(data, trusted(new_key())) == "malformed"

    def test_an_oversized_file_is_refused_before_parsing(self):
        assert (
            _refused(b" " * (rs.MAX_ENVELOPE_BYTES + 1), trusted(new_key()))
            == "too_large"
        )

    @pytest.mark.parametrize(
        "override",
        [
            {"size": True},
            {"size": 0},
            {"size": rs.MAX_INSTALLER_BYTES + 1},
            {"sha256": "A" * 64},
            {"sha256": "a" * 63},
            {"schema": 2},
            {"version": 5},
            {"extra": "x"},
            {"schema": True},
        ],
    )
    def test_a_signed_but_malformed_payload_is_refused(self, override):
        key = new_key()
        assert (
            _refused(_envelope(_payload(**override), key), trusted(key)) == "malformed"
        )

    @pytest.mark.parametrize("payload", [b"[" * 30000, b'{"a":' * 6000])
    def test_a_deeply_nested_signed_payload_is_malformed(self, payload):
        key = new_key()
        assert _refused(_envelope(payload, key), trusted(key)) == "malformed"

    def test_a_payload_with_a_duplicate_key_is_malformed(self):
        key = new_key()
        canonical = _payload().decode("ascii")
        dup = canonical.replace("{", '{"sha256":"' + "0" * 64 + '",', 1).encode("ascii")
        assert _refused(_envelope(dup, key), trusted(key)) == "malformed"

    def test_a_non_canonical_signed_payload_is_malformed(self):
        key = new_key()
        spaced = _payload().replace(b",", b", ")
        escaped = _payload().replace(b"SakaDesk", b"Saka\\u0044esk")
        for payload in (spaced, escaped):
            assert _refused(_envelope(payload, key), trusted(key)) == "malformed"

    def test_the_canonical_payload_is_accepted(self):
        key = new_key()
        data = _envelope(_payload(), key)
        assert rs.verify_update_manifest(
            data, version=VERSION, trusted_keys=trusted(key)
        )


class TestTrustStore:
    def test_a_malformed_trust_store_value_is_keys_invalid(self):
        key = new_key()
        data = signed_manifest(CONTENT, VERSION, key)
        kid = rs.key_id(public_raw(key))
        for bad in ("@@@", base64.b64encode(b"short").decode("ascii")):
            assert _refused(data, {kid: bad}) == "keys_invalid"

    def test_an_invalid_trusted_signature_before_a_valid_one_is_accepted(self):
        good, other = new_key(), new_key()
        payload = _payload()
        kid_good, kid_other = rs.key_id(public_raw(good)), rs.key_id(public_raw(other))
        data = rs.build_envelope(
            payload,
            [
                (kid_other, good.sign(rs.SIGNING_CONTEXT + payload)),
                (kid_good, good.sign(rs.SIGNING_CONTEXT + payload)),
            ],
        )
        assert rs.verify_update_manifest(
            data, version=VERSION, trusted_keys=trusted(good, other)
        )


@pytest.mark.parametrize(
    "version", ["0.5.1", "10.0.0", "0.3.3-hotfix1", "0.4.0rc1", "0.3.2.dev0"]
)
def test_release_versions_are_valid(version):
    assert rs.is_valid_version(version)


@pytest.mark.parametrize(
    "version",
    [
        "",
        "v0.5.1",
        "0.5",
        "0.5.1/../x",
        "0.5.1 ",
        "0.5.1..",
        "../0.5.1",
        "0.5.1-" + "a" * 40,
        "１.２.３",
        5,
    ],
)
def test_odd_versions_are_invalid(version):
    assert not rs.is_valid_version(version)


def test_asset_names():
    assert rs.installer_asset_name("0.5.1") == "SakaDesk-0.5.1-Setup.exe"
    assert rs.manifest_asset_name("0.5.1") == "SakaDesk-0.5.1-manifest.json"


def test_importing_the_module_does_not_load_cryptography():
    """The release workflow's signer imports this module with the standard library only."""
    code = (
        "import sys, backend.services.release_signing; "
        "sys.stdout.write(str('cryptography' in sys.modules))"
    )
    done = subprocess.run(
        [sys.executable, "-c", code],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
        check=True,
    )
    assert done.stdout == "False"


def test_trusted_release_keys_are_well_formed():
    assert len(release_keys.TRUSTED_RELEASE_KEYS) <= 2
    for kid, public in release_keys.TRUSTED_RELEASE_KEYS.items():
        raw = base64.b64decode(public, validate=True)
        assert len(raw) == 32
        assert rs.key_id(raw) == kid
