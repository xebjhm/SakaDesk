"""Security tests for backend/main.py — CR 2026-07-02 SEC-1 / SEC-2.

SEC-1: the SPA catch-all must not serve files outside frontend/dist.
SEC-2: the local API must reject cross-origin (CSRF) and non-loopback Host
       (DNS-rebinding) requests.
Audit 2026-11-13: exact-Origin check, per-launch token, no production CORS, security headers.
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend import main as backend_main
from backend.main import app
from backend.services import api_auth

client = TestClient(app)

# A real endpoint that returns 200 for the not-blocked assertions.
_API_PATH = "/api/sync/progress?service=hinatazaka46"


# --- SEC-1: SPA catch-all path traversal ------------------------------------


def test_spa_catchall_blocks_encoded_path_traversal():
    """A URL-encoded ``../`` escape must NOT serve files outside frontend/dist.

    ``%2e%2e%2f`` is ``../``; httpx keeps it percent-encoded and Starlette
    decodes it into the :path param without collapsing the dot segments, so a
    naive ``frontend_dist / full_path`` would resolve to the repo's
    pyproject.toml. The fix falls back to index.html instead.
    """
    resp = client.get("/%2e%2e%2f%2e%2e%2fpyproject.toml")
    body = resp.text
    # The real pyproject.toml carries these markers; index.html does not.
    assert "[tool.pytest.ini_options]" not in body
    assert "[build-system]" not in body


# --- SEC-2 + audit 2026-11-13: who may call /api ----------------------------

TOKEN = {"X-SakaDesk-Token": api_auth.LAUNCH_TOKEN}
# A client that looks like the packaged webview (Host 127.0.0.1:<port>), so the
# pytest-only "testserver" exemption does not apply.
app_client = TestClient(app, base_url="http://127.0.0.1:8765")
_JSON_GET = "/api/settings"


def test_cross_origin_api_request_blocked():
    """/api/* carrying a non-loopback Origin is rejected with 403 (SEC-2)."""
    resp = client.get(_API_PATH, headers={"Origin": "http://evil.example.com"})
    assert resp.status_code == 403


def test_other_loopback_port_origin_blocked():
    """A page on another localhost port is not the app (any-loopback-port-origin)."""
    resp = app_client.post(
        _JSON_GET, json={}, headers={**TOKEN, "Origin": "http://localhost:9999"}
    )
    assert resp.status_code == 403


def test_null_origin_blocked():
    resp = app_client.get(_JSON_GET, headers={**TOKEN, "Origin": "null"})
    assert resp.status_code == 403


def test_own_origin_with_token_allowed():
    resp = app_client.get(
        _JSON_GET, headers={**TOKEN, "Origin": "http://127.0.0.1:8765"}
    )
    assert resp.status_code == 200


def test_no_origin_api_request_allowed():
    """Native/webview/CLI callers send no Origin and must be allowed."""
    resp = client.get(_API_PATH)
    assert resp.status_code != 403


def test_api_without_token_is_unauthorized():
    """No token, no access: other processes / accounts (no-caller-authentication)."""
    assert app_client.get(_JSON_GET).status_code == 401
    assert app_client.post(_JSON_GET, json={}).status_code == 401


def test_api_with_wrong_token_is_unauthorized():
    resp = app_client.get(_JSON_GET, headers={"X-SakaDesk-Token": "x" * 43})
    assert resp.status_code == 401


def test_cookie_authorizes_get_but_never_a_mutation():
    """<img>/<video> GETs carry the cookie; POSTs must carry the header."""
    jar = {api_auth.TOKEN_COOKIE: api_auth.LAUNCH_TOKEN}
    cookie_client = TestClient(app, base_url="http://127.0.0.1:8765", cookies=jar)
    assert cookie_client.get(_JSON_GET).status_code == 200
    assert cookie_client.post(_JSON_GET, json={}).status_code == 401


def test_bootstrap_sets_an_httponly_strict_cookie():
    fresh = TestClient(app, base_url="http://127.0.0.1:8765")
    resp = fresh.post("/api/session/bootstrap", headers=TOKEN)
    assert resp.status_code == 200
    cookie = resp.headers["set-cookie"]
    assert cookie.startswith(f"{api_auth.TOKEN_COOKIE}={api_auth.LAUNCH_TOKEN}")
    assert "HttpOnly" in cookie
    assert "SameSite=strict" in cookie
    assert "Path=/api/" in cookie


def test_bootstrap_requires_the_header():
    assert app_client.post("/api/session/bootstrap").status_code == 401


def test_no_cors_grant_for_dev_origins():
    """The six dev origins no longer get ACAO in production (CORS dev origins)."""
    resp = app_client.get(
        _JSON_GET, headers={**TOKEN, "Origin": "http://localhost:3000"}
    )
    assert "access-control-allow-origin" not in resp.headers


def test_health_needs_no_token_and_returns_a_proof():
    nonce = "abcdefghijklmnop"
    plain = app_client.get("/health")
    proved = app_client.get(f"/health?nonce={nonce}")
    assert plain.status_code == 200 and "proof" not in plain.json()
    assert proved.json()["proof"] == api_auth.health_proof(nonce)


def test_health_ignores_a_malformed_nonce():
    assert "proof" not in app_client.get("/health?nonce=bad nonce").json()


def test_security_headers_on_every_response():
    responses = (
        app_client.get("/health"),  # 200
        app_client.get(_JSON_GET, headers=TOKEN),  # 200
        client.get("/health", headers={"Host": "evil.example.com"}),  # 400
        # fresh client: app_client's jar may hold the bootstrap cookie
        TestClient(app, base_url="http://127.0.0.1:8765").get(_JSON_GET),  # 401
        app_client.get(  # 403
            _JSON_GET, headers={**TOKEN, "Origin": "http://localhost:9999"}
        ),
    )
    assert [r.status_code for r in responses] == [200, 200, 400, 401, 403]
    for resp in responses:
        assert resp.headers["x-frame-options"] == "SAMEORIGIN"
        assert "frame-ancestors 'self'" in resp.headers["content-security-policy"]
        assert resp.headers["x-content-type-options"] == "nosniff"
        assert resp.headers["cross-origin-resource-policy"] == "same-origin"


def test_guard_rechecks_the_test_client_flag_per_request(monkeypatch):
    """The Host: testserver exemption needs SAKADESK_TEST_CLIENT at request time."""
    assert client.get(_JSON_GET).status_code == 200
    monkeypatch.delenv("SAKADESK_TEST_CLIENT")
    assert client.get(_JSON_GET).status_code == 401


_COOKIE = {api_auth.TOKEN_COOKIE: api_auth.LAUNCH_TOKEN}


@pytest.mark.parametrize(
    ("fetch_site", "status"),
    [
        ("same-site", 401),
        ("cross-site", 401),
        ("same-origin", 200),
        ("none", 200),
        (None, 200),
    ],
)
def test_cookie_auth_honours_sec_fetch_site(fetch_site, status):
    cookie_client = TestClient(app, base_url="http://127.0.0.1:8765", cookies=_COOKIE)
    headers = {"Sec-Fetch-Site": fetch_site} if fetch_site else {}
    assert cookie_client.get(_JSON_GET, headers=headers).status_code == status


def test_header_auth_ignores_sec_fetch_site():
    resp = app_client.get(_JSON_GET, headers={**TOKEN, "Sec-Fetch-Site": "cross-site"})
    assert resp.status_code == 200


def test_fetch_site_rejection_is_logged():
    cookie_client = TestClient(app, base_url="http://127.0.0.1:8765", cookies=_COOKIE)
    with capture_logs() as logs:
        cookie_client.get(_JSON_GET, headers={"Sec-Fetch-Site": "same-site"})
    assert any(
        e["event"] == "api_request_rejected" and e["reason"] == "fetch_site"
        for e in logs
    )


def test_bad_host_rejection_is_logged_without_the_host():
    with capture_logs() as logs:
        resp = client.get("/health", headers={"Host": "evil.example.com"})
    assert resp.status_code == 400
    events = [e for e in logs if e["event"] == "api_request_rejected"]
    assert events and events[0]["reason"] == "host"
    assert "evil.example.com" not in repr(logs)


def test_health_rejected_nonce_is_logged():
    with capture_logs() as logs:
        body = app_client.get("/health?nonce=bad nonce").json()
    assert body == {"status": "ok"}
    assert any(e["event"] == "health_nonce_rejected" for e in logs)


def test_health_rejects_a_nonce_with_trailing_newline():
    body = app_client.get("/health?nonce=abcdefghijklmnop%0A").json()
    assert "proof" not in body


def test_docs_are_disabled_when_frozen():
    assert backend_main._docs_urls(frozen=True) == {
        "docs_url": None,
        "redoc_url": None,
        "openapi_url": None,
    }
    assert backend_main._docs_urls(frozen=False)["docs_url"] == "/docs"


def test_is_own_origin_requires_exact_host_match():
    assert backend_main._is_own_origin("http://127.0.0.1:8765", "127.0.0.1:8765")
    assert not backend_main._is_own_origin("http://127.0.0.1:9999", "127.0.0.1:8765")
    assert not backend_main._is_own_origin("http://localhost:8765", "127.0.0.1:8765")
    assert not backend_main._is_own_origin("null", "127.0.0.1:8765")
    assert not backend_main._is_own_origin("file:///x", "127.0.0.1:8765")


def test_untrusted_host_rejected():
    """A non-loopback Host header is rejected (DNS-rebinding defense)."""
    resp = client.get("/health", headers={"Host": "evil.example.com"})
    assert resp.status_code == 400


def test_loopback_host_allowed():
    """A loopback Host header passes (control for the rejection test)."""
    resp = client.get("/health", headers={"Host": "127.0.0.1:8765"})
    assert resp.status_code == 200


def test_testserver_host_rejected_outside_pytest(tmp_path):
    """Production never accepts Host: testserver (testserver-allowed-host)."""
    env = {k: v for k, v in os.environ.items() if k != "SAKADESK_TEST_CLIENT"}
    env.update(
        SAKADESK_DATA_DIR=str(tmp_path),
        HOME=str(tmp_path),
        PYTHONPATH=str(Path(__file__).resolve().parents[2]),
    )
    code = (
        "from fastapi.testclient import TestClient\n"
        "from backend.main import app\n"
        "print(TestClient(app).get('/health').status_code)\n"
    )
    out = subprocess.run(
        [sys.executable, "-c", code],
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert out.stdout.strip().splitlines()[-1] == "400", out.stderr[-2000:]
