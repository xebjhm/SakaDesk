# Timeline Rail Fisheye Zoom Design

## Problem

Members with 800-900+ blogs make precise navigation difficult. With ~400px rail height, each blog gets <0.5px - impossible to pinpoint specific posts.

## Solution

macOS Dock-style fisheye magnification that activates after a 400ms dwell. The region around the cursor expands to show finer detail while compressing distant areas.

## Interaction Flow

1. **Normal mode**: Current proportional mapping behavior
2. **Dwell detection**: After hovering in same area (±10 posts) for 400ms, zoom activates
3. **Zoomed mode**: ±50 posts around cursor expand to ~50% of rail height
4. **Exit**: Mouse leaves rail entirely → zoom deactivates with 200ms transition

## Technical Design

### State

```typescript
const [isZoomed, setIsZoomed] = useState(false);
const [zoomCenter, setZoomCenter] = useState<number | null>(null);
const dwellTimerRef = useRef<NodeJS.Timeout | null>(null);
const lastHoverIndex = useRef<number | null>(null);
```

### Fisheye Mapping Function

Two functions needed:
- `indexToPosition(index, zoomCenter, isZoomed)` - for positioning current indicator
- `positionToIndex(y, zoomCenter, isZoomed)` - for mouse hit testing

When zoomed:
- Posts within ±50 of center: expanded spacing (5x normal)
- Posts outside: compressed spacing
- Smooth falloff using easing function (no hard edges)

### Parameters

| Parameter | Value |
|-----------|-------|
| Dwell time | 400ms |
| Dwell tolerance | ±10 posts |
| Magnified window | ±50 posts |
| Magnification | 5x |
| Transition | 200ms ease-out |

### Visual Feedback

- Track glows with oshi color when zoomed
- Year labels reposition according to fisheye distortion
- Current position indicator follows the distorted mapping

## Files to Modify

- `TimelineRail.tsx` - Add zoom state, fisheye functions, dwell detection
