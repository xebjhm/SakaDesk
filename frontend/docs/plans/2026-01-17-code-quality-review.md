# Blog Feature Code Quality Review & Refactoring Plan

**Date:** 2026-01-17
**Status:** Implementation Ready

## Executive Summary

Comprehensive code quality review of the blog feature (`src/components/features/blogs/`). This document identifies issues and provides implementation plan for achieving top-tier code quality.

---

## Part 1: Unused Code Removal

### Files to Delete

| File | Lines | Reason |
|------|-------|--------|
| `MemberSelectGrid.tsx` | 460 | Exported in index.ts but never imported anywhere |
| `MemberTimeline.tsx` | 292 | Exported in index.ts but never imported anywhere |

**Total savings:** 752 lines of dead code

### Barrel Export Cleanup

Update `blogs/index.ts` to remove exports for deleted files.

---

## Part 2: Code Duplication Analysis

### 2.1 Month Names Array (4 occurrences)

**Files affected:**
- `TimelineSection.tsx:9`
- `MemberTimelineModal.tsx:28`
- `TimelineRail.tsx:11`
- `BlogNavFooter.tsx:13`

**Current (duplicated):**
```typescript
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
```

**Solution:** Create shared utility

```typescript
// src/utils/dates.ts
export const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const MONTH_NAMES_JP = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'] as const;

export function formatMonthYear(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${MONTH_NAMES_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}
```

### 2.2 Month Grouping Logic (2 occurrences)

**Files affected:**
- `TimelineSection.tsx:28-38`
- `MemberTimelineModal.tsx:67-77`

**Current pattern:**
```typescript
const groupBlogsByMonth = (blogs: BlogMeta[]) => {
  const groups: Map<string, BlogMeta[]> = new Map();
  blogs.forEach(blog => {
    const date = new Date(blog.published_at);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    // ... grouping logic
  });
  return groups;
};
```

**Solution:** Extract to shared hook

```typescript
// src/hooks/useGroupedByMonth.ts
export function useGroupedByMonth<T extends { published_at: string }>(items: T[]) {
  return useMemo(() => {
    const groups = new Map<string, T[]>();
    items.forEach(item => {
      const date = new Date(item.published_at);
      const key = `${date.getFullYear()}-${String(date.getMonth()).padStart(2, '0')}`;
      const existing = groups.get(key) || [];
      groups.set(key, [...existing, item]);
    });
    return groups;
  }, [items]);
}
```

### 2.3 Loading Spinner UI (5+ occurrences)

**Current pattern (scattered):**
```typescript
{loading && (
  <div className="flex items-center justify-center h-32">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: color }} />
  </div>
)}
```

**Solution:** Create shared component

```typescript
// src/components/ui/LoadingSpinner.tsx
interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  className?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  color = '#5d95ae',
  className = '',
}) => {
  const sizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' };
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div
        className={`animate-spin rounded-full border-b-2 ${sizes[size]}`}
        style={{ borderColor: color }}
      />
    </div>
  );
};
```

### 2.4 Error Display UI (3+ occurrences)

**Solution:** Create shared component

```typescript
// src/components/ui/ErrorDisplay.tsx
interface ErrorDisplayProps {
  error: string;
  onRetry?: () => void;
  retryLabel?: string;
  color?: string;
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({
  error,
  onRetry,
  retryLabel = 'Retry',
  color = '#5d95ae',
}) => (
  <div className="p-4 text-center">
    <p className="text-red-600 mb-2">{error}</p>
    {onRetry && (
      <button
        onClick={onRetry}
        className="px-4 py-2 text-white rounded-lg"
        style={{ backgroundColor: color }}
      >
        {retryLabel}
      </button>
    )}
  </div>
);
```

---

## Part 3: Hardcoded Values Consolidation

### 3.1 Mascot Configuration

**Current (hardcoded in BlogsFeature.tsx:17-21):**
```typescript
const POKA_MEMBER: BlogMemberWithThumbnail = {
  id: '000',
  name: 'ポカ',
  thumbnail: null,
};
```

**Solution:** Move to group config

```typescript
// src/config/groupMascots.ts
export interface GroupMascot {
  id: string;
  name: string;
  thumbnailUrl?: string;
}

export const GROUP_MASCOTS: Record<GroupId, GroupMascot | null> = {
  hinatazaka: {
    id: '000',
    name: 'ポカ',
    thumbnailUrl: 'https://cdn.hinatazaka46.com/images/14/98b/e96b48f630edc3119806a1b40bc10/400_320_102400.jpg',
  },
  sakurazaka: null, // Add when known
  nogizaka: null,   // Add when known
};
```

### 3.2 Image Position Constants

**Current (MemberSelectModal.tsx:250-251):**
```typescript
objectPosition: 'center 0%',
transform: 'scale(1.15)',
```

**Solution:** Move to theme config

```typescript
// Add to groupThemes.ts blog section
blog: {
  // ... existing
  avatar: {
    objectPosition: 'center 0%',
    scale: 1.15,
  },
}
```

### 3.3 UI Constants

**Scattered values to consolidate:**
```typescript
// src/config/uiConstants.ts
export const UI_CONSTANTS = {
  modal: {
    maxWidth: '3xl',
    maxHeight: '85vh',
    borderRadius: '3xl',
  },
  avatar: {
    sizeSm: 'w-12 h-12',
    sizeMd: 'w-16 h-16',
    sizeLg: 'w-20 h-20',
  },
  animation: {
    duration: {
      fast: '150ms',
      normal: '200ms',
      slow: '300ms',
    },
  },
} as const;
```

---

## Part 4: Type Safety Improvements

### 4.1 Missing Type Exports

**Add to `src/types/index.ts`:**
```typescript
export type GenerationKey = '2nd' | '3rd' | '4th' | '5th' | 'mascot';

export interface EnrichedMember extends BlogMemberWithThumbnail {
  nameJp: string;
  generation: GenerationKey;
  penlightColors: [string, string] | null;
}
```

### 4.2 Type Consolidation

**Current issue:** `GenerationKey` defined in both:
- `MemberSelectModal.tsx:19`
- `memberColors.ts:4`

**Solution:** Single source of truth in `src/types/index.ts`

### 4.3 Strict Null Checks

Add explicit null handling to:
- `getMemberColors()` return type
- `favorites` store access
- API response types

---

## Part 5: Multi-Service Support Gaps

### 5.1 Incomplete Member Data

**Current state:**
```typescript
// memberColors.ts only has Hinatazaka data
MEMBER_COLORS: MemberColor[] = [/* 22 Hinatazaka members */]
```

**Required structure:**
```typescript
MEMBER_COLORS_BY_GROUP: Record<GroupId, MemberColor[]> = {
  hinatazaka: [/* 22 members */],
  sakurazaka: [/* TBD members */],
  nogizaka: [/* TBD members */],
}
```

### 5.2 Service Detection

**Improve `getGroupFromService()`:**
```typescript
export function getGroupFromService(serviceId: string | null): GroupId {
  if (!serviceId) return 'hinatazaka'; // default
  const lower = serviceId.toLowerCase();
  if (lower.includes('sakura')) return 'sakurazaka';
  if (lower.includes('nogi')) return 'nogizaka';
  return 'hinatazaka';
}
```

---

## Part 6: CSS/Animation Consolidation

### 6.1 Modal Animation

**Current (inline in MemberSelectModal.tsx:343-357):**
```css
@keyframes modal-in {
  from { opacity: 0; transform: scale(0.95) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
```

**Solution:** Move to shared CSS

```typescript
// src/styles/animations.ts
export const animations = {
  modalIn: `
    @keyframes modal-in {
      from { opacity: 0; transform: scale(0.95) translateY(10px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
  `,
  fadeIn: `
    @keyframes fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `,
};
```

---

## Part 7: Implementation Order

### Phase 1: Cleanup (No Breaking Changes)
1. Delete `MemberSelectGrid.tsx`
2. Delete `MemberTimeline.tsx`
3. Update `blogs/index.ts` exports

### Phase 2: Shared Utilities
4. Create `src/utils/dates.ts`
5. Create `src/components/ui/LoadingSpinner.tsx`
6. Create `src/components/ui/ErrorDisplay.tsx`
7. Create `src/config/groupMascots.ts`

### Phase 3: Refactor Components
8. Update components to use shared utilities
9. Consolidate types to `src/types/index.ts`
10. Remove duplicate type definitions

### Phase 4: Config Consolidation
11. Move hardcoded values to config files
12. Create `src/config/uiConstants.ts`
13. Move animations to shared module

### Phase 5: Verification
14. Run TypeScript compiler (`tsc --noEmit`)
15. Run linter (`npm run lint`)
16. Build verification (`npm run build`)
17. Visual testing of all blog views

---

## Estimated Impact

| Metric | Before | After |
|--------|--------|-------|
| Dead code lines | 752 | 0 |
| Duplicate patterns | 8+ | 0 |
| Hardcoded values | 13+ | 0 |
| Type duplications | 5 | 0 |
| Shared utilities | 0 | 4 |
| Config files | 2 | 5 |

---

## Success Criteria

- [ ] All unused files removed
- [ ] No duplicate code patterns
- [ ] All hardcoded values in config
- [ ] Single source of truth for types
- [ ] Build passes with no errors
- [ ] All blog features work correctly
- [ ] Ready for multi-group expansion
