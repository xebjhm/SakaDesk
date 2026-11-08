/** How a list is sorted on screen: the oldest item first, or the newest first. */
export type ListOrder = 'oldest_first' | 'newest_first';

/**
 * App-wide rule: ← / ‹ always go to the OLDER item and → / › to the NEWER one, whichever way the
 * list is sorted. Returns the indices of the older and newer neighbours of `index` (`null` at an
 * end of the list) and the 1-based ordinal counting the oldest item as 1.
 */
export function timeNeighbours(index: number, total: number, order: ListOrder): {
    older: number | null;
    newer: number | null;
    ordinal: number;
} {
    const step = order === 'newest_first' ? -1 : 1;
    const inRange = (i: number) => (i >= 0 && i < total ? i : null);
    return {
        older: inRange(index - step),
        newer: inRange(index + step),
        ordinal: order === 'newest_first' ? total - index : index + 1,
    };
}
