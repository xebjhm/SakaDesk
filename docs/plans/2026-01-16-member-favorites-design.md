# Member Favorites Feature Design

**Date**: 2026-01-16
**Status**: Approved

## Overview

Two features unified in one UI:
1. **Navigation**: Tap member card → go to their blog timeline
2. **Favorites (Following)**: Toggle members to follow, filtering the recent posts feed

## User Flow

```
┌─────────────────────────────────────────────────────────────┐
│  ←  Select Member              [Everyone ○─● Following]  🔍 │
│      30 members                                              │
├─────────────────────────────────────────────────────────────┤
│  [All] [2nd Gen] [3rd Gen] [4th Gen] [5th Gen]              │
└─────────────────────────────────────────────────────────────┘

Mode behaviors:
- Everyone mode: Cards are pure navigation, no heart visible
- Following mode: Heart icon appears on each card
  - Tap heart → toggle favorite (instant save)
  - Tap card body → still navigates to timeline
```

## Data Model

### Zustand Store Addition (`appStore.ts`)

```typescript
interface AppState {
  // ... existing state

  // New: favorites per service
  favorites: { [serviceId: string]: string[] };  // member IDs
}

interface AppActions {
  // ... existing actions

  // New actions
  toggleFavorite: (serviceId: string, memberId: string) => void;
  getFavorites: (serviceId: string) => string[];
  isFavorite: (serviceId: string, memberId: string) => boolean;
}
```

**Persistence**: Uses existing Zustand persist middleware (localStorage).

**Default behavior**: Empty array means "show all" - no favorites = all members' posts shown.

## UI Components

### MemberSelectGrid Changes

**Header modification**:
- Add pill-shaped toggle switch: `Everyone | Following`
- Position: top-right area, before search input
- Toggle uses theme's primary color when in "Following" mode

**Card behavior by mode**:

| Mode | Card tap | Heart icon |
|------|----------|------------|
| Everyone | Navigate to timeline | Hidden |
| Following | Navigate to timeline | Visible, tappable |

**Heart interaction**:
- Position: top-right of card (beside generation badge)
- Outline heart = not following
- Filled heart with subtle glow = following
- Tap heart toggles state (doesn't trigger navigation)
- Uses member's penlight color for filled state

### RecentPostsFeed Changes

**Filter indicator** (when favorites active):
- Small badge in header: "Showing posts from 3 members"
- Optional: "Edit following →" link to navigate to member grid in Following mode

**Empty state**:
- If user follows members but none have recent posts
- Message: "No recent posts from members you follow"

## API Changes

### Backend (`blog_service.py`)

```python
async def get_recent_posts(
    self,
    service: str,
    limit: int = 20,
    member_ids: list[str] | None = None  # NEW parameter
) -> list[dict]:
    """
    Get recent posts across all members (or filtered members).

    Args:
        service: Service name
        limit: Maximum posts to return (default 20)
        member_ids: If provided, only return posts from these members

    Returns:
        List of recent posts with member info
    """
    # SQL WHERE clause adds: AND member_id IN (...)
```

### Backend API (`blogs.py`)

```python
@router.get("/recent")
async def get_recent_posts(
    service: str,
    limit: int = 20,
    member_ids: str | None = None  # Comma-separated IDs
):
    ids = member_ids.split(",") if member_ids else None
    return await blog_service.get_recent_posts(service, limit, ids)
```

### Frontend API (`blogs.ts`)

```typescript
export async function getRecentPosts(
  serviceId: string,
  limit: number = 20,
  memberIds?: string[]
): Promise<RecentPostsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (memberIds?.length) {
    params.set('member_ids', memberIds.join(','));
  }
  // ...
}
```

### Frontend Usage (`BlogsFeature.tsx`)

```typescript
const favorites = useAppStore(state => state.favorites[activeService] ?? []);

useEffect(() => {
  if (viewState.view !== 'recent' || !activeService) return;

  getRecentPosts(
    activeService,
    20,
    favorites.length > 0 ? favorites : undefined
  )
    .then(res => setRecentPosts(res.posts))
    // ...
}, [viewState.view, activeService, favorites]);
```

## Files to Modify

1. **`frontend/src/stores/appStore.ts`**
   - Add `favorites` state
   - Add `toggleFavorite`, `getFavorites`, `isFavorite` actions

2. **`frontend/src/api/blogs.ts`**
   - Add `memberIds` parameter to `getRecentPosts`

3. **`frontend/src/components/features/blogs/MemberSelectGrid.tsx`**
   - Add Everyone/Following toggle
   - Add heart icon to cards (visible in Following mode)
   - Wire up toggle and heart interactions

4. **`frontend/src/components/features/BlogsFeature.tsx`**
   - Read favorites from store
   - Pass favorites to API call
   - Pass props to MemberSelectGrid

5. **`backend/api/blogs.py`**
   - Accept `member_ids` query parameter

6. **`backend/services/blog_service.py`**
   - Add member filtering to `get_recent_posts` query

## Design Decisions

- **Toggle labels**: "Everyone / Following" - familiar social media terminology
- **Heart color**: Uses member's penlight color for personal touch
- **Pre-filtering**: Filter at API level to always return full limit (20 posts)
- **Per-service favorites**: Each group has independent favorites list
- **Instant save**: Heart toggles save immediately (no confirm button needed)
