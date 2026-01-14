# P3.14 Official Blogs Support - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add blog reading feature to HakoDesk, allowing users to browse and read official blog posts from Sakamichi group members.

**Architecture:** Backend blog API proxies PyHako's blog scraper module. Frontend implements BlogsFeature component in Zone C with member list → blog list → reader navigation. Data is fetched live (not synced/cached like messages).

**Tech Stack:** FastAPI (backend), aiohttp (blog scraping), React + TypeScript + Tailwind (frontend), PyHako blog module (data source), DOMPurify (HTML sanitization)

---

## Prerequisites

- UI Architecture from `2026-01-14-ui-architecture-design.md` must be implemented first
- FeatureRail (Zone B) must exist and support feature switching
- PyHako blog module is already implemented (`pyhako.blog`)

---

## Task 1: Backend Blog API - Types and Setup

**Files:**
- Create: `backend/api/blogs.py`
- Modify: `backend/main.py` (add router)

**Step 1: Create blog API module with types**

```python
# backend/api/blogs.py
"""Blog API for HakoDesk - fetches blogs from official sites via PyHako."""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from datetime import datetime
from typing import Optional
import structlog
import aiohttp

router = APIRouter()
logger = structlog.get_logger(__name__)


class BlogMember(BaseModel):
    """A member who has a blog."""
    id: str
    name: str


class BlogEntry(BaseModel):
    """A single blog post."""
    id: str
    title: str
    content: str
    published_at: datetime
    url: str
    images: list[str]
    member_id: str
    member_name: str


class BlogListResponse(BaseModel):
    """Response for blog list endpoint."""
    entries: list[BlogEntry]
    has_more: bool
```

**Step 2: Register router in main.py**

Add to `backend/main.py`:
```python
from backend.api.blogs import router as blogs_router
app.include_router(blogs_router, prefix="/api/blogs", tags=["blogs"])
```

**Step 3: Verify server starts**

Run: `cd HakoDesk && python -m backend.main`
Expected: Server starts without import errors

**Step 4: Commit**

```bash
git add backend/api/blogs.py backend/main.py
git commit -m "feat(blogs): add blog API module skeleton"
```

---

## Task 2: Backend Blog API - Get Members Endpoint

**Files:**
- Modify: `backend/api/blogs.py`

**Step 1: Implement get_blog_members endpoint**

Add to `backend/api/blogs.py`:
```python
from pyhako.client import Group
from pyhako.blog import get_scraper


def _parse_group(group_name: str) -> Group:
    """Parse service name to Group enum."""
    name_lower = group_name.lower()
    if "hinata" in name_lower or "日向" in name_lower:
        return Group.HINATAZAKA46
    elif "sakura" in name_lower or "櫻" in name_lower:
        return Group.SAKURAZAKA46
    elif "nogi" in name_lower or "乃木" in name_lower:
        return Group.NOGIZAKA46
    raise ValueError(f"Unknown group: {group_name}")


@router.get("/members")
async def get_blog_members(service: str = Query(..., description="Service name")):
    """Get list of members who have blogs for a service."""
    try:
        group = _parse_group(service)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    async with aiohttp.ClientSession() as session:
        scraper = get_scraper(group, session)
        members_dict = await scraper.get_members()

        members = [
            BlogMember(id=mid, name=name)
            for mid, name in members_dict.items()
        ]
        # Sort by name
        members.sort(key=lambda m: m.name)
        return members
```

**Step 2: Test endpoint manually**

Run: `curl "http://localhost:8000/api/blogs/members?service=Hinatazaka46"`
Expected: JSON array of members with id and name

**Step 3: Commit**

```bash
git add backend/api/blogs.py
git commit -m "feat(blogs): add get_blog_members endpoint"
```

---

## Task 3: Backend Blog API - Get Blogs Endpoint

**Files:**
- Modify: `backend/api/blogs.py`

**Step 1: Implement get_blogs endpoint**

Add to `backend/api/blogs.py`:
```python
@router.get("/entries")
async def get_blog_entries(
    service: str = Query(..., description="Service name"),
    member_id: str = Query(..., description="Member ID"),
    limit: int = Query(20, ge=1, le=100, description="Max entries to return"),
):
    """Get blog entries for a specific member."""
    try:
        group = _parse_group(service)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    async with aiohttp.ClientSession() as session:
        scraper = get_scraper(group, session)

        entries = []
        async for entry in scraper.get_blogs(member_id):
            entries.append(BlogEntry(
                id=entry.id,
                title=entry.title,
                content=entry.content,
                published_at=entry.published_at,
                url=entry.url,
                images=entry.images,
                member_id=entry.member_id,
                member_name=entry.member_name,
            ))
            if len(entries) >= limit:
                break

        return BlogListResponse(
            entries=entries,
            has_more=len(entries) >= limit
        )
```

**Step 2: Test endpoint manually**

Run: `curl "http://localhost:8000/api/blogs/entries?service=Hinatazaka46&member_id=<valid_id>&limit=5"`
Expected: JSON with entries array and has_more boolean

**Step 3: Commit**

```bash
git add backend/api/blogs.py
git commit -m "feat(blogs): add get_blog_entries endpoint"
```

---

## Task 4: Backend Blog API - Get Single Blog Detail

**Files:**
- Modify: `backend/api/blogs.py`

**Step 1: Implement get_blog_detail endpoint**

Add to `backend/api/blogs.py`:
```python
@router.get("/entry/{blog_id}")
async def get_blog_detail(
    blog_id: str,
    service: str = Query(..., description="Service name"),
):
    """Get full content of a specific blog post."""
    try:
        group = _parse_group(service)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    async with aiohttp.ClientSession() as session:
        scraper = get_scraper(group, session)

        try:
            entry = await scraper.get_blog_detail(blog_id)
            return BlogEntry(
                id=entry.id,
                title=entry.title,
                content=entry.content,
                published_at=entry.published_at,
                url=entry.url,
                images=entry.images,
                member_id=entry.member_id,
                member_name=entry.member_name,
            )
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
```

**Step 2: Test endpoint manually**

Run: `curl "http://localhost:8000/api/blogs/entry/<valid_blog_id>?service=Hinatazaka46"`
Expected: JSON with full blog entry including content

**Step 3: Commit**

```bash
git add backend/api/blogs.py
git commit -m "feat(blogs): add get_blog_detail endpoint"
```

---

## Task 5: Frontend Types - Blog Types

**Files:**
- Modify: `frontend/src/types/index.ts`

**Step 1: Add blog type definitions**

Add to `frontend/src/types/index.ts`:
```typescript
// Blog types
export interface BlogMember {
    id: string;
    name: string;
}

export interface BlogEntry {
    id: string;
    title: string;
    content: string;
    published_at: string;  // ISO datetime
    url: string;
    images: string[];
    member_id: string;
    member_name: string;
}

export interface BlogListResponse {
    entries: BlogEntry[];
    has_more: boolean;
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd HakoDesk/frontend && npm run build`
Expected: Build succeeds without type errors

**Step 3: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat(blogs): add frontend blog types"
```

---

## Task 6: Frontend Setup - Install DOMPurify for HTML Sanitization

**Files:**
- Modify: `frontend/package.json`

**Step 1: Install DOMPurify**

Run: `cd HakoDesk/frontend && npm install dompurify && npm install -D @types/dompurify`

**Step 2: Verify installation**

Run: `cd HakoDesk/frontend && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore(blogs): add DOMPurify for HTML sanitization"
```

---

## Task 7: Frontend API - Blog API Functions

**Files:**
- Create: `frontend/src/api/blogs.ts`

**Step 1: Create blog API module**

```typescript
// frontend/src/api/blogs.ts
import { BlogMember, BlogEntry, BlogListResponse } from '../types';

const API_BASE = '/api/blogs';

export async function getBlogMembers(service: string): Promise<BlogMember[]> {
    const res = await fetch(`${API_BASE}/members?service=${encodeURIComponent(service)}`);
    if (!res.ok) {
        throw new Error(`Failed to fetch blog members: ${res.status}`);
    }
    return res.json();
}

export async function getBlogEntries(
    service: string,
    memberId: string,
    limit: number = 20
): Promise<BlogListResponse> {
    const params = new URLSearchParams({
        service,
        member_id: memberId,
        limit: String(limit),
    });
    const res = await fetch(`${API_BASE}/entries?${params}`);
    if (!res.ok) {
        throw new Error(`Failed to fetch blog entries: ${res.status}`);
    }
    return res.json();
}

export async function getBlogDetail(
    service: string,
    blogId: string
): Promise<BlogEntry> {
    const res = await fetch(`${API_BASE}/entry/${blogId}?service=${encodeURIComponent(service)}`);
    if (!res.ok) {
        throw new Error(`Failed to fetch blog detail: ${res.status}`);
    }
    return res.json();
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd HakoDesk/frontend && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add frontend/src/api/blogs.ts
git commit -m "feat(blogs): add frontend blog API functions"
```

---

## Task 8: Frontend Component - BlogsFeature Shell

**Files:**
- Create: `frontend/src/components/features/BlogsFeature.tsx`

**Step 1: Create BlogsFeature component skeleton**

```typescript
// frontend/src/components/features/BlogsFeature.tsx
import React, { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { BlogMember, BlogEntry } from '../../types';
import { getBlogMembers, getBlogEntries } from '../../api/blogs';

interface BlogsFeatureProps {
    activeService?: string;
}

type ViewState =
    | { view: 'members' }
    | { view: 'list'; member: BlogMember }
    | { view: 'reader'; entry: BlogEntry; member: BlogMember };

export const BlogsFeature: React.FC<BlogsFeatureProps> = ({ activeService }) => {
    const [viewState, setViewState] = useState<ViewState>({ view: 'members' });
    const [members, setMembers] = useState<BlogMember[]>([]);
    const [entries, setEntries] = useState<BlogEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reset to members view when service changes
    useEffect(() => {
        setViewState({ view: 'members' });
        setMembers([]);
        setEntries([]);
    }, [activeService]);

    if (!activeService) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-500">
                Select a service to view blogs
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col h-full bg-white">
            {/* Breadcrumb */}
            <div className="px-4 py-2 border-b border-gray-200 flex items-center gap-2 text-sm">
                <button
                    onClick={() => setViewState({ view: 'members' })}
                    className="text-blue-600 hover:underline"
                >
                    Blogs
                </button>
                {viewState.view !== 'members' && (
                    <>
                        <span className="text-gray-400">/</span>
                        <button
                            onClick={() => {
                                if (viewState.view === 'reader') {
                                    setViewState({ view: 'list', member: viewState.member });
                                }
                            }}
                            className={viewState.view === 'reader' ? "text-blue-600 hover:underline" : "text-gray-700"}
                        >
                            {viewState.member.name}
                        </button>
                    </>
                )}
                {viewState.view === 'reader' && (
                    <>
                        <span className="text-gray-400">/</span>
                        <span className="text-gray-700 truncate max-w-xs">{viewState.entry.title}</span>
                    </>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                {loading && (
                    <div className="flex items-center justify-center h-32">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
                    </div>
                )}
                {error && (
                    <div className="p-4 text-red-600">{error}</div>
                )}
                {/* View content will be added in next tasks */}
                <div className="p-4 text-gray-500">
                    View: {viewState.view}
                </div>
            </div>
        </div>
    );
};
```

**Step 2: Verify TypeScript compiles**

Run: `cd HakoDesk/frontend && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add frontend/src/components/features/BlogsFeature.tsx
git commit -m "feat(blogs): add BlogsFeature component skeleton"
```

---

## Task 9: Frontend Component - Member List View

**Files:**
- Modify: `frontend/src/components/features/BlogsFeature.tsx`

**Step 1: Implement member list loading and rendering**

Add member loading effect and render member grid:
```typescript
// Add to BlogsFeature component

// Load members when in members view
useEffect(() => {
    if (viewState.view !== 'members' || !activeService) return;

    setLoading(true);
    setError(null);
    getBlogMembers(activeService)
        .then(setMembers)
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
}, [viewState.view, activeService]);

// Member selection handler
const handleSelectMember = (member: BlogMember) => {
    setViewState({ view: 'list', member });
};

// In the render, replace placeholder with:
{viewState.view === 'members' && !loading && !error && (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 p-4">
        {members.map(member => (
            <button
                key={member.id}
                onClick={() => handleSelectMember(member)}
                className="flex flex-col items-center p-3 rounded-lg hover:bg-gray-50 transition-colors"
            >
                <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center mb-2">
                    <span className="text-lg font-medium text-gray-600">
                        {member.name.substring(0, 2)}
                    </span>
                </div>
                <span className="text-sm text-gray-700 text-center">{member.name}</span>
            </button>
        ))}
    </div>
)}
```

**Step 2: Verify in browser**

Run: Start dev server and navigate to Blogs feature
Expected: Member grid displays when blogs feature is active

**Step 3: Commit**

```bash
git add frontend/src/components/features/BlogsFeature.tsx
git commit -m "feat(blogs): implement member list view"
```

---

## Task 10: Frontend Component - Blog List View

**Files:**
- Modify: `frontend/src/components/features/BlogsFeature.tsx`

**Step 1: Implement blog list loading and rendering**

Add blog list loading effect and render:
```typescript
// Load entries when in list view
useEffect(() => {
    if (viewState.view !== 'list' || !activeService) return;

    setLoading(true);
    setError(null);
    getBlogEntries(activeService, viewState.member.id)
        .then(res => setEntries(res.entries))
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
}, [viewState, activeService]);

// Entry selection handler
const handleSelectEntry = (entry: BlogEntry) => {
    if (viewState.view === 'list') {
        setViewState({ view: 'reader', entry, member: viewState.member });
    }
};

// In the render:
{viewState.view === 'list' && !loading && !error && (
    <div className="divide-y divide-gray-100">
        {entries.map(entry => (
            <button
                key={entry.id}
                onClick={() => handleSelectEntry(entry)}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
            >
                <h3 className="font-medium text-gray-900 line-clamp-2">{entry.title}</h3>
                <p className="text-sm text-gray-500 mt-1">
                    {new Date(entry.published_at).toLocaleDateString('ja-JP', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                    })}
                </p>
            </button>
        ))}
        {entries.length === 0 && (
            <div className="p-4 text-gray-500 text-center">No blog entries found</div>
        )}
    </div>
)}
```

**Step 2: Verify in browser**

Run: Click on a member in the blogs feature
Expected: Blog entry list displays with titles and dates

**Step 3: Commit**

```bash
git add frontend/src/components/features/BlogsFeature.tsx
git commit -m "feat(blogs): implement blog list view"
```

---

## Task 11: Frontend Component - Blog Reader View with Sanitization

**Files:**
- Modify: `frontend/src/components/features/BlogsFeature.tsx`

**Step 1: Implement blog reader view with DOMPurify sanitization**

Add reader view rendering with sanitized HTML:
```typescript
// Import DOMPurify at the top
import DOMPurify from 'dompurify';

// In the render:
{viewState.view === 'reader' && !loading && !error && (
    <article className="max-w-3xl mx-auto px-4 py-6">
        <header className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
                {viewState.entry.title}
            </h1>
            <div className="flex items-center gap-3 text-sm text-gray-500">
                <span>{viewState.entry.member_name}</span>
                <span>-</span>
                <time>
                    {new Date(viewState.entry.published_at).toLocaleDateString('ja-JP', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                    })}
                </time>
            </div>
        </header>

        {/* Blog content - render HTML safely with DOMPurify */}
        <div
            className="prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(viewState.entry.content, {
                    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'a', 'img', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li'],
                    ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'target', 'rel'],
                })
            }}
        />

        {/* External link */}
        <footer className="mt-8 pt-4 border-t border-gray-200">
            <a
                href={viewState.entry.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline text-sm"
            >
                View original post
            </a>
        </footer>
    </article>
)}
```

**Step 2: Add Tailwind Typography plugin for prose styles**

Run: `cd HakoDesk/frontend && npm install -D @tailwindcss/typography`

Add to `tailwind.config.js`:
```javascript
plugins: [
    require('@tailwindcss/typography'),
    // ... other plugins
],
```

**Step 3: Verify in browser**

Run: Click on a blog entry
Expected: Full blog content displays with proper formatting, HTML is sanitized

**Step 4: Commit**

```bash
git add frontend/src/components/features/BlogsFeature.tsx frontend/package.json frontend/tailwind.config.js
git commit -m "feat(blogs): implement blog reader view with DOMPurify sanitization"
```

---

## Task 12: Integration - Wire BlogsFeature to Layout

**Files:**
- Modify: Files as determined by UI architecture implementation
  - Likely `frontend/src/components/ContentArea.tsx` or equivalent

**Step 1: Import and render BlogsFeature in Zone C**

The exact integration depends on the UI architecture implementation from `2026-01-14-ui-architecture-design.md`. The BlogsFeature should be rendered when the active feature is 'blogs'.

Example pattern:
```typescript
import { BlogsFeature } from './features/BlogsFeature';

// In ContentArea or equivalent:
{activeFeature === 'blogs' && (
    <BlogsFeature activeService={activeService} />
)}
```

**Step 2: Add blogs to FeatureRail configuration**

Add blogs feature definition with icon (e.g., BookOpen from lucide-react).

**Step 3: Verify end-to-end**

Run: Start app, select service, click blogs icon in FeatureRail
Expected: BlogsFeature displays and allows navigation through members → entries → reader

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(blogs): integrate BlogsFeature with layout"
```

---

## Task 13: Polish - Loading States and Error Handling

**Files:**
- Modify: `frontend/src/components/features/BlogsFeature.tsx`

**Step 1: Improve loading skeleton**

Add skeleton loading states for each view:
```typescript
// Member skeleton
{viewState.view === 'members' && loading && (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 p-4">
        {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center p-3">
                <div className="w-16 h-16 rounded-full bg-gray-200 animate-pulse" />
                <div className="w-20 h-4 bg-gray-200 rounded mt-2 animate-pulse" />
            </div>
        ))}
    </div>
)}

// Entry list skeleton
{viewState.view === 'list' && loading && (
    <div className="divide-y divide-gray-100">
        {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-4 py-3">
                <div className="h-5 bg-gray-200 rounded w-3/4 animate-pulse" />
                <div className="h-4 bg-gray-200 rounded w-1/4 mt-2 animate-pulse" />
            </div>
        ))}
    </div>
)}
```

**Step 2: Add retry button for errors**

```typescript
{error && (
    <div className="p-4 text-center">
        <p className="text-red-600 mb-2">{error}</p>
        <button
            onClick={() => {
                setError(null);
                // Trigger reload by toggling view
                const currentView = viewState;
                setViewState({ view: 'members' });
                setTimeout(() => setViewState(currentView), 0);
            }}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
            Retry
        </button>
    </div>
)}
```

**Step 3: Verify loading and error states**

Run: Test with slow network and with backend offline
Expected: Loading skeletons show during fetch, error message with retry on failure

**Step 4: Commit**

```bash
git add frontend/src/components/features/BlogsFeature.tsx
git commit -m "feat(blogs): add loading skeletons and error retry"
```

---

## Task 14: Final Testing and Verification

**Files:**
- None (testing only)

**Step 1: Full end-to-end test**

Manual test checklist:
1. [ ] Select Hinatazaka46 service
2. [ ] Click Blogs feature in FeatureRail
3. [ ] Member list loads and displays
4. [ ] Click on a member - blog list loads
5. [ ] Click on a blog - full content displays
6. [ ] Images in blog content display correctly
7. [ ] Breadcrumb navigation works (back to list, back to members)
8. [ ] External link opens in new tab
9. [ ] Switch service - view resets to members
10. [ ] Test with Nogizaka46 and Sakurazaka46 services

**Step 2: Test error scenarios**

1. [ ] Backend offline - error message with retry
2. [ ] Invalid service - appropriate error
3. [ ] Network timeout - loading doesn't hang forever

**Step 3: Update roadmap**

Mark P3.14 as complete in `docs/ROADMAP.md`

**Step 4: Final commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: mark P3.14 Official Blogs Support as complete"
```

---

## Notes

### Dependencies on UI Architecture

This plan assumes the UI architecture from `2026-01-14-ui-architecture-design.md` is implemented. Task 12 will need adjustment based on the actual component names and structure.

### Blog Content Security

The blog reader uses DOMPurify to sanitize HTML content before rendering. This prevents XSS attacks even though the content comes from official Sakamichi websites via PyHako scrapers.

### Performance Considerations

- Blog entries are fetched live (not cached) - suitable for browsing
- Consider adding client-side caching if users frequently revisit same blogs
- Rate limiting is handled by PyHako scrapers (0.5s between requests)

### Future Enhancements

Not in scope for P3.14 but potential future work:
- Blog search within member's posts
- Favorite/bookmark blogs locally
- Offline reading (download blogs)
- Blog notifications for new posts
