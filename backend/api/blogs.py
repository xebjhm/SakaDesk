"""
Blogs API for SakaDesk.
Provides endpoints for blog browsing, content fetching, and cache management.
"""

import asyncio
from html.parser import HTMLParser
from html import escape as _html_escape
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional

import structlog

from backend.services import avatar_resize
from backend.services import blog_service as blog_service_module
from backend.security_headers import SANDBOX_CSP
from backend.services.passive_media import INLINE_MEDIA_TYPES, passive_media
from backend.services.blog_service import (
    BlogService,
    blog_backup_enabled,
    gallery_images,
    get_blog_backup_manager,
)
from backend.services.remote_images import MAX_REMOTE_IMAGE_BYTES, OFFICIAL_IMAGE_HOSTS
from backend.services.service_utils import validate_service
from backend.services.safe_paths import UnsafePath, blog_date

logger = structlog.get_logger(__name__)

router = APIRouter()
blog_service = BlogService()


# ---------------------------------------------------------------------------
# Server-side HTML sanitization (SD-BE-SEC-01)
# ---------------------------------------------------------------------------
# Blog content is member-authored free-text/HTML from the official 46-group sites
# and is served to the same-origin webview. The frontend already renders it via
# DOMPurify, but the backend should not emit raw member HTML — this is the
# defense-in-depth layer. We allowlist a small set of formatting/media tags and
# safe attributes, drop everything else (script/style/iframe/on*/javascript:),
# and keep the local /api/blogs/image proxy URLs intact.

_ALLOWED_TAGS = frozenset(
    {
        "p",
        "br",
        "b",
        "strong",
        "i",
        "em",
        "u",
        "s",
        "span",
        "div",
        "a",
        "img",
        "ul",
        "ol",
        "li",
        "blockquote",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "figure",
        "figcaption",
        "hr",
        "pre",
        "code",
        "table",
        "thead",
        "tbody",
        "tr",
        "td",
        "th",
    }
)
# Per-tag allowed attributes. Anything not listed (notably every on* handler) is
# dropped. URL-bearing attributes are additionally scheme-checked below.
_ALLOWED_ATTRS: dict[str, set[str]] = {
    "a": {"href", "title", "target", "rel"},
    "img": {"src", "alt", "title", "width", "height"},
    "span": {"class"},
    "div": {"class"},
    "p": {"class"},
    "figure": {"class"},
    "figcaption": {"class"},
    "table": {"class"},
    "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan"},
}
_URL_ATTRS = frozenset({"href", "src"})
# Void (self-closing) HTML elements that never get a closing tag.
_VOID_TAGS = frozenset({"br", "img", "hr"})
# Tags whose *contents* must be dropped entirely, not just the tag itself.
_DROP_CONTENT_TAGS = frozenset({"script", "style"})


def _safe_url(value: str) -> bool:
    """Allow only relative URLs (incl. the /api/blogs/image proxy) and http(s)/
    mailto — reject javascript:, data:, vbscript:, etc."""
    v = value.strip().lower()
    if v.startswith(("http://", "https://", "mailto:", "/", "#", "./", "../")):
        return True
    # A scheme-less relative URL (no ':' before the first '/', '#', '?') is safe.
    for ch in v:
        if ch == ":":
            return False
        if ch in "/#?":
            return True
    return True


class _HTMLSanitizer(HTMLParser):
    """Allowlist-based HTML sanitizer built on the stdlib parser (no external dep)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._out: list[str] = []
        # Depth of nested drop-content tags currently open (script/style).
        self._suppress_depth = 0

    def _emit(self, text: str) -> None:
        if self._suppress_depth == 0:
            self._out.append(text)

    def handle_starttag(self, tag, attrs):
        if tag in _DROP_CONTENT_TAGS:
            self._suppress_depth += 1
            return
        if tag not in _ALLOWED_TAGS:
            return  # drop the tag, keep its (already-escaped) text content
        allowed: set[str] = _ALLOWED_ATTRS.get(tag, set())
        kept: list[str] = []
        for name, value in attrs:
            name = name.lower()
            if name not in allowed:
                continue
            value = value or ""
            if name in _URL_ATTRS and not _safe_url(value):
                continue
            kept.append(f'{name}="{_html_escape(value, quote=True)}"')
        attr_str = (" " + " ".join(kept)) if kept else ""
        if tag in _VOID_TAGS:
            self._emit(f"<{tag}{attr_str}/>")
        else:
            self._emit(f"<{tag}{attr_str}>")

    def handle_startendtag(self, tag, attrs):
        # e.g. <img ... /> — treat like a start tag; void tags close themselves.
        self.handle_starttag(tag, attrs)
        if tag not in _VOID_TAGS and tag in _ALLOWED_TAGS:
            self._emit(f"</{tag}>")

    def handle_endtag(self, tag):
        if tag in _DROP_CONTENT_TAGS:
            if self._suppress_depth > 0:
                self._suppress_depth -= 1
            return
        if tag in _ALLOWED_TAGS and tag not in _VOID_TAGS:
            self._emit(f"</{tag}>")

    def handle_data(self, data):
        self._emit(_html_escape(data, quote=False))

    def get_html(self) -> str:
        return "".join(self._out)


def _sanitize_blog_html(html: str) -> str:
    """Return a sanitized copy of member-authored blog HTML (SD-BE-SEC-01)."""
    if not html:
        return html
    parser = _HTMLSanitizer()
    parser.feed(html)
    parser.close()
    return parser.get_html()


class BlogMeta(BaseModel):
    id: str
    title: str
    published_at: str
    url: str
    thumbnail: Optional[str] = None
    cached: bool = False


class BlogListResponse(BaseModel):
    member_id: str
    member_name: str
    blogs: List[BlogMeta]


class BlogContentMeta(BaseModel):
    id: str
    member_name: str
    title: str
    published_at: str  # ISO datetime from index (single source of truth)
    url: str


class BlogImage(BaseModel):
    original_url: str
    local_path: Optional[str] = None
    local_url: Optional[str] = None


class BlogContent(BaseModel):
    html: str


class BlogContentResponse(BaseModel):
    meta: BlogContentMeta
    content: BlogContent
    images: List[BlogImage]


class CacheSizeResponse(BaseModel):
    service: str
    size_bytes: int
    size_mb: float


class RecentPost(BaseModel):
    id: str
    title: str
    published_at: str
    url: str
    thumbnail: Optional[str] = None
    member_id: str
    member_name: str


class RecentPostsResponse(BaseModel):
    service: str
    posts: List[RecentPost]


class MemberWithThumbnail(BaseModel):
    id: str
    name: str
    thumbnail: Optional[str] = None


class MembersWithThumbnailsResponse(BaseModel):
    service: str
    members: List[MemberWithThumbnail]


@router.get("/recent", response_model=RecentPostsResponse)
async def get_recent_posts(
    service: str = Query(...),
    limit: int = Query(default=20, ge=1, le=100),
    member_ids: Optional[str] = Query(
        default=None, description="Comma-separated member IDs to filter by"
    ),
):
    """Get recent blog posts across all members (or filtered by member_ids), sorted by date."""
    try:
        validate_service(service)
        # Parse comma-separated member_ids if provided
        member_id_list = (
            [m.strip() for m in member_ids.split(",") if m.strip()]
            if member_ids
            else None
        )
        posts = await blog_service.get_recent_posts(service, limit, member_id_list)
        return RecentPostsResponse(
            service=service, posts=[RecentPost(**p) for p in posts]
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to fetch recent blog posts", service=service, error=str(e))
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.get("/members")
async def get_blog_members(service: str = Query(...)):
    """Get members who have blogs for a service."""
    try:
        validate_service(service)
        members = await blog_service.get_blog_members(service)
        return {
            "service": service,
            "members": [{"id": k, "name": v} for k, v in members.items()],
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to fetch blog members", service=service, error=str(e))
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.get("/members-with-thumbnails", response_model=MembersWithThumbnailsResponse)
async def get_members_with_thumbnails(service: str = Query(...)):
    """Get members with locally cached thumbnail images.

    Fetches member data from official site, uses content hash caching
    to detect changes, and serves locally cached thumbnail images.
    """
    try:
        validate_service(service)
        members = await blog_service.get_members_with_thumbnails(service)
        return MembersWithThumbnailsResponse(
            service=service, members=[MemberWithThumbnail(**m) for m in members]
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(
            "Failed to fetch members with thumbnails", service=service, error=str(e)
        )
        raise HTTPException(status_code=500, detail="An internal error occurred")


_THUMBNAIL_CACHE_CONTROL = "public, max-age=86400"
"""One day, for member thumbnails whether resized or served as archived."""


@router.get("/member-thumbnail/{service}/{member_id}")
async def get_member_thumbnail(
    service: str, member_id: str, w: Optional[int] = Query(default=None)
):
    """Serve a member's cached thumbnail image.

    Args:
        service: Service name (e.g., 'hinatazaka46').
        member_id: Member ID; anything that is not ``safe_paths.is_safe_id``
            answers 404 before any filesystem call (security audit 2026-11-13).
        w: Optional width; one of ``avatar_resize.ALLOWED_WIDTHS`` (400
            otherwise). Serves a cached square WebP downscaled to ``w`` px,
            cropped from the top (portrait photos keep the head).

    Returns:
        The thumbnail file, typed and headed by ``passive_media`` (route
        ``member_thumbnail``: a picture inline with ``nosniff`` and the
        sandbox CSP). Resized or not, it carries the same ``Cache-Control``
        (``_THUMBNAIL_CACHE_CONTROL``).
    """
    try:
        validate_service(service)
        if w is not None and w not in avatar_resize.ALLOWED_WIDTHS:
            logger.info("member_thumbnail_rejected", reason="width", width=w)
            raise HTTPException(status_code=400, detail="Unsupported width")
        thumbnail_path = blog_service.get_member_thumbnail_path(service, member_id)

        if not thumbnail_path or not thumbnail_path.exists():
            raise HTTPException(status_code=404, detail="Thumbnail not found")

        served = thumbnail_path
        if w is not None:
            served = await asyncio.to_thread(
                avatar_resize.resized_avatar,
                thumbnail_path,
                w,
                None,
                avatar_resize.TOP,
            )
        passive = passive_media(served.name, route="member_thumbnail")
        return FileResponse(
            served,
            media_type=passive.media_type,
            headers={"Cache-Control": _THUMBNAIL_CACHE_CONTROL, **passive.headers},
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "member_thumbnail_failed", service=service, error_type=type(e).__name__
        )
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.get("/list", response_model=BlogListResponse)
async def get_blog_list(service: str = Query(...), member_id: str = Query(...)):
    """Get blog list for a member."""
    try:
        validate_service(service)
        return await blog_service.get_blog_list(service, member_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(
            "Failed to fetch blog list",
            service=service,
            member_id=member_id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail="An internal error occurred")


class BlogGalleryImage(BaseModel):
    blog_id: str
    published_at: str
    title: str
    image_index: int
    media_url: str
    src: str


class BlogGalleryResponse(BaseModel):
    images: List[BlogGalleryImage]


@router.get("/gallery", response_model=BlogGalleryResponse)
async def get_blog_gallery(service: str = Query(...), member_id: str = Query(...)):
    """The member's blog photo gallery in one call (``blog_service.gallery_images``).

    Every locally cached image of the member's blogs, newest first:
    ``{"images": [{blog_id, published_at, title, image_index, media_url, src}]}``.
    An unknown service answers 400; with full blog backup off (the gallery
    shows its "turn on backup" state) the list is empty.
    """
    try:
        validate_service(service)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not await blog_backup_enabled():
        return {"images": []}
    try:
        return {"images": await gallery_images(service, member_id)}
    except Exception as e:  # noqa: BLE001 - one 500 with codes only
        logger.error(
            "blog_gallery_failed", service=service, error_type=type(e).__name__
        )
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.get("/content", response_model=BlogContentResponse)
async def get_blog_content(service: str = Query(...), blog_id: str = Query(...)):
    """Get full blog content (fetches on-demand if not cached)."""
    try:
        validate_service(service)
        result = await blog_service.get_blog_content(service, blog_id)
        # SD-BE-SEC-01: sanitize the member-authored HTML server-side before it
        # leaves the backend (defense-in-depth behind the frontend DOMPurify).
        content = result.get("content")
        if isinstance(content, dict) and isinstance(content.get("html"), str):
            content["html"] = _sanitize_blog_html(content["html"])
        return result
    except ValueError as e:
        raise HTTPException(
            status_code=400 if "Invalid service" in str(e) else 404, detail=str(e)
        )
    except Exception as e:
        logger.error(
            "Failed to fetch blog content",
            service=service,
            blog_id=blog_id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.get("/cache-size", response_model=CacheSizeResponse)
async def get_cache_size(service: str = Query(...)):
    """Get cache size for a service's blogs."""
    try:
        validate_service(service)
        size_bytes = await blog_service.get_cache_size(service)
        return CacheSizeResponse(
            service=service,
            size_bytes=size_bytes,
            size_mb=round(size_bytes / (1024 * 1024), 2),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to get cache size", service=service, error=str(e))
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.get("/cache-stats")
async def get_cache_stats(service: str = Query(...)):
    """Get blog counts (total, available, cached, removed, pending) for a service."""
    try:
        validate_service(service)
        stats = await blog_service.get_cache_stats(service)
        return stats
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to get cache stats", service=service, error=str(e))
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.delete("/cache")
async def clear_cache(service: str = Query(...)):
    """Clear blog cache for a service."""
    try:
        validate_service(service)
        await blog_service.clear_cache(service)
        return {"status": "ok", "service": service}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to clear blog cache", service=service, error=str(e))
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.get("/backup/status")
async def get_blog_backup_status():
    """Get status of running blog backup tasks."""
    manager = get_blog_backup_manager()
    running = {s: True for s in manager.running_services()}
    return {"running": running}


@router.post("/backup/start")
async def start_blog_backup(services: List[str] = Query(...)):
    """Start blog full backup for specified services immediately."""
    try:
        for s in services:
            validate_service(s)

        manager = get_blog_backup_manager()
        manager.start(services)

        return {"status": "started", "services": services}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to start blog backup", services=services, error=str(e))
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.post("/backup/stop")
async def stop_blog_backup(services: Optional[List[str]] = Query(None)):
    """Stop blog full backup for specified services (or all if none specified)."""
    try:
        if services:
            for s in services:
                validate_service(s)

        manager = get_blog_backup_manager()
        manager.stop(services)

        return {"status": "stopped", "services": services or ["all"]}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to stop blog backup", services=services, error=str(e))
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.post("/sync")
async def sync_blog_metadata(service: str = Query(...)):
    """Sync blog metadata from official website.

    This endpoint fetches fresh blog data from the official website.
    Unlike message sync, this does NOT require authentication since
    blogs are publicly accessible.

    Args:
        service: Service name (e.g., 'sakurazaka46').

    Returns:
        Stats about the sync operation. Answers 502 when every member's sync
        failed (nothing was scanned, ``last_sync`` is not stamped).
    """
    try:
        validate_service(service)
        index = await blog_service.sync_blog_metadata(service)
        if index.get("sync_failed"):
            raise HTTPException(status_code=502, detail="Blog sync failed")

        # Calculate stats
        total_blogs = sum(
            len(m.get("blogs", [])) for m in index.get("members", {}).values()
        )

        return {
            "status": "ok",
            "service": service,
            "total_members": len(index.get("members", {})),
            "total_blogs": total_blogs,
            "last_sync": index.get("last_sync"),
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to sync blog metadata", service=service, error=str(e))
        raise HTTPException(status_code=500, detail="An internal error occurred")


# The proxy and the blog backup accept the same hosts and size.
_PROXY_ALLOWED_HOSTS = OFFICIAL_IMAGE_HOSTS
_PROXY_MAX_IMAGE_BYTES = MAX_REMOTE_IMAGE_BYTES


_PROXY_IMAGE_TYPES = frozenset(
    t for t in INLINE_MEDIA_TYPES.values() if t.startswith("image/")
)
"""Upstream types the proxy passes on (jpeg, png, gif, webp); else 502 (no HTML, SVG, XML)."""


def _proxy_reject(status: int, reason: str, detail: str) -> HTTPException:
    """Log ``proxy_image_rejected`` (a reason code, never the URL); build the error."""
    logger.info("proxy_image_rejected", reason=reason, status=status)
    return HTTPException(status_code=status, detail=detail)


@router.get("/proxy-image")
async def proxy_blog_image(
    url: str = Query(...),
    download: Optional[str] = Query(None),
):
    """Fetch an official blog image the page cannot fetch itself (the CDNs send no CORS).

    Only ``https`` URLs on ``_PROXY_ALLOWED_HOSTS``, with no port or port 443,
    are fetched (403 otherwise; a malformed URL or port is 400), without
    following redirects (a 3xx answers 502, so
    the allowlist and scheme hold for the final URL too). The upstream must
    answer a type in ``_PROXY_IMAGE_TYPES`` (502 otherwise) of at most
    ``_PROXY_MAX_IMAGE_BYTES`` (502); a network or HTTP error is 502 with a
    fixed message. The image is returned with that exact type and
    ``X-Content-Type-Options: nosniff``; inline answers also carry
    ``SANDBOX_CSP``, and ``download=filename`` answers an attachment with that
    name instead. Every refusal logs ``proxy_image_rejected`` with ``reason``
    (``invalid_url``, ``scheme``, ``host``, ``port``, ``redirect``,
    ``content_type``,
    ``too_large``, ``upstream`` with ``error_type``) and ``status``.
    """
    from urllib.parse import quote, urlparse

    import httpx
    from starlette.responses import Response

    try:
        parsed = urlparse(url)
        host = parsed.hostname
        port = parsed.port  # raises ValueError on a bad port
    except ValueError:
        raise _proxy_reject(400, "invalid_url", "Invalid URL") from None
    if parsed.scheme != "https":
        raise _proxy_reject(403, "scheme", "Only https image URLs can be proxied")
    if host not in _PROXY_ALLOWED_HOSTS:
        raise _proxy_reject(403, "host", "Domain not allowed for proxy")
    if port not in (None, 443):
        raise _proxy_reject(403, "port", "Only the default https port can be proxied")

    try:
        # follow_redirects=False: an allowlisted host that open-redirects must not
        # be able to steer this server-side fetch to an internal address (SSRF).
        async with httpx.AsyncClient(follow_redirects=False) as client:
            async with client.stream("GET", url, timeout=30.0) as resp:
                # SD-BE-API-15: raise_for_status() only fires on 4xx/5xx; with
                # redirects disabled a 3xx would stream through as a broken image.
                if resp.is_redirect:
                    raise _proxy_reject(502, "redirect", "Upstream image redirected")
                resp.raise_for_status()

                content_type = (
                    resp.headers.get("content-type", "")
                    .split(";", 1)[0]
                    .strip()
                    .lower()
                )
                if content_type not in _PROXY_IMAGE_TYPES:
                    raise _proxy_reject(502, "content_type", "Upstream is not an image")

                # Reject oversized responses up front when the server declares a
                # length; otherwise cap while streaming below.
                declared_len = resp.headers.get("content-length")
                if declared_len is not None:
                    try:
                        too_large = int(declared_len) > _PROXY_MAX_IMAGE_BYTES
                    except ValueError:
                        too_large = False
                    if too_large:
                        raise _proxy_reject(502, "too_large", "Image too large")

                chunks: list[bytes] = []
                total = 0
                async for chunk in resp.aiter_bytes():
                    total += len(chunk)
                    if total > _PROXY_MAX_IMAGE_BYTES:
                        raise _proxy_reject(502, "too_large", "Image too large")
                    chunks.append(chunk)
                content = b"".join(chunks)
    except httpx.InvalidURL:
        raise _proxy_reject(400, "invalid_url", "Invalid URL") from None
    except httpx.HTTPError as e:
        logger.info(
            "proxy_image_rejected",
            reason="upstream",
            status=502,
            error_type=type(e).__name__,
        )
        raise HTTPException(status_code=502, detail="Failed to fetch image") from None

    headers = {"X-Content-Type-Options": "nosniff"}
    if download:
        safe_name = quote(download, safe="")
        headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{safe_name}"
    else:
        headers["Content-Security-Policy"] = SANDBOX_CSP
    return Response(content=content, media_type=content_type, headers=headers)


@router.get("/image")
async def serve_blog_image(
    service: str = Query(...),
    blog_id: str = Query(...),
    filename: str = Query(...),
    download: Optional[str] = Query(None),
):
    """Serve a locally cached blog image from disk.

    Used when full blog backup has downloaded images locally. Inline answers
    take type and headers from ``passive_media`` (route ``blog_image``): a
    cached file that is not a picture is an attachment. ``download=name``
    always answers a ``application/octet-stream`` attachment with that name.
    """
    import re

    try:
        validate_service(service)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Validate filename to prevent path traversal
    if not re.fullmatch(r"img_\d+\.\w+", filename):
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Resolve the blog's cache directory via service
    index = await blog_service.load_blog_index(service)
    blog_meta = None
    member_name = None
    for _mid, member_data in index.get("members", {}).items():
        for blog in blog_service_module._readable_blogs(
            service, "image", member_data.get("blogs", [])
        ):
            if blog["id"] == blog_id:
                blog_meta = blog
                member_name = member_data.get("name", "")
                break
        if blog_meta:
            break

    if not blog_meta or member_name is None:
        raise HTTPException(status_code=404, detail="Blog not found")

    date = blog_date(blog_meta["published_at"])
    try:
        cache_path = blog_service.get_blog_cache_path(
            service, member_name, blog_id, date
        )
    except UnsafePath as e:
        # A hostile or broken index entry (security audit 2026-11-13).
        logger.warning(
            "blog_path_rejected", service=service, where="image", reason=e.reason
        )
        raise HTTPException(status_code=404, detail="Blog not found")
    image_path = cache_path / "images" / filename

    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Image not found")

    if download:
        return FileResponse(
            image_path,
            filename=download,
            media_type="application/octet-stream",
        )
    passive = passive_media(image_path.name, route="blog_image")
    return FileResponse(
        image_path,
        media_type=passive.media_type,
        headers={"Cache-Control": "public, max-age=604800", **passive.headers},
    )
