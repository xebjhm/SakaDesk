"""Response security headers on everything the app produces
(security audit 2026-11-13; a 500 from Starlette's outermost error middleware bypasses them).

Unless the route already set its own value, every response gets:

- ``Content-Security-Policy: APP_CSP`` — the SPA's policy. Scripts only from
  the app (no inline script, no inline event handler, no ``javascript:``
  URL; ``'unsafe-eval'`` because pywebview 5.3.2 runs every host→page call,
  such as a toast click, through ``eval``), styles and connections only from
  the app, fonts from the app or inlined ``data:`` slices, images also from
  ``data:``, ``blob:`` and ``https:`` (remote blog images and thumbnails),
  media and frames only from the app, no plugins, no ``<base>``, forms only to
  the app, and only the app may frame it (``frame-ancestors 'self'``: its own
  hidden download iframe). Routes that stream archive or remote files set
  ``SANDBOX_CSP`` instead (``backend/services/passive_media.py``).
- ``X-Frame-Options: SAMEORIGIN``: the same framing rule for clients that only
  read this header.
- ``X-Content-Type-Options: nosniff``: a file is never sniffed into a more
  active type than the one it was served as.
- ``Cross-Origin-Resource-Policy: same-origin``: other sites cannot embed
  archive media as <img>/<video> and observe load/error.

``csp_overrides`` maps exact request paths to another policy: in source runs
FastAPI's /docs and /redoc pages (CDN scripts with inline setup) get
``DOCS_CSP`` (``backend.main._docs_csp_overrides``).
"""

from __future__ import annotations

from collections.abc import Mapping

from starlette.types import ASGIApp, Message, Receive, Scope, Send

APP_CSP = "; ".join(
    (
        "default-src 'self'",
        "script-src 'self' 'unsafe-eval'",
        "style-src 'self'",
        "img-src 'self' data: blob: https:",
        "media-src 'self'",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'self'",
    )
)
"""The policy of every page and API response the app produces (see the module docstring)."""

SANDBOX_CSP = "default-src 'none'; sandbox; frame-ancestors 'self'"
"""CSP of a file from the archive or a remote host: opened as a page it runs no
script, loads nothing and has an opaque origin; only the app may frame it."""

DOCS_CSP = "frame-ancestors 'self'"
"""Source runs only: FastAPI's docs pages keep framing protection and nothing else."""

_CSP = b"content-security-policy"
_DEFAULTS: tuple[tuple[bytes, bytes], ...] = (
    (b"x-frame-options", b"SAMEORIGIN"),
    (b"x-content-type-options", b"nosniff"),
    (b"cross-origin-resource-policy", b"same-origin"),
)


class SecurityHeadersMiddleware:
    def __init__(
        self, app: ASGIApp, csp_overrides: Mapping[str, str] | None = None
    ) -> None:
        self.app = app
        self._app_csp = APP_CSP.encode("latin-1")
        self._csp_overrides = {
            path: policy.encode("latin-1")
            for path, policy in (csp_overrides or {}).items()
        }

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        csp = self._csp_overrides.get(scope.get("path", ""), self._app_csp)

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {name.lower() for name, _ in headers}
                headers.extend(h for h in _DEFAULTS if h[0] not in present)
                if _CSP not in present:
                    headers.append((_CSP, csp))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)
