# Blog Feature Refactoring Design

**Date:** 2026-01-17
**Status:** Approved

## Overview

Refactor the blogs feature to achieve:
- Clean, well-organized, modular code
- Proper variable naming and coding style consistency
- Multi-group support (Hinatazaka46, Sakurazaka46, Nogizaka46)
- Centralized color/theme configuration
- Removal of unused code

## Section 1: File Structure & Organization

### Current Structure
```
src/
├── components/features/
│   ├── BlogsFeature.tsx          (592 lines - too large)
│   └── blogs/
│       ├── BlogCard.tsx
│       ├── BlogNavFooter.tsx
│       ├── MemberSelectGrid.tsx
│       ├── MemberSelectModal.tsx
│       ├── MemberTimeline.tsx
│       ├── MemberTimelineModal.tsx
│       ├── RecentPostsFeed.tsx
│       ├── TimelineRail.tsx      (UNUSED - delete)
│       ├── TimelineSection.tsx
│       └── index.ts
├── config/
│   └── groupThemes.ts
└── data/
    └── memberColors.ts
```

### Target Structure
```
src/
├── components/features/
│   ├── BlogsFeature.tsx          (~300 lines - orchestrator only)
│   └── blogs/
│       ├── BlogCard.tsx
│       ├── BlogNavFooter.tsx
│       ├── BlogReader.tsx        (NEW - extracted from BlogsFeature)
│       ├── MemberSelectGrid.tsx
│       ├── MemberSelectModal.tsx
│       ├── MemberTimeline.tsx
│       ├── MemberTimelineModal.tsx
│       ├── RecentPostsFeed.tsx
│       ├── TimelineSection.tsx
│       └── index.ts
├── config/
│   └── groupThemes.ts            (extended with blog colors)
├── data/
│   └── memberColors.ts           (restructured for multi-group)
└── hooks/
    └── useBlogTheme.ts           (NEW - centralized theme access)
```

## Section 2: Theme System Enhancement

### Extended GroupTheme Interface

```typescript
// src/config/groupThemes.ts
export interface GroupTheme {
  // ... existing properties ...
  blog: {
    memberNameColor: string;      // Member name in cards/headers
    linkColor: string;            // Links in blog content
    linkUnderlineColor: string;   // Subtle underline (40% opacity)
    headerTitleColor: string;     // "Latest Blogs" header
    timelineIndicator: string;    // Timeline dot/line color
    cardGlow: {
      primary: string;            // Oshi color glow
      secondary: string;          // Secondary glow
    };
  };
}
```

### Theme Values by Group

| Property | Hinatazaka | Sakurazaka | Nogizaka |
|----------|------------|------------|----------|
| memberNameColor | #5d95ae | #ff64b4 | #7b4cba |
| linkColor | #5d95ae | #ff64b4 | #7b4cba |
| headerTitleColor | #5d95ae | #ff64b4 | #7b4cba |

### useBlogTheme Hook

```typescript
// src/hooks/useBlogTheme.ts
export function useBlogTheme() {
  const activeService = useAppStore((state) => state.activeService);

  return useMemo(() => {
    const theme = getThemeForService(activeService);
    return {
      ...theme,
      memberNameColor: theme.blog.memberNameColor,
      linkColor: theme.blog.linkColor,
      linkUnderlineColor: theme.blog.linkUnderlineColor,
      headerTitleColor: theme.blog.headerTitleColor,
    };
  }, [activeService]);
}
```

## Section 3: Member Colors Multi-Group Structure

### Type Definitions

```typescript
export type GroupId = 'hinatazaka' | 'sakurazaka' | 'nogizaka';

export interface MemberColor {
  id: string;
  nameEn: string;
  nameJp: string;
  color: string;
}
```

### Data Structure

```typescript
const MEMBER_COLORS: Record<GroupId, MemberColor[]> = {
  hinatazaka: [
    { id: 'member-id', nameEn: 'Romaji Name', nameJp: '漢字名前', color: '#RRGGBB' },
    // ... 22 members
  ],
  sakurazaka: [],  // Future: add members
  nogizaka: [],    // Future: add members
};
```

### Helper Functions

```typescript
// Map service ID to group
export function getGroupFromService(serviceId: string | null): GroupId

// Get members for a group
export function getMembersForGroup(groupId: GroupId): MemberColor[]

// Backward-compatible (defaults to hinatazaka)
export function getMemberColor(memberId: string, groupId?: GroupId): string | undefined
export function getMemberNameJp(nameEn: string, groupId?: GroupId): string
```

## Section 4: Component Refactoring

### BlogReader Extraction

```typescript
// src/components/features/blogs/BlogReader.tsx
interface BlogReaderProps {
  post: BlogPost;
  member: MemberColor;
  theme: ReturnType<typeof useBlogTheme>;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  hasPrev: boolean;
  hasNext: boolean;
}

export const BlogReader: React.FC<BlogReaderProps> = ({ ... }) => {
  // Current BlogReader JSX and logic (~200 lines)
};
```

### BlogsFeature.tsx Simplification

```typescript
export const BlogsFeature: React.FC = () => {
  const theme = useBlogTheme();
  // ... state hooks

  if (viewMode === 'reading' && selectedPost) {
    return <BlogReader post={selectedPost} member={member} theme={theme} ... />;
  }

  return <RecentPostsFeed ... />;
};
```

### Hardcoded Color Replacements

| File | Current | After |
|------|---------|-------|
| BlogCard.tsx | #5d95ae | theme.blog.memberNameColor |
| RecentPostsFeed.tsx | #5d95ae | theme.blog.headerTitleColor |
| MemberTimelineModal.tsx | #5d95ae | theme.blog.memberNameColor |
| BlogsFeature.tsx | #5d95ae | theme.blog.linkColor |

### Naming Conventions

- **Components**: PascalCase (BlogReader, BlogCard)
- **Hooks**: camelCase with `use` prefix (useBlogTheme)
- **Utilities**: camelCase (getMembersForGroup)
- **Types**: PascalCase (GroupId, MemberColor)
- **Constants**: SCREAMING_SNAKE_CASE (MEMBER_COLORS)

## Section 5: Implementation Order

### Phase 1: Foundation (No Breaking Changes)
1. Create `src/hooks/useBlogTheme.ts`
2. Extend `groupThemes.ts` with blog property
3. Restructure `memberColors.ts` with multi-group support

### Phase 2: Component Updates (One at a Time)
4. Update `RecentPostsFeed.tsx`
5. Update `BlogCard.tsx`
6. Update `MemberTimelineModal.tsx`
7. Update `BlogsFeature.tsx`

### Phase 3: Extraction & Cleanup
8. Create `BlogReader.tsx`
9. Update `BlogsFeature.tsx` to use BlogReader
10. Delete `TimelineRail.tsx`
11. Update `index.ts`

### Testing Strategy
- After each phase, verify app builds and runs
- Visual inspection: colors remain identical
- Test all views: Recent Posts, Member Timeline Modal, Blog Reader
- Use Playwright for UI verification

### Rollback Safety
- Phase 1 is purely additive
- Phase 2 changes are isolated per file
- Phase 3 extraction can be reverted
