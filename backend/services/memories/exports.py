"""In-memory export handoff for Memories images and clips.

The desktop webview (pywebview / WebView2) ignores ``<a download>`` on blob URLs,
so the frontend cannot save a canvas it rendered. It hands the bytes to the local
server instead (``POST /api/memories/export``) and then opens the returned token's
URL in a hidden iframe; the ``Content-Disposition: attachment`` response triggers
the webview's native save dialog.

Entries live only in process memory: nothing is written to disk and nothing leaves
the machine. Each entry expires ``TTL_SECONDS`` after it was stored, at most ``MAX_ENTRIES``
are kept and their total size is capped at ``MAX_TOTAL_BYTES`` (the oldest is
evicted first). Expired entries are freed on every access and by ``sweep_loop``,
a periodic task the app lifespan runs, so idle bytes do not outlive their TTL.

An entry is **kept until its TTL** after a successful GET rather than deleted on
first read. A webview may request the download URL more than once (a retried or
re-issued iframe navigation), and deleting on first read would make the second
request a 404 and the save fail. The token is 256 bits of ``secrets`` randomness,
the server only listens on loopback and the bytes are the user's own render, so a
short-lived repeatable read is safe.
"""

from __future__ import annotations

import asyncio
import re
import secrets
import threading
import time
import unicodedata
from collections import OrderedDict
from dataclasses import dataclass
from typing import Literal
from urllib.parse import quote

import structlog

logger = structlog.get_logger(__name__)

ExportKind = Literal["png", "gif", "webm", "mp4"]

KINDS: tuple[ExportKind, ...] = ("png", "gif", "webm", "mp4")
MEDIA_TYPES: dict[str, str] = {
    "png": "image/png",
    "gif": "image/gif",
    "webm": "video/webm",
    "mp4": "video/mp4",
}
MAX_BYTES = 60 * 1024 * 1024
TTL_SECONDS = 10 * 60
MAX_ENTRIES = 8
MAX_TOTAL_BYTES = 150 * 1024 * 1024
SWEEP_INTERVAL_SECONDS = 60
MAX_STEM_CHARS = 100
DEFAULT_STEM = "sakadesk-memories"

# Characters a filename may not carry on Windows, macOS or Linux.
_FORBIDDEN = re.compile(r'[\\/:*?"<>|]')
# A trailing extension, replaced by the export's own.
_EXTENSION = re.compile(r"\.[A-Za-z0-9]{1,5}$")


@dataclass(frozen=True)
class ExportEntry:
    kind: ExportKind
    data: bytes
    stored_at: float


def magic_matches(kind: str, data: bytes) -> bool:
    """Whether ``data`` starts with the file signature of ``kind``."""
    if kind == "png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if kind == "gif":
        return data.startswith((b"GIF87a", b"GIF89a"))
    if kind == "webm":
        return data.startswith(b"\x1a\x45\xdf\xa3")
    if kind == "mp4":
        return len(data) >= 12 and data[4:8] == b"ftyp"
    return False


class ExportStore:
    """A small TTL + size-capped map of token → export bytes (thread-safe)."""

    def __init__(
        self,
        *,
        ttl_seconds: float = TTL_SECONDS,
        max_entries: int = MAX_ENTRIES,
        max_total_bytes: int = MAX_TOTAL_BYTES,
    ) -> None:
        self._ttl = ttl_seconds
        self._max = max_entries
        self._max_total = max_total_bytes
        self._total = 0
        self._entries: OrderedDict[str, ExportEntry] = OrderedDict()
        self._lock = threading.Lock()

    def _purge_expired(self, now: float) -> int:
        expired = [
            t for t, e in self._entries.items() if now - e.stored_at >= self._ttl
        ]
        for token in expired:
            self._total -= len(self._entries.pop(token).data)
        return len(expired)

    def purge(self) -> int:
        """Free every expired entry now; return how many were freed."""
        with self._lock:
            return self._purge_expired(time.time())

    def put(self, kind: ExportKind, data: bytes) -> tuple[str, int]:
        """Store the bytes; return the token and how many old entries were evicted."""
        now = time.time()
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._purge_expired(now)
            evicted = 0
            while self._entries and (
                len(self._entries) >= self._max
                or self._total + len(data) > self._max_total
            ):
                _, old = self._entries.popitem(last=False)
                self._total -= len(old.data)
                evicted += 1
            self._entries[token] = ExportEntry(kind=kind, data=data, stored_at=now)
            self._total += len(data)
        return token, evicted

    def get(self, token: str) -> ExportEntry | None:
        """The entry, or ``None`` when the token is unknown or expired (kept until TTL)."""
        now = time.time()
        with self._lock:
            self._purge_expired(now)
            return self._entries.get(token)

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
            self._total = 0


store = ExportStore()


async def sweep_loop(interval: float = SWEEP_INTERVAL_SECONDS) -> None:
    """Free expired entries every ``interval`` seconds until cancelled."""
    while True:
        await asyncio.sleep(interval)
        freed = store.purge()
        if freed:
            logger.info("memories.export.swept", count=freed)


def sanitize_filename(raw: str | None, kind: ExportKind) -> str:
    """A safe download filename whose extension is forced to ``kind``.

    Path separators, characters forbidden on Windows and control/format characters
    are removed; leading and trailing dots and spaces are trimmed; any trailing
    extension is dropped and replaced by ``kind``; the stem is capped at ``MAX_STEM_CHARS``. Non-ASCII (e.g. a Japanese member name) is kept.
    """
    name = unicodedata.normalize("NFC", raw or "")
    name = "".join(
        ch
        for ch in name
        if unicodedata.category(ch) not in ("Cc", "Cf", "Cs", "Zl", "Zp")
    )
    name = _FORBIDDEN.sub("", name)
    stem = _EXTENSION.sub("", name.strip(" ."))
    stem = stem.strip(" .")[:MAX_STEM_CHARS].strip(" .")
    if not stem:
        stem = DEFAULT_STEM
    return f"{stem}.{kind}"


def content_disposition(filename: str, kind: ExportKind) -> str:
    """``attachment`` with an ASCII ``filename`` fallback and a UTF-8 ``filename*``."""
    ascii_stem = filename.rsplit(".", 1)[0].encode("ascii", "ignore").decode("ascii")
    ascii_stem = re.sub(r"[^A-Za-z0-9._ -]", "", ascii_stem).strip(" .") or DEFAULT_STEM
    fallback = f"{ascii_stem}.{kind}"
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"
