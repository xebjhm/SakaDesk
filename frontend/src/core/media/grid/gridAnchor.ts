/** Resize anchoring helpers of `VirtualMediaGrid` (pure, so they are unit-tested on their own). */

/** One rendered row's box (viewport px) and the flat index of its first item. */
export interface GridRowBox {
    top: number;
    bottom: number;
    first: number;
}

/**
 * The flat index of the first item the user can see: the first row whose vertical midpoint lies
 * below `viewTop` (the scroll parent's top plus the sticky header), so a row mostly hidden
 * behind the header does not count. `null` when no row qualifies. Pure.
 */
export function firstVisibleItem(rows: readonly GridRowBox[], viewTop: number): number | null {
    let best: GridRowBox | null = null;
    for (const row of rows) {
        if ((row.top + row.bottom) / 2 < viewTop) continue;
        if (!best || row.top < best.top) best = row;
    }
    return best ? best.first : null;
}

/**
 * The Virtuoso row index (group headers not counted) holding the item at `flatIndex` in a layout
 * of `cols` columns, or `null` when out of range. Pure.
 */
export function rowOfItem(flatIndex: number, itemStarts: readonly number[], rowStarts: readonly number[], total: number, cols: number): number | null {
    if (flatIndex < 0 || flatIndex >= total || itemStarts.length === 0) return null;
    let g = itemStarts.length - 1;
    while (g > 0 && itemStarts[g] > flatIndex) g -= 1;
    return rowStarts[g] + Math.floor((flatIndex - itemStarts[g]) / cols);
}
