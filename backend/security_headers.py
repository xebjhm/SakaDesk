"""Framing, sniffing and embedding defaults on every response (security audit 2026-11-13).

- ``X-Frame-Options: DENY`` + ``Content-Security-Policy: frame-ancestors 'none'``:
  no other site may frame SakaDesk's UI (clickjacking).
- ``X-Content-Type-Options: nosniff``: a file is never sniffed into a more
  active type than the one it was served as.
- ``Cross-Origin-Resource-Policy: same-origin``: other sites cannot embed
  archive media as <img>/<video> and observe load/error.

Headers a route already set (for example a stricter CSP) are kept.
"""

from __future__ import annotations

from starlette.types import ASGIApp, Message, Receive, Scope, Send

_DEFAULTS: tuple[tuple[bytes, bytes], ...] = (
    (b"x-frame-options", b"DENY"),
    (b"content-security-policy", b"frame-ancestors 'none'"),
    (b"x-content-type-options", b"nosniff"),
    (b"cross-origin-resource-policy", b"same-origin"),
)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {name.lower() for name, _ in headers}
                headers.extend(h for h in _DEFAULTS if h[0] not in present)
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)
