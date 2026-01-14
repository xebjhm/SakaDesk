"""
Blog service for HakoDesk.
Handles blog metadata sync, on-demand content fetching, and caching.
"""
import json
import aiohttp
import aiofiles
import structlog
from pathlib import Path
from typing import Optional
from datetime import datetime

from pyhako.blog import get_scraper
from pyhako import Group

from backend.services.service_utils import get_service_enum, get_service_display_name, validate_service
from backend.services.path_resolver import get_output_dir

logger = structlog.get_logger(__name__)


class BlogService:
    def __init__(self):
        pass

    def get_blogs_base_path(self, service: str) -> Path:
        """Get base path for blogs storage."""
        validate_service(service)
        display_name = get_service_display_name(service)
        return get_output_dir() / display_name / "blogs"

    def get_blog_index_path(self, service: str) -> Path:
        """Get path to blog index file."""
        return self.get_blogs_base_path(service) / "index.json"

    def get_blog_cache_path(self, service: str, member_name: str, blog_id: str, date: str) -> Path:
        """Get path to cached blog content."""
        base = self.get_blogs_base_path(service)
        folder_name = f"{date}_{blog_id}"
        return base / member_name / folder_name

    async def load_blog_index(self, service: str) -> dict:
        """Load blog index from disk."""
        index_path = self.get_blog_index_path(service)
        if index_path.exists():
            try:
                async with aiofiles.open(index_path, 'r', encoding='utf-8') as f:
                    return json.loads(await f.read())
            except Exception as e:
                logger.error(f"Failed to load blog index: {e}")
        return {"members": {}, "last_sync": None}

    async def save_blog_index(self, service: str, index: dict):
        """Save blog index to disk."""
        index_path = self.get_blog_index_path(service)
        index_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(index_path, 'w', encoding='utf-8') as f:
            await f.write(json.dumps(index, ensure_ascii=False, indent=2))

    async def get_blog_members(self, service: str) -> dict[str, str]:
        """Get members who have blogs for a service."""
        validate_service(service)
        group = get_service_enum(service)

        async with aiohttp.ClientSession() as session:
            scraper = get_scraper(group, session)
            return await scraper.get_members()

    async def sync_blog_metadata(self, service: str, progress_callback=None):
        """
        Sync blog metadata (titles, dates, URLs) for all members.
        This is lightweight - just metadata, not full content.
        """
        validate_service(service)
        group = get_service_enum(service)

        index = await self.load_blog_index(service)

        async with aiohttp.ClientSession() as session:
            scraper = get_scraper(group, session)
            members = await scraper.get_members()

            for member_id, member_name in members.items():
                if progress_callback:
                    await progress_callback(f"Scanning {member_name}")

                if member_id not in index["members"]:
                    index["members"][member_id] = {
                        "name": member_name,
                        "blogs": []
                    }

                existing_ids = {b["id"] for b in index["members"][member_id]["blogs"]}

                async for entry in scraper.get_blogs(member_id):
                    if entry.id not in existing_ids:
                        index["members"][member_id]["blogs"].append({
                            "id": entry.id,
                            "title": entry.title,
                            "published_at": entry.published_at.isoformat(),
                            "url": entry.url,
                            "thumbnail": entry.images[0] if entry.images else None,
                        })

        index["last_sync"] = datetime.utcnow().isoformat() + "Z"
        await self.save_blog_index(service, index)
        return index

    async def get_blog_list(self, service: str, member_id: str) -> dict:
        """Get blog list for a member from index."""
        index = await self.load_blog_index(service)
        member_data = index.get("members", {}).get(member_id, {})

        blogs = member_data.get("blogs", [])

        # Check which blogs are cached
        for blog in blogs:
            date = blog["published_at"][:10].replace("-", "")
            cache_path = self.get_blog_cache_path(service, member_data.get("name", ""), blog["id"], date)
            blog["cached"] = (cache_path / "blog.json").exists()

        return {
            "member_id": member_id,
            "member_name": member_data.get("name", ""),
            "blogs": sorted(blogs, key=lambda b: b["published_at"], reverse=True)
        }

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

        for member_id, member_data in index.get("members", {}).items():
            for blog in member_data.get("blogs", []):
                if blog["id"] == blog_id:
                    blog_meta = blog
                    member_name = member_data.get("name", "")
                    break
            if blog_meta:
                break

        if not blog_meta:
            raise ValueError(f"Blog {blog_id} not found in index")

        # Check cache
        date = blog_meta["published_at"][:10].replace("-", "")
        cache_path = self.get_blog_cache_path(service, member_name, blog_id, date)
        cache_file = cache_path / "blog.json"

        if cache_file.exists():
            async with aiofiles.open(cache_file, 'r', encoding='utf-8') as f:
                return json.loads(await f.read())

        # Fetch on-demand
        async with aiohttp.ClientSession() as session:
            scraper = get_scraper(group, session)
            entry = await scraper.get_blog_detail(blog_id)

            # Save to cache
            cache_path.mkdir(parents=True, exist_ok=True)

            content = {
                "meta": {
                    "id": entry.id,
                    "member_name": member_name,
                    "title": entry.title,
                    "published_at": entry.published_at.isoformat(),
                    "url": entry.url,
                },
                "content": {
                    "html": entry.content,
                },
                "images": [{"original_url": img, "local_path": None} for img in entry.images]
            }

            async with aiofiles.open(cache_file, 'w', encoding='utf-8') as f:
                await f.write(json.dumps(content, ensure_ascii=False, indent=2))

            return content

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

    async def clear_cache(self, service: str):
        """Clear all cached blog content for a service."""
        import shutil
        base_path = self.get_blogs_base_path(service)

        # Keep index.json, delete everything else
        index_path = self.get_blog_index_path(service)
        index_backup = None

        if index_path.exists():
            async with aiofiles.open(index_path, 'r', encoding='utf-8') as f:
                index_backup = await f.read()

        if base_path.exists():
            shutil.rmtree(base_path)

        # Restore index
        if index_backup:
            base_path.mkdir(parents=True, exist_ok=True)
            async with aiofiles.open(index_path, 'w', encoding='utf-8') as f:
                await f.write(index_backup)
