"""Keep API JSON out of the browser HTTP cache.

Chromium serialises concurrent requests for the same cacheable URL behind the
in-flight one (the "cache lock", ~20 s). API JSON responses carry no
``Cache-Control``, so a pending ``/api/sync/progress`` request made every later
poll wait. ``Cache-Control: no-store`` removes the lock.

Only JSON responses under ``/api/`` that do not set ``Cache-Control`` themselves
are touched; media, avatars, thumbnails and range responses keep their own
headers. Implemented as pure ASGI (not ``BaseHTTPMiddleware``) so streaming
responses are never buffered.
"""

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_API_PREFIX = "/api/"
_JSON_MEDIA_TYPE = "application/json"


class ApiNoStoreMiddleware:
    """Add ``Cache-Control: no-store`` to ``/api/`` JSON responses lacking one."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(_API_PREFIX):
            await self.app(scope, receive, send)
            return

        async def send_with_header(message: Message) -> None:
            if message["type"] == "http.response.start":
                message.setdefault("headers", [])
                headers = MutableHeaders(scope=message)
                media_type = headers.get("content-type", "").split(";")[0].strip()
                if (
                    media_type.lower() == _JSON_MEDIA_TYPE
                    and "cache-control" not in headers
                ):
                    headers["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, send_with_header)
