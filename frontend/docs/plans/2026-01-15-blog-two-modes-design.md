# Blog Two-Mode Design for HakoDesk GUI

**Date:** 2026-01-15
**Status:** Approved
**Author:** Claude Code

## Overview

HakoDesk GUI supports two independent blog modes that users can switch between. This is separate from the CLI's `--blog` flag which always does full backup.

## Two Modes

### Mode 1: Browse (Default)

- **Blog List**: Metadata (title, date, thumbnail) synced to `index.json` during main sync
- **Blog Content**: Fetched on-demand when user clicks a blog entry
- **Images**: Stay as URLs (not downloaded)
- **Offline Reading**: No - requires internet to view blog content
- **Use Case**: Quick browsing, minimal disk space

### Mode 2: Full Backup

- **Blog List**: Metadata synced to `index.json` during main sync
- **Blog Content**: Downloaded to disk during sync
- **Images**: Downloaded locally to `images/` folder
- **Offline Reading**: Yes - everything available offline
- **Use Case**: Archival, offline access

## Storage Structure

```
output/{ServiceName}/blogs/
├── index.json                    # Blog metadata index (both modes)
└── {MemberName}/
    └── {YYYYMMDD}_{BlogID}/
        ├── blog.json             # Full content (Mode 2 only, or on-demand cache)
        └── images/               # Downloaded images (Mode 2 only)
            ├── img_0.jpg
            └── img_1.jpg
```

## Mode Selection UI

### 1. Settings Page
Add setting: `blog_sync_mode: "browse" | "full_backup"`
- Default: `"browse"`
- Label: "Blog Sync Mode"
- Options: "Browse (on-demand)" / "Full Backup (offline)"

### 2. First Sync Dialog
When user starts their first sync, show option:
- Checkbox or radio: "Download blogs for offline reading"
- This overrides the default setting for that sync

## Backend Changes

### Settings API
Add `blog_sync_mode` to app settings:
```python
class AppSettings:
    blog_sync_mode: str = "browse"  # "browse" or "full_backup"
```

### Sync Service
Modify Phase 5 (Blog Sync) to check mode:
```python
if settings.blog_sync_mode == "full_backup":
    # Download full content + images
    await blog_service.sync_full_backup(service, progress_callback)
else:
    # Just sync metadata to index
    await blog_service.sync_blog_metadata(service, progress_callback)
```

### Blog Service
Add new method for full backup:
```python
async def sync_full_backup(self, service: str, progress_callback=None):
    """Full backup: metadata + content + images to disk."""
    # 1. Sync metadata to index
    await self.sync_blog_metadata(service, progress_callback)

    # 2. For each blog in index, download content if not cached
    # 3. Download images to local folder
```

## Frontend Changes

### Settings Modal
Add dropdown/toggle for blog sync mode.

### Sync Modal (First Sync)
Add option to choose blog mode before starting sync.

### BlogsFeature Component
No changes needed - already shows from index and fetches content on-demand.
The `cached` field in BlogMeta indicates if content is available offline.

## API Response

BlogMeta already has `cached: boolean` field:
- `true`: Content available locally (can read offline)
- `false`: Content will be fetched on-demand

## Implementation Priority

1. Backend: Add `blog_sync_mode` to settings
2. Backend: Implement `sync_full_backup()` method
3. Backend: Modify sync Phase 5 to check mode
4. Frontend: Add setting to Settings modal
5. Frontend: Add option to first-sync flow
