"""Unit tests for the local API's per-launch token (security audit 2026-11-13)."""

from __future__ import annotations

import hashlib
import hmac

from backend.services import api_auth


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
    monkeypatch.setenv("SAKADESK_API_TOKEN", "dev-token-0123456789")
    assert api_auth._initial_token() == "dev-token-0123456789"


def test_initial_token_ignores_a_short_env_pin(monkeypatch):
    monkeypatch.setenv("SAKADESK_API_TOKEN", "short")
    token = api_auth._initial_token()
    assert token != "short" and len(token) >= 32


def test_initial_token_is_random_without_env(monkeypatch):
    monkeypatch.delenv("SAKADESK_API_TOKEN", raising=False)
    assert api_auth._initial_token() != api_auth._initial_token()


def test_health_proof_is_hmac_of_the_nonce():
    nonce = "n" * 24
    expected = hmac.new(
        api_auth.LAUNCH_TOKEN.encode(), nonce.encode(), hashlib.sha256
    ).hexdigest()
    assert api_auth.health_proof(nonce) == expected
    assert api_auth.health_proof("m" * 24) != expected


def test_valid_nonce_shape():
    assert api_auth.valid_nonce("A" * 16)
    assert api_auth.valid_nonce("aZ09_-" * 4)
    assert not api_auth.valid_nonce("short")
    assert not api_auth.valid_nonce("A" * 65)
    assert not api_auth.valid_nonce("bad nonce with spaces!!")


def test_test_client_mode_follows_env(monkeypatch):
    monkeypatch.setenv("SAKADESK_TEST_CLIENT", "1")
    assert api_auth.test_client_mode() is True
    monkeypatch.delenv("SAKADESK_TEST_CLIENT")
    assert api_auth.test_client_mode() is False
