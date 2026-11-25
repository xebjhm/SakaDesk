"""Serve archived media in bounded byte ranges.

Why this exists: Chromium (WebView2) allows only six low-priority requests per
host. ``<video>`` / ``<audio>`` always ask for ``Range: bytes=N-``, and the old
``FileResponse`` answered that with the whole rest of the file. A paused or
abandoned media element kept that download open, so a handful of them filled
every slot and new video, voice and picture requests queued forever.

``MediaFileResponse`` fixes it in two ways:

* every ``206`` carries at most ``MEDIA_RANGE_CAP`` bytes (open-ended ranges
  become ``N-(N+cap-1)``, larger explicit ranges are trimmed), so each request
  finishes quickly and frees its slot; the media element simply asks for the
  next range, which is what RFC 9110 range clients do with a short ``206``;
* it stops reading the file as soon as the client disconnects. uvicorn's
  ``send()`` silently returns after an abort, so the response watches
  ``receive()`` for ``http.disconnect`` (and also treats ``OSError`` from
  ``send()`` as a disconnect, as ASGI 2.4 servers raise it).

Requests without ``Range`` get the full body with ``200``: RFC 9110 only allows
``206`` in answer to a range request, and ``<img>`` never sends one. Range
semantics follow RFC 9110 §14: an unknown unit or an invalid range set is
ignored (full ``200``); for several ranges only the first satisfiable one is
sent as a single-part ``206`` (clients must read ``Content-Range``); no
satisfiable range gives ``416`` with ``Content-Range: bytes */size``.

``If-Range`` is evaluated first, as Starlette's ``FileResponse`` did (RFC 9110
§13.1.5): when it matches neither the ``ETag`` (strong comparison, so a weak
``W/`` tag never matches) nor the exact ``Last-Modified`` HTTP-date, the
``Range`` is ignored and the full body is sent with ``200``; when it matches,
the bounded ``206`` is served.

A file that vanished between path validation and ``stat``/``open`` gets
``404``. ``HEAD`` is not handled (a body is always sent); the media routes are
GET-only.

Only passive media is served inline (``backend.services.passive_media``):
pictures, video and voice get their exact type; any other file name
(``.html``, ``.svg``, ...) is sent as ``application/octet-stream`` with
``Content-Disposition: attachment``. Every response carries
``X-Content-Type-Options: nosniff`` and the sandbox CSP.

Each response is counted, and every ``MEDIA_SUMMARY_EVERY`` requests an info
``media_requests_summary`` line reports the counts per media kind and status.
The detailed ``media_request`` breadcrumb (status, range header capped to
``LOGGED_RANGE_MAX`` characters, whether it was ignored or capped, the
``If-Range`` outcome, bytes sent, size, elapsed ms, media kind,
``client_disconnected`` and ``truncated``) is written at info on every
occurrence for a client disconnect, a truncated body or a status >= 400, and
otherwise only at debug for 1 in ``MEDIA_LOG_SAMPLE_EVERY`` requests. Neither
log carries the path or file name. Requests after the last full block of
``MEDIA_SUMMARY_EVERY`` are not summarised if the app shuts down first.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import time
from dataclasses import dataclass
from email.utils import formatdate
from pathlib import Path
from typing import BinaryIO

import structlog
from starlette.datastructures import Headers
from starlette.responses import JSONResponse, Response
from starlette.types import Message, Receive, Scope, Send

from backend.services.passive_media import passive_media

logger = structlog.get_logger(__name__)

MEDIA_RANGE_CAP = 2 * 1024 * 1024
"""Largest body (bytes) of a single ``206`` media response."""

CHUNK_SIZE = 64 * 1024
"""Bytes read from disk and sent per ASGI body message."""

LOGGED_RANGE_MAX = 64
"""Longest raw ``Range`` header value written to the ``media_request`` log."""

MEDIA_LOG_SAMPLE_EVERY = 25
"""Routine (successful, connected) requests: one in this many is logged at debug."""

MEDIA_SUMMARY_EVERY = 500
"""A ``media_requests_summary`` info line is emitted every this many requests."""

_request_count = 0
_summary_counts: dict[tuple[str, int], int] = {}

_RANGE_SPEC = re.compile(r"^(\d*)-(\d*)$")


@dataclass(frozen=True)
class ByteRange:
    """An inclusive byte range ``start``–``end`` that will be served.

    ``capped`` is True when the requested range was shortened to the cap.
    """

    start: int
    end: int
    capped: bool = False

    @property
    def length(self) -> int:
        return self.end - self.start + 1


class RangeNotSatisfiable(Exception):
    """No requested range overlaps the representation (answer ``416``)."""

    def __init__(self, size: int) -> None:
        super().__init__(size)
        self.size = size


def resolve_range(
    header: str | None, size: int, cap: int = MEDIA_RANGE_CAP
) -> ByteRange | None:
    """Turn a ``Range`` header into the single byte range to serve.

    Returns ``None`` when the full body should be sent with ``200``: no header,
    a range unit other than ``bytes``, or an invalid ranges-specifier (RFC 9110
    §14.2 lets a server ignore those). With several ranges the first
    satisfiable one is used. The result never exceeds ``cap`` bytes.

    Raises ``RangeNotSatisfiable`` when no range overlaps a ``size``-byte file
    and ``ValueError`` for a non-positive ``cap``.
    """
    if cap <= 0:
        raise ValueError("cap must be positive")
    if header is None:
        return None
    unit, sep, ranges = header.partition("=")
    if not sep or unit.strip().lower() != "bytes":
        return None

    specs: list[tuple[int | None, int | None]] = []
    for raw in ranges.split(","):
        raw = raw.strip()
        if not raw:
            continue  # empty list elements are allowed and skipped
        match = _RANGE_SPEC.match(raw)
        if match is None:
            return None
        first, last = match.group(1), match.group(2)
        if not first and not last:
            return None
        first_pos = int(first) if first else None
        last_pos = int(last) if last else None
        if first_pos is not None and last_pos is not None and last_pos < first_pos:
            return None
        specs.append((first_pos, last_pos))
    if not specs:
        return None

    for first_pos, last_pos in specs:
        if first_pos is None:
            # Suffix range: the last ``suffix`` bytes (parse guarantees digits).
            suffix = last_pos or 0
            if suffix == 0 or size == 0:
                continue
            start, end = max(0, size - suffix), size - 1
        else:
            if first_pos >= size:
                continue
            start = first_pos
            end = size - 1 if last_pos is None else min(last_pos, size - 1)
        if end - start + 1 > cap:
            return ByteRange(start, start + cap - 1, capped=True)
        return ByteRange(start, end)
    raise RangeNotSatisfiable(size)


def _read_chunk(fh: BinaryIO, n: int) -> bytes:
    """Blocking read of up to ``n`` bytes (run via ``asyncio.to_thread``)."""
    return fh.read(n)


def _open_at(path: Path, offset: int) -> BinaryIO:
    """Blocking open + seek (run via ``asyncio.to_thread``)."""
    fh = path.open("rb")
    fh.seek(offset)
    return fh


class MediaFileResponse(Response):
    """Serve ``path`` honouring the request's ``Range`` with bounded bodies.

    See the module docstring for the exact semantics (``If-Range``, ``404`` on a
    vanished file, no ``HEAD`` support). The type and the passive-media headers
    come from ``passive_media`` (route code ``media``). The file is stat'ed,
    opened, read and closed in worker threads so the event loop never blocks on
    disk.
    """

    def __init__(
        self,
        path: Path,
        *,
        cap: int = MEDIA_RANGE_CAP,
        chunk_size: int = CHUNK_SIZE,
    ) -> None:
        self.path = path
        self.cap = cap
        self.chunk_size = chunk_size
        passive = passive_media(path.name, route="media")
        self.media_type = passive.media_type
        self.media_kind = passive.media_type.split("/", 1)[0]
        self.background = None
        self.status_code = 200
        self.init_headers(passive.headers)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        started = time.perf_counter()
        request_headers = Headers(scope=scope)
        range_header = request_headers.get("range")
        stats = _ServeStats(range_header=range_header)
        try:
            stat = await asyncio.to_thread(self.path.stat)
        except FileNotFoundError:
            await self._not_found(scope, receive, send, stats, started, "stat")
            return
        size = stat.st_size
        stats.size = size
        self._set_validators(stat.st_mtime, size)

        if_range = request_headers.get("if-range")
        if range_header is not None and if_range is not None:
            stats.if_range_matched = self._if_range_matches(if_range)
        if stats.if_range_matched is False:
            byte_range = None  # stale validator: ignore Range, send it all
        else:
            try:
                byte_range = resolve_range(range_header, size, self.cap)
            except RangeNotSatisfiable:
                stats.status = 416
                await Response(
                    status_code=416,
                    headers={
                        "content-range": f"bytes */{size}",
                        "accept-ranges": "bytes",
                    },
                )(scope, receive, send)
                self._log(stats, started)
                return

        stats.range_ignored = range_header is not None and byte_range is None
        if byte_range is None:
            start, length = 0, size
        else:
            stats.status = 206
            stats.capped = byte_range.capped
            start, length = byte_range.start, byte_range.length
            self.headers["content-range"] = (
                f"bytes {byte_range.start}-{byte_range.end}/{size}"
            )
        self.headers["content-length"] = str(length)

        # Open before the disconnect watcher exists, so a vanished file can
        # still be answered with 404 and nothing is left running.
        try:
            fh = await asyncio.to_thread(_open_at, self.path, start)
        except FileNotFoundError:
            await self._not_found(scope, receive, send, stats, started, "open")
            return
        try:
            await self._stream(fh, receive, send, length, stats)
        finally:
            fh.close()
        self._log(stats, started)

    async def _not_found(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
        stats: _ServeStats,
        started: float,
        stage: str,
    ) -> None:
        """Answer ``404`` for a file removed after the route validated it."""
        logger.info("media_file_missing", stage=stage)
        stats.status = 404
        await JSONResponse({"detail": "File not found"}, status_code=404)(
            scope, receive, send
        )
        self._log(stats, started)

    def _if_range_matches(self, if_range: str) -> bool:
        """RFC 9110 §13.1.5: strong ETag comparison or exact Last-Modified."""
        value = if_range.strip()
        if value.startswith("W/"):
            return False  # a weak entity tag never matches strongly
        return value in (self.headers["etag"], self.headers["last-modified"])

    def _set_validators(self, mtime: float, size: int) -> None:
        # Same recipe as Starlette's FileResponse so cached entries stay valid.
        etag_base = f"{mtime}-{size}"
        etag = hashlib.md5(etag_base.encode(), usedforsecurity=False).hexdigest()
        self.headers["accept-ranges"] = "bytes"
        self.headers["last-modified"] = formatdate(mtime, usegmt=True)
        self.headers["etag"] = f'"{etag}"'

    async def _stream(
        self,
        fh: BinaryIO,
        receive: Receive,
        send: Send,
        length: int,
        stats: _ServeStats,
    ) -> None:
        disconnected = asyncio.Event()

        async def watch_disconnect() -> None:
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    disconnected.set()
                    return

        async def send_or_flag(message: Message) -> bool:
            """Send ``message``; False (and flag a disconnect) if the client is gone."""
            try:
                await send(message)
            except OSError:
                disconnected.set()
                return False
            return True

        watcher = asyncio.create_task(watch_disconnect())
        try:
            headers_sent = await send_or_flag(
                {
                    "type": "http.response.start",
                    "status": stats.status,
                    "headers": self.raw_headers,
                }
            )
            remaining = length if headers_sent else 0
            while remaining > 0 and not disconnected.is_set():
                chunk = await asyncio.to_thread(
                    _read_chunk, fh, min(self.chunk_size, remaining)
                )
                if disconnected.is_set():
                    break
                if not chunk:
                    # File shrank under us: end the body; the server closes
                    # the connection because Content-Length was not met.
                    stats.truncated = True
                    break
                remaining -= len(chunk)
                sent = await send_or_flag(
                    {
                        "type": "http.response.body",
                        "body": chunk,
                        "more_body": remaining > 0,
                    }
                )
                if not sent:
                    break
                stats.bytes_sent += len(chunk)
            if headers_sent and (length == 0 or stats.truncated):
                await send_or_flag(
                    {"type": "http.response.body", "body": b"", "more_body": False}
                )
        finally:
            stats.client_disconnected = disconnected.is_set()
            watcher.cancel()
            try:
                await watcher
            except asyncio.CancelledError:
                # Only the watcher's own cancellation is expected here; if this
                # request task is itself being cancelled, keep that going.
                current = asyncio.current_task()
                if current is not None and current.cancelling():
                    raise

    def _log(self, stats: _ServeStats, started: float) -> None:
        global _request_count
        _request_count += 1
        key = (self.media_kind, stats.status)
        _summary_counts[key] = _summary_counts.get(key, 0) + 1

        notable = stats.client_disconnected or stats.truncated or stats.status >= 400
        if notable:
            emit = logger.info
        elif _request_count % MEDIA_LOG_SAMPLE_EVERY == 0:
            emit = logger.debug
        else:
            emit = None
        if emit is not None:
            emit(
                "media_request",
                status=stats.status,
                range=(
                    None
                    if stats.range_header is None
                    else stats.range_header[:LOGGED_RANGE_MAX]
                ),
                range_ignored=stats.range_ignored,
                if_range_matched=stats.if_range_matched,
                capped=stats.capped,
                bytes_sent=stats.bytes_sent,
                size=stats.size,
                media_kind=self.media_kind,
                elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
                client_disconnected=stats.client_disconnected,
                truncated=stats.truncated,
            )

        if _request_count % MEDIA_SUMMARY_EVERY == 0:
            logger.info(
                "media_requests_summary",
                requests=MEDIA_SUMMARY_EVERY,
                counts=[
                    {"media_kind": kind, "status": status, "count": n}
                    for (kind, status), n in sorted(_summary_counts.items())
                ],
            )
            _summary_counts.clear()


@dataclass
class _ServeStats:
    """Mutable per-response facts collected for the ``media_request`` log."""

    range_header: str | None
    size: int | None = None
    status: int = 200
    if_range_matched: bool | None = None
    range_ignored: bool = False
    capped: bool = False
    bytes_sent: int = 0
    client_disconnected: bool = False
    truncated: bool = False
