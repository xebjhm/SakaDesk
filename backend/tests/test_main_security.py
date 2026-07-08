"""Security tests for backend/main.py — CR 2026-07-02 SEC-1 / SEC-2.

SEC-1: the SPA catch-all must not serve files outside frontend/dist.
SEC-2: the local API must reject cross-origin (CSRF) and non-loopback Host
       (DNS-rebinding) requests.
"""

from fastapi.testclient import TestClient

from backend.main import app

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


# --- SEC-2: cross-origin (CSRF) + Host (DNS-rebinding) ----------------------


def test_cross_origin_api_request_blocked():
    """/api/* carrying a non-loopback Origin is rejected with 403 (SEC-2)."""
    resp = client.get(_API_PATH, headers={"Origin": "http://evil.example.com"})
    assert resp.status_code == 403


def test_loopback_origin_api_request_allowed():
    """/api/* with the app's own loopback Origin passes the guard."""
    resp = client.get(_API_PATH, headers={"Origin": "http://localhost:5173"})
    assert resp.status_code != 403


def test_no_origin_api_request_allowed():
    """Native/webview/CLI callers send no Origin and must be allowed."""
    resp = client.get(_API_PATH)
    assert resp.status_code != 403


def test_untrusted_host_rejected():
    """A non-loopback Host header is rejected (DNS-rebinding defense)."""
    resp = client.get("/health", headers={"Host": "evil.example.com"})
    assert resp.status_code == 400


def test_loopback_host_allowed():
    """A loopback Host header passes (control for the rejection test)."""
    resp = client.get("/health", headers={"Host": "127.0.0.1:8765"})
    assert resp.status_code == 200
