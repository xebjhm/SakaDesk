"""
Version Check API for HakoDesk.
Checks GitHub releases for updates with caching to respect rate limits.
"""
import httpx
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/version", tags=["version"])

# Current app version - should match pyproject.toml
APP_VERSION = "0.1.0"

# GitHub API settings
GITHUB_REPO = "xtorker/HakoDesk"
GITHUB_API_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"

# Cache settings - check at most once per hour
CACHE_DURATION = timedelta(hours=1)

# DEV MODE: Set to True to simulate an update being available
DEV_FAKE_UPDATE = False

# In-memory cache
_cache: dict = {
    "last_check": None,
    "latest_version": None,
    "release_url": None,
    "release_notes": None,
    "error": None,
}


class VersionInfo(BaseModel):
    """Current and latest version information."""
    current_version: str
    latest_version: Optional[str] = None
    update_available: bool = False
    release_url: Optional[str] = None
    release_notes: Optional[str] = None
    last_checked: Optional[str] = None
    error: Optional[str] = None


def _parse_version(version_str: str) -> tuple:
    """Parse version string like 'v0.1.0' or '0.1.0' into tuple for comparison."""
    # Remove 'v' prefix if present
    v = version_str.lstrip('v')
    try:
        parts = v.split('.')
        return tuple(int(p) for p in parts[:3])
    except (ValueError, IndexError):
        return (0, 0, 0)


def _is_newer(latest: str, current: str) -> bool:
    """Check if latest version is newer than current."""
    return _parse_version(latest) > _parse_version(current)


async def _fetch_latest_release() -> dict:
    """Fetch latest release from GitHub API."""
    global _cache

    now = datetime.now(timezone.utc)

    # Check cache first
    if _cache["last_check"]:
        cache_age = now - _cache["last_check"]
        if cache_age < CACHE_DURATION:
            return _cache

    # Fetch from GitHub
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                GITHUB_API_URL,
                headers={
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": f"HakoDesk/{APP_VERSION}"
                }
            )

            if response.status_code == 200:
                data = response.json()
                _cache["latest_version"] = data.get("tag_name", "").lstrip('v')
                _cache["release_url"] = data.get("html_url")
                _cache["release_notes"] = data.get("body", "")[:500]  # Truncate
                _cache["error"] = None
            elif response.status_code == 404:
                _cache["error"] = "No releases found"
            elif response.status_code == 403:
                _cache["error"] = "Rate limited - try again later"
            else:
                _cache["error"] = f"GitHub API error: {response.status_code}"

    except httpx.TimeoutException:
        _cache["error"] = "Request timed out"
    except Exception as e:
        _cache["error"] = f"Failed to check: {str(e)}"

    _cache["last_check"] = now
    return _cache


@router.get("", response_model=VersionInfo)
async def check_version():
    """Check for updates from GitHub releases."""
    # DEV MODE: Return fake update for UI testing
    if DEV_FAKE_UPDATE:
        return VersionInfo(
            current_version=APP_VERSION,
            latest_version="0.2.0",
            update_available=True,
            release_url="https://github.com/xtorker/HakoDesk/releases/tag/v0.2.0",
            release_notes="This is a fake update for testing the UI flow.\n\n- New feature 1\n- Bug fix 2\n- Improvement 3",
            last_checked=datetime.now(timezone.utc).isoformat(),
            error=None,
        )

    cache = await _fetch_latest_release()

    update_available = False
    if cache["latest_version"] and not cache["error"]:
        update_available = _is_newer(cache["latest_version"], APP_VERSION)

    return VersionInfo(
        current_version=APP_VERSION,
        latest_version=cache["latest_version"],
        update_available=update_available,
        release_url=cache["release_url"],
        release_notes=cache["release_notes"],
        last_checked=cache["last_check"].isoformat() if cache["last_check"] else None,
        error=cache["error"],
    )


@router.get("/current")
async def get_current_version():
    """Get current app version without checking for updates."""
    return {"version": APP_VERSION}
