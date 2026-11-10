// frontend/src/features/blogs/components/fisheye.ts
// The fisheye zoom of the timeline rails (blogs `TimelineRail`, memoir `MonthRail`), extracted
// verbatim from TimelineRail (e4e4118): items near the zoom centre spread `magnification` times
// apart over a `magnifiedWindow`-item window, the rest of the rail is compressed to make room.

/** Fisheye zoom configuration: dwell before zooming (ms), index tolerance, window and strength. */
export const ZOOM_CONFIG = {
    dwellTime: 800,
    dwellTolerance: 10,
    magnifiedWindow: 50,
    magnification: 5,
};

/**
 * Item `index` of `count` → its normalized position on the rail (0–1). Without a `center`
 * (no zoom) the items are evenly spaced; with one (the zoom centre's index) they are magnified.
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

    const dist = normalizedIndex - c;
    const absDist = Math.abs(dist);

    if (absDist <= windowSize) {
        const t = absDist / windowSize;
        const eased = t * t * (3 - 2 * t);
        const expandedDist = dist * (1 + (mag - 1) * (1 - eased));
        return Math.max(0, Math.min(1, c + expandedDist));
    } else {
        const magnifiedSpace = windowSize * mag;
        const remainingSpace = Math.max((1 - magnifiedSpace * 2) / 2, 0.01);
        const normalRemaining = Math.max(0.5 - windowSize, 0.001);

        if (dist > 0) {
            const outsideDist = absDist - windowSize;
            const compressedDist = outsideDist * (remainingSpace / normalRemaining);
            return Math.max(0, Math.min(1, c + magnifiedSpace + compressedDist));
        } else {
            const outsideDist = absDist - windowSize;
            const compressedDist = outsideDist * (remainingSpace / normalRemaining);
            return Math.max(0, Math.min(1, c - magnifiedSpace - compressedDist));
        }
    }
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
