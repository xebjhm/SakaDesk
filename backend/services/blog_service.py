"""
Blog service for SakaDesk.
Handles blog metadata sync, on-demand content fetching, and caching.

Two-stage sync design (similar to message sync):
- Stage 1: sync_blog_metadata() - Fast metadata indexing
- Stage 2: download_blog_content() - Content + image download with queue
"""

import asyncio
import contextlib
import hashlib
import json
import os
import re
import shutil
import tempfile
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Dict, List, Optional, cast
from urllib.parse import urlsplit

import aiofiles
import aiohttp
import structlog

from pysaka import Group
from pysaka.blog import (
    BlogGoneError,
    MAX_PAGES_SAFETY_CAP,
    MemberInfo,
    get_scraper,
)

from backend.services.log_throttle import LogThrottle
from backend.services.passive_media import INLINE_MEDIA_TYPES
from backend.services.path_resolver import get_output_dir
from backend.services.remote_images import RemoteImageRefused, fetch_official_image
from backend.services.safe_paths import (
    UnsafePath,
    blog_date,
    blog_folder,
    blog_folder_name,
    is_safe_id,
    join_within,
    member_folder_name,
    plain_segment,
)
from backend.services.service_utils import (
    get_service_display_name,
    get_service_enum,
    validate_service,
)

logger = structlog.get_logger(__name__)


def _blog_folder(base: Path, member_name: str, blog_id: str, date: str) -> Path:
    """Folder of one cached blog under a service's blogs ``base``.

    ``base / <member name> / <date>_<blog id>``: the member name with
    surrounding whitespace stripped (Windows cannot create a folder ending in a
    space) and ``/`` replaced by ``_``, as archives have always been laid out.
    Raises ``safe_paths.UnsafePath`` (security audit 2026-11-13) with reason
    ``blog_id`` when ``blog_id`` is not ``safe_paths.is_safe_id``, or
    ``segment`` when either folder name is not a ``safe_paths.plain_segment``:
    such a value comes from a hostile or broken index and would leave the
    blogs folder. Callers that loop over the index skip and count it.

    Loops over many blogs resolve ``base`` once and call this per blog:
    ``get_blogs_base_path`` reads settings.json from disk on every call.
    """
    return blog_folder(base, member_name, blog_id, date)


def _safe_blog_members(service: str, members: object) -> dict[str, str]:
    """The scraped ``{member id: name}`` entries that can name archive folders.

    The id must be ``safe_paths.is_safe_id`` and the name a ``str`` whose
    folder form (``safe_paths.member_folder_name``, as :func:`_blog_folder` builds it) is
    a ``safe_paths.plain_segment``. Others are dropped with one
    ``blog_remote_rejected`` (``kind=member``, ``count``); a value that is not a
    mapping logs ``reason=not_mapping``. Never an id or a name is logged
    (security audit 2026-11-13).
    """
    if not isinstance(members, dict):
        logger.warning(
            "blog_remote_rejected", service=service, kind="member", reason="not_mapping"
        )
        return {}
    safe = {
        mid: name
        for mid, name in members.items()
        if is_safe_id(mid)
        and isinstance(name, str)
        and plain_segment(member_folder_name(name))
    }
    if len(safe) != len(members):
        logger.warning(
            "blog_remote_rejected",
            service=service,
            kind="member",
            count=len(members) - len(safe),
        )
    return safe


# Groups that have blog support. Yodel does not have blogs.
BLOG_SUPPORTED_GROUPS = frozenset(
    {Group.HINATAZAKA46, Group.NOGIZAKA46, Group.SAKURAZAKA46}
)


def _is_blog_supported(service: str) -> bool:
    """Check if a service supports blog operations."""
    try:
        group = get_service_enum(service)
        return group in BLOG_SUPPORTED_GROUPS
    except ValueError:
        return False


def _replace_with_retry(
    src: str, dst: str, *, attempts: int = 5, base_delay: float = 0.1
) -> None:
    """``os.replace`` that retries transient Windows lock errors.

    On Windows ``os.replace`` (MoveFileEx) raises ``PermissionError`` (WinError 5
    access-denied / 32 sharing-violation) when another handle briefly holds the
    destination -- a concurrent reader, an antivirus scan, or the Search indexer.
    These clear within milliseconds, so retry with a short linear backoff rather
    than failing the write (which left blog ``index.json`` unwritten in the wild).
    Re-raises the last error if the lock never clears -- we never silently drop
    the write."""
    for attempt in range(attempts):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(base_delay * (attempt + 1))


# SD-BE-SVC-05: index.json for one service can be written by two coroutines on
# different event loops (the main uvicorn loop via POST /api/blogs/sync, and the
# BlogBackupManager's dedicated backup thread) — and by an old force-superseded
# run racing its replacement. Each does a full load→mutate→save, so the last
# writer wins and silently drops the other's newly discovered blogs / removed
# flags / stamps. A per-service lock serializes the merge+write; a threading.Lock
# (not asyncio.Lock) is required because the writers live on different loops.
_INDEX_WRITE_LOCKS: dict[str, threading.Lock] = {}
_INDEX_WRITE_LOCKS_GUARD = threading.Lock()


def _index_write_lock(service: str) -> threading.Lock:
    with _INDEX_WRITE_LOCKS_GUARD:
        lock = _INDEX_WRITE_LOCKS.get(service)
        if lock is None:
            lock = threading.Lock()
            _INDEX_WRITE_LOCKS[service] = lock
        return lock


def _newer_stamp(a: Optional[str], b: Optional[str]) -> Optional[str]:
    """Return the later of two ISO timestamp strings (either may be None)."""
    if a is None:
        return b
    if b is None:
        return a
    return a if a >= b else b


def _parse_published(value: object) -> Optional[datetime]:
    """A stored ``published_at`` as an aware datetime (naive = UTC).

    ``None`` when ``value`` is not a ``str`` or does not parse as ISO 8601
    (pysaka yields ``None`` for a date it cannot read, PY-MGR-04).
    """
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _published_key(value: object) -> datetime:
    """Sort key for a row :func:`_readable_blogs` returned (always parses)."""
    return _parse_published(value) or datetime.min.replace(tzinfo=timezone.utc)


def _text(value: object) -> str:
    """``value`` when it is a ``str``, else ``""`` (a title or URL the scraper left out)."""
    return value if isinstance(value, str) else ""


def _thumbnail(value: object) -> Optional[str]:
    """``value`` when it is a non-empty ``str``, else ``None``."""
    return value if isinstance(value, str) and value else None


CURSOR_SKEW = timedelta(days=1)
"""How far past now a stored date may lie and still move the incremental cursor."""


def _incremental_cursor(rows: object, now: datetime) -> tuple[Optional[datetime], int]:
    """The incremental cursor of a member's stored rows, and how many were ignored.

    The newest :func:`_parse_published` date that is not later than
    ``now + CURSOR_SKEW`` (security audit 2026-11-13: one future-dated post
    made pysaka stop at the first real entry forever). ``None`` when no row
    qualifies; pagination then runs to the incremental page cap.
    """
    items = rows if isinstance(rows, list) else []
    limit = now + CURSOR_SKEW
    dates = [
        d
        for b in items
        if isinstance(b, dict)
        and (d := _parse_published(b.get("published_at"))) is not None
        and d <= limit
    ]
    return (max(dates) if dates else None), len(items) - len(dates)


PENDING_DATES_MAX = 50
"""Most posts a member keeps waiting for a date (the oldest are dropped first)."""

PENDING_RETRIES_PER_SYNC = 10
"""Most pending posts whose detail page is fetched again per member and sync."""

PENDING_MAX_ATTEMPTS = 5
"""Detail fetches a pending post gets before it is given up."""

PENDING_MAX_AGE = timedelta(days=30)
"""How long a post may wait for a date before it is given up."""


def _clean_pending(raw: object, now: datetime) -> tuple[list[dict], dict[str, int]]:
    """A member's ``pending_dates`` list as usable entries, and the drop counts.

    A post skipped for an unknown date is older than the cursor once a newer
    post is stored, so the list pages never yield it again; its id is kept
    here (``id``, ``first_seen``, ``attempts`` and the list page's ``title``,
    ``url``, ``thumbnail``) and its detail page is asked again on later syncs.
    Entries whose id is not ``safe_paths.is_safe_id`` or whose ``first_seen``
    does not parse count as ``invalid`` (a repeated id is merged silently);
    entries older than ``PENDING_MAX_AGE`` count as ``expired``.
    """
    if not isinstance(raw, list):
        return [], {}
    kept: list[dict] = []
    seen: set[str] = set()
    dropped: dict[str, int] = {}
    for item in raw:
        first_seen = (
            _parse_published(item.get("first_seen")) if isinstance(item, dict) else None
        )
        if (
            not isinstance(item, dict)
            or not is_safe_id(item.get("id"))
            or first_seen is None
        ):
            dropped["invalid"] = dropped.get("invalid", 0) + 1
            continue
        if item["id"] in seen:
            continue
        seen.add(item["id"])
        if now - first_seen > PENDING_MAX_AGE:
            dropped["expired"] = dropped.get("expired", 0) + 1
            continue
        attempts = item.get("attempts")
        kept.append(
            {
                "id": item["id"],
                "first_seen": item["first_seen"],
                "attempts": attempts
                if isinstance(attempts, int) and not isinstance(attempts, bool)
                else 0,
                "title": _text(item.get("title")),
                "url": _text(item.get("url")),
                "thumbnail": _thumbnail(item.get("thumbnail")),
            }
        )
    return kept, dropped


_row_skip_logs = LogThrottle(limit=5, window_s=3600.0)
"""Budget for ``blog_rows_skipped``: the readers run on every Blogs-view poll."""

_image_refusal_logs = LogThrottle(limit=20, window_s=60.0)
"""Budget for ``blog_image_refused``: one blog can hold dozens of off-list images."""


def _readable_blogs(service: str, where: str, blogs: object) -> list[dict]:
    """The index rows a reader can use (security audit 2026-11-13).

    A row is a ``dict`` with a ``str`` id and a ``published_at`` that
    :func:`_parse_published` reads. Rows written before the fix may hold
    ``published_at: null``; they are left out of every list, count and
    download queue, so one bad row cannot break a whole group. (An unsafe id
    is still refused where a folder is built: ``_blog_folder``.) Logs
    ``blog_rows_skipped`` (``service``, ``where``, ``count``) through a
    throttle.
    """
    if not isinstance(blogs, list):
        return []
    rows = [
        b
        for b in blogs
        if isinstance(b, dict)
        and isinstance(b.get("id"), str)
        and _parse_published(b.get("published_at")) is not None
    ]
    if len(rows) != len(blogs):
        _row_skip_logs.log(
            logger.warning,
            "blog_rows_skipped",
            service=service,
            where=where,
            count=len(blogs) - len(rows),
        )
    return rows


_BLOG_IMAGE_EXTS = frozenset(
    ext
    for ext, media_type in INLINE_MEDIA_TYPES.items()
    if media_type.startswith("image/")
)
"""Extensions a downloaded blog image keeps; any other URL suffix is stored as ``.jpg``.

Derived from ``INLINE_MEDIA_TYPES`` (the picture entries), so the set is not duplicated."""


def _blog_image_ext(img_url: str) -> str:
    """The file extension of a downloaded blog image (security audit 2026-11-13).

    Remote blog HTML chooses the image URL and the archive serves files by
    extension, so only a picture extension (``_BLOG_IMAGE_EXTS``, compared in
    lower case on the URL path) is kept. Anything else (``.html``, ``.svg``,
    none) becomes ``.jpg`` and logs ``blog_image_ext_defaulted`` with
    ``reason`` ``not_image`` or ``no_suffix`` (never the URL). The bytes are
    stored unchanged: a body that is not a picture then simply fails to show.
    """
    try:
        suffix = PurePosixPath(urlsplit(img_url).path).suffix.lower()
    except ValueError:
        suffix = ""
    if suffix in _BLOG_IMAGE_EXTS:
        return suffix
    logger.info(
        "blog_image_ext_defaulted", reason="not_image" if suffix else "no_suffix"
    )
    return ".jpg"


_THUMBNAIL_EXT_BY_TYPE = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/pjpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
"""Content-Type → the extension a member thumbnail is saved under (``get_member_thumbnail_path`` looks for exactly these)."""

_THUMBNAIL_EXT_BY_SUFFIX = {
    ".jpg": ".jpg",
    ".jpeg": ".jpg",
    ".png": ".png",
    ".webp": ".webp",
}
"""A picture suffix of the thumbnail URL → the extension it is saved under."""


def _thumbnail_ext(content_type: str, url: str) -> str:
    """The extension a downloaded member thumbnail is saved under (security audit 2026-11-13).

    From the response's ``Content-Type`` (``_THUMBNAIL_EXT_BY_TYPE``), else
    the URL path's suffix when it is a picture one (lower case), else ``.jpg``
    with ``member_thumbnail_ext_defaulted`` (``reason`` ``not_image`` or
    ``no_suffix``; never the URL). The remote side never chooses any other
    extension, so a thumbnail is only ever served as a picture; bytes that
    are not one simply fail to show.
    """
    media_type = content_type.split(";", 1)[0].strip().lower()
    ext = _THUMBNAIL_EXT_BY_TYPE.get(media_type)
    if ext is not None:
        return ext
    try:
        suffix = PurePosixPath(urlsplit(url).path).suffix.lower()
    except ValueError:
        suffix = ""
    ext = _THUMBNAIL_EXT_BY_SUFFIX.get(suffix)
    if ext is not None:
        return ext
    logger.info(
        "member_thumbnail_ext_defaulted",
        reason="not_image" if suffix else "no_suffix",
    )
    return ".jpg"


def _merge_blog_index(current: dict, incoming: dict) -> dict:
    """Merge ``incoming`` (a writer's mutated snapshot) onto the latest on-disk
    ``current`` so a concurrent writer's changes are not lost.

    Union of members and of each member's blogs (keyed by id, incoming wins for
    a shared id); ``removed`` / ``blogs_removed`` flags are OR-ed (a removal seen
    by either writer sticks); ``last_sync`` / ``last_download`` take the later
    stamp. Add-only for members/blogs — a merge never deletes an entry the other
    writer still has.
    """
    merged: dict = {"members": {}}
    cur_members = current.get("members", {}) or {}
    inc_members = incoming.get("members", {}) or {}

    for member_id in set(cur_members) | set(inc_members):
        cur_m = cur_members.get(member_id, {})
        inc_m = inc_members.get(member_id, {})
        # Prefer incoming's scalar fields (name etc.), fall back to current.
        out_m: dict = {**cur_m, **inc_m}

        # Union blogs by id, incoming version winning for shared ids.
        by_id: dict[str, dict] = {}
        for blog in cur_m.get("blogs", []) or []:
            by_id[blog["id"]] = blog
        for blog in inc_m.get("blogs", []) or []:
            existing = by_id.get(blog["id"])
            if existing is not None:
                merged_blog = {**existing, **blog}
                # A removal seen by either writer sticks.
                if existing.get("removed") or blog.get("removed"):
                    merged_blog["removed"] = True
                by_id[blog["id"]] = merged_blog
            else:
                by_id[blog["id"]] = blog
        out_m["blogs"] = list(by_id.values())

        # A post that got its date (stored in either snapshot) stops waiting.
        pending = out_m.get("pending_dates")
        if isinstance(pending, list):
            out_m["pending_dates"] = [
                p for p in pending if not (isinstance(p, dict) and p.get("id") in by_id)
            ]

        # blogs_removed sticks if either writer set it.
        if cur_m.get("blogs_removed") or inc_m.get("blogs_removed"):
            out_m["blogs_removed"] = True

        merged["members"][member_id] = out_m

    merged["last_sync"] = _newer_stamp(
        current.get("last_sync"), incoming.get("last_sync")
    )
    merged["last_download"] = _newer_stamp(
        current.get("last_download"), incoming.get("last_download")
    )
    return merged


@dataclass
class BlogDownloadItem:
    """Item in the blog content download queue."""

    blog_id: str
    member_id: str
    member_name: str
    title: str
    published_at: str
    url: str
    cache_path: Path
    # The service the blog belongs to: its write bumps only that service's
    # gallery version (``None``: unknown, every service's).
    service: Optional[str] = None


def _build_blog_content(
    blog_id: str,
    member_name: str,
    title: str,
    published_at: str,
    url: str,
    html: str,
    images: list[dict],
) -> dict:
    """Build blog content dict for caching and API responses.

    Metadata (title, published_at) comes from the index — the single source
    of truth.  HTML content and images come from the scraper detail fetch.
    """
    return {
        "meta": {
            "id": blog_id,
            "member_name": member_name,
            "title": title,
            "published_at": published_at,
            "url": url,
        },
        "content": {
            "html": html,
        },
        "images": images,
    }


class BlogService:
    def __init__(self):
        pass

    # =========================================================================
    # Path helpers
    # =========================================================================

    def get_blogs_base_path(self, service: str) -> Path:
        """Get base path for blogs storage."""
        validate_service(service)
        display_name = get_service_display_name(service)
        return cast(Path, get_output_dir() / display_name / "blogs")

    def get_blog_index_path(self, service: str) -> Path:
        """Get path to blog index file."""
        return self.get_blogs_base_path(service) / "index.json"

    def get_blog_cache_path(
        self, service: str, member_name: str, blog_id: str, date: str
    ) -> Path:
        """Get path to cached blog content (raises ``UnsafePath``: see ``_blog_folder``)."""
        return _blog_folder(
            self.get_blogs_base_path(service), member_name, blog_id, date
        )

    def get_member_thumbnails_path(self, service: str) -> Path:
        """Get path to member thumbnails directory."""
        return self.get_blogs_base_path(service) / "member_thumbnails"

    def get_members_cache_path(self, service: str) -> Path:
        """Get path to members cache file."""
        return self.get_member_thumbnails_path(service) / "members_cache.json"

    # =========================================================================
    # Index operations
    # =========================================================================

    async def load_blog_index(self, service: str) -> Dict[Any, Any]:
        """Load blog index from disk."""
        index_path = self.get_blog_index_path(service)
        if index_path.exists():
            try:
                async with aiofiles.open(index_path, "r", encoding="utf-8") as f:
                    return cast(Dict[Any, Any], json.loads(await f.read()))
            except Exception as e:
                logger.error(f"Failed to load blog index: {e}")
        return {"members": {}, "last_sync": None, "last_download": None}

    async def save_blog_index(self, service: str, index: dict, *, merge: bool = True):
        """Save blog index to disk (atomic write via temp file + rename).

        SD-BE-SVC-05: by default this merges ``index`` onto the latest on-disk
        state under a per-service lock, so a concurrent writer (backup thread vs
        main-loop API sync, or a superseded run vs its replacement) can't silently
        clobber the other's changes. The read-merge-write critical section runs in
        a worker thread; the lock is held only for that short synchronous span (no
        network I/O), so it can't stall an event loop. Pass ``merge=False`` for a
        full replace (e.g. clear-cache style overwrites).
        """
        index_path = self.get_blog_index_path(service)

        def _locked_write() -> None:
            with _index_write_lock(service):
                to_write = index
                if merge and index_path.exists():
                    try:
                        current = json.loads(index_path.read_text(encoding="utf-8"))
                        if isinstance(current, dict):
                            to_write = _merge_blog_index(current, index)
                    except (json.JSONDecodeError, OSError) as e:
                        # Corrupt/unreadable on-disk index: fall back to writing
                        # our own snapshot rather than failing the whole run.
                        logger.warning(
                            "blog_index_merge_skipped_unreadable",
                            service=service,
                            error=str(e),
                        )
                index_path.parent.mkdir(parents=True, exist_ok=True)
                fd, tmp_path = tempfile.mkstemp(
                    dir=str(index_path.parent), suffix=".tmp"
                )
                try:
                    with os.fdopen(fd, "w", encoding="utf-8") as f:
                        json.dump(to_write, f, ensure_ascii=False, indent=2)
                    _replace_with_retry(tmp_path, str(index_path))
                except BaseException:
                    with contextlib.suppress(OSError):
                        os.unlink(tmp_path)
                    raise

        await asyncio.to_thread(_locked_write)

    async def _atomic_write(self, path: Path, data) -> None:
        """Write text or bytes atomically (temp file + os.replace) so an
        interrupted/crashed write can never leave a partial file — which would
        otherwise look complete and be skipped forever on the next backup."""
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
        os.close(fd)
        try:
            if isinstance(data, (bytes, bytearray)):
                async with aiofiles.open(tmp_path, "wb") as f:
                    await f.write(data)
            else:
                async with aiofiles.open(tmp_path, "w", encoding="utf-8") as f:
                    await f.write(data)
            _replace_with_retry(tmp_path, str(path))
        except BaseException:
            with contextlib.suppress(OSError):
                os.unlink(tmp_path)
            raise

    @staticmethod
    def _is_blog_cached(cache_path: Path) -> bool:
        """A blog counts as cached only if its blog.json exists and is non-empty.
        A missing or zero-byte file (e.g. an interrupted download) is treated as
        NOT cached, so the next backup re-downloads it (self-healing resume)."""
        try:
            return (cache_path / "blog.json").stat().st_size > 0
        except OSError:
            return False

    async def get_blog_members(self, service: str) -> Dict[str, str]:
        """Get members who have blogs for a service."""
        validate_service(service)
        if not _is_blog_supported(service):
            return {}
        group = get_service_enum(service)

        async with aiohttp.ClientSession() as session:
            scraper = get_scraper(group, session)
            return cast(Dict[str, str], await scraper.get_members())

    # =========================================================================
    # Member thumbnails with caching
    # =========================================================================

    def _compute_members_hash(self, members: list[dict]) -> str:
        """Compute content hash for member data to detect changes.

        Since member images change together as a group (except ポカ),
        we hash the entire member list to detect any changes.
        """
        # Sort by ID for consistent hashing
        sorted_members = sorted(members, key=lambda m: m["id"])
        content = json.dumps(sorted_members, sort_keys=True)
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    async def _load_members_cache(self, service: str) -> Optional[Dict[str, Any]]:
        """Load members cache from disk."""
        cache_path = self.get_members_cache_path(service)
        if cache_path.exists():
            try:
                async with aiofiles.open(cache_path, "r", encoding="utf-8") as f:
                    return cast(Optional[Dict[str, Any]], json.loads(await f.read()))
            except Exception as e:
                logger.warning(f"Failed to load members cache: {e}")
        return None

    async def _save_members_cache(self, service: str, cache: dict):
        """Save members cache to disk."""
        cache_path = self.get_members_cache_path(service)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(cache_path, "w", encoding="utf-8") as f:
            await f.write(json.dumps(cache, ensure_ascii=False, indent=2))

    async def _download_member_thumbnail(
        self,
        session: aiohttp.ClientSession,
        member_id: str,
        thumbnail_url: str,
        thumbnails_dir: Path,
    ) -> Optional[str]:
        """Download one member thumbnail; the local file name, or None.

        ``member_id`` names the file, so it must be ``safe_paths.is_safe_id``
        and ``thumbnail_url`` a non-empty string; otherwise nothing is fetched
        and ``member_thumbnail_rejected`` (``reason`` ``member_id`` or ``url``)
        is logged (security audit 2026-11-13). The file is
        ``<member_id><ext>`` with ``ext`` from :func:`_thumbnail_ext`, written
        atomically inside ``thumbnails_dir``. A non-200 answer logs
        ``thumbnail_download_failed`` (``status``), any other failure
        ``thumbnail_download_error`` (``error_type``); never an id or a URL.
        The fetch goes through ``remote_images.fetch_official_image`` (official
        https hosts, checked redirects, 10 MiB cap); a refusal logs
        ``thumbnail_download_refused`` (``reason``).
        """
        if not is_safe_id(member_id):
            logger.warning("member_thumbnail_rejected", reason="member_id")
            return None
        if not isinstance(thumbnail_url, str) or not thumbnail_url:
            logger.warning("member_thumbnail_rejected", reason="url")
            return None
        try:
            content, content_type = await fetch_official_image(session, thumbnail_url)
            ext = _thumbnail_ext(content_type, thumbnail_url)
            local_filename = f"{member_id}{ext}"
            await self._atomic_write(
                join_within(thumbnails_dir, local_filename), content
            )
            return local_filename
        except RemoteImageRefused as e:
            if e.reason == "status":
                logger.warning("thumbnail_download_failed", status=e.status)
            else:
                logger.warning("thumbnail_download_refused", reason=e.reason)
            return None
        except Exception as e:
            logger.warning("thumbnail_download_error", error_type=type(e).__name__)
            return None

    async def get_members_with_thumbnails(self, service: str) -> List[Dict[Any, Any]]:
        """Get blog members with locally cached thumbnails.

        Uses content hash caching: fetches member data from official site,
        compares hash with cached data, and re-downloads thumbnails only
        if data has changed. Images are cached locally.

        Args:
            service: Service name.

        Returns:
            List of member dicts with id, name, and local thumbnail filename.
        """
        validate_service(service)
        group = get_service_enum(service)

        # All three groups now support thumbnails
        if group not in (Group.HINATAZAKA46, Group.SAKURAZAKA46, Group.NOGIZAKA46):
            # Fall back to basic members for other groups
            members = await self.get_blog_members(service)
            return [
                {"id": mid, "name": name, "thumbnail": None}
                for mid, name in members.items()
            ]

        thumbnails_dir = self.get_member_thumbnails_path(service)

        connector = aiohttp.TCPConnector(limit=6)
        async with aiohttp.ClientSession(connector=connector) as session:
            scraper = get_scraper(group, session)
            # get_members_with_thumbnails is implemented on every concrete scraper
            # but not declared on the BaseBlogScraper return type of get_scraper;
            # cast so mypy accepts the call (present at runtime for all groups).
            listed = await cast(Any, scraper).get_members_with_thumbnails() or []
            # The member id names the thumbnail file (security audit 2026-11-13).
            fresh_members = [
                m
                for m in listed
                if is_safe_id(getattr(m, "id", None))
                and isinstance(getattr(m, "name", None), str)
            ]
            if len(fresh_members) != len(listed):
                logger.warning(
                    "member_thumbnail_rejected",
                    service=service,
                    reason="member_id",
                    count=len(listed) - len(fresh_members),
                )

            if not fresh_members:
                logger.warning("no_members_fetched", service=service)
                # Return cached data if available
                cache = await self._load_members_cache(service)
                if cache:
                    return cast(List[Dict[Any, Any]], cache.get("members", []))
                return []

            # Convert to dict format for hashing
            fresh_data = [
                {"id": m.id, "name": m.name, "thumbnail_url": m.thumbnail_url}
                for m in fresh_members
            ]
            fresh_hash = self._compute_members_hash(fresh_data)

            # Load existing cache
            cache = await self._load_members_cache(service)

            # Check if we need to re-download thumbnails
            if cache and cache.get("hash") == fresh_hash:
                # Content unchanged, return cached members
                logger.debug("members_cache_hit", service=service)
                return cast(List[Dict[Any, Any]], cache.get("members", []))

            logger.info(
                "members_cache_miss_downloading",
                service=service,
                fresh_hash=fresh_hash,
                cached_hash=cache.get("hash") if cache else None,
            )

            # Download all thumbnails (they change together)
            thumbnails_dir.mkdir(parents=True, exist_ok=True)

            result_members: list[dict] = []

            async def download_and_add(member: MemberInfo):
                thumbnail_filename = await self._download_member_thumbnail(
                    session,
                    member.id,
                    member.thumbnail_url,
                    thumbnails_dir,
                )
                result_members.append(
                    {
                        "id": member.id,
                        "name": member.name,
                        "thumbnail": thumbnail_filename,
                    }
                )

            await asyncio.gather(*[download_and_add(m) for m in fresh_members])

            # Sort by ID for consistency
            result_members.sort(key=lambda m: m["id"])

            # Save cache
            new_cache = {
                "hash": fresh_hash,
                "members": result_members,
            }
            await self._save_members_cache(service, new_cache)

            logger.info(
                "members_thumbnails_cached",
                service=service,
                count=len(result_members),
            )

            return result_members

    def get_member_thumbnail_path(self, service: str, member_id: str) -> Optional[Path]:
        """Path to a member's cached thumbnail image, or None.

        ``member_id`` comes from the request path: anything that is not
        ``safe_paths.is_safe_id`` (a separator, ``:``, ``..``, a device name)
        logs ``member_thumbnail_rejected`` (``reason=member_id``) and returns
        None before any filesystem call (security audit 2026-11-13). Looks for
        ``<member_id>.jpg``, ``.png`` then ``.webp`` in the service's
        ``member_thumbnails`` folder.
        """
        if not is_safe_id(member_id):
            logger.warning("member_thumbnail_rejected", reason="member_id")
            return None
        thumbnails_dir = self.get_member_thumbnails_path(service)
        if not thumbnails_dir.exists():
            return None
        for ext in (".jpg", ".png", ".webp"):
            path = join_within(thumbnails_dir, f"{member_id}{ext}")
            if path.exists():
                return path
        return None

    # =========================================================================
    # Stage 1: Metadata sync (fast)
    # =========================================================================

    async def sync_blog_metadata(
        self,
        service: str,
        progress_callback=None,
        cancel_event: Optional[threading.Event] = None,
    ) -> dict:
        """
        Stage 1: Sync blog metadata (titles, dates, URLs) for all members.

        FAST: Uses get_blogs_metadata() which parses list pages only.
        No individual blog detail fetches needed.

        Uses concurrent fetching:
        - Concurrency is managed by the global AdaptivePool

        Returns:
            Updated index dict with metadata for all members.
        """
        validate_service(service)
        if not _is_blog_supported(service):
            logger.info(f"Skipping blog metadata sync for {service} (not supported)")
            return {}
        group = get_service_enum(service)

        index = await self.load_blog_index(service)

        # Determine if this is first sync or incremental
        is_first_sync = not index.get("members")
        # First sync: fetch all pages to build complete index
        # Incremental: fetch recent pages to catch new posts (5 pages ≈ 50-160
        # blogs, covers ~1 year at typical posting frequency)
        max_pages = MAX_PAGES_SAFETY_CAP if is_first_sync else 5

        connector = aiohttp.TCPConnector(limit=10)
        async with aiohttp.ClientSession(connector=connector) as session:
            scraper = get_scraper(group, session)
            members = _safe_blog_members(service, await scraper.get_members())
            completed = 0
            total = len(members)
            # Blog entries whose id cannot name a folder (security audit 2026-11-13).
            rejected_blogs = 0
            skipped_dates = 0
            pending_resolved = 0
            pending_dropped: dict[str, int] = {}

            async def sync_member(member_id: str, member_name: str):
                nonlocal completed
                if cancel_event and cancel_event.is_set():
                    return
                if progress_callback:
                    await progress_callback(
                        f"Scanning {member_name} ({completed + 1}/{total})"
                    )
                try:
                    await _sync_one(member_id, member_name)
                finally:
                    # A failed member still counts as processed (progress total).
                    completed += 1

            async def _sync_one(member_id: str, member_name: str):
                nonlocal rejected_blogs, skipped_dates, pending_resolved

                if member_id not in index["members"]:
                    index["members"][member_id] = {"name": member_name, "blogs": []}

                existing_ids = {
                    b.get("id")
                    for b in index["members"][member_id]["blogs"]
                    if isinstance(b, dict)
                }

                # Bind datetime unconditionally: it is also used below (the
                # isinstance check when appending blogs). A local import inside the
                # `if` branch made `datetime` a function-local for the whole scope,
                # so a first sync (branch skipped) hit an unbound local.
                from datetime import datetime, timezone

                # For incremental sync, use since_date to stop early when hitting old blogs
                # This avoids paginating through entire history just to find no new posts
                since_date = None
                if not is_first_sync and index["members"][member_id]["blogs"]:
                    since_date, ignored = _incremental_cursor(
                        index["members"][member_id]["blogs"],
                        datetime.now(timezone.utc),
                    )
                    if ignored:
                        logger.info(
                            "blog_cursor_rows_ignored", service=service, count=ignored
                        )

                # Posts skipped earlier for an unknown date: ask their detail
                # page again (they are older than the cursor by now).
                now = datetime.now(timezone.utc)
                member_row = index["members"][member_id]
                pending, dropped = _clean_pending(member_row.get("pending_dates"), now)
                pending = [p for p in pending if p["id"] not in existing_ids]
                batch = pending[:PENDING_RETRIES_PER_SYNC]
                if cancel_event and cancel_event.is_set():
                    batch = []
                waiting = pending[len(batch) :]

                async def retry_pending(item: dict):
                    try:
                        (
                            thumb,
                            detail_date,
                            detail_title,
                        ) = await scraper.get_blog_detail_metadata(item["id"])
                    except Exception as e:
                        # No answer from the detail page: this says nothing
                        # about the date, so it is not one of the attempts.
                        logger.info(
                            "blog_pending_retry_failed",
                            service=service,
                            error_type=type(e).__name__,
                        )
                        return item, False, None, None, None
                    return item, True, thumb, detail_date, detail_title

                retried = await asyncio.gather(*[retry_pending(p) for p in batch])
                for item, answered, thumb, detail_date, detail_title in retried:
                    if isinstance(detail_date, datetime):
                        stored_date: Optional[str] = detail_date.isoformat()
                    elif isinstance(detail_date, str) and _parse_published(detail_date):
                        stored_date = detail_date
                    else:
                        stored_date = None
                    if stored_date is not None:
                        index["members"][member_id]["blogs"].append(
                            {
                                "id": item["id"],
                                "title": _text(detail_title) or item["title"],
                                "published_at": stored_date,
                                "url": item["url"],
                                "thumbnail": _thumbnail(thumb) or item["thumbnail"],
                            }
                        )
                        existing_ids.add(item["id"])
                        pending_resolved += 1
                        continue
                    if not answered:
                        waiting.append(item)
                        continue
                    item["attempts"] += 1
                    if item["attempts"] >= PENDING_MAX_ATTEMPTS:
                        dropped["attempts"] = dropped.get("attempts", 0) + 1
                    else:
                        waiting.append(item)
                pending = waiting

                # Use fast metadata method - parses list pages only
                # Pass member_name to filter out "featured" blogs from other members
                # (Sakurazaka list pages sometimes include blogs from other members)
                new_entries = []
                needs_detail: list[tuple[int, dict]] = []

                async for entry in scraper.get_blogs_metadata(
                    member_id,
                    since_date=since_date,
                    max_pages=max_pages,
                    member_name=member_name,
                ):
                    if not is_safe_id(entry.id):
                        rejected_blogs += 1
                        continue
                    if entry.id not in existing_ids:
                        blog_data = {
                            "id": entry.id,
                            "title": entry.title,
                            "published_at": entry.published_at,
                            "url": entry.url,
                            "thumbnail": entry.images[0] if entry.images else None,
                        }
                        new_entries.append(blog_data)
                        # Sakurazaka list pages have incomplete data (no time,
                        # no thumbnails, possibly truncated titles), so the
                        # detail page is the single source of truth.
                        # The detail page also supplies a date the list page
                        # could not give (security audit 2026-11-13).
                        unknown_date = (
                            not isinstance(blog_data["published_at"], datetime)
                            and _parse_published(blog_data["published_at"]) is None
                        )
                        if not blog_data["thumbnail"] or unknown_date:
                            needs_detail.append((len(new_entries) - 1, blog_data))

                # Batch detail fetches for entries missing thumbnails
                if needs_detail:

                    async def fetch_detail(idx: int, blog: dict):
                        try:
                            (
                                detail_thumb,
                                detail_date,
                                detail_title,
                            ) = await scraper.get_blog_detail_metadata(blog["id"])
                            if detail_thumb:
                                blog["thumbnail"] = detail_thumb
                            if detail_date:
                                blog["published_at"] = detail_date
                            if detail_title:
                                blog["title"] = detail_title
                        except Exception as e:
                            logger.debug(
                                "detail_metadata_failed",
                                blog_id=blog["id"],
                                error_type=type(e).__name__,
                            )

                    await asyncio.gather(
                        *[fetch_detail(idx, blog) for idx, blog in needs_detail]
                    )

                for blog_data in new_entries:
                    pub_at = blog_data["published_at"]
                    if isinstance(pub_at, datetime):
                        stored = pub_at.isoformat()
                    elif isinstance(pub_at, str) and _parse_published(pub_at):
                        stored = pub_at
                    else:
                        # Never persist an unknown date: every reader and the
                        # cursor need one (security audit 2026-11-13).
                        skipped_dates += 1
                        if blog_data["id"] not in {p["id"] for p in pending}:
                            pending.append(
                                {
                                    "id": blog_data["id"],
                                    "first_seen": now.isoformat(),
                                    "attempts": 0,
                                    "title": _text(blog_data["title"]),
                                    "url": _text(blog_data["url"]),
                                    "thumbnail": _thumbnail(blog_data["thumbnail"]),
                                }
                            )
                        continue
                    index["members"][member_id]["blogs"].append(
                        {
                            "id": blog_data["id"],
                            "title": _text(blog_data["title"]),
                            "published_at": stored,
                            "url": _text(blog_data["url"]),
                            "thumbnail": _thumbnail(blog_data["thumbnail"]),
                        }
                    )

                if len(pending) > PENDING_DATES_MAX:
                    dropped["cap"] = len(pending) - PENDING_DATES_MAX
                    pending = pending[-PENDING_DATES_MAX:]
                if pending or "pending_dates" in member_row:
                    member_row["pending_dates"] = pending
                for reason, count in dropped.items():
                    pending_dropped[reason] = pending_dropped.get(reason, 0) + count

            # Run all member syncs concurrently with semaphore limit
            # One member's failure must not abort the others or the index save.
            results = await asyncio.gather(
                *[
                    sync_member(member_id, member_name)
                    for member_id, member_name in members.items()
                ],
                return_exceptions=True,
            )
            failed_members = 0
            for result in results:
                if isinstance(result, BaseException):
                    failed_members += 1
                    logger.warning(
                        "blog_member_sync_failed",
                        service=service,
                        error_type=type(result).__name__,
                    )
            if failed_members:
                logger.warning(
                    "blog_sync_members_failed", service=service, count=failed_members
                )
            for reason, count in pending_dropped.items():
                logger.warning(
                    "blog_pending_dropped", service=service, reason=reason, count=count
                )
            if pending_resolved:
                logger.info(
                    "blog_pending_resolved", service=service, count=pending_resolved
                )
            if skipped_dates:
                logger.warning(
                    "blog_entry_skipped",
                    service=service,
                    reason="unparsed_date",
                    count=skipped_dates,
                )
            if rejected_blogs:
                logger.warning(
                    "blog_remote_rejected",
                    service=service,
                    kind="blog",
                    count=rejected_blogs,
                )

        # SD-BE-SVC-05: a cancelled run must not write its stale snapshot back —
        # doing so after a newer run's save can roll the index backwards.
        if cancel_event and cancel_event.is_set():
            logger.info(
                "Blog metadata sync cancelled; skipping index save", service=service
            )
            return index

        if members and failed_members == len(members):
            # Nothing was scanned: leave last_sync and the stored index alone
            # and flag the failure for the caller.
            index["sync_failed"] = True
            return index

        from datetime import datetime, timezone

        index["last_sync"] = datetime.now(timezone.utc).isoformat()
        await self.save_blog_index(service, index)
        return index

    # =========================================================================
    # Stage 2: Content download (with queue)
    # =========================================================================

    def build_download_queue(
        self, service: str, index: dict, skip_cached: bool = True
    ) -> list[BlogDownloadItem]:
        """
        Build a queue of blogs to download based on index.

        Args:
            service: Service name.
            index: Blog index dict.
            skip_cached: If True, skip blogs that are already cached.

        Returns:
            List of BlogDownloadItem for blogs that need downloading.
        """
        queue: list[BlogDownloadItem] = []
        # Resolved once: it reads settings.json, too slow to repeat per blog.
        base = self.get_blogs_base_path(service)
        rejected = 0

        for member_id, member_data in index.get("members", {}).items():
            # Skip members whose blogs are all removed (e.g., graduated)
            if member_data.get("blogs_removed"):
                continue

            member_name = member_data.get("name", "")

            for blog in _readable_blogs(
                service, "download_queue", member_data.get("blogs", [])
            ):
                # Skip individually removed blogs
                if blog.get("removed"):
                    continue

                blog_id = blog["id"]
                date = blog_date(blog["published_at"])
                try:
                    cache_path = _blog_folder(base, member_name, blog_id, date)
                except UnsafePath:
                    rejected += 1
                    continue

                # Skip if already fully cached (validated non-empty, not partial)
                if skip_cached and self._is_blog_cached(cache_path):
                    continue

                queue.append(
                    BlogDownloadItem(
                        blog_id=blog_id,
                        member_id=member_id,
                        member_name=member_name,
                        title=_text(blog.get("title")),
                        published_at=blog["published_at"],
                        url=_text(blog.get("url")),
                        cache_path=cache_path,
                        service=service,
                    )
                )

        if rejected:
            logger.warning(
                "blog_path_rejected",
                service=service,
                where="download_queue",
                count=rejected,
            )
        return queue

    async def download_blog_content(
        self,
        service: str,
        download_images: bool = True,
        progress_callback=None,
        cancel_event: Optional[threading.Event] = None,
    ) -> dict:
        """
        Stage 2: Download full blog content and optionally images.

        Uses a queue-based approach with concurrent downloads:
        - Concurrency is managed by the global AdaptivePool

        Args:
            service: Service name.
            download_images: If True, also download images for each blog.
            progress_callback: Optional callback for progress updates.

        Returns:
            Stats dict with download results.
        """
        validate_service(service)
        group = get_service_enum(service)

        index = await self.load_blog_index(service)

        # Build download queue
        queue = self.build_download_queue(service, index, skip_cached=True)

        if not queue:
            if progress_callback:
                await progress_callback("All blogs already cached")
            return {
                "total": 0,
                "downloaded": 0,
                "skipped": 0,
                "failed": 0,
                "removed": 0,
            }

        if cancel_event and cancel_event.is_set():
            return {
                "total": 0,
                "downloaded": 0,
                "skipped": 0,
                "failed": 0,
                "removed": 0,
            }

        # Determine concurrency based on how many are already cached
        stats = {
            "total": len(queue),
            "downloaded": 0,
            "skipped": 0,
            "failed": 0,
            "removed": 0,
        }
        completed = 0

        connector = aiohttp.TCPConnector(limit=10)
        # Bound total in-flight image downloads across all blogs.
        # With blog_sem=5, at most 5 blogs download concurrently;
        # image_sem further caps total image fetches sharing the
        # 10-connection TCPConnector.
        image_sem = asyncio.Semaphore(20)
        # Limit concurrent blog downloads to prevent mass TimeoutError.
        # Without this, asyncio.gather queues ALL blogs at once; requests
        # waiting in the connector queue still count against aiohttp's
        # total timeout (default 300s), causing timeout storms.
        blog_sem = asyncio.Semaphore(5)
        async with aiohttp.ClientSession(connector=connector) as session:
            scraper = get_scraper(group, session)

            async def download_item(item: BlogDownloadItem):
                nonlocal completed
                if cancel_event and cancel_event.is_set():
                    return
                async with blog_sem:
                    completed += 1
                    if progress_callback:
                        await progress_callback(
                            f"Downloading {item.member_name} ({completed}/{len(queue)})"
                        )

                    try:
                        await self._download_single_blog(
                            session, scraper, item, download_images, image_sem
                        )
                        stats["downloaded"] += 1
                    except BlogGoneError:
                        # Blog permanently removed (404/410) - mark in index
                        self._mark_blog_removed(index, item.member_id, item.blog_id)
                        stats["removed"] += 1
                    except Exception as e:
                        logger.warning(
                            "Failed to download blog",
                            blog_id=item.blog_id,
                            error_type=type(e).__name__,
                            error=str(e),
                        )
                        stats["failed"] += 1

            await asyncio.gather(*[download_item(item) for item in queue])

        # Auto-promote: if ALL blogs of a member are now removed, set member-level flag
        # This avoids iterating hundreds of removed entries on future syncs
        self._promote_fully_removed_members(index)

        # SD-BE-SVC-05: skip the final save on cancel so a cancelled run can't
        # write its stale snapshot after a newer run's save (rolling it back).
        if cancel_event and cancel_event.is_set():
            logger.info(
                "Blog content download cancelled; skipping index save", service=service
            )
            return stats

        from datetime import datetime, timezone

        index["last_download"] = datetime.now(timezone.utc).isoformat()
        await self.save_blog_index(service, index)

        if stats["removed"] > 0:
            logger.info(
                "Marked removed blogs",
                removed=stats["removed"],
            )

        logger.info(
            "Blog content download complete",
            total=stats["total"],
            downloaded=stats["downloaded"],
            removed=stats["removed"],
            failed=stats["failed"],
        )
        return stats

    def _mark_blog_removed(self, index: dict, member_id: str, blog_id: str):
        """Mark a blog as permanently removed in the index."""
        member_data = index.get("members", {}).get(member_id, {})
        for blog in member_data.get("blogs", []):
            if blog["id"] == blog_id:
                blog["removed"] = True
                break

    def _promote_fully_removed_members(self, index: dict):
        """Set member-level blogs_removed flag when all blogs are removed.

        This avoids iterating hundreds of individual blog entries on future syncs.
        """
        for member_id, member_data in index.get("members", {}).items():
            if member_data.get("blogs_removed"):
                continue  # Already promoted
            blogs = member_data.get("blogs", [])
            if blogs and all(b.get("removed") for b in blogs):
                member_data["blogs_removed"] = True
                logger.info(
                    "All blogs removed for member",
                    member_id=member_id,
                    member_name=member_data.get("name"),
                    blog_count=len(blogs),
                )

    async def _download_single_blog(
        self,
        session: aiohttp.ClientSession,
        scraper,
        item: BlogDownloadItem,
        download_images: bool,
        image_sem: Optional[asyncio.Semaphore] = None,
    ):
        """Download a single blog's content and optionally images.

        Args:
            image_sem: Semaphore bounding concurrent image downloads across
                       the entire batch.  None for single-blog on-demand fetches.
        """
        # Pass member_id for faster lookups (important for Nogizaka old blogs)
        entry = await scraper.get_blog_detail(item.blog_id, member_id=item.member_id)

        item.cache_path.mkdir(parents=True, exist_ok=True)
        cache_file = item.cache_path / "blog.json"

        # Download images if requested
        images_result = []
        if download_images and entry.images:
            images_result = await self._download_images(
                session, entry.images, item.cache_path / "images", image_sem
            )
        else:
            images_result = [
                {"original_url": img, "local_path": None} for img in entry.images
            ]

        # Metadata from index (single source of truth), content from scraper
        content = _build_blog_content(
            blog_id=item.blog_id,
            member_name=item.member_name,
            title=item.title,
            published_at=item.published_at,
            url=item.url,
            html=entry.content,
            images=images_result,
        )

        # Written atomically and LAST (after images), so blog.json is the
        # all-or-nothing completion marker the resume check keys on.
        await self._atomic_write(
            cache_file, json.dumps(content, ensure_ascii=False, indent=2)
        )
        # The persisted gallery listing keys on this folder's mtime, which
        # FAT/exFAT (an external archive drive) do not move when entries change.
        await asyncio.to_thread(_bump_folder_mtime, item.cache_path)
        # Every blog write ends here (backup, on-demand fetch): the photo
        # gallery listings are stale even if the index is never saved after it
        # (a cancelled backup run). Only this blog's service is stale (N3).
        invalidate_gallery(item.service)

    async def _download_images(
        self,
        session: aiohttp.ClientSession,
        image_urls: list[str],
        images_dir: Path,
        semaphore: Optional[asyncio.Semaphore] = None,
    ) -> list[dict]:
        """Download images concurrently with bounded concurrency.

        Each file is named ``img_<n>`` plus ``_blog_image_ext`` of its URL.

        Args:
            semaphore: Limits total in-flight image downloads across all
                       blogs in a batch.  When provided, ``session.get``
                       is only called after acquiring the semaphore, so
                       the aiohttp timeout clock does not start while
                       waiting.  None for unbounded (single-blog fetches).

        Fetches go through ``remote_images.fetch_official_image``; an off-list
        or oversized image is not archived (``blog_image_refused``,
        ``reason``) and the reader keeps its remote URL.
        """
        results: list[dict] = [None] * len(image_urls)  # type: ignore

        async def download_image(idx: int, img_url: str):
            local_name = f"img_{idx}{_blog_image_ext(img_url)}"
            local_path = images_dir / local_name

            async def _fetch_image():
                try:
                    content, _content_type = await fetch_official_image(
                        session, img_url
                    )
                except RemoteImageRefused as e:
                    if e.reason == "status":
                        logger.debug("blog_image_download_failed", status=e.status)
                    else:
                        _image_refusal_logs.log(
                            logger.info, "blog_image_refused", reason=e.reason
                        )
                    # Never leave a None slot: blog.json would break
                    # _rewrite_local_images' img.get() calls.
                    results[idx] = {"original_url": img_url, "local_path": None}
                    return
                await self._atomic_write(local_path, content)
                results[idx] = {
                    "original_url": img_url,
                    "local_path": f"./images/{local_name}",
                }

            try:
                if semaphore:
                    async with semaphore:
                        await _fetch_image()
                else:
                    await _fetch_image()
            except Exception as e:
                logger.warning("blog_image_download_error", error_type=type(e).__name__)
                results[idx] = {"original_url": img_url, "local_path": None}

        await asyncio.gather(
            *[download_image(i, url) for i, url in enumerate(image_urls)]
        )
        return results

    # =========================================================================
    # Combined sync (for convenience)
    # =========================================================================

    async def sync_full_backup(
        self,
        service: str,
        progress_callback=None,
        cancel_event: Optional[threading.Event] = None,
    ):
        """
        Full backup mode: Stage 1 + Stage 2.
        Sync metadata then download all content + images.
        """
        if not _is_blog_supported(service):
            logger.info("Skipping full blog backup (not supported)", service=service)
            return {}
        t0 = time.monotonic()
        # Stage 1: Metadata sync
        if progress_callback:
            await progress_callback("Stage 1: Syncing blog metadata...")
        stage1 = await self.sync_blog_metadata(
            service, progress_callback, cancel_event=cancel_event
        )
        if isinstance(stage1, dict) and stage1.get("sync_failed"):
            logger.warning("blog_backup_aborted", service=service, reason="sync_failed")
            return {"sync_failed": True}
        logger.info(
            "blog_stage1_complete",
            service=service,
            elapsed=f"{time.monotonic() - t0:.1f}s",
        )

        if cancel_event and cancel_event.is_set():
            logger.info("Blog backup cancelled after Stage 1", service=service)
            return {"cancelled": True}

        # Stage 2: Content download
        t1 = time.monotonic()
        if progress_callback:
            await progress_callback("Stage 2: Downloading blog content...")
        stats = await self.download_blog_content(
            service,
            download_images=True,
            progress_callback=progress_callback,
            cancel_event=cancel_event,
        )

        logger.info(
            "blog_backup_complete",
            service=service,
            stage2_elapsed=f"{time.monotonic() - t1:.1f}s",
            total_elapsed=f"{time.monotonic() - t0:.1f}s",
            **{k: v for k, v in stats.items() if k != "cancelled"},
        )
        return stats

    # =========================================================================
    # Query operations
    # =========================================================================

    async def get_recent_posts(
        self, service: str, limit: int = 20, member_ids: Optional[List[str]] = None
    ) -> List[dict]:
        """
        Get recent posts across all members, sorted by date descending.

        Args:
            service: Service name.
            limit: Maximum number of posts to return (default 20, max 100).
            member_ids: If provided, only return posts from these members.

        Returns:
            List of recent posts with member info attached.
        """
        index = await self.load_blog_index(service)
        all_posts = []
        seen_ids: set[str] = set()  # Dedupe by blog ID (handles corrupted indices)

        for member_id, member_data in index.get("members", {}).items():
            # Skip if filtering and member not in list
            if member_ids and member_id not in member_ids:
                continue
            # Skip members whose blogs are all removed
            if member_data.get("blogs_removed"):
                continue

            member_name = member_data.get("name", "")
            for blog in _readable_blogs(
                service, "recent", member_data.get("blogs", [])
            ):
                blog_id = blog["id"]
                # Skip individually removed blogs
                if blog.get("removed"):
                    continue
                # Skip duplicates (same blog appearing under multiple members)
                if blog_id in seen_ids:
                    continue
                seen_ids.add(blog_id)

                all_posts.append(
                    {
                        "id": blog_id,
                        "title": _text(blog.get("title")),
                        "published_at": blog["published_at"],
                        "url": _text(blog.get("url")),
                        "thumbnail": _thumbnail(blog.get("thumbnail")),
                        "member_id": member_id,
                        "member_name": member_name,
                    }
                )

        # Sort by date descending, take limit
        all_posts.sort(key=lambda x: _published_key(x["published_at"]), reverse=True)
        return all_posts[:limit]

    async def get_blog_list(self, service: str, member_id: str) -> dict:
        """Get blog list for a member from index."""
        index = await self.load_blog_index(service)
        member_data = index.get("members", {}).get(member_id, {})

        blogs = _readable_blogs(service, "list", member_data.get("blogs", []))
        base = self.get_blogs_base_path(service)
        member_name = member_data.get("name", "")

        def _with_cached() -> list[dict]:
            # One existence check per blog: in a worker thread, off the event loop.
            out: list[dict] = []
            rejected = 0
            for blog in blogs:
                try:
                    folder = _blog_folder(
                        base, member_name, blog["id"], blog_date(blog["published_at"])
                    )
                    cached = (folder / "blog.json").exists()
                except UnsafePath:
                    cached = False
                    rejected += 1
                out.append(
                    {
                        **blog,
                        "title": _text(blog.get("title")),
                        "url": _text(blog.get("url")),
                        "thumbnail": _thumbnail(blog.get("thumbnail")),
                        "cached": cached,
                    }
                )
            if rejected:
                logger.warning(
                    "blog_path_rejected", service=service, where="list", count=rejected
                )
            return out

        listed = await asyncio.to_thread(_with_cached)
        return {
            "member_id": member_id,
            "member_name": member_data.get("name", ""),
            "blogs": sorted(
                listed, key=lambda b: _published_key(b["published_at"]), reverse=True
            ),
        }

    def _rewrite_local_images(
        self, content: dict, cache_path: Path, service: str, blog_id: str
    ) -> dict:
        """Rewrite image URLs in blog content to use local API when cached on disk.

        For each image with a local_path that exists on disk, replaces the
        external URL in both the images array and the HTML content with
        /api/blogs/image?service=...&blog_id=...&filename=... so the frontend
        serves images from disk instead of hitting external servers.
        """
        from urllib.parse import quote

        images = content.get("images", [])
        html = content.get("content", {}).get("html", "")

        for img in images:
            local_rel = img.get("local_path")
            original_url = img.get("original_url")
            if not local_rel or not original_url:
                continue

            # local_path is like "./images/img_0.jpg" — resolve against cache_path
            local_abs = (cache_path / local_rel).resolve()
            if not local_abs.exists():
                continue

            filename = local_abs.name  # e.g. "img_0.jpg"
            api_url = (
                f"/api/blogs/image"
                f"?service={quote(service)}"
                f"&blog_id={quote(blog_id)}"
                f"&filename={quote(filename)}"
            )

            # Replace in HTML
            html = html.replace(original_url, api_url)
            # Update image entry to point to local API
            img["local_url"] = api_url

        content["content"]["html"] = html
        return content

    async def get_blog_content(self, service: str, blog_id: str) -> dict:
        """
        Get full blog content. Fetches on-demand if not cached.
        """
        validate_service(service)
        group = get_service_enum(service)

        # Find blog in index to get member info
        index = await self.load_blog_index(service)
        blog_meta = None
        member_name = None
        found_member_id = None

        for mid, member_data in index.get("members", {}).items():
            for blog in _readable_blogs(
                service, "content", member_data.get("blogs", [])
            ):
                if blog["id"] == blog_id:
                    blog_meta = blog
                    member_name = member_data.get("name", "")
                    found_member_id = mid
                    break
            if blog_meta:
                break

        if not blog_meta or member_name is None:
            raise ValueError(f"Blog {blog_id} not found in index")

        # Check cache
        date = blog_date(blog_meta["published_at"])
        try:
            cache_path = self.get_blog_cache_path(service, member_name, blog_id, date)
        except UnsafePath as e:
            # Before any fetch or write (security audit 2026-11-13).
            logger.warning(
                "blog_path_rejected", service=service, where="content", reason=e.reason
            )
            raise
        cache_file = cache_path / "blog.json"

        if cache_file.exists():
            async with aiofiles.open(cache_file, "r", encoding="utf-8") as f:
                content = cast(Dict[Any, Any], json.loads(await f.read()))
            return self._rewrite_local_images(content, cache_path, service, blog_id)

        # Fetch on-demand — delegate to _download_single_blog (single code path)
        item = BlogDownloadItem(
            blog_id=blog_meta["id"],
            member_id=found_member_id or "",
            member_name=member_name,
            title=_text(blog_meta.get("title")),
            published_at=blog_meta["published_at"],
            url=_text(blog_meta.get("url")),
            cache_path=cache_path,
            service=service,
        )

        connector = aiohttp.TCPConnector(limit=6)
        async with aiohttp.ClientSession(connector=connector) as session:
            scraper = get_scraper(group, session)
            await self._download_single_blog(
                session,
                scraper,
                item,
                download_images=True,
            )

        # Read back the cached content we just wrote
        async with aiofiles.open(cache_file, "r", encoding="utf-8") as f:
            content = cast(Dict[Any, Any], json.loads(await f.read()))
        return self._rewrite_local_images(content, cache_path, service, blog_id)

    # =========================================================================
    # Cache management
    # =========================================================================

    async def get_cache_size(self, service: str) -> int:
        """Get total cache size in bytes for a service.

        Walks the tree with ``os.scandir``: on Windows each entry's size comes
        from the directory listing, so the walk needs no per-file ``stat`` call
        (``Path.rglob`` + ``is_file`` + ``stat`` opened every file and was ~6x
        slower on a full archive). Symlinks are not followed. Runs in an executor.
        """
        base_path = self.get_blogs_base_path(service)
        if not base_path.exists():
            return 0

        def _walk() -> tuple[int, int]:
            total = files = 0
            pending = [str(base_path)]
            while pending:
                with os.scandir(pending.pop()) as entries:
                    for entry in entries:
                        if entry.is_dir(follow_symlinks=False):
                            pending.append(entry.path)
                        elif entry.is_file(follow_symlinks=False):
                            total += entry.stat(follow_symlinks=False).st_size
                            files += 1
            return total, files

        started = time.monotonic()
        loop = asyncio.get_running_loop()
        total, files = await loop.run_in_executor(None, _walk)
        logger.debug(
            "blog_cache_size_scanned",
            service=service,
            files=files,
            duration_ms=round((time.monotonic() - started) * 1000),
        )
        return total

    async def get_cache_stats(self, service: str) -> dict:
        """Get blog counts for a service: total, available, cached, removed, pending.

        Counts come from the index plus one ``blog.json`` existence check per
        available blog. The on-disk size is not included (it needs a walk of the
        whole tree); ``get_cache_size`` reports it.
        """
        index = await self.load_blog_index(service)

        members = index.get("members", {})
        readable = {
            mid: _readable_blogs(service, "stats", m.get("blogs", []))
            for mid, m in members.items()
        }

        total_blogs = 0
        removed_count = 0
        for mid, m in members.items():
            blogs = readable[mid]
            total_blogs += len(blogs)
            if m.get("blogs_removed"):
                removed_count += len(blogs)
            else:
                removed_count += sum(1 for b in blogs if b.get("removed"))

        base = self.get_blogs_base_path(service)

        def _count_cached() -> int:
            # Thousands of synchronous existence checks: in a worker thread so
            # the event loop keeps serving media and polls meanwhile.
            count = 0
            rejected = 0
            for mid, member_data in members.items():
                if member_data.get("blogs_removed"):
                    continue
                member_name = member_data.get("name", "")
                for blog in readable[mid]:
                    if blog.get("removed"):
                        continue
                    date = blog_date(blog["published_at"])
                    try:
                        folder = _blog_folder(base, member_name, blog["id"], date)
                    except UnsafePath:
                        rejected += 1
                        continue
                    if (folder / "blog.json").exists():
                        count += 1
            if rejected:
                logger.warning(
                    "blog_path_rejected", service=service, where="stats", count=rejected
                )
            return count

        cached_count = await asyncio.to_thread(_count_cached)

        available_blogs = total_blogs - removed_count
        return {
            "total_blogs": total_blogs,
            "available_blogs": available_blogs,
            "cached_blogs": cached_count,
            "removed_blogs": removed_count,
            "pending_download": available_blogs - cached_count,
            "last_sync": index.get("last_sync"),
            "last_download": index.get("last_download"),
        }

    async def clear_cache(self, service: str):
        """Clear all cached blog content for a service, keeping index.json.

        SD-BE-SVC-08: index.json holds ``removed``/``blogs_removed`` flags and
        metadata for blogs that no longer exist on the official site (graduated
        members) — unrecoverable by re-scraping. The previous implementation read
        the index into memory, then ``rmtree``'d the tree; if ``rmtree`` raised
        partway (a file briefly locked by AV/the Search indexer — the exact
        Windows failure the retry helpers exist for) the function unwound with the
        index already deleted and its only copy trapped in the raised exception.

        Instead: move index.json *out* of the tree first (atomic rename to a
        sibling), delete the tree, then move it back — so the index is never in a
        deleted-and-not-yet-restored window. Also refuse to clear while a backup
        is actively writing under the tree.
        """
        # Don't yank the tree out from under an in-flight backup writer.
        if get_blog_backup_manager().is_running(service):
            raise RuntimeError(
                f"Cannot clear blog cache for {service} while a backup is running"
            )

        base_path = self.get_blogs_base_path(service)
        index_path = self.get_blog_index_path(service)

        if not base_path.exists():
            return

        # Stash index.json outside the tree via an atomic rename so it survives
        # rmtree regardless of where rmtree might fail.
        stash_path = base_path.parent / f".{base_path.name}_index_keep.json"
        stashed = False
        if index_path.exists():
            await asyncio.to_thread(
                _replace_with_retry, str(index_path), str(stash_path)
            )
            stashed = True

        try:
            await asyncio.to_thread(shutil.rmtree, base_path)
        finally:
            # Always put the index back, even if rmtree partially failed, so the
            # graduated-member metadata is never lost.
            if stashed:
                base_path.mkdir(parents=True, exist_ok=True)
                await asyncio.to_thread(
                    _replace_with_retry, str(stash_path), str(index_path)
                )


# =============================================================================
# Blog Backup Manager (immediate toggle support)
# =============================================================================


class BlogBackupManager:
    """Manages blog backup tasks on a dedicated background thread.

    All backup coroutines run on a separate asyncio event loop so they
    cannot starve the main uvicorn event loop (UI responsiveness).

    Public methods (start, stop, is_running, shutdown) are synchronous
    and thread-safe — safe to call from any thread or async context.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._cancel_events: dict[str, threading.Event] = {}
        self._running: set[str] = set()
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def _ensure_thread(self) -> asyncio.AbstractEventLoop:
        """Start the background thread and event loop if not already running.

        Must be called with self._lock held.
        """
        if (
            self._loop is not None
            and self._thread is not None
            and self._thread.is_alive()
        ):
            return self._loop

        ready = threading.Event()
        loop_holder: list[asyncio.AbstractEventLoop] = []

        def _run():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop_holder.append(loop)
            ready.set()
            loop.run_forever()
            # After run_forever returns (shutdown), clean up pending tasks
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            if pending:
                loop.run_until_complete(
                    asyncio.gather(*pending, return_exceptions=True)
                )
            loop.close()

        self._thread = threading.Thread(target=_run, name="blog-backup", daemon=True)
        self._thread.start()
        if not ready.wait(timeout=5):
            raise RuntimeError("Blog backup thread failed to start within 5 seconds")
        self._loop = loop_holder[0]
        return self._loop

    def start(self, services: list[str], *, force: bool = False) -> None:
        """Start blog backup for the given services.

        Synchronous and thread-safe. Skips services already running
        unless *force* is True.
        """
        with self._lock:
            loop = self._ensure_thread()
            for service in services:
                if not force and service in self._running:
                    logger.debug(
                        "Blog backup already running, skipping", service=service
                    )
                    continue

                # Cancel any previous run for this service
                self._signal_cancel(service)

                cancel_event = threading.Event()
                self._cancel_events[service] = cancel_event
                self._running.add(service)

                asyncio.run_coroutine_threadsafe(
                    self._run_backup(service, cancel_event),
                    loop,
                )

    def stop(self, services: list[str] | None = None) -> None:
        """Stop blog backup for the given services (or all).

        Synchronous and thread-safe.
        """
        with self._lock:
            targets = services or list(self._running)
            for service in targets:
                self._signal_cancel(service)
                self._running.discard(service)

    def is_running(self, service: str) -> bool:
        """Thread-safe check whether a service backup is active."""
        with self._lock:
            return service in self._running

    def running_services(self) -> list[str]:
        """Thread-safe snapshot of all running service IDs."""
        with self._lock:
            return list(self._running)

    def shutdown(self) -> None:
        """Stop all backups and shut down the background thread.

        I1: ``join(timeout=5)`` is a bounded wait for safety (a hung backup
        coroutine must not deadlock app shutdown forever), but a timeout is
        not the same as confirmed-dead. If the thread is still alive after
        the join, log loudly (ERROR) rather than silently returning as if
        the writer were drained -- that's exactly the "no write after
        release" guarantee this hook exists to uphold.
        """
        with self._lock:
            targets = list(self._running)
            for service in targets:
                self._signal_cancel(service)
                self._running.discard(service)
            loop = self._loop
            thread = self._thread
            self._loop = None
            self._thread = None
        if loop is not None:
            loop.call_soon_threadsafe(loop.stop)
        if thread is not None:
            thread.join(timeout=5)
            if thread.is_alive():
                logger.error(
                    "blog_backup_thread_join_timed_out; worker may still be "
                    "writing; shutting down anyway to avoid deadlock"
                )

    async def stop_async(self) -> None:
        """Shutdown-barrier hook: stop every backup and join the worker
        thread, returning only once it can no longer write.

        Named distinctly from ``stop(services=...)`` above (selective,
        synchronous, cancel-only) — this is the awaitable, stop-everything
        hook the app-shutdown write barrier registers. ``shutdown()`` is
        synchronous and blocks on ``Thread.join`` (bounded, 5s) — run it off
        the event loop via ``asyncio.to_thread`` so the barrier can await it
        without stalling the loop. Idempotent: safe to call with nothing
        running or after a prior ``shutdown()``.
        """
        await asyncio.to_thread(self.shutdown)

    def _signal_cancel(self, service: str) -> None:
        """Signal cancellation for a service. Must hold self._lock."""
        event = self._cancel_events.pop(service, None)
        if event is not None:
            event.set()

    def _deregister_own(self, service: str, cancel_event: threading.Event) -> None:
        """Remove this run's bookkeeping only if it is still the current run.

        A superseding ``start(force=True)`` replaces ``_cancel_events[service]``
        with a fresh event; this run must not clobber the newer run's
        registration.  Identity of the cancel-event is the per-run token: only
        deregister when the currently-registered event is still our own.
        A deregistered run asks the thumbnail pre-generation worker for a
        pass over the service (``media_pregen.request_safely``; thread-safe).
        """
        with self._lock:
            mine = self._cancel_events.get(service) is cancel_event
            if mine:
                self._cancel_events.pop(service, None)
                self._running.discard(service)
        if mine:
            # Thumbnails for the blog images (and a pass once idle); never raises.
            from backend.services import media_pregen

            media_pregen.request_safely(service)

    async def _run_backup(self, service: str, cancel_event: threading.Event):
        """Run full backup for one service with cancellation support."""
        if not _is_blog_supported(service):
            logger.info(f"Skipping blog backup for {service} (not supported)")
            self._deregister_own(service, cancel_event)
            return

        blog_service = BlogService()
        try:
            logger.info(f"Standalone blog backup started for {service}")
            await blog_service.sync_full_backup(
                service,
                cancel_event=cancel_event,
            )
            logger.info(f"Standalone blog backup finished for {service}")

            # Index blogs for search now that blog.json files exist on disk
            try:
                from backend.services.search_service import get_search_service

                search_svc = get_search_service()
                indexed = await search_svc.index_blogs_for_service(service)
                logger.info(
                    "Blog search index updated after backup",
                    service=service,
                    indexed=indexed,
                )
            except Exception as e:
                logger.warning(f"Blog search index update failed (non-fatal): {e}")
        except asyncio.CancelledError:
            logger.info(f"Standalone blog backup cancelled for {service}")
        except Exception as e:
            logger.error(f"Standalone blog backup error for {service}: {e}")
        finally:
            self._deregister_own(service, cancel_event)


# =============================================================================
# Blog photo gallery (media pipeline 0.5.0, M7)
# =============================================================================
#
# Building blocks shared by ``gallery_images`` (the API) and the
# pre-generation worker's blog phase (``media_pregen``), which runs them one
# step at a time on its background-priority thread with pause checks between
# steps. All of them are blocking: never call them on the event loop.

GALLERY_MEMO_MAX = 32
"""Cached member listings kept at most (oldest dropped first). Whole-service listings are never memoised."""

_GALLERY_IMAGE_NAME = re.compile(
    r"^img_[0-9]+(?:"
    + "|".join(re.escape(ext) for ext in sorted(_BLOG_IMAGE_EXTS))
    + r")\Z",
    re.IGNORECASE,
)
"""A cached blog image the photo gallery lists: ``img_<n>`` plus a picture extension
(``_BLOG_IMAGE_EXTS``, any case). ``GET /api/blogs/image`` accepts any
``img_<n>.<ext>`` and serves a file without a picture extension only as an
attachment (``passive_media``); the gallery leaves such files out (security
audit 2026-11-13). A persisted listing row with another name is malformed, so
the blog is read again."""

GallerySignature = tuple[str, int, int, int]
"""``(base, index mtime_ns, cached blog.json count, gallery version)``: unchanged means the listing is unchanged."""


@dataclass
class _MemoEntry:
    signature: GallerySignature
    images: list[dict]
    skipped: int


# (service, member_id) -> the last listing of that member
_gallery_memo: "OrderedDict[tuple[str, str], _MemoEntry]" = OrderedDict()
_gallery_memo_lock = threading.Lock()
# Bumped for every service by a write of unknown service; per service otherwise.
_gallery_version_all = 0
_gallery_versions: dict[str, int] = {}


def reset_gallery_memo_for_tests() -> None:
    with _gallery_memo_lock:
        _gallery_memo.clear()


def invalidate_gallery(service: Optional[str] = None) -> None:
    """A blog's files changed (``blog.json`` or its images were written): its listings are stale.

    A cheap bump of ``service``'s gallery version (every service's when it is
    ``None``), which is part of every gallery signature, so neither the memo
    nor the worker's "unchanged" skip relies on the index being saved. Other
    services' listings stay valid (N3). It also drops the worker's persisted
    blog signature of the service (``media_pregen.forget_blog_signatures``).
    """
    global _gallery_version_all
    with _gallery_memo_lock:
        if service is None:
            _gallery_version_all += 1
        else:
            _gallery_versions[service] = _gallery_versions.get(service, 0) + 1
    # The pre-generation worker's persisted "unchanged" signature is stale
    # too (it outlives this in-memory version). Cheap; never raises.
    from backend.services import media_pregen

    media_pregen.forget_blog_signatures(service)


def gallery_version(service: Optional[str] = None) -> int:
    """``service``'s gallery version, bumped by :func:`invalidate_gallery`.

    It only grows. ``None`` gives the sum over every service, which moves on
    any write.
    """
    with _gallery_memo_lock:
        if service is None:
            return _gallery_version_all + sum(_gallery_versions.values())
        return _gallery_version_all + _gallery_versions.get(service, 0)


def _read_gallery_index(path: Path) -> Any:
    """The parsed blog ``index.json`` (raises on a missing or broken file)."""
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _read_blog_json(path: Path) -> dict:
    """A cached ``blog.json`` as a dict (raises ``ValueError`` when it is not one)."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("blog.json is not an object")
    return data


_FAT_MTIME_STEP_NS = 2_000_000_000
"""FAT stores mtimes in 2 s steps: a bump smaller than this could round back."""


def _bump_folder_mtime(folder: Path) -> None:
    """Move ``folder``'s mtime forward (to now, and at least one FAT step). Blocking.

    Called after every blog write, so ``gallery_member_listing`` reads the
    blog again on any filesystem. Never raises; a failure is logged with its
    error type only (no path).
    """
    try:
        old = folder.stat().st_mtime_ns
        new = max(time.time_ns(), old + _FAT_MTIME_STEP_NS)
        os.utime(folder, ns=(new, new))
    except OSError as e:
        logger.warning("blog_folder_touch_failed", error_type=type(e).__name__)


@dataclass(frozen=True)
class GalleryMember:
    """One member of the index: her folder name and her well-formed blog entries."""

    folder: str
    blogs: list[dict]


@dataclass(frozen=True)
class GalleryIndex:
    """The blog index of a service, read once: the blogs ``base``, its mtime and members."""

    base: Path
    mtime_ns: int
    members: list[GalleryMember]


@dataclass(frozen=True)
class CachedBlog:
    """A blog with a non-empty ``blog.json``: its index entry and folder."""

    blog: dict
    folder: Path


@dataclass(frozen=True)
class LocalImage:
    """One image of a cached blog whose file exists (``folder / "images" / name``)."""

    blog: dict
    folder: Path
    image_index: int
    name: str

    @property
    def path(self) -> Path:
        return self.folder / "images" / self.name


def _published(blog: dict) -> datetime:
    """``published_at`` as an aware datetime (naive = UTC, unparsable = oldest), for sorting."""
    try:
        parsed = datetime.fromisoformat(blog["published_at"].replace("Z", "+00:00"))
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def gallery_index(
    service: str, member_id: Optional[str] = None, output_dir: Optional[Path] = None
) -> Optional[GalleryIndex]:
    """Read the service's blog index once; ``None`` when there is none (or it is broken).

    The blogs base is ``output_dir`` (default: the configured output dir,
    resolved once here) / the service folder / ``blogs``. Keeps ``member_id``
    only (every member when ``None``). Members and blogs whose folder name is
    not a plain path segment or whose blog id is not a safe id (the rules
    ``_blog_folder`` writes by), or whose entry is malformed, are left out.
    Blocking.
    """
    root = output_dir if output_dir is not None else get_output_dir()
    base = root / get_service_display_name(service) / "blogs"
    index_path = base / "index.json"
    try:
        mtime_ns = index_path.stat().st_mtime_ns
        index = _read_gallery_index(index_path)
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as e:
        logger.warning(
            "blog_gallery_index_unreadable",
            service=service,
            error_type=type(e).__name__,
        )
        return None
    found = index.get("members") if isinstance(index, dict) else None
    members: dict = found if isinstance(found, dict) else {}
    chosen = (
        list(members.values())
        if member_id is None
        else [members[member_id]]
        if member_id in members
        else []
    )
    out: list[GalleryMember] = []
    for member in chosen:
        if not isinstance(member, dict):
            continue
        name, blogs = member.get("name", ""), member.get("blogs", [])
        if not isinstance(name, str) or not isinstance(blogs, list):
            continue  # a malformed member: skip her, keep the others
        folder = member_folder_name(name)
        if not plain_segment(folder):
            continue
        valid = [
            b
            for b in blogs
            if isinstance(b, dict)
            and is_safe_id(b.get("id"))
            and isinstance(b.get("published_at"), str)
            and plain_segment(blog_folder_name(b["published_at"], b["id"]))
        ]
        out.append(GalleryMember(folder, valid))
    return GalleryIndex(base, mtime_ns, out)


def gallery_member_blogs(base: Path, member: GalleryMember) -> list[CachedBlog]:
    """The member's cached blogs: one listing of her folder, then one stat per blog folder present.

    A blog counts when its ``blog.json`` is non-empty (``_is_blog_cached``),
    so an interrupted download that is later completed changes the count.
    Blocking.
    """
    folder = base / member.folder
    try:
        with os.scandir(folder) as it:
            present = {e.name for e in it if e.is_dir()}
    except OSError:  # no folder yet (nothing downloaded), or unreadable
        return []
    out: list[CachedBlog] = []
    for blog in member.blogs:
        name = blog_folder_name(blog["published_at"], blog["id"])
        if name not in present:
            continue
        try:
            if (folder / name / "blog.json").stat().st_size > 0:
                out.append(CachedBlog(blog, folder / name))
        except OSError:
            continue
    return out


def gallery_newest_first(cached: list[CachedBlog]) -> list[CachedBlog]:
    """``cached`` newest ``published_at`` first (parsed, so mixed UTC offsets order right)."""
    return sorted(cached, key=lambda c: _published(c.blog), reverse=True)


def gallery_local_images(
    service: str, cached: list[CachedBlog]
) -> tuple[list[LocalImage], int]:
    """Read each cached blog's ``blog.json``; its images whose file exists, and the skip count.

    An unreadable ``blog.json`` is skipped (``blog_gallery_skip``, codes
    only). A file name must be a picture name (``_GALLERY_IMAGE_NAME``), so a
    hostile ``local_path`` never leaves the blog's ``images`` folder and a
    stored non-picture is never listed. Blocking.
    """
    found: list[LocalImage] = []
    skipped = 0
    for c in cached:
        listed = _blog_images(service, c.folder)
        if listed is None:
            skipped += 1
            continue
        found += [LocalImage(c.blog, c.folder, idx, name) for idx, name in listed]
    return found, skipped


def _blog_images(service: str, folder: Path) -> Optional[list[list]]:
    """``[[image_index, name]]`` of one cached blog's images whose file exists. Blocking.

    ``None`` when its ``blog.json`` is unreadable (``blog_gallery_skip``,
    codes only). A file name must be a picture name (``_GALLERY_IMAGE_NAME``).
    """
    try:
        content = _read_blog_json(folder / "blog.json")
    except (OSError, ValueError) as e:
        logger.warning(
            "blog_gallery_skip",
            service=service,
            reason="unreadable",
            error_type=type(e).__name__,
        )
        return None
    images = content.get("images")
    if not isinstance(images, list):
        return []
    out: list[list] = []
    for idx, img in enumerate(images):
        local = img.get("local_path") if isinstance(img, dict) else None
        if not isinstance(local, str):
            continue
        name = Path(local).name
        if _GALLERY_IMAGE_NAME.match(name) and (folder / "images" / name).is_file():
            out.append([idx, name])
    return out


GALLERY_STORE_PREFIX = "blog_gallery:"
"""``media_meta`` key-value prefix of the persisted gallery listings (N2)."""


def _store_key(folder: Path) -> str:
    """The persisted listing's key of a member folder: a hash, never the path."""
    digest = hashlib.sha256(str(folder).encode("utf-8")).hexdigest()[:16]
    return GALLERY_STORE_PREFIX + digest


def _entry_mtime(entry: os.DirEntry) -> Optional[int]:
    """A listed folder's ``mtime_ns`` (from the listing itself on Windows), or ``None``."""
    try:
        return entry.stat(follow_symlinks=False).st_mtime_ns
    except OSError:
        return None


def _load_store(key: str) -> tuple[dict[str, list], bool]:
    """The persisted ``{blog folder: [mtime_ns, [[image_index, name]]]}`` and whether it was bad."""
    from backend.services import media_meta

    raw = media_meta.kv_get_prefix(key).get(key)
    if raw is None:
        return {}, False
    try:
        data = json.loads(raw)
        blogs = data["blogs"]
        if data.get("v") != 1 or not isinstance(blogs, dict):
            raise ValueError
        ok = {
            name: rec
            for name, rec in blogs.items()
            if isinstance(rec, list)
            and len(rec) == 2
            and isinstance(rec[0], int)
            and isinstance(rec[1], list)
            and all(
                isinstance(i, list)
                and len(i) == 2
                and isinstance(i[0], int)
                and isinstance(i[1], str)
                and _GALLERY_IMAGE_NAME.match(i[1])
                for i in rec[1]
            )
        }
    except (ValueError, TypeError, KeyError):
        return {}, True
    return ok, len(ok) != len(blogs)


def gallery_member_listing(
    service: str, base: Path, member: GalleryMember
) -> tuple[list[CachedBlog], dict[Path, list[list]], int, dict[str, int]]:
    """The member's cached blogs and their local images, from a persisted listing (N2).

    Returns ``(cached, images by blog folder, skipped, counts)``. One listing of
    her folder gives every blog folder's mtime; a blog whose folder mtime
    equals the one stored with its images (``media_meta`` key-value store,
    :data:`GALLERY_STORE_PREFIX`) is taken from the store without opening
    anything. Every blog write replaces ``blog.json`` inside its folder (a
    temp file renamed into place, after its images) and then moves the
    folder's mtime forward explicitly (``_bump_folder_mtime``: now, and at
    least one 2 s FAT step), because FAT/exFAT do not move a folder's mtime
    when its entries change. So a new or rewritten blog is read again on any
    filesystem; others are not.
    Otherwise the blog is read as before (``blog.json`` stat and read, one
    ``is_file`` per image) and stored when its folder mtime is known and its
    ``blog.json`` was readable. Trade-off: an image file deleted by hand
    without a blog write stays listed until the blog changes (its tile falls
    back to the placeholder). The store holds blog folder names, image
    indexes and file names only (no path, no title). ``counts``: ``reused``,
    ``read``, ``store_bad`` (1 when the stored listing was unreadable or had
    malformed rows, which are read again). Blocking.
    """
    from backend.services import media_meta

    folder = base / member.folder
    counts = {"reused": 0, "read": 0, "store_bad": 0}
    try:
        with os.scandir(folder) as it:
            present = {e.name: _entry_mtime(e) for e in it if e.is_dir()}
    except OSError:  # no folder yet (nothing downloaded), or unreadable
        return [], {}, 0, counts
    key = _store_key(folder)
    stored, bad = _load_store(key)
    counts["store_bad"] = int(bad)
    keep: dict[str, list] = {}
    cached: list[CachedBlog] = []
    images: dict[Path, list[list]] = {}
    skipped = 0
    for blog in member.blogs:
        name = blog_folder_name(blog["published_at"], blog["id"])
        if name not in present:
            continue
        path = folder / name
        mtime = present[name]
        rec = stored.get(name)
        if mtime is not None and rec is not None and rec[0] == mtime:
            cached.append(CachedBlog(blog, path))
            images[path] = rec[1]
            keep[name] = rec
            counts["reused"] += 1
            continue
        try:
            if (path / "blog.json").stat().st_size <= 0:
                continue
        except OSError:
            continue
        cached.append(CachedBlog(blog, path))
        counts["read"] += 1
        listed = _blog_images(service, path)
        if listed is None:
            skipped += 1
            images[path] = []
            continue
        images[path] = listed
        if mtime is not None:
            keep[name] = [mtime, listed]
    if keep != stored or bad:
        media_meta.kv_set(key, json.dumps({"v": 1, "blogs": keep}, ensure_ascii=False))
    return cached, images, skipped, counts


def gallery_signature(
    index: GalleryIndex, cached_count: int, version: int
) -> GallerySignature:
    """The listing's signature: unchanged index, cached count and version mean an unchanged listing."""
    return (str(index.base), index.mtime_ns, cached_count, version)


def _gallery_entry(service: str, image: LocalImage) -> dict:
    """The API entry of one image (``media_url`` for thumbnails, ``src`` for the viewer)."""
    from urllib.parse import quote

    from backend.services.archive_urls import media_url

    blog = image.blog
    return {
        "blog_id": blog["id"],
        "published_at": blog["published_at"],
        "title": blog.get("title", ""),
        "image_index": image.image_index,
        "media_url": media_url(
            service,
            [
                "blogs",
                image.folder.parent.name,
                image.folder.name,
                "images",
                image.name,
            ],
        ),
        "src": (
            f"/api/blogs/image?service={quote(service)}"
            f"&blog_id={quote(blog['id'])}&filename={quote(image.name)}"
        ),
    }


def _gallery_scan(
    service: str, member_id: Optional[str]
) -> tuple[list[dict], dict[str, Any]]:
    """The gallery listing and its summary counts. Blocking: run it in a thread.

    One index read, then per member one folder listing and the persisted
    listing (:func:`gallery_member_listing`: only new or rewritten blogs open
    their ``blog.json``); the entries are built unless the member's signature
    (:func:`gallery_signature`) matches the memo. Only member listings are
    memoised.
    """
    # before any read: a write meanwhile makes the next call miss
    version = gallery_version(service)
    index = gallery_index(service, member_id)
    if index is None:
        return [], {"blogs": 0, "images": 0, "skipped": 0, "memo": "none"}
    cached: list[CachedBlog] = []
    listed: dict[Path, list[list]] = {}
    skipped = 0
    store = {"reused": 0, "read": 0, "store_bad": 0}
    for m in index.members:
        c, imgs, sk, n = gallery_member_listing(service, index.base, m)
        cached += c
        listed.update(imgs)
        skipped += sk
        for k, v in n.items():
            store[k] += v
    signature = gallery_signature(index, len(cached), version)
    counts: dict[str, Any] = {"blogs": len(cached), **store}
    if member_id is not None:
        with _gallery_memo_lock:
            hit = _gallery_memo.get((service, member_id))
            if hit is not None and hit.signature == signature:
                _gallery_memo.move_to_end((service, member_id))
                return hit.images, {
                    **counts,
                    "images": len(hit.images),
                    "skipped": hit.skipped,
                    "memo": "hit",
                }
    # Newest first (a stable sort), then the image order inside a blog.
    found = [
        LocalImage(c.blog, c.folder, idx, name)
        for c in gallery_newest_first(cached)
        for idx, name in listed[c.folder]
    ]
    images = [_gallery_entry(service, i) for i in found]
    if member_id is not None:
        with _gallery_memo_lock:
            _gallery_memo[(service, member_id)] = _MemoEntry(signature, images, skipped)
            _gallery_memo.move_to_end((service, member_id))
            while len(_gallery_memo) > GALLERY_MEMO_MAX:
                _gallery_memo.popitem(last=False)
    return images, {
        **counts,
        "images": len(images),
        "skipped": skipped,
        "memo": "miss" if member_id is not None else "off",
    }


async def gallery_images(service: str, member_id: Optional[str] = None) -> list[dict]:
    """Every locally cached image of a member's blogs (every member's when ``None``).

    One entry per image whose file exists: ``{blog_id, published_at, title,
    image_index, media_url, src}``, newest ``published_at`` first (parsed, so
    mixed offsets order right), then ``image_index``. ``media_url`` is the
    media-route URL of the file (for ``/api/content/thumb`` and
    ``/api/media/meta``); ``src`` is the ``/api/blogs/image`` URL the viewer
    shows. One worker-thread pass (:func:`_gallery_scan`): the index read
    once, one folder listing per member, then the ``blog.json`` reads of new
    or rewritten blogs only (the rest come from the persisted listing,
    :func:`gallery_member_listing`, so a cold start after a reboot does not
    open every blog), memoised per ``(service, member_id)`` on
    :func:`gallery_signature` (whole-service listings are not memoised). An
    unreadable ``blog.json`` is skipped (``blog_gallery_skip``). Logs one
    ``blog_gallery`` summary (counts only, with ``reused`` / ``read`` /
    ``store_bad`` from the persisted listing).
    The returned list is shared with the memo: do not mutate it. Raises
    ``ValueError`` for an unknown service.
    """
    validate_service(service)
    start = time.perf_counter()
    images, counts = await asyncio.to_thread(_gallery_scan, service, member_id)
    logger.info(
        "blog_gallery",
        service=service,
        elapsed_ms=round((time.perf_counter() - start) * 1000),
        **counts,
    )
    return images


async def blog_backup_enabled() -> bool:
    """The global "full blog backup" setting (``blogs_full_backup``)."""
    from backend.services.settings_store import load_config

    return bool((await load_config()).get("blogs_full_backup"))


_blog_backup_manager: BlogBackupManager | None = None
_blog_backup_manager_lock = threading.Lock()


def get_blog_backup_manager() -> BlogBackupManager:
    """Thread-safe singleton access."""
    global _blog_backup_manager
    if _blog_backup_manager is None:
        with _blog_backup_manager_lock:
            if _blog_backup_manager is None:
                _blog_backup_manager = BlogBackupManager()
    return _blog_backup_manager
