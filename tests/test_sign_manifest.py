"""tooling/release/sign_manifest.py: the release workflow's signer (OpenSSL 3 + stdlib)."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import shutil
import subprocess
from pathlib import Path
from types import ModuleType

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from backend.services import release_signing as rs
from backend.tests.signing_helpers import new_key, trusted
from ci_env import on_ci

ROOT = Path(__file__).resolve().parent.parent
VERSION = "0.5.1"


def _openssl_has_ed25519() -> bool:
    if shutil.which("openssl") is None:
        return False
    done = subprocess.run(
        ["openssl", "genpkey", "-algorithm", "ed25519"],
        capture_output=True,
        timeout=30,
        check=False,
    )
    return done.returncode == 0


_HAS_ED25519 = _openssl_has_ed25519()
# Locally the suite skips without OpenSSL 3; in CI it must run, so it fails instead.
pytestmark = pytest.mark.skipif(
    not _HAS_ED25519 and not on_ci(),
    reason="needs OpenSSL 3 with Ed25519 (CI and WSL have it)",
)


def test_openssl_with_ed25519_is_available_in_ci():
    if on_ci():
        assert _HAS_ED25519, "the release signer's tests need OpenSSL 3 with Ed25519"


def _signer() -> ModuleType:
    path = ROOT / "tooling" / "release" / "sign_manifest.py"
    spec = importlib.util.spec_from_file_location("sign_manifest", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _pem(key) -> str:
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode("ascii")


def _installer(tmp_path: Path, version: str = VERSION) -> Path:
    path = tmp_path / f"SakaDesk-{version}-Setup.exe"
    path.write_bytes(b"MZ" + bytes(range(256)) * 16)
    return path


def _args(installer: Path, out: Path, version: str = VERSION) -> list[str]:
    return ["--installer", str(installer), "--version", version, "--out", str(out)]


def test_openssl_signatures_verify_with_the_app(tmp_path):
    key = new_key()
    installer = _installer(tmp_path)
    out = tmp_path / "SakaDesk-0.5.1-manifest.json"
    code = _signer().main(
        _args(installer, out), environ={"SAKADESK_RELEASE_SIGNING_KEY": _pem(key)}
    )
    assert code == 0
    manifest = rs.verify_update_manifest(
        out.read_bytes(), version=VERSION, trusted_keys=trusted(key)
    )
    assert manifest.sha256 == hashlib.sha256(installer.read_bytes()).hexdigest()
    assert manifest.size == installer.stat().st_size


def test_the_next_key_signs_too_while_rotating(tmp_path):
    current, following = new_key(), new_key()
    out = tmp_path / "m.json"
    environ = {
        "SAKADESK_RELEASE_SIGNING_KEY": _pem(current),
        "SAKADESK_RELEASE_SIGNING_KEY_NEXT": _pem(following),
    }
    assert _signer().main(_args(_installer(tmp_path), out), environ=environ) == 0
    assert len(json.loads(out.read_bytes())["signatures"]) == 2
    for key in (current, following):
        rs.verify_update_manifest(
            out.read_bytes(), version=VERSION, trusted_keys=trusted(key)
        )


def test_no_key_fails_with_a_code(tmp_path, capsys):
    out = tmp_path / "m.json"
    assert _signer().main(_args(_installer(tmp_path), out), environ={}) == 1
    assert capsys.readouterr().err == "ERROR: no_signing_key\n"
    assert not out.exists()


def test_a_non_pem_key_is_refused_without_echo(tmp_path, capsys):
    secret = "not-a-pem-" + "x" * 40
    code = _signer().main(
        _args(_installer(tmp_path), tmp_path / "m.json"),
        environ={"SAKADESK_RELEASE_SIGNING_KEY": secret},
    )
    captured = capsys.readouterr()
    assert code == 1
    assert captured.err == "ERROR: key_invalid\n"
    assert secret not in captured.out + captured.err


def test_a_non_ed25519_key_is_refused(tmp_path, capsys):
    ec_pem = (
        ec.generate_private_key(ec.SECP256R1())
        .private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        .decode("ascii")
    )
    code = _signer().main(
        _args(_installer(tmp_path), tmp_path / "m.json"),
        environ={"SAKADESK_RELEASE_SIGNING_KEY": ec_pem},
    )
    assert code == 1
    assert capsys.readouterr().err == "ERROR: not_ed25519\n"


def test_the_installer_name_must_match_the_version(tmp_path, capsys):
    code = _signer().main(
        _args(_installer(tmp_path, "0.5.0"), tmp_path / "m.json"),
        environ={"SAKADESK_RELEASE_SIGNING_KEY": _pem(new_key())},
    )
    assert code == 1
    assert capsys.readouterr().err == "ERROR: wrong_asset\n"


def test_an_invalid_version_is_refused(tmp_path, capsys):
    code = _signer().main(
        _args(_installer(tmp_path), tmp_path / "m.json", version="0.5.1/../x"),
        environ={"SAKADESK_RELEASE_SIGNING_KEY": _pem(new_key())},
    )
    assert code == 1
    assert capsys.readouterr().err == "ERROR: version_invalid\n"


def test_the_key_file_is_removed_after_signing(tmp_path):
    key = new_key()
    work = tmp_path / "work"
    work.mkdir()
    kid, signature = _signer().sign_with_pem(_pem(key), b"hello", work)
    assert not (work / "key.pem").exists()
    assert len(signature) == 64
    key.public_key().verify(signature, b"hello")
    assert kid in trusted(key)


def test_output_never_contains_key_material(tmp_path, capsys):
    pem = _pem(new_key())
    code = _signer().main(
        _args(_installer(tmp_path), tmp_path / "m.json"),
        environ={"SAKADESK_RELEASE_SIGNING_KEY": pem},
    )
    captured = capsys.readouterr()
    assert code == 0
    body = "".join(pem.strip().splitlines()[1:-1])
    assert "PRIVATE KEY" not in captured.out + captured.err
    assert body not in captured.out + captured.err


def _garbage_pem() -> str:
    return (
        "-----BEGIN " + "PRIVATE KEY-----\nAAAAAAAA\n-----END " + "PRIVATE KEY-----\n"
    )


def test_the_key_file_is_removed_when_openssl_rejects_the_key(tmp_path):
    signer = _signer()
    with pytest.raises(signer.SignError) as raised:
        signer.sign_with_pem(_garbage_pem(), b"hello", tmp_path)
    assert raised.value.code == "openssl_failed"
    assert not (tmp_path / "key.pem").exists()


def test_the_key_file_is_removed_when_openssl_is_missing(tmp_path, monkeypatch):
    empty = tmp_path / "empty-path"
    empty.mkdir()
    monkeypatch.setenv("PATH", str(empty))
    work = tmp_path / "work"
    work.mkdir()
    signer = _signer()
    with pytest.raises(signer.SignError) as raised:
        signer.sign_with_pem(_pem(new_key()), b"hello", work)
    assert raised.value.code == "openssl_unavailable"
    assert not (work / "key.pem").exists()


def test_openssl_runs_without_the_signing_keys_in_its_environment(
    tmp_path, monkeypatch
):
    for name in (
        "SAKADESK_RELEASE_SIGNING_KEY",
        "SAKADESK_RELEASE_SIGNING_KEY_NEXT",
        "OPENSSL_CONF",
        "OPENSSL_ENGINES",
    ):
        monkeypatch.setenv(name, "value-" + name)
    monkeypatch.setenv("SAKADESK_TEST_KEEP", "kept")
    signer = _signer()
    real_run = subprocess.run
    envs = []

    def spy(*args, **kwargs):
        envs.append(kwargs.get("env"))
        return real_run(*args, **kwargs)

    monkeypatch.setattr(signer.subprocess, "run", spy)
    signer.sign_with_pem(_pem(new_key()), b"hello", tmp_path)
    assert len(envs) == 2
    for env in envs:
        assert env is not None
        assert env["SAKADESK_TEST_KEEP"] == "kept"
        assert "PATH" in env
        for name in (
            "SAKADESK_RELEASE_SIGNING_KEY",
            "SAKADESK_RELEASE_SIGNING_KEY_NEXT",
            "OPENSSL_CONF",
            "OPENSSL_ENGINES",
        ):
            assert name not in env
