# HakoDesk UI Architecture Design

> **Date:** 2026-01-14
> **Status:** Approved
> **Scope:** Multi-service, multi-feature layout architecture

---

## Overview

HakoDesk will support multiple services (Nogizaka46, Sakurazaka46, Hinatazaka46, etc.) with multiple features per service (Messages, Blogs, News, Fan Club, AI Agent, etc.). This document defines the UI architecture to organize these components.

---

## Layout Architecture

### 3-Zone Discord-Style Layout

```
┌──────┬──────┬────────────────────────────────────────────┐
│      │      │                                            │
│ [HI] │ 💬   │         Zone C: Content Area               │
│      │ 📝   │         (flexible, feature-defined)        │
│ [SA] │ 📰   │                                            │
│      │ ⭐   │  Each feature owns its layout entirely     │
│ [NO] │ 🤖   │                                            │
│      │      │                                            │
└──────┴──────┴────────────────────────────────────────────┘
  Zone A  Zone B              Zone C
 (56px)  (48px)              (flex)
```

### Zone Definitions

| Zone | Name | Width | Purpose |
|------|------|-------|---------|
| A | ServiceRail | 56px | Service selector icons (Hinatazaka, Sakurazaka, Nogizaka) |
| B | FeatureRail | 48px | Feature icons for selected service (Messages, Blogs, etc.) |
| C | ContentArea | flex | Full content area, layout defined by each feature |

---

## Zone A: ServiceRail

**Purpose:** Switch between services (idol groups).

**Behavior:**
- Vertical list of service icons
- Each icon shows group color/logo
- Active service highlighted with indicator bar
- Clicking switches the active service
- FeatureRail (Zone B) updates to show that service's available features

**Visual:**
- Circular icons with group colors
- Active indicator: vertical bar on left edge
- Hover: slight scale + opacity change

---

## Zone B: FeatureRail

**Purpose:** Switch between features within the selected service.

**Key Design Decisions:**

### 1. Per-Service Feature Availability
- Backend defines which features are available for each service
- FeatureRail only renders icons for available features
- Example: Fan Club might only be available for Hinatazaka initially

### 2. User-Reorderable Icons
- Users can drag to reorder feature icons
- Order preference persisted to settings
- Default order defined per service

### 3. No Duplicate Code
- Single `FeatureRail` component handles all logic
- Feature definitions stored in configuration
- Icon rendering driven by data, not hardcoded

**Data Structure:**
```typescript
interface FeatureDefinition {
  id: string;           // 'messages' | 'blogs' | 'news' | 'fanclub' | 'ai'
  icon: LucideIcon;     // Icon component
  label: string;        // Display name
  available: boolean;   // Whether feature is ready for this service
}

interface ServiceFeatures {
  [serviceId: string]: FeatureDefinition[];
}
```

**Visual:**
- Vertical list of feature icons
- Active feature highlighted
- Tooltip on hover shows feature name
- Drag handle appears on hover for reordering

---

## Zone C: ContentArea

**Purpose:** Display the active feature's content.

**Key Design Decision: Feature Owns Layout**

Each feature defines its own layout entirely. Zone C simply renders the active feature's component with full available space.

| Feature | Layout | Notes |
|---------|--------|-------|
| Messages | 2-column (member sidebar + chat) | Existing design, special case |
| Blogs | TBD | Full-page, decided at implementation |
| News | TBD | Full-page, decided at implementation |
| Fan Club | TBD | Full-page, decided at implementation |
| AI Agent | TBD | Full-page chat, decided at implementation |

**Why flexible:**
- Different features have fundamentally different UX needs
- Messages requires frequent member switching (sidebar makes sense)
- Reading features (Blogs, News) benefit from full-width
- Locking in navigation patterns now would constrain future design

**Implementation:**
```typescript
// Zone C renders the active feature's component
<ContentArea>
  {activeFeature === 'messages' && <MessagesFeature />}
  {activeFeature === 'blogs' && <BlogsFeature />}
  {activeFeature === 'news' && <NewsFeature />}
  {/* etc */}
</ContentArea>
```

---

## Component Hierarchy

```
App
├── Layout
│   ├── ServiceRail (Zone A)
│   │   └── ServiceIcon[]
│   ├── FeatureRail (Zone B)
│   │   └── FeatureIcon[] (draggable)
│   └── ContentArea (Zone C)
│       └── {ActiveFeatureComponent}
│           ├── MessagesFeature (2-column)
│           ├── BlogsFeature (TBD)
│           ├── NewsFeature (TBD)
│           ├── FanClubFeature (TBD)
│           └── AIAgentFeature (TBD)
```

---

## State Management

### Global State
```typescript
interface AppState {
  // Service selection
  activeService: string;              // 'hinatazaka' | 'sakurazaka' | 'nogizaka'

  // Feature selection (per service)
  activeFeature: {
    [serviceId: string]: string;      // e.g., { hinatazaka: 'messages' }
  };

  // Feature order preference (per service)
  featureOrder: {
    [serviceId: string]: string[];    // e.g., { hinatazaka: ['messages', 'blogs', ...] }
  };
}
```

### Feature-Specific State
Each feature manages its own internal state. MessagesFeature has member selection, BlogsFeature has article selection, etc.

---

## Migration from Existing Code

### Existing Components to Refactor
- `ServiceRail.tsx` - Update to match this design (ignore current implementation if it conflicts)
- `Layout.tsx` - Refactor to 3-zone architecture
- `GroupSidebar.tsx` - Becomes part of MessagesFeature

### New Components to Create
- `FeatureRail.tsx` - New Zone B component
- `ContentArea.tsx` - Zone C container
- `MessagesFeature.tsx` - Wraps existing messages UI
- Feature components for Blogs, News, etc. (as implemented)

---

## Deferred Decisions

The following will be decided when implementing each feature:

1. **Zone C navigation patterns** - Breadcrumb vs mobile-style vs sidebar peek
2. **Blog feature layout** - Member list → post list → reader flow
3. **News feature layout** - Article list presentation
4. **Fan Club feature layout** - Content organization
5. **AI Agent feature layout** - Chat interface design

---

## Success Criteria

1. User can switch between services via Zone A
2. Zone B shows only available features for selected service
3. User can reorder features in Zone B (persisted)
4. Zone C renders full-width content for active feature
5. Messages feature maintains existing 2-column layout
6. No duplicate code between features for shared functionality

---

## Related Documents

- [ROADMAP.md](../ROADMAP.md) - P1.4 Multi-service support, P3.14 Blog support
