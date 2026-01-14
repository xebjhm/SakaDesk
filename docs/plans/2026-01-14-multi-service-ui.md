# P1.4 Multi-Service UI Architecture - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the 3-zone Discord-style layout architecture to support multiple services (Hinatazaka46, Sakurazaka46, Nogizaka46) with multiple features per service.

**Architecture:** Zone A (ServiceRail) for service switching, Zone B (FeatureRail) for feature switching, Zone C (ContentArea) renders the active feature. Current messages functionality becomes MessagesFeature within Zone C.

**Tech Stack:** React + TypeScript + Tailwind, Zustand (state management), lucide-react (icons)

**Reference:** [2026-01-14-ui-architecture-design.md](./2026-01-14-ui-architecture-design.md)

---

## Prerequisites

- Existing codebase with working messages UI in `App.tsx`
- ServiceRail.tsx exists but needs refactoring
- Layout.tsx exists but needs refactoring to 3-zone architecture

---

## Task 1: Install Zustand for State Management

**Files:**
- Modify: `frontend/package.json`

**Step 1: Install Zustand**

Run: `cd HakoDesk/frontend && npm install zustand`

**Step 2: Verify installation**

Run: `cd HakoDesk/frontend && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: add zustand for state management"
```

---

## Task 2: Create App State Store

**Files:**
- Create: `frontend/src/stores/appStore.ts`

**Step 1: Create the store with service/feature state**

```typescript
// frontend/src/stores/appStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type FeatureId = 'messages' | 'blogs' | 'news' | 'fanclub' | 'ai';

interface AppState {
    // Service selection
    activeService: string | null;
    setActiveService: (service: string) => void;

    // Feature selection (per service)
    activeFeatures: Record<string, FeatureId>;
    setActiveFeature: (service: string, feature: FeatureId) => void;
    getActiveFeature: (service: string) => FeatureId;

    // Feature order preference (per service) - for drag reordering
    featureOrders: Record<string, FeatureId[]>;
    setFeatureOrder: (service: string, order: FeatureId[]) => void;
    getFeatureOrder: (service: string) => FeatureId[];
}

const DEFAULT_FEATURE_ORDER: FeatureId[] = ['messages', 'blogs', 'news', 'fanclub', 'ai'];

export const useAppStore = create<AppState>()(
    persist(
        (set, get) => ({
            activeService: null,
            setActiveService: (service) => set({ activeService: service }),

            activeFeatures: {},
            setActiveFeature: (service, feature) =>
                set((state) => ({
                    activeFeatures: { ...state.activeFeatures, [service]: feature },
                })),
            getActiveFeature: (service) => get().activeFeatures[service] || 'messages',

            featureOrders: {},
            setFeatureOrder: (service, order) =>
                set((state) => ({
                    featureOrders: { ...state.featureOrders, [service]: order },
                })),
            getFeatureOrder: (service) => get().featureOrders[service] || DEFAULT_FEATURE_ORDER,
        }),
        {
            name: 'hakodesk-app-state',
            partialize: (state) => ({
                activeService: state.activeService,
                activeFeatures: state.activeFeatures,
                featureOrders: state.featureOrders,
            }),
        }
    )
);
```

**Step 2: Verify TypeScript compiles**

Run: `cd HakoDesk/frontend && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add frontend/src/stores/appStore.ts
git commit -m "feat(ui): add zustand app state store for service/feature selection"
```

---

## Task 3: Create Feature Configuration

**Files:**
- Create: `frontend/src/config/features.ts`

**Step 1: Create feature definitions**

```typescript
// frontend/src/config/features.ts
import { MessageSquare, BookOpen, Newspaper, Star, Bot, LucideIcon } from 'lucide-react';
import { FeatureId } from '../stores/appStore';

export interface FeatureDefinition {
    id: FeatureId;
    icon: LucideIcon;
    label: string;
    labelJa: string;
}

export const FEATURE_DEFINITIONS: Record<FeatureId, FeatureDefinition> = {
    messages: {
        id: 'messages',
        icon: MessageSquare,
        label: 'Messages',
        labelJa: 'メッセージ',
    },
    blogs: {
        id: 'blogs',
        icon: BookOpen,
        label: 'Blogs',
        labelJa: 'ブログ',
    },
    news: {
        id: 'news',
        icon: Newspaper,
        label: 'News',
        labelJa: 'ニュース',
    },
    fanclub: {
        id: 'fanclub',
        icon: Star,
        label: 'Fan Club',
        labelJa: 'ファンクラブ',
    },
    ai: {
        id: 'ai',
        icon: Bot,
        label: 'AI Agent',
        labelJa: 'AIエージェント',
    },
};

// Which features are available per service
// For now, only messages is available. Others will be enabled as implemented.
export const SERVICE_FEATURES: Record<string, FeatureId[]> = {
    'Hinatazaka46': ['messages'],
    'Sakurazaka46': ['messages'],
    'Nogizaka46': ['messages'],
    // Default for any service
    default: ['messages'],
};

export function getAvailableFeatures(service: string): FeatureDefinition[] {
    const featureIds = SERVICE_FEATURES[service] || SERVICE_FEATURES.default;
    return featureIds.map(id => FEATURE_DEFINITIONS[id]);
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd HakoDesk/frontend && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add frontend/src/config/features.ts
git commit -m "feat(ui): add feature configuration for multi-service support"
```

---

## Task 4: Refactor ServiceRail (Zone A)

**Files:**
- Modify: `frontend/src/components/ServiceRail.tsx`

**Step 1: Update ServiceRail to use Zustand store**

```typescript
// frontend/src/components/ServiceRail.tsx
import React from 'react';
import { cn } from '../lib/utils';
import { useAppStore } from '../stores/appStore';

export interface ServiceRailProps {
    services: string[];
}

const getInitials = (name: string) => {
    if (name === 'Hinatazaka46') return 'HI';
    if (name === 'Sakurazaka46') return 'SA';
    if (name === 'Nogizaka46') return 'NO';
    return name.substring(0, 2).toUpperCase();
};

const getServiceColor = (name: string) => {
    if (name === 'Hinatazaka46') return 'bg-[#7cc7e8]'; // Sky Blue
    if (name === 'Sakurazaka46') return 'bg-[#f19db5]'; // Sakura Pink
    if (name === 'Nogizaka46') return 'bg-[#7e1083]';   // Purple
    return 'bg-gray-500';
};

export const ServiceRail: React.FC<ServiceRailProps> = ({ services }) => {
    const { activeService, setActiveService } = useAppStore();

    return (
        <div className="w-14 bg-[#1e1f22] h-full flex flex-col items-center py-3 gap-2 shrink-0">
            {services.map(service => {
                const isActive = activeService === service;
                const colorClass = getServiceColor(service);

                return (
                    <button
                        key={service}
                        onClick={() => setActiveService(service)}
                        className={cn(
                            "group relative w-12 h-12 rounded-[24px] flex items-center justify-center transition-all duration-200",
                            isActive ? "rounded-[16px]" : "hover:rounded-[16px]"
                        )}
                        title={service}
                    >
                        {/* Active Indicator Pill */}
                        <div className={cn(
                            "absolute left-0 top-1/2 -translate-y-1/2 w-1 bg-white rounded-r-full transition-all",
                            isActive ? "h-10" : "h-0 group-hover:h-5"
                        )} />

                        {/* Service Icon */}
                        <div className={cn(
                            "w-12 h-12 rounded-[24px] flex items-center justify-center text-white font-bold text-sm transition-all duration-200",
                            colorClass,
                            isActive ? "rounded-[16px]" : "group-hover:rounded-[16px]"
                        )}>
                            {getInitials(service)}
                        </div>
                    </button>
                );
            })}
        </div>
    );
};
```

**Step 2: Verify TypeScript compiles**

Run: `cd HakoDesk/frontend && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add frontend/src/components/ServiceRail.tsx
git commit -m "refactor(ui): update ServiceRail to use Zustand store with Discord-style design"
```

---

## Task 5: Create FeatureRail (Zone B)

**Files:**
- Create: `frontend/src/components/FeatureRail.tsx`

**Step 1: Create FeatureRail component**

```typescript
// frontend/src/components/FeatureRail.tsx
import React from 'react';
import { cn } from '../lib/utils';
import { useAppStore, FeatureId } from '../stores/appStore';
import { getAvailableFeatures, FEATURE_DEFINITIONS } from '../config/features';

export interface FeatureRailProps {
    service: string;
}

export const FeatureRail: React.FC<FeatureRailProps> = ({ service }) => {
    const { getActiveFeature, setActiveFeature, getFeatureOrder } = useAppStore();

    const activeFeature = getActiveFeature(service);
    const featureOrder = getFeatureOrder(service);
    const availableFeatures = getAvailableFeatures(service);

    // Sort available features by user preference
    const sortedFeatures = [...availableFeatures].sort((a, b) => {
        const aIndex = featureOrder.indexOf(a.id);
        const bIndex = featureOrder.indexOf(b.id);
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
    });

    return (
        <div className="w-12 bg-[#2b2d31] h-full flex flex-col items-center py-3 gap-1 shrink-0 border-r border-[#1e1f22]">
            {sortedFeatures.map(feature => {
                const isActive = activeFeature === feature.id;
                const Icon = feature.icon;

                return (
                    <button
                        key={feature.id}
                        onClick={() => setActiveFeature(service, feature.id)}
                        className={cn(
                            "group relative w-10 h-10 rounded-lg flex items-center justify-center transition-all",
                            isActive
                                ? "bg-[#404249] text-white"
                                : "text-[#949ba4] hover:text-white hover:bg-[#35373c]"
                        )}
                        title={feature.label}
                    >
                        {/* Active indicator */}
                        {isActive && (
                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-white rounded-r-full" />
                        )}

                        <Icon className="w-5 h-5" />
                    </button>
                );
            })}

            {/* Separator and future features hint */}
            {availableFeatures.length < Object.keys(FEATURE_DEFINITIONS).length && (
                <>
                    <div className="w-8 h-px bg-[#3f4147] my-2" />
                    <div className="text-[10px] text-[#949ba4] text-center px-1">
                        More coming soon
                    </div>
                </>
            )}
        </div>
    );
};
```

**Step 2: Verify TypeScript compiles**

Run: `cd HakoDesk/frontend && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add frontend/src/components/FeatureRail.tsx
git commit -m "feat(ui): add FeatureRail component (Zone B)"
```

---

## Task 6: Create ContentArea (Zone C)

**Files:**
- Create: `frontend/src/components/ContentArea.tsx`

**Step 1: Create ContentArea component**

```typescript
// frontend/src/components/ContentArea.tsx
import React from 'react';
import { useAppStore, FeatureId } from '../stores/appStore';

interface ContentAreaProps {
    service: string;
    // MessagesFeature will need these props initially
    messagesContent: React.ReactNode;
}

export const ContentArea: React.FC<ContentAreaProps> = ({
    service,
    messagesContent,
}) => {
    const { getActiveFeature } = useAppStore();
    const activeFeature = getActiveFeature(service);

    const renderFeature = () => {
        switch (activeFeature) {
            case 'messages':
                return messagesContent;
            case 'blogs':
                return (
                    <div className="flex-1 flex items-center justify-center text-gray-500">
                        <div className="text-center">
                            <p className="text-lg mb-2">Blogs Feature</p>
                            <p className="text-sm">Coming soon...</p>
                        </div>
                    </div>
                );
            case 'news':
                return (
                    <div className="flex-1 flex items-center justify-center text-gray-500">
                        <div className="text-center">
                            <p className="text-lg mb-2">News Feature</p>
                            <p className="text-sm">Coming soon...</p>
                        </div>
                    </div>
                );
            case 'fanclub':
                return (
                    <div className="flex-1 flex items-center justify-center text-gray-500">
                        <div className="text-center">
                            <p className="text-lg mb-2">Fan Club Feature</p>
                            <p className="text-sm">Coming soon...</p>
                        </div>
                    </div>
                );
            case 'ai':
                return (
                    <div className="flex-1 flex items-center justify-center text-gray-500">
                        <div className="text-center">
                            <p className="text-lg mb-2">AI Agent Feature</p>
                            <p className="text-sm">Coming soon...</p>
                        </div>
                    </div>
                );
            default:
                return messagesContent;
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#F0F2F5]">
            {renderFeature()}
        </div>
    );
};
```

**Step 2: Verify TypeScript compiles**

Run: `cd HakoDesk/frontend && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add frontend/src/components/ContentArea.tsx
git commit -m "feat(ui): add ContentArea component (Zone C)"
```

---

## Task 7: Refactor Layout to 3-Zone Architecture

**Files:**
- Modify: `frontend/src/components/Layout.tsx`

**Step 1: Update Layout to use 3-zone architecture**

```typescript
// frontend/src/components/Layout.tsx
import React, { useEffect } from 'react';
import { ServiceRail } from './ServiceRail';
import { FeatureRail } from './FeatureRail';
import { ContentArea } from './ContentArea';
import { useAppStore } from '../stores/appStore';
import { MultiGroupAuthStatus } from '../types';

interface LayoutProps {
    authStatus: MultiGroupAuthStatus | null;
    messagesContent: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({
    authStatus,
    messagesContent,
}) => {
    const { activeService, setActiveService } = useAppStore();

    // Get authenticated services
    const services = authStatus
        ? Object.entries(authStatus)
            .filter(([_, status]) => status.is_authenticated)
            .map(([name]) => name)
        : [];

    // Auto-select first service if none selected
    useEffect(() => {
        if (services.length > 0 && !activeService) {
            setActiveService(services[0]);
        }
    }, [services, activeService, setActiveService]);

    return (
        <div className="flex h-screen overflow-hidden">
            {/* Zone A: Service Rail */}
            <ServiceRail services={services} />

            {/* Zone B: Feature Rail (only show when service selected) */}
            {activeService && (
                <FeatureRail service={activeService} />
            )}

            {/* Zone C: Content Area */}
            {activeService ? (
                <ContentArea
                    service={activeService}
                    messagesContent={messagesContent}
                />
            ) : (
                <div className="flex-1 flex items-center justify-center bg-[#F0F2F5] text-gray-500">
                    <div className="text-center">
                        <p className="text-lg mb-2">Welcome to HakoDesk</p>
                        <p className="text-sm">Select a service to get started</p>
                    </div>
                </div>
            )}
        </div>
    );
};
```

**Step 2: Verify TypeScript compiles**

Run: `cd HakoDesk/frontend && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add frontend/src/components/Layout.tsx
git commit -m "refactor(ui): update Layout to 3-zone architecture"
```

---

## Task 8: Extract Messages Content from App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: Refactor App.tsx to use new Layout**

This is a large refactor. The key changes:

1. Remove the old sidebar-based layout
2. Use the new `Layout` component with 3 zones
3. Pass the messages UI as `messagesContent` prop

The messages UI (GroupSidebar + ChatList) becomes the content passed to Zone C when messages feature is active.

```typescript
// Key changes in App.tsx render section:

// Replace the current layout structure with:
return (
    <div className="flex flex-col h-screen overflow-hidden">
        {/* Update Banner */}
        <UpdateBanner />

        {/* Sync Modal - keep as is */}
        {showSyncModal && (/* ... existing sync modal ... */)}

        {/* Setup Wizard - keep as is */}
        {showSetupWizard && (/* ... existing setup wizard ... */)}

        {/* Main Layout */}
        <Layout
            authStatus={authStatus}
            messagesContent={
                <MessagesContent
                    // Pass all the props needed for messages functionality
                    selectedGroupDir={selectedGroupDir}
                    onSelectGroup={handleSelectGroup}
                    // ... etc
                />
            }
        />

        {/* Modals - keep outside Layout */}
        <DiagnosticsModal ... />
        <AboutModal ... />
        {/* etc */}
    </div>
);
```

**Step 2: Create MessagesContent component inline or extract**

For this initial refactor, create the MessagesContent as a component within App.tsx that contains:
- GroupSidebar (member selection)
- ChatList (messages display)
- Chat header
- All related state and handlers

**Step 3: Verify app runs correctly**

Run: `cd HakoDesk/frontend && npm run dev`
Expected: App shows 3-zone layout, messages feature works as before

**Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "refactor(ui): integrate App.tsx with 3-zone Layout"
```

---

## Task 9: Create MessagesFeature Component

**Files:**
- Create: `frontend/src/components/features/MessagesFeature.tsx`
- Modify: `frontend/src/App.tsx`

**Step 1: Extract messages UI into dedicated component**

Create `frontend/src/components/features/MessagesFeature.tsx` that contains:
- GroupSidebar on the left (member selection within service)
- Chat area on the right (messages display)

This component receives the active service and handles all messages-related state.

```typescript
// frontend/src/components/features/MessagesFeature.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { GroupSidebar } from '../GroupSidebar';
import { ChatList } from '../ChatList';
import { ChatHeaderMenu } from '../ChatHeaderMenu';
import { MemberProfilePopup } from '../MemberProfilePopup';
// ... other imports

interface MessagesFeatureProps {
    activeService: string;
    // Shared state from App.tsx that MessagesFeature needs
    appSettings: AppSettings | null;
    syncProgress: SyncProgress;
    onOpenSettings: () => void;
    onOpenDiagnostics: () => void;
    onReportIssue: () => void;
}

export const MessagesFeature: React.FC<MessagesFeatureProps> = ({
    activeService,
    appSettings,
    syncProgress,
    onOpenSettings,
    onOpenDiagnostics,
    onReportIssue,
}) => {
    // All the messages-related state from App.tsx moves here
    const [selectedGroupDir, setSelectedGroupDir] = useState<string | undefined>();
    const [selectedName, setSelectedName] = useState<string | undefined>();
    const [isGroupChat, setIsGroupChat] = useState(false);
    const [messages, setMessages] = useState<GroupMessage[]>([]);
    // ... etc

    // Reset selection when service changes
    useEffect(() => {
        setSelectedGroupDir(undefined);
        setSelectedName(undefined);
        setMessages([]);
    }, [activeService]);

    return (
        <div className="flex h-full">
            {/* Member Sidebar */}
            <GroupSidebar
                activeService={activeService}
                onSelectGroup={handleSelectGroup}
                selectedGroupDir={selectedGroupDir}
                isSyncing={syncProgress.state === 'running'}
                onOpenSettings={onOpenSettings}
                onOpenDiagnostics={onOpenDiagnostics}
            />

            {/* Chat Area */}
            <div className="flex-1 flex flex-col">
                {/* Chat Header */}
                <header className="...">
                    {/* ... */}
                </header>

                {/* Chat List */}
                <div className="flex-1 overflow-hidden">
                    {selectedGroupDir ? (
                        <ChatList ... />
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-500">
                            Select a conversation
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
```

**Step 2: Update ContentArea to use MessagesFeature**

```typescript
// In ContentArea.tsx
import { MessagesFeature } from './features/MessagesFeature';

// Replace messagesContent prop with MessagesFeature component
case 'messages':
    return (
        <MessagesFeature
            activeService={service}
            appSettings={appSettings}
            syncProgress={syncProgress}
            onOpenSettings={onOpenSettings}
            onOpenDiagnostics={onOpenDiagnostics}
            onReportIssue={onReportIssue}
        />
    );
```

**Step 3: Verify messages feature works**

Run: `cd HakoDesk/frontend && npm run dev`
Expected: Can select service, see members, view messages

**Step 4: Commit**

```bash
git add frontend/src/components/features/MessagesFeature.tsx frontend/src/components/ContentArea.tsx frontend/src/App.tsx
git commit -m "feat(ui): extract MessagesFeature component for Zone C"
```

---

## Task 10: Update GroupSidebar to Filter by Service

**Files:**
- Modify: `frontend/src/components/GroupSidebar.tsx`

**Step 1: Ensure GroupSidebar filters groups by activeService**

The GroupSidebar already has `activeService` prop and filters by it. Verify the filtering logic is correct:

```typescript
// In GroupSidebar.tsx - verify this filtering exists:
const onlineGroups = sortGroups(
    groups.filter(g =>
        g.is_active !== false &&
        (!activeService || !g.service || g.service === activeService)
    )
);
const offlineGroups = sortGroups(
    groups.filter(g =>
        g.is_active === false &&
        (!activeService || !g.service || g.service === activeService)
    )
);
```

**Step 2: Test service switching**

Run: Switch between services and verify only relevant members show
Expected: Each service shows only its members

**Step 3: Commit (if changes needed)**

```bash
git add frontend/src/components/GroupSidebar.tsx
git commit -m "fix(ui): ensure GroupSidebar filters by active service"
```

---

## Task 11: Clean Up App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: Remove messages state that moved to MessagesFeature**

After extracting MessagesFeature, App.tsx should be much simpler:
- Auth state
- Sync state
- Settings state
- Modal states
- Layout rendering

Remove all the messages-specific state and handlers that now live in MessagesFeature.

**Step 2: Verify app still works**

Run: `cd HakoDesk/frontend && npm run dev`
Expected: Full functionality preserved

**Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "refactor(ui): clean up App.tsx after MessagesFeature extraction"
```

---

## Task 12: Add Index Exports

**Files:**
- Create: `frontend/src/stores/index.ts`
- Create: `frontend/src/config/index.ts`
- Create: `frontend/src/components/features/index.ts`

**Step 1: Create index files for clean imports**

```typescript
// frontend/src/stores/index.ts
export * from './appStore';

// frontend/src/config/index.ts
export * from './features';

// frontend/src/components/features/index.ts
export * from './MessagesFeature';
```

**Step 2: Verify imports work**

Run: `cd HakoDesk/frontend && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add frontend/src/stores/index.ts frontend/src/config/index.ts frontend/src/components/features/index.ts
git commit -m "chore(ui): add index exports for stores, config, and features"
```

---

## Task 13: Final Testing and Verification

**Files:**
- None (testing only)

**Step 1: Full end-to-end test**

Manual test checklist:
1. [ ] App loads with 3-zone layout
2. [ ] ServiceRail shows authenticated services
3. [ ] Clicking service switches activeService
4. [ ] FeatureRail shows available features (messages only for now)
5. [ ] Messages feature shows members filtered by service
6. [ ] Can select member and view messages
7. [ ] Chat functionality works (scroll, reveal, favorites)
8. [ ] Sync modal works
9. [ ] Settings modal works
10. [ ] Service switching preserves feature selection per service

**Step 2: Verify mobile responsiveness**

Test at various viewport sizes to ensure layout adapts.

**Step 3: Update roadmap**

Mark P1.4 as complete in `docs/ROADMAP.md`

**Step 4: Final commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: mark P1.4 Multi-service UI support as complete"
```

---

## Notes

### State Migration

The refactor moves state ownership:
- **App.tsx**: Auth, sync, settings, modals (global concerns)
- **appStore**: Service/feature selection (persisted)
- **MessagesFeature**: Chat state (conversation-specific)

### Future Features

When adding blogs support (P3.14), the ContentArea will import BlogsFeature and render it when `activeFeature === 'blogs'`.

### Drag Reordering

FeatureRail drag reordering is deferred. The `featureOrders` state is ready in the store, but the drag-drop UI will be added in a future task.

### Dark Theme

The ServiceRail and FeatureRail use Discord-like dark colors. ContentArea uses the existing light theme. This creates a visual hierarchy similar to Discord.
