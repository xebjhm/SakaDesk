# Blog Reader Navigation Enhancement

## Overview

Enhance the BlogReader component with member-scoped navigation: a magnifying timeline scrubber on the right edge and floating prev/next navigation at the bottom.

## Layout Structure

```
┌─────────────────────────────────────────┬──────┐
│ Breadcrumb: < 松尾桜 / Blog Title       │      │
├─────────────────────────────────────────┤  R   │
│                                         │  A   │
│           Blog Content                  │  I   │
│           (scrollable)                  │  L   │
│                                         │      │
│                                         │      │
├─────────────────────────────────────────┤      │
│ ← Title...  │  Title... →               │      │
│   Jan 14    │    Jan 16                 │      │
└─────────────────────────────────────────┴──────┘
```

- **Content Area** (~90% width): Existing blog reader with scrollable content
- **Timeline Rail** (right, ~48px): Fixed-height magnifying scrubber
- **Navigation Footer**: Floating prev/next with blog titles

## Timeline Rail (Magnifying Scrubber)

### Structure
- Fixed height: ~66% of page height, vertically centered
- All posts mapped proportionally to this fixed space (no scrolling)
- Rail positioned on right edge
- Tooltip/title appears to the LEFT of hovered dot

### Visual Elements
- Thin vertical line with dots for each post
- Year labels always visible as section dividers
- Month labels appear on hover within that month's zone
- Current post: oshi color dot, slightly larger

### Magnification Effect (Fisheye/Dock-style)
- Items near cursor: larger dots, more spacing
- Hovered item: largest, shows title text to its left
- Gaussian falloff, ~5-7 items in expanded zone
- Smooth animation on mouse movement

### Hover Display
```
                    ●
                   ●
                  ●
「君と生きる」──◉   ← hovered item shows title to left
                  ●
                   ●
                    ●
```

## Floating Prev/Next Navigation

### Layout
```
┌─────────────────────────────────────────┐
│ ← しあわせは...     │     君と生きる →  │
│   Jan 14            │        Jan 16     │
└─────────────────────────────────────────┘
```

### Content
- **Left (Prev)**: ← arrow, previous blog title (truncated), date
- **Right (Next)**: Next blog title (truncated), date, → arrow
- Titles truncate with ellipsis (~15-20 chars max)

### Behavior
- If at first post: hide left side entirely
- If at last post: hide right side entirely
- Glassmorphism background (washi paper style)
- Keyboard support: ← → arrow keys

## Data Flow

### State Changes (BlogsFeature.tsx)
```typescript
// Add member blogs cache
const [memberBlogsCache, setMemberBlogsCache] = useState<Map<string, BlogMeta[]>>(new Map());

// Add content cache (last 3 visited)
const [contentCache, setContentCache] = useState<Map<string, BlogContentResponse>>(new Map());
```

### Blog List Caching
- Cache member blog lists in `Map<memberId, BlogMeta[]>`
- Check cache before fetching, only fetch if missing
- Cache persists for session (cleared on service change)
- No complex invalidation - manual refresh via timeline view if needed

### Content Caching
- Keep last 3 blog contents in LRU-style cache
- Enables instant back-navigation

### Navigation Logic
- Prev: Navigate to `memberBlogs[currentIndex - 1]`
- Next: Navigate to `memberBlogs[currentIndex + 1]`
- Jump: Click rail dot → load that blog's content
- When entering from "Recent Posts", fetch member's blog list to enable navigation

## Props Changes

### BlogReader Component
```typescript
interface BlogReaderProps {
    // Existing
    content: BlogContentResponse | null;
    member: BlogMember;
    blog: BlogMeta;
    loading: boolean;
    error: string | null;
    onBack: () => void;
    onRetry: () => void;

    // New
    memberBlogs: BlogMeta[];           // Full list for navigation
    currentIndex: number;              // Position in list
    onNavigate: (blog: BlogMeta) => void;  // Navigate to different blog
}
```

## New Components

### TimelineRail
- Props: `blogs: BlogMeta[]`, `currentIndex: number`, `oshiColor: string`, `onSelect: (index: number) => void`
- Handles magnification math and rendering
- Uses `onMouseMove` for cursor position tracking

### BlogNavFooter
- Props: `prevBlog: BlogMeta | null`, `nextBlog: BlogMeta | null`, `onPrev: () => void`, `onNext: () => void`
- Renders floating navigation bar
- Handles keyboard events

## Implementation Order

1. Add `memberBlogsCache` state to BlogsFeature
2. Fetch member blog list when entering reader (if not cached)
3. Create `BlogNavFooter` component (simpler, test navigation flow)
4. Create `TimelineRail` component with magnification effect
5. Add content caching for smooth navigation
6. Polish animations and transitions
