# Frontend Codebase Restructure Design

**Date:** 2026-01-17
**Status:** Approved for Implementation

## Problem Statement

The frontend codebase started with only Messages support, then Blogs was added. After several refactoring rounds:
- File naming has drifted from actual functionality
- 28 top-level components in `/components` lack organization
- `App.tsx` is 945 lines (monolithic)
- Utilities are scattered between `lib/` and `utils/`
- Tests are mixed with source files

## Goals

1. **Domain-based organization** - Group related files together
2. **Clear naming** - Files named for what they actually do
3. **Modular structure** - Self-contained feature modules
4. **Clean imports** - Barrel exports for every directory
5. **Reduced complexity** - Split large files into focused modules

## New Directory Structure

```
src/
├── features/                   # Feature modules (self-contained)
│   ├── messages/               # Messages feature
│   │   ├── components/         # ChatList→MessageList, MessageBubble, etc.
│   │   ├── hooks/              # useChatScroll
│   │   └── index.ts            # Barrel export
│   └── blogs/                  # Blogs feature (keep existing structure)
│       ├── components/         # Existing 11 components
│       ├── hooks/              # useBlogTheme
│       ├── api.ts              # Move from api/blogs.ts
│       └── index.ts
├── core/                       # Core app infrastructure
│   ├── layout/                 # Layout, ServiceRail, FeatureRail, ContentArea
│   ├── modals/                 # All modal components (10+)
│   ├── media/                  # VoicePlayer, LazyVideo, MediaGalleryModal
│   └── common/                 # BaseModal, SafeImage, ModalStates
├── shell/                      # App shell
│   ├── App.tsx                 # Slimmed down main component
│   ├── AppProviders.tsx        # Extract: auth logic
│   ├── hooks/
│   │   ├── useSync.ts          # Sync orchestration
│   │   └── useSettings.ts      # Settings management
│   └── main.tsx
├── pages/                      # Keep as-is
├── data/                       # Keep memberColors.ts
├── config/                     # Keep as-is
├── store/                      # Rename from stores/
├── types/                      # Consolidate all types
├── utils/                      # Merge lib/ into utils/
├── i18n/                       # Keep as-is
├── constants/                  # Keep as-is
└── __tests__/                  # Keep test infrastructure
```

## File Moves & Renames

### Phase 1: Messages Feature Extraction

| Current Location | New Location | Rename Reason |
|-----------------|--------------|---------------|
| `components/Sidebar.tsx` | `features/messages/components/MemberList.tsx` | Lists members, not a generic sidebar |
| `components/GroupSidebar.tsx` | `features/messages/components/GroupMemberList.tsx` | Consistency |
| `components/ChatList.tsx` | `features/messages/components/MessageList.tsx` | Displays messages |
| `components/MessageBubble.tsx` | `features/messages/components/MessageBubble.tsx` | Keep |
| `components/MessageContextMenu.tsx` | `features/messages/components/MessageContextMenu.tsx` | Keep |
| `components/ChatHeaderMenu.tsx` | `features/messages/components/ConversationMenu.tsx` | More descriptive |
| `components/MemberProfilePopup.tsx` | `features/messages/components/MemberProfilePopup.tsx` | Keep |
| `hooks/useChatScroll.ts` | `features/messages/hooks/useChatScroll.ts` | Feature-specific |
| `components/features/MessagesFeature.tsx` | `features/messages/MessagesFeature.tsx` | Feature root |

### Phase 2: Core Infrastructure

#### Layout Components → `core/layout/`
| Current | New |
|---------|-----|
| `components/Layout.tsx` | `core/layout/Layout.tsx` |
| `components/ServiceRail.tsx` | `core/layout/ServiceRail.tsx` |
| `components/FeatureRail.tsx` | `core/layout/FeatureRail.tsx` |
| `components/ContentArea.tsx` | `core/layout/ContentArea.tsx` |

#### Modal Components → `core/modals/`
| Current | New |
|---------|-----|
| `components/CalendarModal.tsx` | `core/modals/CalendarModal.tsx` |
| `components/FavoritesModal.tsx` | `core/modals/FavoritesModal.tsx` |
| `components/SentLettersModal.tsx` | `core/modals/SentLettersModal.tsx` |
| `components/BackgroundModal.tsx` | `core/modals/BackgroundModal.tsx` |
| `components/ReportIssueModal.tsx` | `core/modals/ReportIssueModal.tsx` |
| `components/DiagnosticsModal.tsx` | `core/modals/DiagnosticsModal.tsx` |
| `components/AboutModal.tsx` | `core/modals/AboutModal.tsx` |
| `components/UpdateBanner.tsx` | `core/modals/UpdateBanner.tsx` |

#### Media Components → `core/media/`
| Current | New |
|---------|-----|
| `components/VoicePlayer.tsx` | `core/media/VoicePlayer.tsx` |
| `components/LazyVideo.tsx` | `core/media/LazyVideo.tsx` |
| `components/MediaGalleryModal.tsx` | `core/media/MediaGalleryModal.tsx` |

#### Common Components → `core/common/`
| Current | New |
|---------|-----|
| `components/common/BaseModal.tsx` | `core/common/BaseModal.tsx` |
| `components/common/ModalStates.tsx` | `core/common/ModalStates.tsx` |
| `components/common/SafeImage.tsx` | `core/common/SafeImage.tsx` |
| `components/ui/DynamicBackground.tsx` | `core/common/DynamicBackground.tsx` |
| `components/Portal.tsx` | `core/common/Portal.tsx` |
| `components/ErrorBoundary.tsx` | `core/common/ErrorBoundary.tsx` |

### Phase 3: Blogs Feature Reorganization

| Current | New |
|---------|-----|
| `api/blogs.ts` | `features/blogs/api.ts` |
| `hooks/useBlogTheme.ts` | `features/blogs/hooks/useBlogTheme.ts` |
| `components/features/BlogsFeature.tsx` | `features/blogs/BlogsFeature.tsx` |
| `components/features/blogs/*` | `features/blogs/components/*` |

### Phase 4: Shell & Utilities

| Current | New | Notes |
|---------|-----|-------|
| `App.tsx` | `shell/App.tsx` | Will be decomposed |
| `main.tsx` | `shell/main.tsx` | Entry point |
| `ErrorBoundary.tsx` (root) | DELETE | Duplicate, use core/common/ |
| `lib/utils.ts` | `utils/classnames.ts` | Rename: describes `cn()` |
| `stores/` | `store/` | Rename: singular |

### Phase 5: App.tsx Decomposition

Extract from 945-line App.tsx:

1. **`shell/hooks/useAuth.ts`** - Auth state, token refresh
2. **`shell/hooks/useSync.ts`** - Sync orchestration, progress
3. **`shell/hooks/useSettings.ts`** - Settings state, auto-sync
4. **`shell/AppModals.tsx`** - Modal state management

## Barrel Exports

Every directory gets an `index.ts`:

```typescript
// features/messages/index.ts
export { MessagesFeature } from './MessagesFeature';
export * from './components';
export * from './hooks';

// core/layout/index.ts
export { Layout } from './Layout';
export { ServiceRail } from './ServiceRail';
export { FeatureRail } from './FeatureRail';
export { ContentArea } from './ContentArea';

// core/modals/index.ts
export { CalendarModal } from './CalendarModal';
export { FavoritesModal } from './FavoritesModal';
// ... etc
```

## Import Path Updates

After restructure, imports become cleaner:

```typescript
// Before
import { Sidebar } from '../components/Sidebar';
import { ChatList } from '../components/ChatList';
import { CalendarModal } from '../components/CalendarModal';

// After
import { MemberList, MessageList } from '@/features/messages';
import { CalendarModal } from '@/core/modals';
import { Layout } from '@/core/layout';
```

## Implementation Order

1. Create new directory structure (empty folders)
2. Move files with git mv (preserve history)
3. Rename files where needed
4. Update all imports
5. Add barrel exports
6. Decompose App.tsx
7. Run build to verify
8. Run tests to verify
9. Commit with descriptive message

## Success Criteria

- [ ] Build passes with no TypeScript errors
- [ ] All tests pass
- [ ] No files in `components/` root except index.ts
- [ ] All features self-contained in `features/`
- [ ] App.tsx under 300 lines
- [ ] Every directory has barrel export
- [ ] Git history preserved via `git mv`
