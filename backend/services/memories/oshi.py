"""The user's oshi (favourite) members, mirrored from the frontend.

The frontend keeps the list as blog member ids per service; it is mirrored to
settings (``oshi_members``) so backend features (year recap, notifications)
can match members by normalized name.
"""

import time

import structlog

from backend.services.blog_service import BlogService
from backend.services.memories.names import normalize_member_name
from backend.services.settings_store import load_config

logger = structlog.get_logger(__name__)


_MEMBERS_TTL_SECONDS = 3600.0
# service -> (monotonic expiry, blog member id -> name); successes only.
_members_cache: dict[str, tuple[float, dict[str, str]]] = {}


async def _blog_members(service: str) -> dict[str, str]:
    """Blog member id -> name for ``service``; ``{}`` when unavailable.

    Cached for an hour per service so repeat callers (notifications) don't
    scrape on every call. Failures and empty results are never cached.
    """
    cached = _members_cache.get(service)
    if cached is not None and cached[0] > time.monotonic():
        return cached[1]
    try:
        members = await BlogService().get_blog_members(service)
    except Exception as exc:
        logger.warning(
            "oshi_members_unavailable", service=service, error_type=type(exc).__name__
        )
        return {}
    if members:
        _members_cache[service] = (time.monotonic() + _MEMBERS_TTL_SECONDS, members)
    return members


async def oshi_names(service: str) -> set[str]:
    """Normalized names of the oshi members for ``service``."""
    config = await load_config()
    ids = (config.get("oshi_members") or {}).get(service) or []
    if not ids:
        logger.info("oshi_names_empty", service=service)
        return set()
    members = await _blog_members(service)
    names: set[str] = set()
    unresolved = 0
    for member_id in ids:
        name = members.get(member_id)
        if name:
            names.add(normalize_member_name(name))
        else:
            unresolved += 1
    if unresolved:
        logger.info("oshi_unresolved", service=service, count=unresolved)
    return names
