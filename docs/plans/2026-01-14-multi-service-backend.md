# Multi-Service Backend Design

> **Created:** 2026-01-14
> **Status:** Design Complete, Ready for Implementation
> **Related:** [2026-01-14-multi-service-ui.md](2026-01-14-multi-service-ui.md) (Frontend Architecture - Complete)

## Overview

This document describes the backend changes needed to support multiple services (Hinatazaka46, Nogizaka46, Sakurazaka46) in HakoDesk, along with the blogs feature integration.

### Goals

1. **Multi-Service Auth** - Separate login per service, shared OAuth flow
2. **Multi-Service Sync** - Sync runs per-service, separate state tracking
3. **Blogs Feature** - Metadata sync + on-demand content with optional full backup
4. **API Migration** - Move from path-based to param-based content endpoints

---

## Architecture

### Settings Structure

Separate global app settings from per-service settings (like Discord's server vs app settings):

```json
{
  "global": {
    "theme": "dark",
    "language": "en",
    "notifications_enabled": true,
    "update_channel": "stable"
  },
  "services": {
    "hinatazaka46": {
      "sync_enabled": true,
      "adaptive_sync_enabled": true,
      "last_sync": "2026-01-14T10:00:00Z",
      "blogs_full_backup": false
    },
    "nogizaka46": {
      "sync_enabled": true,
      "adaptive_sync_enabled": true,
      "last_sync": null,
      "blogs_full_backup": false
    },
    "sakurazaka46": {
      "sync_enabled": false,
      "adaptive_sync_enabled": true,
      "last_sync": null,
      "blogs_full_backup": false
    }
  }
}
```

### Credential Storage

Already works per-service via PyHako's `TokenManager.load_session(group_name)`. No changes needed.

### Disk Structure

```
{output_dir}/
├── sync_metadata.json
├── sync_state.json
└── {service_display_name}/          # e.g., "日向坂46"
    ├── messages/
    │   ├── {talk_room_id} {name}/   # e.g., "40 松田 好花"
    │   │   └── {member_id} {name}/  # e.g., "64 松田 好花"
    │   │       ├── messages.json
    │   │       └── picture/, video/, voice/
    │   └── {talk_room_id} {name}/   # e.g., "78 日向坂46 四期生ライブ"
    │       ├── {member_id} {name}/  # Multiple members in group events
    │       └── ...
    └── blogs/
        ├── index.json               # Metadata for all blogs (always synced)
        └── {member_name}/
            └── {YYYYMMDD}_{blog_id}/
                ├── blog.json        # Full content (cached or full backup)
                └── images/
```

**Key concepts:**
- **talk_room_id** = chat room identifier (first number in folder name)
- **member_id** = person identifier, globally unique across all talk rooms
- Same member_id can appear in multiple talk rooms (individual + group events)

---

## API Design

### Auth API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/auth/status` | Returns auth status for ALL services |
| `POST /api/auth/login?service=hinatazaka46` | Login to specific service |
| `POST /api/auth/logout?service=hinatazaka46` | Logout from specific service |
| `POST /api/auth/refresh-if-needed?service=hinatazaka46` | Refresh token for specific service |

**Response for `GET /api/auth/status`:**
```json
{
  "services": {
    "hinatazaka46": {
      "authenticated": true,
      "expires_at": "2026-01-15T10:00:00Z",
      "display_name": "日向坂46"
    },
    "nogizaka46": {
      "authenticated": false,
      "expires_at": null,
      "display_name": "乃木坂46"
    },
    "sakurazaka46": {
      "authenticated": false,
      "expires_at": null,
      "display_name": "櫻坂46"
    }
  }
}
```

### Sync API

| Endpoint | Purpose |
|----------|---------|
| `POST /api/sync/start?service=hinatazaka46` | Start sync for specific service |
| `POST /api/sync/start` (no param) | Start sync for ALL authenticated services |
| `GET /api/sync/progress` | Returns progress for ALL services |
| `GET /api/sync/progress?service=hinatazaka46` | Progress for specific service |

**Response for `GET /api/sync/progress`:**
```json
{
  "services": {
    "hinatazaka46": {
      "status": "syncing",
      "phase": 2,
      "phase_name": "Downloading media",
      "progress": 45,
      "current_member": "Member Name",
      "last_sync": "2026-01-14T08:00:00Z"
    },
    "nogizaka46": {
      "status": "idle",
      "phase": null,
      "phase_name": null,
      "progress": 100,
      "current_member": null,
      "last_sync": "2026-01-14T09:30:00Z"
    },
    "sakurazaka46": {
      "status": "not_authenticated",
      "phase": null,
      "phase_name": null,
      "progress": null,
      "current_member": null,
      "last_sync": null
    }
  }
}
```

### Content API (Param-based - New)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/content/talk_rooms?service=hinatazaka46` | List all talk rooms |
| `GET /api/content/members?service=hinatazaka46&talk_room_id=78` | List members in a talk room |
| `GET /api/content/messages?service=hinatazaka46&talk_room_id=40&member_id=64` | Messages for a member |
| `GET /api/content/talk_room_messages?service=hinatazaka46&talk_room_id=78` | Merged messages for group talk room |
| `GET /api/content/media?service=hinatazaka46&talk_room_id=40&member_id=64&type=picture&file=xxx.jpg` | Media file |

**Response for `GET /api/content/talk_rooms?service=hinatazaka46`:**
```json
{
  "service": "hinatazaka46",
  "talk_rooms": [
    {
      "id": 40,
      "name": "松田 好花",
      "type": "individual",
      "member_count": 1
    },
    {
      "id": 78,
      "name": "日向坂46 四期生ライブ",
      "type": "group_event",
      "member_count": 11
    }
  ]
}
```

### Content API (Path-based - Deprecated)

These endpoints remain functional during migration but are deprecated:

- `GET /api/content/messages_by_path?path=...`
- `GET /api/content/group_messages/{path}`
- `GET /api/content/media/{file_path}`

**TODO:** Remove deprecated path-based endpoints after frontend migration complete.

### Blogs API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/blogs/members?service=hinatazaka46` | List members who have blogs |
| `GET /api/blogs/list?service=hinatazaka46&member_id=42` | Blog metadata list for a member (from disk) |
| `GET /api/blogs/content?service=hinatazaka46&blog_id=12345` | Full blog content (from cache or fetch on-demand) |
| `DELETE /api/blogs/cache?service=hinatazaka46` | Clear blog cache for a service |
| `GET /api/blogs/cache-size?service=hinatazaka46` | Get cache size for settings UI |

**Response for `GET /api/blogs/list`:**
```json
{
  "member_id": "42",
  "member_name": "Member Name",
  "blogs": [
    {
      "id": "12345",
      "title": "Blog Title",
      "published_at": "2026-01-14T12:00:00+09:00",
      "url": "https://...",
      "thumbnail": "https://...",
      "cached": true
    },
    {
      "id": "12344",
      "title": "Another Blog",
      "published_at": "2026-01-13T18:00:00+09:00",
      "url": "https://...",
      "thumbnail": "https://...",
      "cached": false
    }
  ]
}
```

**Response for `GET /api/blogs/content`:**
```json
{
  "meta": {
    "id": "12345",
    "member_id": "42",
    "member_name": "Member Name",
    "title": "Blog Title",
    "published_at": "2026-01-14T12:00:00+09:00",
    "url": "https://..."
  },
  "content": {
    "html": "<p>Blog content...</p>"
  },
  "images": [
    {
      "original_url": "https://...",
      "local_path": "/api/blogs/media/hinatazaka46/member/12345/img_0.jpg"
    }
  ]
}
```

---

## Blogs Feature Design

### Storage Strategy: Metadata Sync + On-Demand with Optional Full Backup

**Default Mode (Metadata Only):**
- Sync blog list/metadata for all members (titles, dates, thumbnails, URLs)
- Estimate: 1-5MB per service instead of 15GB+
- User can browse blog list instantly
- Clicking a blog → fetch content on-demand → cache locally
- Cached blogs persist (re-reading is instant)
- Cache grows unbounded; user can clear via settings

**Optional Full Backup Mode (per-service toggle):**
- Setting: `blogs_full_backup: true`
- When enabled, sync downloads full content + images
- For users who want archival or plan to use future AI features
- Warning about storage requirements shown in UI

### Sync Integration

Blog metadata sync added to existing 4-phase sync process:
- Phase 1-4 for messages (unchanged)
- New: Sync blog metadata (always, lightweight)
- If `blogs_full_backup` enabled: Also download blog content

### Core Library Usage

PyHako already has blog scrapers for all three services:
- `pyhako.blog.get_scraper(group, session)` - Factory function
- `scraper.get_members()` - Returns `{member_id: member_name}`
- `scraper.get_blogs(member_id)` - Async generator yielding `BlogEntry`
- `scraper.get_blog_detail(blog_id)` - Fetch full content

Different scraping methods per service (abstracted by common interface):
- Hinatazaka: HTML scraping
- Nogizaka: JSONP API
- Sakurazaka: HTML scraping

---

## Backend Changes Required

### AuthService Refactor

Current (hardcoded):
```python
class AuthService:
    def __init__(self):
        self._group = Group.HINATAZAKA46  # HARDCODED!
```

New (parameterized):
```python
class AuthService:
    def get_status(self, service: str = None) -> dict:
        """Get auth status for one or all services."""

    async def login(self, service: str) -> dict:
        """Login to specific service."""

    async def logout(self, service: str) -> dict:
        """Logout from specific service."""

    async def refresh_if_needed(self, service: str) -> dict:
        """Refresh token for specific service."""
```

### SyncService Refactor

Current (hardcoded):
```python
class SyncService:
    def __init__(self):
        self._group = Group.HINATAZAKA46  # HARDCODED!
```

New (parameterized):
```python
class SyncService:
    def __init__(self, service: str):
        self._service = service

class SyncManager:
    """Orchestrates multiple SyncService instances."""

    async def start_sync(self, service: str = None):
        """Start sync for one or all authenticated services."""

    def get_progress(self, service: str = None) -> dict:
        """Get progress for one or all services."""
```

### Path Resolver

Centralize path logic to decouple API from disk structure:

```python
def resolve_content_path(
    service: str,
    talk_room_id: int = None,
    member_id: int = None
) -> Path:
    """Convert API params to disk path."""
    service_name = get_service_display_name(service)  # e.g., "日向坂46"
    base = get_output_dir() / service_name / "messages"

    if talk_room_id:
        # Find folder matching talk_room_id
        talk_room_folder = find_folder_by_id(base, talk_room_id)
        base = base / talk_room_folder

    if member_id:
        # Find folder matching member_id
        member_folder = find_folder_by_id(base, member_id)
        base = base / member_folder

    return base
```

---

## Frontend Changes Summary

### New Components

| Component | Purpose |
|-----------|---------|
| `AddServicePage` | First page on fresh install / when clicking "+" |
| `ServiceLoginCard` | Card for each service showing login button |
| `BlogsFeature` | Blog list and reader view |

### Modified Components

| Component | Change |
|-----------|--------|
| `ServiceRail` | Add "+" icon at bottom to add new service |
| `App.tsx` | Check if any service authenticated, show AddServicePage if none |
| `MessagesFeature` | Update API calls to use param-based endpoints |

### User Flow

1. App starts → calls `GET /api/auth/status`
2. If no services authenticated → show `AddServicePage`
3. User clicks service → login flow → redirects to main app
4. ServiceRail shows authenticated services + "+" button
5. Clicking "+" → shows `AddServicePage` (can add more services)

---

## Implementation Plan

### Phase 1: Backend Multi-Service Foundation
1. Refactor `AuthService` - remove hardcoded group, add service parameter
2. Refactor `SyncService` - same, parameterize by service
3. Update settings structure (global vs per-service)
4. Update auth API endpoints (`/api/auth/status`, `/api/auth/login`, etc.)
5. Update sync API endpoints (`/api/sync/start`, `/api/sync/progress`)

### Phase 2: Content API Migration
6. Add new param-based content endpoints (keep old path-based working)
7. Add `talk_rooms` and `members` list endpoints
8. Update media endpoint to param-based

### Phase 3: Blogs Feature
9. Add blog metadata sync to sync process
10. Create blog index storage (`index.json` per service)
11. Add blogs API endpoints (`/api/blogs/list`, `/api/blogs/content`, etc.)
12. Implement on-demand fetch + caching logic
13. Add `blogs_full_backup` setting per service
14. Add cache clear endpoint and cache size endpoint

### Phase 4: Frontend Updates
15. Create `AddServicePage` component
16. Update `ServiceRail` with "+" button
17. Update `App.tsx` for no-auth-redirect logic
18. Migrate content API calls to param-based
19. Create `BlogsFeature` component

### Future TODO
- Remove deprecated path-based content endpoints after frontend migration

---

## Notes

- All three services use identical OAuth flow (only base URLs differ)
- PyHako core already supports multi-service via `Group` enum
- `TokenManager` already stores credentials per-service
- Blog scrapers use same interface but different implementations per service
