"""Unit tests for the local API's per-launch token (security audit 2026-11-13)."""

from __future__ import annotations

import hashlib
import hmac
import os
import subprocess
import sys
from pathlib import Path

import pytest
from structlog.testing import capture_logs

from backend.services import api_auth

_PIN = "dev-token-0123456789"


def test_token_ok_accepts_only_the_launch_token():
    assert api_auth.token_ok(api_auth.LAUNCH_TOKEN) is True
    assert api_auth.token_ok(api_auth.LAUNCH_TOKEN + "x") is False
    assert api_auth.token_ok("") is False
    assert api_auth.token_ok(None) is False


def test_token_ok_tolerates_non_ascii_without_raising():
    assert api_auth.token_ok("日向坂46-トークン") is False


def test_launch_token_is_long_and_url_safe():
    assert len(api_auth.LAUNCH_TOKEN) >= 32
    assert all(c.isalnum() or c in "-_" for c in api_auth.LAUNCH_TOKEN)


def test_initial_token_uses_a_long_enough_env_pin(monkeypatch):
    monkeypatch.setenv("SAKADESK_API_TOKEN", _PIN)
    assert api_auth._initial_token() == _PIN


def test_initial_token_ignores_a_short_env_pin(monkeypatch):
    monkeypatch.setenv("SAKADESK_API_TOKEN", "pin-7x9q")
    with capture_logs() as logs:
        token = api_auth._initial_token()
    assert token != "pin-7x9q" and len(token) >= 32
    ignored = [e for e in logs if e["event"] == "api_token_env_ignored"]
    assert [e["reason"] for e in ignored] == ["too_short"]
    assert "pin-7x9q" not in repr(logs)


def test_initial_token_ignores_the_env_pin_when_frozen(monkeypatch):
    """The packaged app never takes its token from the environment."""
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setenv("SAKADESK_API_TOKEN", _PIN)
    with capture_logs() as logs:
        token = api_auth._initial_token()
    assert token != _PIN and len(token) >= 32
    ignored = [e for e in logs if e["event"] == "api_token_env_ignored"]
    assert [e["reason"] for e in ignored] == ["frozen"]
    assert _PIN not in repr(logs)


def test_initial_token_without_env_logs_nothing_when_frozen(monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.delenv("SAKADESK_API_TOKEN", raising=False)
    with capture_logs() as logs:
        api_auth._initial_token()
    assert not [e for e in logs if e["event"] == "api_token_env_ignored"]


def test_initial_token_is_random_without_env(monkeypatch):
    monkeypatch.delenv("SAKADESK_API_TOKEN", raising=False)
    assert api_auth._initial_token() != api_auth._initial_token()


def _hmac(msg: bytes) -> str:
    return hmac.new(api_auth.LAUNCH_TOKEN.encode(), msg, hashlib.sha256).hexdigest()


def test_health_proof_is_a_domain_separated_hmac_of_the_nonce():
    nonce = "n" * 24
    assert api_auth.health_proof(nonce) == _hmac(b"health:" + nonce.encode())
    assert api_auth.health_proof(nonce) != _hmac(nonce.encode())
    assert api_auth.health_proof("m" * 24) != api_auth.health_proof(nonce)


def test_cookie_value_is_derived_from_but_not_the_token():
    assert api_auth.cookie_value() == _hmac(b"sakadesk-cookie-v1")
    assert api_auth.cookie_value() != api_auth.LAUNCH_TOKEN
    assert api_auth.LAUNCH_TOKEN not in api_auth.cookie_value()


def test_cookie_ok_accepts_only_the_derived_cookie():
    assert api_auth.cookie_ok(api_auth.cookie_value()) is True
    assert api_auth.cookie_ok(api_auth.LAUNCH_TOKEN) is False
    assert api_auth.cookie_ok(api_auth.cookie_value() + "0") is False
    assert api_auth.cookie_ok("") is False
    assert api_auth.cookie_ok(None) is False
    assert api_auth.cookie_ok("日向坂46-クッキー") is False


def test_header_check_refuses_the_cookie_value():
    assert api_auth.token_ok(api_auth.cookie_value()) is False


def test_valid_nonce_shape():
    assert api_auth.valid_nonce("A" * 16)
    assert api_auth.valid_nonce("aZ09_-" * 4)
    assert not api_auth.valid_nonce("short")
    assert not api_auth.valid_nonce("A" * 65)
    assert not api_auth.valid_nonce("bad nonce with spaces!!")
    assert not api_auth.valid_nonce("A" * 16 + "\n")


def test_test_client_mode_follows_env(monkeypatch):
    monkeypatch.setenv("SAKADESK_TEST_CLIENT", "1")
    assert api_auth.test_client_mode() is True
    monkeypatch.delenv("SAKADESK_TEST_CLIENT")
    assert api_auth.test_client_mode() is False


def test_test_client_mode_is_off_when_frozen(monkeypatch):
    monkeypatch.setenv("SAKADESK_TEST_CLIENT", "1")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    assert api_auth.test_client_mode() is False


def test_frozen_test_client_env_is_noted_once(monkeypatch):
    monkeypatch.setenv("SAKADESK_TEST_CLIENT", "1")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    with capture_logs() as logs:
        api_auth._note_ignored_test_client_env()
    assert [(e["event"], e["reason"]) for e in logs] == [
        ("test_client_env_ignored", "frozen")
    ]


def test_test_client_env_is_not_noted_from_source(monkeypatch):
    monkeypatch.setenv("SAKADESK_TEST_CLIENT", "1")
    monkeypatch.delattr(sys, "frozen", raising=False)
    with capture_logs() as logs:
        api_auth._note_ignored_test_client_env()
    assert logs == []


def _launch_token_matches_pin(tmp_path: Path, pin: str | None) -> str:
    """Import api_auth in a fresh interpreter; report whether it took the pin."""
    env = {k: v for k, v in os.environ.items() if k != "SAKADESK_API_TOKEN"}
    env.update(
        SAKADESK_DATA_DIR=str(tmp_path),
        HOME=str(tmp_path),
        PYTHONPATH=str(Path(__file__).resolve().parents[2]),
    )
    if pin is not None:
        env["SAKADESK_API_TOKEN"] = pin
    code = (
        "import os\n"
        "from backend.services import api_auth\n"
        "print(api_auth.LAUNCH_TOKEN == os.environ.get('SAKADESK_API_TOKEN'))\n"
    )
    out = subprocess.run(
        [sys.executable, "-c", code],
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    return out.stdout.strip().splitlines()[-1] if out.stdout.strip() else out.stderr


@pytest.mark.parametrize(
    ("pin", "expected"), [(_PIN, "True"), ("short", "False"), (None, "False")]
)
def test_launch_token_takes_the_env_pin_at_import(tmp_path, pin, expected):
    assert _launch_token_matches_pin(tmp_path, pin) == expected
