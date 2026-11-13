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
            "script-src": ["'self'", "'unsafe-eval'"],
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


class TestMiddleware:
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
