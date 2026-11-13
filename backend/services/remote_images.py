"""Blog backup image fetches from the official sites only (security audit 2026-11-13).

Blog HTML and member JSON choose the image URLs. A fetch needs ``https`` on
:data:`OFFICIAL_IMAGE_HOSTS` with the default port; each redirect hop (at most
:data:`MAX_REDIRECTS`) is checked the same way before it is requested; the
body is at most :data:`MAX_REMOTE_IMAGE_BYTES`, checked against
``Content-Length`` first and then counted while streaming. The proxy route
(``backend/api/blogs.py``) uses the same host set and cap. Network errors
(``aiohttp.ClientError``, ``TimeoutError``) propagate to the caller.
"""

from __future__ import annotations

from urllib.parse import urljoin, urlsplit

import aiohttp

OFFICIAL_IMAGE_HOSTS: frozenset[str] = frozenset(
    {
        "cdn.hinatazaka46.com",
        "www.hinatazaka46.com",
        "hinatazaka46.com",
        "cdn.sakurazaka46.com",
        "www.sakurazaka46.com",
        "sakurazaka46.com",
        "cdn.nogizaka46.com",
        "www.nogizaka46.com",
        "nogizaka46.com",
        "img.nogizaka46.com",
    }
)
"""Hosts blog images and member thumbnails may come from (owner check 9 confirms them)."""

MAX_REMOTE_IMAGE_BYTES = 10 * 1024 * 1024
"""Largest image body accepted (official assets are well under this)."""

MAX_REDIRECTS = 3
"""Redirect hops followed, each re-checked by :func:`url_refusal`."""

_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
_CHUNK_BYTES = 64 * 1024


class RemoteImageRefused(Exception):
    """A fetch refused before or while reading.

    ``reason`` is a log code (``invalid_url``, ``scheme``, ``host``, ``port``,
    ``redirect``, ``too_large``, ``status``); ``status`` is the HTTP status
    for ``reason="status"``.
    """

    def __init__(self, reason: str, status: int | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.status = status


def url_refusal(url: object) -> str | None:
    """Why ``url`` may not be fetched (``invalid_url``, ``scheme``, ``host``, ``port``), or ``None``."""
    if not isinstance(url, str) or not url:
        return "invalid_url"
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return "invalid_url"
    if parts.scheme != "https":
        return "scheme"
    if parts.hostname not in OFFICIAL_IMAGE_HOSTS:
        return "host"
    if port not in (None, 443):
        return "port"
    return None


async def fetch_official_image(
    session: aiohttp.ClientSession,
    url: str,
    *,
    max_bytes: int = MAX_REMOTE_IMAGE_BYTES,
) -> tuple[bytes, str]:
    """``(body, Content-Type)`` of an official-host image; raises :class:`RemoteImageRefused`."""
    current = url
    for _hop in range(MAX_REDIRECTS + 1):
        reason = url_refusal(current)
        if reason is not None:
            raise RemoteImageRefused(reason)
        async with session.get(current, allow_redirects=False) as resp:
            if resp.status in _REDIRECT_STATUSES:
                location = resp.headers.get("Location")
                if not location:
                    raise RemoteImageRefused("redirect")
                current = urljoin(current, location)
                continue
            if resp.status != 200:
                raise RemoteImageRefused("status", status=resp.status)
            declared = resp.content_length
            if declared is not None and declared > max_bytes:
                raise RemoteImageRefused("too_large")
            chunks: list[bytes] = []
            total = 0
            async for chunk in resp.content.iter_chunked(_CHUNK_BYTES):
                total += len(chunk)
                if total > max_bytes:
                    raise RemoteImageRefused("too_large")
                chunks.append(chunk)
            return b"".join(chunks), resp.headers.get("Content-Type", "")
    raise RemoteImageRefused("redirect")
