# Member Favorites Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add favorites system allowing users to follow members and filter recent posts feed.

**Architecture:** Zustand store holds per-service favorites (member IDs). MemberSelectGrid gets a mode toggle that reveals heart icons. Backend filters posts by member_ids when provided.

**Tech Stack:** React, Zustand, FastAPI, TypeScript

---

## Task 1: Add Favorites State to Zustand Store

**Files:**
- Modify: `frontend/src/stores/appStore.ts`

**Step 1: Add favorites state and actions to AppState interface**

Add after line 20 (after `getFeatureOrder`):

```typescript
    // Member favorites (per service)
    favorites: Record<string, string[]>;
    toggleFavorite: (serviceId: string, memberId: string) => void;
    getFavorites: (serviceId: string) => string[];
    isFavorite: (serviceId: string, memberId: string) => boolean;
```

**Step 2: Add favorites implementation to store**

Add after line 43 (after `getFeatureOrder` implementation), before the closing `})`):

```typescript
            favorites: {},
            toggleFavorite: (serviceId, memberId) =>
                set((state) => {
                    const current = state.favorites[serviceId] || [];
                    const newFavorites = current.includes(memberId)
                        ? current.filter((id) => id !== memberId)
                        : [...current, memberId];
                    return {
                        favorites: { ...state.favorites, [serviceId]: newFavorites },
                    };
                }),
            getFavorites: (serviceId) => get().favorites[serviceId] || [],
            isFavorite: (serviceId, memberId) =>
                (get().favorites[serviceId] || []).includes(memberId),
```

**Step 3: Add favorites to persist partialize**

Update the partialize function (around line 47) to include favorites:

```typescript
            partialize: (state) => ({
                activeService: state.activeService,
                activeFeatures: state.activeFeatures,
                featureOrders: state.featureOrders,
                favorites: state.favorites,
            }),
```

**Step 4: Verify build passes**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors

**Step 5: Commit**

```bash
git add frontend/src/stores/appStore.ts
git commit -m "feat(store): add per-service member favorites state

- Add favorites Record<serviceId, memberId[]> to store
- Add toggleFavorite, getFavorites, isFavorite actions
- Persist favorites to localStorage

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add member_ids Parameter to Backend API

**Files:**
- Modify: `backend/api/blogs.py`
- Modify: `backend/services/blog_service.py`

**Step 1: Update API endpoint to accept member_ids**

In `backend/api/blogs.py`, update the `get_recent_posts` function (line 58-71):

```python
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
        member_id_list = member_ids.split(",") if member_ids else None
        posts = await blog_service.get_recent_posts(service, limit, member_id_list)
        return RecentPostsResponse(service=service, posts=posts)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

**Step 2: Update blog_service to filter by member_ids**

In `backend/services/blog_service.py`, update the `get_recent_posts` method signature and implementation (around line 457):

```python
    async def get_recent_posts(self, service: str, limit: int = 20, member_ids: list[str] | None = None) -> list[dict]:
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

        for member_id, member_data in index.get("members", {}).items():
            # Skip if filtering and member not in list
            if member_ids and member_id not in member_ids:
                continue

            member_name = member_data.get("name", "")
            for blog in member_data.get("blogs", []):
                all_posts.append({
                    "id": blog["id"],
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
```

**Step 3: Verify backend starts without errors**

Run: `cd backend && python -c "from api.blogs import router; print('OK')"`
Expected: Prints "OK" without import errors

**Step 4: Commit**

```bash
git add backend/api/blogs.py backend/services/blog_service.py
git commit -m "feat(api): add member_ids filter to recent posts endpoint

- Accept comma-separated member_ids query param
- Filter posts at service layer for efficiency
- Returns up to limit posts from specified members only

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Update Frontend API to Support member_ids

**Files:**
- Modify: `frontend/src/api/blogs.ts`

**Step 1: Update getRecentPosts function**

Replace the existing function (lines 6-16):

```typescript
export async function getRecentPosts(
    service: string,
    limit: number = 20,
    memberIds?: string[]
): Promise<RecentPostsResponse> {
    const params = new URLSearchParams({
        service,
        limit: limit.toString(),
    });
    if (memberIds && memberIds.length > 0) {
        params.set('member_ids', memberIds.join(','));
    }
    const res = await fetch(`${API_BASE}/recent?${params}`);
    if (!res.ok) {
        throw new Error(`Failed to fetch recent posts: ${res.status}`);
    }
    return res.json();
}
```

**Step 2: Verify build passes**

Run: `cd frontend && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add frontend/src/api/blogs.ts
git commit -m "feat(api): add memberIds param to getRecentPosts

Support filtering recent posts by member IDs on the client.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Add Mode Toggle to MemberSelectGrid

**Files:**
- Modify: `frontend/src/components/features/blogs/MemberSelectGrid.tsx`

**Step 1: Add mode state and props**

Add after line 13 (after the interface):

```typescript
type SelectionMode = 'everyone' | 'following';
```

Update the interface to add new props (replace existing interface):

```typescript
interface MemberSelectGridProps {
    members: BlogMember[];
    loading: boolean;
    error: string | null;
    onBack: () => void;
    onSelectMember: (member: BlogMember) => void;
    onRetry: () => void;
    // New props for favorites
    serviceId: string;
    favorites: string[];
    onToggleFavorite: (memberId: string) => void;
}
```

**Step 2: Add mode state inside component**

Add after line 27 (after `hoveredMember` state):

```typescript
    const [selectionMode, setSelectionMode] = useState<SelectionMode>('everyone');
```

**Step 3: Add mode toggle UI in header**

Insert the toggle between the title div and search input (around line 121, after the title `</div>` and before the search `<div className="relative">`):

```tsx
                    {/* Mode Toggle */}
                    <div className="flex items-center gap-1 bg-gray-100/80 rounded-full p-1">
                        <button
                            onClick={() => setSelectionMode('everyone')}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
                                selectionMode === 'everyone'
                                    ? 'bg-white text-gray-800 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            Everyone
                        </button>
                        <button
                            onClick={() => setSelectionMode('following')}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
                                selectionMode === 'following'
                                    ? 'bg-white text-gray-800 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            Following
                        </button>
                    </div>
```

**Step 4: Verify build passes**

Run: `cd frontend && npm run build`
Expected: Build succeeds (will have unused prop warnings, that's OK for now)

**Step 5: Commit**

```bash
git add frontend/src/components/features/blogs/MemberSelectGrid.tsx
git commit -m "feat(ui): add Everyone/Following mode toggle to member grid

- Add SelectionMode type and state
- Add toggle UI in header with pill-button design
- Props ready for favorites integration

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Add Heart Icon to Member Cards

**Files:**
- Modify: `frontend/src/components/features/blogs/MemberSelectGrid.tsx`

**Step 1: Add heart icon component inside the card**

Find the member card button (around line 232-333). Add the heart icon after the generation badge div and before the closing `</div>` of the Polaroid Card (around line 331, just before `</button>`):

```tsx
                                        {/* Favorite Heart - Only visible in Following mode */}
                                        {selectionMode === 'following' && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onToggleFavorite(member.id);
                                                }}
                                                className="absolute top-3 right-3 p-1 rounded-full transition-all duration-200 hover:scale-110 z-10"
                                                style={{
                                                    background: favorites.includes(member.id)
                                                        ? `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`
                                                        : 'rgba(255, 255, 255, 0.9)',
                                                    boxShadow: favorites.includes(member.id)
                                                        ? `0 2px 8px ${colors[0]}40`
                                                        : '0 2px 6px rgba(0, 0, 0, 0.1)',
                                                }}
                                            >
                                                <svg
                                                    className="w-4 h-4"
                                                    fill={favorites.includes(member.id) ? 'white' : 'none'}
                                                    stroke={favorites.includes(member.id) ? 'white' : colors[0]}
                                                    strokeWidth={2}
                                                    viewBox="0 0 24 24"
                                                >
                                                    <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                                                    />
                                                </svg>
                                            </button>
                                        )}
```

**Step 2: Move generation badge to only show in 'everyone' mode**

Find the Generation Badge div (around line 301-312) and wrap it with a condition:

```tsx
                                        {/* Generation Badge - Only in Everyone mode */}
                                        {selectionMode === 'everyone' && (
                                            <div
                                                className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider uppercase transition-all duration-300"
                                                style={{
                                                    background: isHovered
                                                        ? `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`
                                                        : 'rgba(0, 0, 0, 0.05)',
                                                    color: isHovered ? 'white' : '#999',
                                                }}
                                            >
                                                {member.generation}
                                            </div>
                                        )}
```

**Step 3: Verify build passes**

Run: `cd frontend && npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add frontend/src/components/features/blogs/MemberSelectGrid.tsx
git commit -m "feat(ui): add heart icon for favorites on member cards

- Heart appears only in Following mode
- Uses member penlight colors when favorited
- Generation badge hidden in Following mode
- Click heart toggles favorite (doesn't navigate)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Wire Up MemberSelectGrid in BlogsFeature

**Files:**
- Modify: `frontend/src/components/features/BlogsFeature.tsx`

**Step 1: Import and use favorites from store**

Add to the existing useAppStore destructure (around line 19):

```typescript
    const { activeService } = useAppStore();
    const favorites = useAppStore((state) => state.favorites[activeService ?? ''] ?? []);
    const toggleFavorite = useAppStore((state) => state.toggleFavorite);
```

**Step 2: Update MemberSelectGrid props**

Find the MemberSelectGrid usage (around line 243-252) and add the new props:

```tsx
            {viewState.view === 'members' && (
                <MemberSelectGrid
                    members={members}
                    loading={loading}
                    error={error}
                    onBack={() => setViewState({ view: 'recent' })}
                    onSelectMember={(member) => setViewState({ view: 'timeline', member })}
                    onRetry={handleRetry}
                    serviceId={activeService ?? ''}
                    favorites={favorites}
                    onToggleFavorite={(memberId) => activeService && toggleFavorite(activeService, memberId)}
                />
            )}
```

**Step 3: Update recent posts fetch to use favorites**

Find the useEffect that fetches recent posts (around line 46-56) and update it:

```typescript
    // Load recent posts when in recent view
    useEffect(() => {
        if (viewState.view !== 'recent' || !activeService) return;

        setLoading(true);
        setError(null);
        getRecentPosts(activeService, 20, favorites.length > 0 ? favorites : undefined)
            .then(res => setRecentPosts(res.posts))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, [viewState.view, activeService, favorites]);
```

**Step 4: Verify build passes**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors

**Step 5: Commit**

```bash
git add frontend/src/components/features/BlogsFeature.tsx
git commit -m "feat(blogs): wire up favorites to member grid and feed

- Pass favorites state to MemberSelectGrid
- Filter recent posts API call by favorites when set
- Re-fetch posts when favorites change

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Final Build Verification and Manual Test

**Step 1: Full rebuild**

Run: `cd frontend && npm run build`
Expected: Build succeeds

**Step 2: Start the app and manual test**

Run: `cd frontend && npm run dev` (in one terminal)
Run: `cd backend && uvicorn main:app --reload` (in another terminal)

Manual test checklist:
- [ ] Navigate to Blogs feature
- [ ] Click "Members" button to open member grid
- [ ] Toggle shows "Everyone" and "Following"
- [ ] In "Everyone" mode: generation badge visible, no heart, click card navigates
- [ ] Switch to "Following" mode: hearts appear, generation badge hidden
- [ ] Click heart: fills with member color, click again unfills
- [ ] Click card body in Following mode: still navigates to timeline
- [ ] Go back to recent posts: should show all posts (no favorites set)
- [ ] Set some favorites, go to recent posts: only shows posts from favorites
- [ ] Refresh page: favorites persist

**Step 3: Final commit if any fixes needed**

If any fixes were made during manual testing, commit them.

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add favorites to Zustand store | appStore.ts |
| 2 | Add member_ids filter to backend | blogs.py, blog_service.py |
| 3 | Update frontend API | blogs.ts |
| 4 | Add mode toggle to grid | MemberSelectGrid.tsx |
| 5 | Add heart icon to cards | MemberSelectGrid.tsx |
| 6 | Wire up in BlogsFeature | BlogsFeature.tsx |
| 7 | Build verification | - |
