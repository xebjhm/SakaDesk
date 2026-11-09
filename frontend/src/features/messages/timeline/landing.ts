import type { JumpAlign } from './jumpTarget';
import type { RowKey } from './buildTimeline';

/** A landed row may sit this far from its aligned position and still count as landed. */
export const LANDING_TOLERANCE_PX = 8;

export interface Box { top: number; bottom: number }

/**
 * Signed distance (px) between where the row is and where `align` wants it.
 * When the list cannot scroll further in the needed direction, the row is as
 * close as it can get, so the error is 0.
 */
export function landingError(row: Box, view: Box, scroll: { atTop: boolean; atBottom: boolean }, align: JumpAlign): number {
    let d: number;
    if (align === 'start') d = row.top - view.top;
    else if (align === 'end') d = row.bottom - view.bottom;
    else d = (row.top + row.bottom) / 2 - (view.top + view.bottom) / 2;
    if (d > 0 && scroll.atBottom) return 0;
    if (d < 0 && scroll.atTop) return 0;
    return d;
}

/**
 * Bottom edge (viewport px) of GroupedVirtuoso's sticky group header inside `scroller`, or the
 * scroller's top when there is none. Rows above it are hidden, and `align: 'start'` lands a row
 * right below it (probe facts 1-2, e2e/probe/grouped-virtuoso.spec.ts).
 */
export function stickyHeaderBottom(scroller: HTMLElement): number {
    const top = scroller.getBoundingClientRect().top;
    const header = scroller.querySelector<HTMLElement>('[data-testid="virtuoso-top-item-list"]');
    return header ? Math.max(top, header.getBoundingClientRect().bottom) : top;
}

/**
 * Measure the rendered row `rowKey` against its Virtuoso scroller; null when not rendered.
 * `start` is measured from the sticky header's bottom edge, `center` and `end` from the scroller.
 */
export function measureLanding(rowKey: RowKey, align: JumpAlign): number | null {
    const row = document.getElementById(rowKey);
    const scroller = row?.closest<HTMLElement>('[data-virtuoso-scroller]');
    if (!row || !scroller) return null;
    const atTop = scroller.scrollTop <= 0;
    // The - 1 is slack for fractional scrollTop values on HiDPI screens.
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    const box = scroller.getBoundingClientRect();
    const view = { top: align === 'start' ? stickyHeaderBottom(scroller) : box.top, bottom: box.bottom };
    return landingError(row.getBoundingClientRect(), view, { atTop, atBottom }, align);
}

/**
 * The first row of `range` the user can actually see: Virtuoso's range may start with a row
 * hidden behind the sticky header (probe fact 3). Falls back to `range.startIndex`.
 */
export function topVisibleRowIndex(
    scroller: HTMLElement | null,
    range: { startIndex: number; endIndex: number },
    rowKeyAt: (index: number) => RowKey | null,
): number {
    if (!scroller) return range.startIndex;
    const edge = stickyHeaderBottom(scroller) + 1;
    for (let i = range.startIndex; i <= range.endIndex; i += 1) {
        const key = rowKeyAt(i);
        const el = key ? document.getElementById(key) : null;
        if (el && el.getBoundingClientRect().bottom > edge) return i;
    }
    return range.startIndex;
}
