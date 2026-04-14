# Blog Photo Gallery — Design Spec

## Overview

A photo gallery for blog content, accessed from `MemberTimelineModal`, that lets users quickly skim through all inline photos a member has posted in their blogs. Clicking a photo opens the same `MediaViewerModal` used for message media, extended with a source-agnostic "jump to source" label.

Requires full blog backup to be enabled — images are read exclusively from local cache.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Entry point | `MemberTimelineModal` button | Blogs are browsed per-member here already |
| Image scope | Inline images only (`BlogContentResponse.images[]`) | Thumbnails are generic/repeated; inline images are the real content |
| Grid organization | Flat by month (identical to message gallery) | Even visual density; blog post context deferred to viewer |
| Blog post context | Source label in `MediaViewerModal` only | No hover overlays in the grid; clean uniform grid |
| Photo viewer | Extend existing `MediaViewerModal` | Source-agnostic `sourceLabel` + `onSourceJump` benefits both blog and message photos |
| Data source gate | `blogs_full_backup` setting | No network fetching; local cache only |
| Data lifecycle | Build `BlogPhotoItem[]` on gallery open, hold in component state | Simple; store-level caching is a future optimization |
| Calendar | Identical to message gallery — daily granularity with dots | Reuse `CalendarModal` component |
| Modal type | New `BlogPhotoGalleryModal` (separate from message gallery) | Different data source, different entry point, clean boundaries |
| Naming | `BlogPhotoGalleryModal` | Only photos, not videos/voice |

## Data Model

### BlogPhotoItem

Internal type used within `BlogPhotoGalleryModal`:

```typescript
interface BlogPhotoItem {
  src: string;           // local media URL from cached local_path
  blogId: string;        // which blog post this came from
  blogTitle: string;     // for the source label in viewer
  publishedAt: string;   // ISO datetime from parent blog, used for monthly grouping + calendar
  imageIndex: number;    // position within blog's images[], preserves original order
}
```

### MediaViewerItem extensions

Two new optional fields added to the existing interface:

```typescript
// Added to existing MediaViewerItem in PhotoDetailModal.tsx
sourceLabel?: string;      // e.g. blog post title or message preview text
onSourceJump?: () => void; // called when the label is clicked
```

When both are present, the label renders as a clickable link in the viewer. When absent, no change to current behavior (backward compatible).

## Data Flow

1. User opens `BlogPhotoGalleryModal` from `MemberTimelineModal`
2. Check `appSettings.blogs_full_backup`:
   - If **off**: render empty state explaining backup is required, with guidance to enable it
   - If **on**: proceed to step 3
3. Fetch member's blog list (already cached if timeline was browsed)
4. For each blog with `cached: true`, read cached blog content (local disk, no network)
5. Extract `images[]` entries that have a `local_path`
6. Build flat `BlogPhotoItem[]` array, sorted by `publishedAt` descending, then by `imageIndex` ascending within the same blog
7. This flat array is the single source of truth for:
   - **Grid rendering**: grouped into monthly sections for display
   - **Viewer navigation**: arrow keys walk this array by index
   - **Calendar dots**: extract unique dates to mark on the calendar
8. Hold in component state; discard blog HTML content after extraction

## UI Behavior

### Gallery Modal

- **Layout**: 4-column grid, 0.5px gap — identical to `MediaGalleryModal`
- **Grouping**: Monthly sections with year-month headers, newest first
- **Calendar jump**: Reuse `CalendarModal`. Daily granularity. Dots on dates that have photos. Clicking a date scrolls to that position in the grid.
- **Loading state**: Spinner while extracting images from cached blogs
- **Empty states**:
  - Backup not enabled: explanation message with guidance to enable in settings
  - No photos found: standard empty state (backup is on but no inline images exist)

### Photo Viewer

- Opens `MediaViewerModal` with all `BlogPhotoItem[]` mapped to `MediaViewerItem[]`
- Arrow keys navigate the full serialized photo array
- Zoom (up/down arrows) works as usual for photos
- Blog post title displayed as a clickable source label
- Clicking the label ("jump to post"): closes viewer, closes gallery, opens the blog post in `BlogReader`

### Source Label for Messages (bonus)

The `sourceLabel`/`onSourceJump` extension also benefits the message media gallery:
- Message photos get a source label (message preview/timestamp)
- Clicking jumps to that message in the conversation
- Same UI pattern, source-agnostic

## Component Changes

### New files

| File | Purpose |
|------|---------|
| `frontend/src/features/blogs/components/BlogPhotoGalleryModal.tsx` | Blog photo gallery modal component |

### Modified files

| File | Change |
|------|--------|
| `frontend/src/core/media/PhotoDetailModal.tsx` | Add `sourceLabel?` and `onSourceJump?` to `MediaViewerItem`; render clickable label in viewer |
| `frontend/src/features/blogs/components/MemberTimelineModal.tsx` | Add photo gallery button to open `BlogPhotoGalleryModal` |
| `frontend/src/features/messages/components/ConversationMenu.tsx` | Wire up `sourceLabel`/`onSourceJump` for message photos (if feasible in same scope) |
| `frontend/src/i18n/locales/*.json` | Add i18n keys for gallery button, empty states, loading text |

### Not in scope

- Pre-caching / store-level caching of `BlogPhotoItem[]`
- Video or voice content from blogs
- New backend API endpoints
- Thumbnail display in the gallery
