"""Per-launch authentication for the local loopback API (security audit 2026-11-13).

The backend listens on 127.0.0.1, which every local process can reach,
including processes of other Windows accounts on the same PC. A random token,
created once per process and handed only to SakaDesk's own windows (in the URL
fragment, see desktop.py), separates the app's UI from any other caller.

``SAKADESK_API_TOKEN`` pins the value for development (dev.sh / dev.ps1 share it
with the Vite proxy) and e2e runs; a pin shorter than 16 characters is ignored.
``SAKADESK_TEST_CLIENT=1`` (set only by the root conftest) lets pytest's
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
_NONCE_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")


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


def token_ok(value: str | None) -> bool:
    """Constant-time comparison with the launch token."""
    if not value:
        return False
    return hmac.compare_digest(value.encode("utf-8"), LAUNCH_TOKEN.encode("utf-8"))


def valid_nonce(nonce: str) -> bool:
    """A readiness-probe nonce: 16-64 URL-safe characters."""
    return bool(_NONCE_RE.match(nonce))


def health_proof(nonce: str) -> str:
    """HMAC-SHA256 of the nonce under the launch token (hex).

    desktop.py's readiness probe sends a fresh nonce and accepts the server
    only if it returns this proof, so a process squatting the port cannot pass
    itself off as SakaDesk's backend.
    """
    return hmac.new(
        LAUNCH_TOKEN.encode("utf-8"), nonce.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def test_client_mode() -> bool:
    """True only under pytest (root conftest sets SAKADESK_TEST_CLIENT=1)."""
    return os.environ.get("SAKADESK_TEST_CLIENT") == "1"
