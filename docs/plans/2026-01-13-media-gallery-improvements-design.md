# Media Gallery Improvements Design

## Summary

Three improvements to the MediaGalleryModal:
1. Jump to Date scrolls to specific item (not just month)
2. Voice tab bottom player gets contextual info header
3. Video tab uses lazy loading with fade-in animation

## 1. Jump to Date - Scroll to Specific Item

**Current:** Scrolls to month header only.

**New:** Scroll directly to first item on the selected date.

### Implementation

- Add `itemRefs` Map keyed by date string (YYYY-MM-DD)
- Each grid/list item registers with its date key (first item per date only)
- `handleCalendarDateSelect` looks up item by date, falls back to month

### Changes

**MediaGalleryModal.tsx:**
- Add `itemRefs = useRef<Map<string, HTMLElement>>(new Map())`
- In render loops, register first item of each date to `itemRefs`
- Update `handleCalendarDateSelect` to try `itemRefs` first

## 2. Voice Tab - Improved Bottom Player

**Current:** Basic gray bar with VoicePlayer.

**New:** Info header showing currently selected voice details.

### Layout

```
┌─────────────────────────────────────┐
│  [Avatar] Member Name               │
│  2025/11/05 22:45  •  00:55         │
├─────────────────────────────────────┤
│  [VoicePlayer component]            │
└─────────────────────────────────────┘
```

### Changes

**MediaGalleryModal.tsx (renderVoiceList):**
- Add info row above VoicePlayer showing:
  - Small avatar (32px)
  - Member name
  - Timestamp and duration
- Add subtle shadow to elevate player area
- Softer background color

## 3. Video Tab - Lazy Loading with Fade Animation

**Current:** All videos load immediately, causes lag on fast scroll.

**New:** Videos load only when visible, with smooth fade-in.

### Implementation

**New component: LazyVideo.tsx**

```typescript
interface LazyVideoProps {
  src: string;
  className?: string;
  children?: React.ReactNode; // Overlay content (mute icon, duration)
  onClick?: () => void;
}
```

**Behavior:**
1. Show placeholder (gray bg + Film icon) initially
2. IntersectionObserver detects when entering viewport
3. Create video element, start loading metadata
4. On `loadeddata` event: crossfade (400ms ease-out)
5. Placeholder fades out, video fades in

**Placeholder:**
- `bg-gray-200` background
- Centered Film icon (`text-gray-400`)
- Same `aspect-square` sizing

**Transition:**
- Placeholder and video layered (absolute positioning)
- Video: `opacity-0` → `opacity-100` (400ms)
- CSS transition for smooth animation

### Changes

**New file: components/LazyVideo.tsx**
- Self-contained component with IntersectionObserver
- Handles loading state internally
- Accepts overlay children for badges

**MediaGalleryModal.tsx:**
- Replace `<video>` in video grid with `<LazyVideo>`
- Pass mute icon and duration as children

## File Changes Summary

| File | Changes |
|------|---------|
| MediaGalleryModal.tsx | Add itemRefs, update date select handler, improve voice player area, use LazyVideo |
| LazyVideo.tsx | New component for lazy-loaded video thumbnails |

## Testing

1. Jump to Date: Select a specific date, verify scrolls to first item on that date
2. Voice player: Select different voices, verify info updates in player area
3. Video lazy loading: Fast scroll through videos, verify smooth loading without lag
4. Fade animation: Watch videos fade in smoothly as they become visible
