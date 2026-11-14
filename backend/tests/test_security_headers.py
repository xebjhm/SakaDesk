"""Content-Security-Policy of the app (security audit 2026-11-13, report-hardening:
"The SPA is served without a Content-Security-Policy")."""

from __future__ import annotations

import re
from pathlib import Path

from fastapi.testclient import TestClient
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route

from backend import main as backend_main
from backend.security_headers import (
    APP_CSP,
    DOCS_CSP,
    SANDBOX_CSP,
    SecurityHeadersMiddleware,
)

ROOT = Path(__file__).resolve().parents[2]


def _directives(policy: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for part in policy.split(";"):
        tokens = part.split()
        if tokens:
            out[tokens[0]] = tokens[1:]
    return out


def _client(overrides: dict[str, str] | None = None) -> TestClient:
    async def plain(_request):
        return PlainTextResponse("ok")

    async def own(_request):
        return PlainTextResponse("ok", headers={"Content-Security-Policy": SANDBOX_CSP})

    inner = Starlette(
        routes=[Route("/plain", plain), Route("/own", own), Route("/docs", plain)]
    )
    return TestClient(SecurityHeadersMiddleware(inner, csp_overrides=overrides))


class TestAppPolicy:
    def test_directives(self):
        d = _directives(APP_CSP)
        assert d == {
            "default-src": ["'self'"],
            "script-src": ["'self'"],
            "style-src": ["'self'"],
            "img-src": ["'self'", "data:", "blob:", "https:"],
            "media-src": ["'self'"],
            "font-src": ["'self'", "data:"],
            "connect-src": ["'self'"],
            "frame-src": ["'self'"],
            "object-src": ["'none'"],
            "base-uri": ["'none'"],
            "form-action": ["'self'"],
            "frame-ancestors": ["'self'"],
        }

    def test_no_inline_code_and_no_third_party_origin(self):
        assert "unsafe-inline" not in APP_CSP
        assert "https://" not in APP_CSP and "http://" not in APP_CSP


class TestNoEval:
    def test_no_eval(self):
        """Host->page calls run through host_js raw mode (audit 2026-11-13, Plan D)."""
        assert "unsafe-eval" not in APP_CSP


class TestMiddleware:
    def test_referrer_policy(self):
        resp = _client().get("/plain")
        assert resp.headers["referrer-policy"] == "strict-origin-when-cross-origin"

    def test_every_response_gets_the_app_policy_once(self):
        resp = _client().get("/plain")
        assert resp.headers.get_list("content-security-policy") == [APP_CSP]
        assert resp.headers["x-frame-options"] == "SAMEORIGIN"
        assert resp.headers["x-content-type-options"] == "nosniff"
        assert resp.headers["cross-origin-resource-policy"] == "same-origin"

    def test_a_route_policy_is_kept(self):
        resp = _client().get("/own")
        assert resp.headers.get_list("content-security-policy") == [SANDBOX_CSP]

    def test_an_override_path_gets_its_policy(self):
        c = _client({"/docs": DOCS_CSP})
        assert c.get("/docs").headers["content-security-policy"] == DOCS_CSP
        assert c.get("/plain").headers["content-security-policy"] == APP_CSP

    def test_the_real_app_answers_with_the_app_policy(self):
        resp = TestClient(backend_main.app, base_url="http://127.0.0.1:8765").get(
            "/health"
        )
        assert resp.headers.get_list("content-security-policy") == [APP_CSP]


class TestDocsOverrides:
    def test_frozen_builds_need_none(self):
        assert (
            backend_main._docs_csp_overrides(backend_main._docs_urls(frozen=True)) == {}
        )

    def test_source_runs_relax_only_the_docs_pages(self):
        overrides = backend_main._docs_csp_overrides(
            backend_main._docs_urls(frozen=False)
        )
        assert overrides == {
            "/docs": DOCS_CSP,
            "/docs/oauth2-redirect": DOCS_CSP,
            "/redoc": DOCS_CSP,
        }
        assert DOCS_CSP == "frame-ancestors 'self'"


class TestIndexHtml:
    def test_index_html_has_no_inline_code_or_remote_origin(self):
        html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
        assert "style=" not in html
        scripts = re.findall(r"<script\b([^>]*)>", html)
        assert scripts and all("src=" in attrs for attrs in scripts)
        assert "https://" not in html and "http://" not in html


from backend.security_headers import AppWithSecurityHeaders  # noqa: E402


def test_a_500_from_an_unhandled_error_keeps_the_headers():
    """Plan A follow-up: Starlette's ServerErrorMiddleware sat outside the headers middleware."""
    app = AppWithSecurityHeaders(csp_overrides={})

    @app.get("/boom")
    async def boom():
        raise RuntimeError("C:\\Users\\victim")

    resp = TestClient(app, raise_server_exceptions=False).get("/boom")
    assert resp.status_code == 500
    assert resp.headers.get_list("content-security-policy") == [APP_CSP]
    assert resp.headers["x-frame-options"] == "SAMEORIGIN"
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["cross-origin-resource-policy"] == "same-origin"
    assert "victim" not in resp.text


def test_overrides_still_apply_and_headers_are_not_doubled():
    app = AppWithSecurityHeaders(csp_overrides={"/docs-like": "frame-ancestors 'self'"})

    @app.get("/docs-like")
    async def docs_like():
        return {"ok": True}

    resp = TestClient(app).get("/docs-like")
    assert resp.headers.get_list("content-security-policy") == [
        "frame-ancestors 'self'"
    ]
    assert resp.headers.get_list("x-frame-options") == ["SAMEORIGIN"]
