"""Per-launch authentication for the local loopback API (security audit 2026-11-13).

The backend listens on 127.0.0.1, which every local process can reach,
including processes of other Windows accounts on the same PC. A random token,
created once per process and handed only to SakaDesk's own windows (in the URL
fragment, see desktop.py), separates the app's UI from any other caller.

Values derived from the token are domain-separated, so none can stand in for
another: the media cookie holds ``cookie_value()`` (an HMAC of a fixed label),
never the token, so a cookie leaked to another 127.0.0.1 port cannot be sent as
the header; the open ``/health`` signs ``"health:" + nonce``, so it cannot be
made to produce the cookie value or any other keyed value.

``SAKADESK_API_TOKEN`` pins the value for development (dev.sh / dev.ps1 put it
in the dev page's ``#t=`` URL) and e2e runs; a pin shorter than 16 characters is
ignored. ``SAKADESK_TEST_CLIENT=1`` (set only by the root conftest) lets pytest's
TestClient, which always sends ``Host: testserver``, through the guard.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets

import structlog

logger = structlog.get_logger(__name__)

TOKEN_HEADER = "x-sakadesk-token"
TOKEN_COOKIE = "sakadesk_t"

_MIN_ENV_TOKEN_LEN = 16
_NONCE_RE = re.compile(r"[A-Za-z0-9_-]{16,64}")


def _initial_token() -> str:
    """The env pin when it is long enough, otherwise 256 random bits."""
    pinned = os.environ.get("SAKADESK_API_TOKEN", "")
    if len(pinned) >= _MIN_ENV_TOKEN_LEN:
        logger.info("api_token_source", source="env")
        return pinned
    if pinned:
        logger.warning("api_token_env_ignored", reason="too_short")
    return secrets.token_urlsafe(32)


LAUNCH_TOKEN: str = _initial_token()


def _keyed(message: bytes) -> str:
    """HMAC-SHA256 of ``message`` under the launch token (hex)."""
    return hmac.new(LAUNCH_TOKEN.encode("utf-8"), message, hashlib.sha256).hexdigest()


def _same(value: str | None, expected: str) -> bool:
    """Constant-time equality; empty or missing values never match."""
    if not value:
        return False
    return hmac.compare_digest(value.encode("utf-8"), expected.encode("utf-8"))


def token_ok(value: str | None) -> bool:
    """Constant-time comparison with the launch token (the header value)."""
    return _same(value, LAUNCH_TOKEN)


def cookie_value() -> str:
    """The media cookie's value: HMAC-SHA256 of ``b"sakadesk-cookie-v1"`` (hex).

    Derived from, but never equal to, the launch token: the API guard accepts
    it only as the cookie on GET/HEAD and never as the header.
    """
    return _keyed(b"sakadesk-cookie-v1")


def cookie_ok(value: str | None) -> bool:
    """Constant-time comparison with ``cookie_value()``."""
    return _same(value, cookie_value())


def valid_nonce(nonce: str) -> bool:
    """A readiness-probe nonce: 16-64 URL-safe characters."""
    return bool(_NONCE_RE.fullmatch(nonce))


def health_proof(nonce: str) -> str:
    """HMAC-SHA256 of ``b"health:" + nonce`` under the launch token (hex).

    desktop.py's readiness probe sends a fresh nonce and accepts the server
    only if it returns this proof, so a process squatting the port cannot pass
    itself off as SakaDesk's backend. The ``health:`` prefix keeps the open
    /health endpoint from signing anything another check accepts.
    """
    return _keyed(b"health:" + nonce.encode("utf-8"))


def test_client_mode() -> bool:
    """True only under pytest (root conftest sets SAKADESK_TEST_CLIENT=1)."""
    return os.environ.get("SAKADESK_TEST_CLIENT") == "1"
