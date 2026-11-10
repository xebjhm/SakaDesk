// frontend/src/features/blogs/components/fisheye.ts
// The fisheye zoom of the timeline rails (blogs `TimelineRail`, memoir `MonthRail`), extracted
// from TimelineRail (e4e4118): items near the zoom centre spread `magnification` times apart over
// a `magnifiedWindow`-item window, the rest of the rail is compressed to make room. The pointer
// mapping (`fisheyeIndex`) is e4e4118's; `fisheyePosition` is its exact, monotonic inverse.

/** Fisheye zoom configuration: dwell before zooming (ms), index tolerance, window and strength. */
export const ZOOM_CONFIG = {
    dwellTime: 800,
    dwellTolerance: 10,
    magnifiedWindow: 50,
    magnification: 5,
};

/**
 * Item `index` of `count` → its normalized position on the rail (0–1). Without a `center`
 * (no zoom) the items are evenly spaced. With one (the zoom centre's index) this is the exact
 * inverse of {@link fisheyeIndex}: piecewise linear and monotonic, items within the window
 * `magnification` times apart, the rest compressed into the space left, so what is drawn at a
 * position is what the pointer selects there (e4e4118's smoothstep folded and jumped instead).
 */
export function fisheyePosition(index: number, count: number, center: number | null): number {
    if (count <= 1) return 0;
    const normalizedIndex = index / (count - 1);

    if (center === null) {
        return normalizedIndex;
    }

    const c = center / (count - 1);
    // Clamp windowSize so magnified region doesn't exceed available space
    const rawWindowSize = ZOOM_CONFIG.magnifiedWindow / (count - 1);
    const mag = ZOOM_CONFIG.magnification;
    const windowSize = Math.min(rawWindowSize, 0.45 / mag);
    const magnifiedSpace = windowSize * mag;

    const dist = normalizedIndex - c;
    const absDist = Math.abs(dist);
    const sign = dist >= 0 ? 1 : -1;

    let offset: number;
    if (absDist <= windowSize) {
        offset = absDist * mag;
    } else {
        const remainingSpace = Math.max((1 - magnifiedSpace * 2) / 2, 0.01);
        const normalRemaining = Math.max(0.5 - windowSize, 0.001);
        offset = magnifiedSpace + (absDist - windowSize) * (remainingSpace / normalRemaining);
    }
    return Math.max(0, Math.min(1, c + sign * offset));
}

/** The inverse of {@link fisheyePosition}: a normalized rail position (0–1) → the nearest item index. */
export function fisheyeIndex(pos: number, count: number, center: number | null): number {
    if (count <= 1) return 0;

    if (center === null) {
        return Math.round(pos * (count - 1));
    }

    const c = center / (count - 1);
    const rawWindowSize = ZOOM_CONFIG.magnifiedWindow / (count - 1);
    const mag = ZOOM_CONFIG.magnification;
    const windowSize = Math.min(rawWindowSize, 0.45 / mag);
    const magnifiedSpace = windowSize * mag;

    const dist = pos - c;
    const absDist = Math.abs(dist);

    let normalizedIndex: number;

    if (absDist <= magnifiedSpace) {
        const sign = dist >= 0 ? 1 : -1;
        const originalDist = (absDist / mag);
        normalizedIndex = c + sign * originalDist;
    } else {
        const remainingSpace = Math.max((1 - magnifiedSpace * 2) / 2, 0.01);
        const normalRemaining = Math.max(0.5 - windowSize, 0.001);

        if (dist > 0) {
            const compressedDist = absDist - magnifiedSpace;
            const originalDist = compressedDist * (normalRemaining / remainingSpace);
            normalizedIndex = c + windowSize + originalDist;
        } else {
            const compressedDist = absDist - magnifiedSpace;
            const originalDist = compressedDist * (normalRemaining / remainingSpace);
            normalizedIndex = c - windowSize - originalDist;
        }
    }

    return Math.round(Math.max(0, Math.min(1, normalizedIndex)) * (count - 1));
}
