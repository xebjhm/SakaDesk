"""
Blogs API for HakoDesk.
Provides endpoints for blog browsing, content fetching, and cache management.
"""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional

from backend.services.blog_service import BlogService, get_blog_backup_manager
from backend.services.service_utils import validate_service

router = APIRouter()
blog_service = BlogService()


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
    member_ids: Optional[str] = Query(default=None, description="Comma-separated member IDs to filter by")
):
    """Get recent blog posts across all members (or filtered by member_ids), sorted by date."""
    try:
        validate_service(service)
        # Parse comma-separated member_ids if provided
        member_id_list = [m.strip() for m in member_ids.split(",") if m.strip()] if member_ids else None
        posts = await blog_service.get_recent_posts(service, limit, member_id_list)
        return RecentPostsResponse(service=service, posts=[RecentPost(**p) for p in posts])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/members")
async def get_blog_members(service: str = Query(...)):
    """Get members who have blogs for a service."""
    try:
        validate_service(service)
        members = await blog_service.get_blog_members(service)
        return {"service": service, "members": [{"id": k, "name": v} for k, v in members.items()]}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/members-with-thumbnails", response_model=MembersWithThumbnailsResponse)
async def get_members_with_thumbnails(service: str = Query(...)):
    """Get members with locally cached thumbnail images.

    Fetches member data from official site, uses content hash caching
    to detect changes, and serves locally cached thumbnail images.
    """
    try:
        validate_service(service)
        members = await blog_service.get_members_with_thumbnails(service)
        return MembersWithThumbnailsResponse(service=service, members=[MemberWithThumbnail(**m) for m in members])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/member-thumbnail/{service}/{member_id}")
async def get_member_thumbnail(service: str, member_id: str):
    """Serve a member's cached thumbnail image.

    Args:
        service: Service name (e.g., 'hinatazaka46').
        member_id: Member ID.

    Returns:
        The thumbnail image file.
    """
    try:
        validate_service(service)
        thumbnail_path = blog_service.get_member_thumbnail_path(service, member_id)

        if not thumbnail_path or not thumbnail_path.exists():
            raise HTTPException(status_code=404, detail="Thumbnail not found")

        # Determine media type from extension
        ext = thumbnail_path.suffix.lower()
        media_types = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
        }
        media_type = media_types.get(ext, "image/jpeg")

        return FileResponse(
            thumbnail_path,
            media_type=media_type,
            headers={
                "Cache-Control": "public, max-age=86400",  # Cache for 1 day
            }
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/list", response_model=BlogListResponse)
async def get_blog_list(
    service: str = Query(...),
    member_id: str = Query(...)
):
    """Get blog list for a member."""
    try:
        validate_service(service)
        return await blog_service.get_blog_list(service, member_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/content", response_model=BlogContentResponse)
async def get_blog_content(
    service: str = Query(...),
    blog_id: str = Query(...)
):
    """Get full blog content (fetches on-demand if not cached)."""
    try:
        validate_service(service)
        return await blog_service.get_blog_content(service, blog_id)
    except ValueError as e:
        raise HTTPException(status_code=400 if "Invalid service" in str(e) else 404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/cache-size", response_model=CacheSizeResponse)
async def get_cache_size(service: str = Query(...)):
    """Get cache size for a service's blogs."""
    try:
        validate_service(service)
        size_bytes = await blog_service.get_cache_size(service)
        return CacheSizeResponse(
            service=service,
            size_bytes=size_bytes,
            size_mb=round(size_bytes / (1024 * 1024), 2)
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/backup/start")
async def start_blog_backup(services: List[str] = Query(...)):
    """Start blog full backup for specified services immediately."""
    try:
        for s in services:
            validate_service(s)

        manager = get_blog_backup_manager()
        await manager.start(services)

        return {"status": "started", "services": services}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/backup/stop")
async def stop_blog_backup(services: Optional[List[str]] = Query(None)):
    """Stop blog full backup for specified services (or all if none specified)."""
    try:
        if services:
            for s in services:
                validate_service(s)

        manager = get_blog_backup_manager()
        await manager.stop(services)

        return {"status": "stopped", "services": services or ["all"]}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync")
async def sync_blog_metadata(service: str = Query(...)):
    """Sync blog metadata from official website.

    This endpoint fetches fresh blog data from the official website.
    Unlike message sync, this does NOT require authentication since
    blogs are publicly accessible.

    Args:
        service: Service name (e.g., 'sakurazaka46').

    Returns:
        Stats about the sync operation.
    """
    try:
        validate_service(service)
        index = await blog_service.sync_blog_metadata(service)

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
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Allowed domains for the image proxy (official blog hosts and CDNs)
_PROXY_ALLOWED_HOSTS = {
    "cdn.hinatazaka46.com", "www.hinatazaka46.com", "hinatazaka46.com",
    "cdn.sakurazaka46.com", "www.sakurazaka46.com", "sakurazaka46.com",
    "cdn.nogizaka46.com", "www.nogizaka46.com", "nogizaka46.com",
    "img.nogizaka46.com",
}


@router.get("/proxy-image")
async def proxy_blog_image(url: str = Query(...)):
    """Proxy download for external blog images to bypass browser CORS restrictions.

    Only allows fetching from known official blog domains for security.
    """
    from urllib.parse import urlparse
    import httpx

    parsed = urlparse(url)
    if parsed.hostname not in _PROXY_ALLOWED_HOSTS:
        raise HTTPException(status_code=403, detail="Domain not allowed for proxy")

    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await client.get(url, timeout=30.0)
            resp.raise_for_status()

        content_type = resp.headers.get("content-type", "application/octet-stream")
        from starlette.responses import Response
        return Response(content=resp.content, media_type=content_type)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch image: {e}")


@router.get("/image")
async def serve_blog_image(
    service: str = Query(...),
    blog_id: str = Query(...),
    filename: str = Query(...),
):
    """Serve a locally cached blog image from disk.

    Used when full blog backup has downloaded images locally.
    """
    import re
    from pathlib import Path as _Path

    try:
        validate_service(service)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Validate filename to prevent path traversal
    if not re.match(r'^img_\d+\.\w+$', filename):
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Resolve the blog's cache directory via service
    index = await blog_service.load_blog_index(service)
    blog_meta = None
    member_name = None
    for _mid, member_data in index.get("members", {}).items():
        for blog in member_data.get("blogs", []):
            if blog["id"] == blog_id:
                blog_meta = blog
                member_name = member_data.get("name", "")
                break
        if blog_meta:
            break

    if not blog_meta or member_name is None:
        raise HTTPException(status_code=404, detail="Blog not found")

    date = blog_meta["published_at"][:10].replace("-", "")
    cache_path = blog_service.get_blog_cache_path(service, member_name, blog_id, date)
    image_path = cache_path / "images" / filename

    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Image not found")

    ext = image_path.suffix.lower()
    media_types = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
    }
    return FileResponse(
        image_path,
        media_type=media_types.get(ext, "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=604800"},
    )
