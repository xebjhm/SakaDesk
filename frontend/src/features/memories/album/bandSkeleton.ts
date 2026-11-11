/**
 * The band skeleton's sizing (`MonthSection`'s `BandSkeleton`), kept pure for the tests.
 *
 * Before a month's payload arrives only its summary is known: `count` items and `has_favorites`.
 * The real grid draws one cell per item, except that a burst collapses its frames into one tile and
 * a pinned ★ tile spans 2 × 2 (`MonthGrid`, `gridEntries`). Neither is in the summary, so the
 * reserved rows count one cell per item, plus one pinned ★ (3 more cells) when the month has a
 * favourite, the filter pins them (not under ★) and a row holds two or more tiles. What remains
 * unknown until the grid lands: every further pinned ★ (3 more cells each), a favourite that sits
 * inside a burst (not pinned: 3 fewer), and each burst of n frames (n − 1 fewer cells). The
 * remaining error is therefore bursts and favourites beyond the first; a month with neither is exact.
 */

/** Most skeleton tiles that pulse in a band; the rest of its reserved height stays empty. */
export const BAND_SKELETON_MAX = 12;

/** The cells a month's grid is expected to take (see the module note). */
export function bandSkeletonCells(count: number, cols: number, pinsLikely: boolean): number {
    const cells = Math.max(1, count);
    return pinsLikely && cols >= 2 ? cells + 3 : cells;
}

/** The rows the band reserves: `ceil(cells / cols)`. */
export function bandSkeletonRows(count: number, cols: number, pinsLikely: boolean): number {
    return Math.ceil(bandSkeletonCells(count, cols, pinsLikely) / Math.max(1, cols));
}

/**
 * The reserved grid height in px for `rows` rows of square tiles in a grid `width` px wide with
 * `cols` columns and a `gap` px gap (the CSS grid's own maths: track = (width − gaps) / cols).
 * 0 while the width is unknown (nothing is reserved beyond the drawn tiles).
 */
export function bandSkeletonHeight(rows: number, cols: number, width: number, gap: number): number {
    if (!(width > 0) || rows <= 0) return 0;
    const tile = (width - gap * (cols - 1)) / cols;
    return rows * tile + (rows - 1) * gap;
}
