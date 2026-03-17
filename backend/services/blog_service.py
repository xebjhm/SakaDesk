"""
Blog service for ZakaDesk.
Handles blog metadata sync, on-demand content fetching, and caching.

Two-stage sync design (similar to message sync):
- Stage 1: sync_blog_metadata() - Fast metadata indexing
- Stage 2: download_blog_content() - Content + image download with queue
"""
import asyncio
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, cast

import aiofiles
import aiohttp
import structlog

from pyzaka import Group
from pyzaka.blog import (
    BlogGoneError,
    MAX_PAGES_SAFETY_CAP,
    MemberInfo,
    get_scraper,
)

from backend.services.path_resolver import get_output_dir
from backend.services.service_utils import (
    get_service_display_name,
    get_service_enum,
    validate_service,
)

logger = structlog.get_logger(__name__)

# Groups that have blog support. Yodel does not have blogs.
BLOG_SUPPORTED_GROUPS = frozenset({Group.HINATAZAKA46, Group.NOGIZAKA46, Group.SAKURAZAKA46})


def _is_blog_supported(service: str) -> bool:
    """Check if a service supports blog operations."""
    try:
        group = get_service_enum(service)
        return group in BLOG_SUPPORTED_GROUPS
    except ValueError:
        return False


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
        """Get path to cached blog content."""
        base = self.get_blogs_base_path(service)
        folder_name = f"{date}_{blog_id}"
        return base / member_name / folder_name

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

    async def save_blog_index(self, service: str, index: dict):
        """Save blog index to disk (atomic write via temp file + rename)."""
        import os

        index_path = self.get_blog_index_path(service)
        index_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = index_path.with_suffix(".json.tmp")
        async with aiofiles.open(tmp_path, "w", encoding="utf-8") as f:
            await f.write(json.dumps(index, ensure_ascii=False, indent=2))
        os.replace(tmp_path, index_path)

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
        """Download a single member thumbnail and return local filename."""
        try:
            async with session.get(thumbnail_url) as resp:
                if resp.status != 200:
                    logger.warning(
                        "thumbnail_download_failed",
                        member_id=member_id,
                        status=resp.status,
                    )
                    return None

                # Determine extension from URL or content-type
                content_type = resp.headers.get("Content-Type", "")
                if "jpeg" in content_type or "jpg" in content_type:
                    ext = ".jpg"
                elif "png" in content_type:
                    ext = ".png"
                elif "webp" in content_type:
                    ext = ".webp"
                else:
                    # Try from URL
                    url_path = thumbnail_url.split("?")[0]
                    ext = Path(url_path).suffix or ".jpg"

                local_filename = f"{member_id}{ext}"
                local_path = thumbnails_dir / local_filename

                content = await resp.read()
                async with aiofiles.open(local_path, "wb") as f:
                    await f.write(content)

                return local_filename

        except Exception as e:
            logger.warning(
                "thumbnail_download_error",
                member_id=member_id,
                error=str(e),
            )
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
            fresh_members = await scraper.get_members_with_thumbnails()

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
                result_members.append({
                    "id": member.id,
                    "name": member.name,
                    "thumbnail": thumbnail_filename,
                })

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
        """Get path to a member's cached thumbnail image.

        Args:
            service: Service name.
            member_id: Member ID.

        Returns:
            Path to the thumbnail file, or None if not found.
        """
        thumbnails_dir = self.get_member_thumbnails_path(service)
        if not thumbnails_dir.exists():
            return None

        # Check for common extensions
        for ext in [".jpg", ".png", ".webp"]:
            path = thumbnails_dir / f"{member_id}{ext}"
            if path.exists():
                return path

        return None

    # =========================================================================
    # Stage 1: Metadata sync (fast)
    # =========================================================================

    async def sync_blog_metadata(self, service: str, progress_callback=None, cancel_event: Optional[asyncio.Event] = None) -> dict:
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
            members = await scraper.get_members()
            completed = 0
            total = len(members)

            async def sync_member(member_id: str, member_name: str):
                nonlocal completed
                if cancel_event and cancel_event.is_set():
                    return
                if progress_callback:
                    await progress_callback(
                        f"Scanning {member_name} ({completed + 1}/{total})"
                    )

                if member_id not in index["members"]:
                    index["members"][member_id] = {"name": member_name, "blogs": []}

                existing_ids = {
                    b["id"] for b in index["members"][member_id]["blogs"]
                }

                # For incremental sync, use since_date to stop early when hitting old blogs
                # This avoids paginating through entire history just to find no new posts
                since_date = None
                if not is_first_sync and index["members"][member_id]["blogs"]:
                    # Find the newest blog date for this member
                    from datetime import datetime

                    newest_date_str = max(
                        b["published_at"]
                        for b in index["members"][member_id]["blogs"]
                    )
                    since_date = datetime.fromisoformat(newest_date_str)

                # Use fast metadata method - parses list pages only
                # Pass member_name to filter out "featured" blogs from other members
                # (Sakurazaka list pages sometimes include blogs from other members)
                new_entries = []
                needs_detail: list[tuple[int, dict]] = []

                async for entry in scraper.get_blogs_metadata(
                    member_id, since_date=since_date, max_pages=max_pages,
                    member_name=member_name
                ):
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
                        if not blog_data["thumbnail"]:
                            needs_detail.append((len(new_entries) - 1, blog_data))

                # Batch detail fetches for entries missing thumbnails
                if needs_detail:
                    async def fetch_detail(idx: int, blog: dict):
                        try:
                            detail_thumb, detail_date, detail_title = (
                                await scraper.get_blog_detail_metadata(blog["id"])
                            )
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
                                error=str(e)
                            )

                    await asyncio.gather(*[
                        fetch_detail(idx, blog) for idx, blog in needs_detail
                    ])

                for blog_data in new_entries:
                    pub_at = blog_data["published_at"]
                    index["members"][member_id]["blogs"].append(
                        {
                            "id": blog_data["id"],
                            "title": blog_data["title"],
                            "published_at": pub_at.isoformat() if hasattr(pub_at, 'isoformat') else pub_at,
                            "url": blog_data["url"],
                            "thumbnail": blog_data["thumbnail"],
                        }
                    )

                completed += 1

            # Run all member syncs concurrently with semaphore limit
            await asyncio.gather(
                *[
                    sync_member(member_id, member_name)
                    for member_id, member_name in members.items()
                ]
            )

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

        for member_id, member_data in index.get("members", {}).items():
            # Skip members whose blogs are all removed (e.g., graduated)
            if member_data.get("blogs_removed"):
                continue

            member_name = member_data.get("name", "")

            for blog in member_data.get("blogs", []):
                # Skip individually removed blogs
                if blog.get("removed"):
                    continue

                blog_id = blog["id"]
                date = blog["published_at"][:10].replace("-", "")
                cache_path = self.get_blog_cache_path(
                    service, member_name, blog_id, date
                )

                # Skip if already cached
                if skip_cached and (cache_path / "blog.json").exists():
                    continue

                queue.append(
                    BlogDownloadItem(
                        blog_id=blog_id,
                        member_id=member_id,
                        member_name=member_name,
                        title=blog["title"],
                        published_at=blog["published_at"],
                        url=blog["url"],
                        cache_path=cache_path,
                    )
                )

        return queue

    async def download_blog_content(
        self,
        service: str,
        download_images: bool = True,
        progress_callback=None,
        cancel_event: Optional[asyncio.Event] = None,
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
            return {"total": 0, "downloaded": 0, "skipped": 0, "failed": 0, "removed": 0}

        if cancel_event and cancel_event.is_set():
            return {"total": 0, "downloaded": 0, "skipped": 0, "failed": 0, "removed": 0}

        # Determine concurrency based on how many are already cached
        stats = {"total": len(queue), "downloaded": 0, "skipped": 0, "failed": 0, "removed": 0}
        completed = 0

        connector = aiohttp.TCPConnector(limit=10)
        async with aiohttp.ClientSession(connector=connector) as session:
            scraper = get_scraper(group, session)

            async def download_item(item: BlogDownloadItem):
                nonlocal completed
                if cancel_event and cancel_event.is_set():
                    return
                completed += 1
                if progress_callback:
                    await progress_callback(
                        f"Downloading {item.member_name} ({completed}/{len(queue)})"
                    )

                try:
                    await self._download_single_blog(
                        session, scraper, item, download_images
                    )
                    stats["downloaded"] += 1
                except BlogGoneError:
                    # Blog permanently removed (404/410) - mark in index
                    self._mark_blog_removed(index, item.member_id, item.blog_id)
                    stats["removed"] += 1
                except Exception as e:
                    logger.warning(
                        f"Failed to download blog {item.blog_id}: {e}"
                    )
                    stats["failed"] += 1

            await asyncio.gather(*[download_item(item) for item in queue])

        # Auto-promote: if ALL blogs of a member are now removed, set member-level flag
        # This avoids iterating hundreds of removed entries on future syncs
        self._promote_fully_removed_members(index)

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
    ):
        """Download a single blog's content and optionally images."""
        # Pass member_id for faster lookups (important for Nogizaka old blogs)
        entry = await scraper.get_blog_detail(item.blog_id, member_id=item.member_id)

        item.cache_path.mkdir(parents=True, exist_ok=True)
        cache_file = item.cache_path / "blog.json"

        # Download images if requested
        images_result = []
        if download_images and entry.images:
            images_result = await self._download_images(
                session, entry.images, item.cache_path / "images"
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

        async with aiofiles.open(cache_file, "w", encoding="utf-8") as f:
            await f.write(json.dumps(content, ensure_ascii=False, indent=2))

    async def _download_images(
        self,
        session,
        image_urls: list[str],
        images_dir: Path,
    ) -> list[dict]:
        """Download images concurrently.

        Concurrency is managed by the TCPConnector limit on the session.
        """
        results: list[dict] = [None] * len(image_urls)  # type: ignore

        async def download_image(idx: int, img_url: str):
            try:
                ext = Path(img_url).suffix or ".jpg"
                # Clean extension (remove query params)
                if "?" in ext:
                    ext = ext.split("?")[0]
                local_name = f"img_{idx}{ext}"
                local_path = images_dir / local_name

                async with session.get(img_url) as resp:
                    if resp.status == 200:
                        images_dir.mkdir(parents=True, exist_ok=True)
                        content = await resp.read()
                        async with aiofiles.open(local_path, "wb") as f:
                            await f.write(content)
                        results[idx] = {
                            "original_url": img_url,
                            "local_path": f"./images/{local_name}",
                        }
                    else:
                        results[idx] = {"original_url": img_url, "local_path": None}
            except Exception as e:
                logger.warning(f"Failed to download image {img_url}: {e}")
                results[idx] = {"original_url": img_url, "local_path": None}

        await asyncio.gather(
            *[download_image(i, url) for i, url in enumerate(image_urls)]
        )
        return results

    # =========================================================================
    # Combined sync (for convenience)
    # =========================================================================

    async def sync_full_backup(self, service: str, progress_callback=None, cancel_event: Optional[asyncio.Event] = None):
        """
        Full backup mode: Stage 1 + Stage 2.
        Sync metadata then download all content + images.
        """
        if not _is_blog_supported(service):
            logger.info(f"Skipping full blog backup for {service} (not supported)")
            return {}
        # Stage 1: Metadata sync
        if progress_callback:
            await progress_callback("Stage 1: Syncing blog metadata...")
        await self.sync_blog_metadata(service, progress_callback, cancel_event=cancel_event)

        if cancel_event and cancel_event.is_set():
            logger.info(f"Blog backup cancelled after Stage 1 for {service}")
            return {"cancelled": True}

        # Stage 2: Content download
        if progress_callback:
            await progress_callback("Stage 2: Downloading blog content...")
        stats = await self.download_blog_content(
            service, download_images=True, progress_callback=progress_callback,
            cancel_event=cancel_event,
        )

        logger.info(f"Full blog backup complete: {stats}")
        return stats

    # =========================================================================
    # Query operations
    # =========================================================================

    async def get_recent_posts(self, service: str, limit: int = 20, member_ids: Optional[List[str]] = None) -> List[dict]:
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
            for blog in member_data.get("blogs", []):
                blog_id = blog["id"]
                # Skip individually removed blogs
                if blog.get("removed"):
                    continue
                # Skip duplicates (same blog appearing under multiple members)
                if blog_id in seen_ids:
                    continue
                seen_ids.add(blog_id)

                all_posts.append({
                    "id": blog_id,
                    "title": blog["title"],
                    "published_at": blog["published_at"],
                    "url": blog["url"],
                    "thumbnail": blog.get("thumbnail"),
                    "member_id": member_id,
                    "member_name": member_name,
                })

        # Sort by date descending, take limit
        all_posts.sort(key=lambda x: x["published_at"], reverse=True)
        return all_posts[:limit]

    async def get_blog_list(self, service: str, member_id: str) -> dict:
        """Get blog list for a member from index."""
        index = await self.load_blog_index(service)
        member_data = index.get("members", {}).get(member_id, {})

        blogs = member_data.get("blogs", [])

        # Check which blogs are cached
        for blog in blogs:
            date = blog["published_at"][:10].replace("-", "")
            cache_path = self.get_blog_cache_path(
                service, member_data.get("name", ""), blog["id"], date
            )
            blog["cached"] = (cache_path / "blog.json").exists()

        return {
            "member_id": member_id,
            "member_name": member_data.get("name", ""),
            "blogs": sorted(blogs, key=lambda b: b["published_at"], reverse=True),
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
            for blog in member_data.get("blogs", []):
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
        date = blog_meta["published_at"][:10].replace("-", "")
        cache_path = self.get_blog_cache_path(service, member_name, blog_id, date)
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
            title=blog_meta["title"],
            published_at=blog_meta["published_at"],
            url=blog_meta["url"],
            cache_path=cache_path,
        )

        connector = aiohttp.TCPConnector(limit=6)
        async with aiohttp.ClientSession(connector=connector) as session:
            scraper = get_scraper(group, session)
            await self._download_single_blog(
                session, scraper, item, download_images=False,
            )

        # Read back the cached content we just wrote
        async with aiofiles.open(cache_file, "r", encoding="utf-8") as f:
            content = cast(Dict[Any, Any], json.loads(await f.read()))
        return self._rewrite_local_images(content, cache_path, service, blog_id)

    # =========================================================================
    # Cache management
    # =========================================================================

    async def get_cache_size(self, service: str) -> int:
        """Get total cache size in bytes for a service."""
        base_path = self.get_blogs_base_path(service)
        if not base_path.exists():
            return 0

        total = 0
        for file in base_path.rglob("*"):
            if file.is_file():
                total += file.stat().st_size
        return total

    async def get_cache_stats(self, service: str) -> dict:
        """Get detailed cache statistics."""
        index = await self.load_blog_index(service)

        total_blogs = 0
        removed_count = 0
        for m in index.get("members", {}).values():
            blogs = m.get("blogs", [])
            total_blogs += len(blogs)
            if m.get("blogs_removed"):
                removed_count += len(blogs)
            else:
                removed_count += sum(1 for b in blogs if b.get("removed"))

        # Count cached blogs (skip removed members/blogs entirely)
        cached_count = 0
        for member_id, member_data in index.get("members", {}).items():
            if member_data.get("blogs_removed"):
                continue
            member_name = member_data.get("name", "")
            for blog in member_data.get("blogs", []):
                if blog.get("removed"):
                    continue
                date = blog["published_at"][:10].replace("-", "")
                cache_path = self.get_blog_cache_path(
                    service, member_name, blog["id"], date
                )
                if (cache_path / "blog.json").exists():
                    cached_count += 1

        available_blogs = total_blogs - removed_count
        return {
            "total_blogs": total_blogs,
            "available_blogs": available_blogs,
            "cached_blogs": cached_count,
            "removed_blogs": removed_count,
            "pending_download": available_blogs - cached_count,
            "cache_size_bytes": await self.get_cache_size(service),
            "last_sync": index.get("last_sync"),
            "last_download": index.get("last_download"),
        }

    async def clear_cache(self, service: str):
        """Clear all cached blog content for a service."""
        import shutil

        base_path = self.get_blogs_base_path(service)

        # Keep index.json, delete everything else
        index_path = self.get_blog_index_path(service)
        index_backup = None

        if index_path.exists():
            async with aiofiles.open(index_path, "r", encoding="utf-8") as f:
                index_backup = await f.read()

        if base_path.exists():
            shutil.rmtree(base_path)

        # Restore index
        if index_backup:
            base_path.mkdir(parents=True, exist_ok=True)
            async with aiofiles.open(index_path, "w", encoding="utf-8") as f:
                await f.write(index_backup)


# =============================================================================
# Blog Backup Manager (immediate toggle support)
# =============================================================================

class BlogBackupManager:
    """Singleton manager for blog backup background tasks.

    Provides fine-grained cancellation via asyncio.Event per service.
    Coordinates between the settings toggle and Phase 5 of sync.
    """

    def __init__(self):
        self._tasks: dict[str, asyncio.Task] = {}
        self._cancel_events: dict[str, asyncio.Event] = {}
        self._lock = asyncio.Lock()

    def is_running(self, service: str) -> bool:
        task = self._tasks.get(service)
        return task is not None and not task.done()

    async def start(self, services: list[str]):
        """Start blog backup for the given services. Cancels any existing tasks first."""
        async with self._lock:
            for service in services:
                await self._cancel_service(service)

                cancel_event = asyncio.Event()
                self._cancel_events[service] = cancel_event

                task = asyncio.create_task(
                    self._run_backup(service, cancel_event)
                )
                self._tasks[service] = task

    async def stop(self, services: list[str] | None = None):
        """Stop blog backup for the given services (or all if None)."""
        async with self._lock:
            targets = services or list(self._tasks.keys())
            for service in targets:
                await self._cancel_service(service)

    async def _cancel_service(self, service: str):
        """Cancel backup for a single service. Must hold self._lock."""
        if service in self._cancel_events:
            self._cancel_events[service].set()

        task = self._tasks.pop(service, None)
        if task and not task.done():
            task.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=5.0)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass

        self._cancel_events.pop(service, None)

    async def _run_backup(self, service: str, cancel_event: asyncio.Event):
        """Run full backup for one service with cancellation support."""
        if not _is_blog_supported(service):
            logger.info(f"Skipping blog backup for {service} (not supported)")
            self._tasks.pop(service, None)
            self._cancel_events.pop(service, None)
            return

        blog_service = BlogService()
        try:
            logger.info(f"Standalone blog backup started for {service}")
            await blog_service.sync_full_backup(
                service, cancel_event=cancel_event,
            )
            logger.info(f"Standalone blog backup finished for {service}")

            # Index blogs for search now that blog.json files exist on disk
            try:
                from backend.services.search_service import get_search_service
                search_svc = get_search_service()
                indexed = await search_svc.index_blogs_for_service(service)
                logger.info(f"Blog search index updated after backup", service=service, indexed=indexed)
            except Exception as e:
                logger.warning(f"Blog search index update failed (non-fatal): {e}")
        except asyncio.CancelledError:
            logger.info(f"Standalone blog backup cancelled for {service}")
        except Exception as e:
            logger.error(f"Standalone blog backup error for {service}: {e}")
        finally:
            self._tasks.pop(service, None)
            self._cancel_events.pop(service, None)


_blog_backup_manager: BlogBackupManager | None = None


def get_blog_backup_manager() -> BlogBackupManager:
    global _blog_backup_manager
    if _blog_backup_manager is None:
        _blog_backup_manager = BlogBackupManager()
    return _blog_backup_manager
