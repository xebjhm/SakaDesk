# Messages Feature Code Quality Review & Refactoring Plan

**Date:** 2026-01-17
**Status:** Implementation Ready

## Executive Summary

Comprehensive code quality review of the Messages feature. This document identifies issues and provides implementation plan for achieving top-tier code quality.

**Key Files Analyzed:**
- `MessagesFeature.tsx` (558 lines)
- `MessageBubble.tsx` (323 lines)
- `ChatList.tsx` (121 lines)
- `Sidebar.tsx` (306 lines)
- `ChatHeaderMenu.tsx` (146 lines)
- `MessageContextMenu.tsx` (92 lines)
- `MemberProfilePopup.tsx` (173 lines)
- `BackgroundModal.tsx` (~150 lines)

---

## Part 1: Code Duplication

### 1.1 formatName & getShortName (3 occurrences)

**Files affected:**
- `MessagesFeature.tsx:312`
- `Sidebar.tsx:123-128`
- `GroupSidebar.tsx:99-104`

**Current (duplicated):**
```typescript
const formatName = (name: string) => name.replace(/_/g, ' ');

const getShortName = (name: string) => {
    const parts = formatName(name).split(' ');
    return parts[0].substring(0, 2);
};
```

**Solution:** Create shared utility

```typescript
// src/utils/nameFormatters.ts
export function formatName(name: string): string {
  return name.replace(/_/g, ' ');
}

export function getShortName(name: string): string {
  const parts = formatName(name).split(' ');
  return parts[0].substring(0, 2);
}

export function getInitials(name: string): string {
  return formatName(name)
    .split(' ')
    .map(p => p[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();
}
```

### 1.2 Read State Management (2 occurrences)

**Files affected:**
- `MessagesFeature.tsx:243-260`
- `Sidebar.tsx:51-105`

**Solution:** Create custom hook

```typescript
// src/hooks/useReadState.ts
interface ReadState {
  lastReadId: number;
  readCount: number;
  revealedIds: number[];
}

const DEFAULT_READ_STATE: ReadState = { lastReadId: 0, readCount: 0, revealedIds: [] };

export function useReadState(path: string | null) {
  const [state, setState] = useState<ReadState>(DEFAULT_READ_STATE);

  useEffect(() => {
    if (!path) return;
    const key = `read_state_${path}`;
    try {
      const saved = localStorage.getItem(key);
      setState(saved ? JSON.parse(saved) : DEFAULT_READ_STATE);
    } catch {
      setState(DEFAULT_READ_STATE);
    }
  }, [path]);

  const save = useCallback((newState: ReadState) => {
    if (!path) return;
    try {
      localStorage.setItem(`read_state_${path}`, JSON.stringify(newState));
    } catch {
      // Log error instead of silent fail
    }
    setState(newState);
  }, [path]);

  return { state, save };
}
```

### 1.3 Background Settings (2 occurrences)

**Files affected:**
- `MessagesFeature.tsx:320-332`
- `BackgroundModal.tsx:46-66`

**Solution:** Create shared utility

```typescript
// src/utils/backgroundSettings.ts
export interface BackgroundSettings {
  type: 'default' | 'color' | 'image';
  imageData?: string;
  color: string;
  opacity: number;
}

export const DEFAULT_BACKGROUND: BackgroundSettings = {
  type: 'default',
  color: '#E2E6EB',
  opacity: 100,
};

export function loadBackgroundSettings(path: string): BackgroundSettings {
  try {
    const saved = localStorage.getItem(`bg_settings_${path}`);
    return saved ? JSON.parse(saved) : DEFAULT_BACKGROUND;
  } catch {
    return DEFAULT_BACKGROUND;
  }
}

export function saveBackgroundSettings(path: string, settings: BackgroundSettings): void {
  try {
    localStorage.setItem(`bg_settings_${path}`, JSON.stringify(settings));
  } catch {
    // Handle error
  }
}
```

---

## Part 2: Hardcoded Values

### 2.1 Colors to Extract

| Location | Color | Usage | Config Key |
|----------|-------|-------|------------|
| MessagesFeature.tsx:94,327,330,449 | `#E2E6EB` | Default background | `colors.background.default` |
| MessagesFeature.tsx:407 | `from-[#a8c4e8] via-[#a0a9d8] to-[#9181c4]` | Header gradient | `colors.gradient.header` |
| MemberProfilePopup.tsx:117 | Same gradient | Profile header | (same as above) |
| Sidebar.tsx:223 | `#7cc7e8` | Unread badge | `colors.badge.unread` |
| Sidebar.tsx:245,272,282 | `#c8d8ec`, `#dde6f0`, `#f0f4f8` | Sidebar gradients | `colors.sidebar.gradient` |
| BackgroundModal.tsx:25-33 | 8 preset colors | Color picker | `colors.presets.background` |

**Solution:** Create color constants

```typescript
// src/config/colors.ts
export const COLORS = {
  background: {
    default: '#E2E6EB',
    chat: '#F5F5F4',
  },
  gradient: {
    header: {
      from: '#a8c4e8',
      via: '#a0a9d8',
      to: '#9181c4',
    },
  },
  badge: {
    unread: '#7cc7e8',
  },
  sidebar: {
    gradient: ['#c8d8ec', '#dde6f0', '#f0f4f8'],
  },
  presets: {
    background: ['#E2E6EB', '#FEE2E2', '#FEF3C7', '#D1FAE5', '#DBEAFE', '#E9D5FF', '#FCE7F3', '#F5F5F4'],
  },
} as const;

// Helper for Tailwind gradient classes
export function getHeaderGradientClass(): string {
  const { from, via, to } = COLORS.gradient.header;
  return `bg-gradient-to-r from-[${from}] via-[${via}] to-[${to}]`;
}
```

### 2.2 Magic Numbers to Extract

| Location | Value | Usage | Config Key |
|----------|-------|-------|------------|
| MessageBubble.tsx:38-40 | `320`, `500`, `200` | Media dimensions | `media.maxWidth`, `media.maxHeight`, `media.defaultHeight` |
| MessageBubble.tsx:149,175 | `600` | Long-press timeout | `interaction.longPressMs` |
| Sidebar.tsx:109 | `2000` | Polling interval | `polling.sidebarMs` |
| MessageContextMenu.tsx:47-48 | `200`, `48` | Menu dimensions | `contextMenu.width`, `contextMenu.itemHeight` |
| BackgroundModal.tsx:80 | `2 * 1024 * 1024` | Max file size | `limits.maxImageSize` |

**Solution:** Create constants file

```typescript
// src/config/constants.ts
export const UI_CONSTANTS = {
  media: {
    maxWidth: 320,
    maxHeight: 500,
    defaultHeight: 200,
  },
  interaction: {
    longPressMs: 600,
    debounceMs: 300,
  },
  polling: {
    sidebarMs: 2000,
    syncCheckMs: 5000,
  },
  contextMenu: {
    width: 200,
    itemHeight: 48,
    padding: 8,
  },
  limits: {
    maxImageSizeBytes: 2 * 1024 * 1024, // 2MB
  },
} as const;
```

---

## Part 3: Type Safety Issues

### 3.1 Duplicate Type: BackgroundSettings

**Current (duplicated in 2 files):**
- `ChatHeaderMenu.tsx:11-16`
- `BackgroundModal.tsx:7-12`

**Solution:** Consolidate to types file

```typescript
// src/types/index.ts
export interface BackgroundSettings {
  type: 'default' | 'color' | 'image';
  imageData?: string;
  color: string;
  opacity: number;
}
```

Then update imports in both files.

### 3.2 Weak Type Annotations

**Fix these:**

```typescript
// MessagesFeature.tsx:173 - Remove type assertion
const memberInfo: MemberInfo | undefined = data.member;

// MessageContextMenu.tsx:48 - Use proper error type
catch (err: unknown) {
  const message = err instanceof Error ? err.message : 'Unknown error';
}

// Sidebar.tsx:70 - Add error logging
catch (err) {
  console.error('Failed to load groups:', err);
}
```

---

## Part 4: Multi-Service Support Fixes

### 4.1 Missing Service Parameter

**MemberProfilePopup.tsx:41** - Missing service in API call

**Current:**
```typescript
const res = await fetch(`/api/chat/streak/${groupId}`);
```

**Fix:**
```typescript
interface MemberProfilePopupProps {
  // ... existing props
  activeService?: string;
}

// In component:
const res = await fetch(
  `/api/chat/streak/${groupId}${activeService ? `?service=${activeService}` : ''}`
);
```

### 4.2 Hardcoded Group Chat IDs

**Sidebar.tsx:30** - Only recognizes group 43

**Current:**
```typescript
const GROUP_CHAT_IDS = ['43']; // 日向坂46
```

**Fix:**
```typescript
// src/config/groupConfig.ts
export const GROUP_CHAT_IDS: Record<string, string[]> = {
  hinatazaka: ['43'],
  sakurazaka: ['45'], // Confirm actual ID
  nogizaka: ['46'],   // Confirm actual ID
};

// Usage in Sidebar.tsx
import { GROUP_CHAT_IDS } from '../config/groupConfig';
const groupChatIds = activeService
  ? GROUP_CHAT_IDS[activeService] || []
  : Object.values(GROUP_CHAT_IDS).flat();
```

---

## Part 5: Error Handling Improvements

### 5.1 Replace Silent Catches

**Current pattern (multiple locations):**
```typescript
try {
  localStorage.setItem(...);
} catch {
  // Ignore localStorage errors
}
```

**Fix:** Add proper logging

```typescript
// src/utils/logger.ts
export function logError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  // In production, use proper logging service
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[${context}]`, message);
  }
}

// Usage:
try {
  localStorage.setItem(...);
} catch (err) {
  logError('saveReadState', err);
}
```

### 5.2 Replace console.error

**Locations:**
- `Sidebar.tsx:47` - `.catch(console.error)`
- `MessagesFeature.tsx:376` - `console.error('Failed to toggle favorite:', err)`

**Fix:** Use the logger utility above.

---

## Part 6: Performance Improvements

### 6.1 Reduce Polling Frequency

**Sidebar.tsx:108-111** - Polls every 2 seconds

**Fix:** Use smart polling with backoff

```typescript
// src/hooks/useSmartPolling.ts
export function useSmartPolling(
  callback: () => void,
  intervalMs: number,
  options?: { enabled?: boolean }
) {
  useEffect(() => {
    if (options?.enabled === false) return;

    callback();
    const interval = setInterval(callback, intervalMs);
    return () => clearInterval(interval);
  }, [callback, intervalMs, options?.enabled]);
}

// Usage - poll less frequently when tab is hidden
const [isVisible, setIsVisible] = useState(true);
useEffect(() => {
  const handleVisibility = () => setIsVisible(!document.hidden);
  document.addEventListener('visibilitychange', handleVisibility);
  return () => document.removeEventListener('visibilitychange', handleVisibility);
}, []);

useSmartPolling(loadGroups, isVisible ? 2000 : 10000);
```

---

## Part 7: Implementation Order

### Phase 1: Create Shared Utilities (No Breaking Changes)
1. Create `src/utils/nameFormatters.ts`
2. Create `src/utils/backgroundSettings.ts`
3. Create `src/utils/logger.ts`
4. Create `src/config/colors.ts`
5. Create `src/config/constants.ts`
6. Create `src/config/groupConfig.ts`

### Phase 2: Consolidate Types
7. Move `BackgroundSettings` to `src/types/index.ts`
8. Update imports in `ChatHeaderMenu.tsx` and `BackgroundModal.tsx`

### Phase 3: Refactor Components (One at a Time)
9. Update `MessagesFeature.tsx` - use shared utilities
10. Update `Sidebar.tsx` - use shared utilities
11. Update `MessageBubble.tsx` - use constants
12. Update `BackgroundModal.tsx` - use shared type
13. Update `MemberProfilePopup.tsx` - add service parameter

### Phase 4: Create Custom Hooks
14. Create `src/hooks/useReadState.ts`
15. Create `src/hooks/useSmartPolling.ts`
16. Update components to use hooks

### Phase 5: Verification
17. Run TypeScript compiler (`tsc --noEmit`)
18. Run linter (`npm run lint`)
19. Build verification (`npm run build`)
20. Manual testing of all message features

---

## Summary Table

| Category | Issues Found | Priority |
|----------|-------------|----------|
| Duplicate Functions | 3 patterns | HIGH |
| Duplicate Types | 1 (BackgroundSettings) | HIGH |
| Hardcoded Colors | 12 occurrences | MEDIUM |
| Magic Numbers | 8 occurrences | MEDIUM |
| Type Safety | 4 weak annotations | MEDIUM |
| Service Handling | 2 missing parameters | HIGH |
| Error Handling | 3 silent catches | MEDIUM |
| Performance | 1 polling issue | LOW |

---

## Success Criteria

- [ ] All duplicate code extracted to shared utilities
- [ ] All hardcoded values moved to config files
- [ ] BackgroundSettings type consolidated
- [ ] Service parameter added to all APIs
- [ ] Silent catches replaced with proper logging
- [ ] Build passes with no errors
- [ ] All message features work correctly
