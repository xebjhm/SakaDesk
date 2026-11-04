import type { JumpAlign } from './jumpTarget';

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

/** Measure the rendered row `msg-<id>` against its Virtuoso scroller; null when not rendered. */
export function measureLanding(messageId: number, align: JumpAlign): number | null {
    const row = document.getElementById(`msg-${messageId}`);
    const scroller = row?.closest<HTMLElement>('[data-virtuoso-scroller]');
    if (!row || !scroller) return null;
    const atTop = scroller.scrollTop <= 0;
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    return landingError(row.getBoundingClientRect(), scroller.getBoundingClientRect(), { atTop, atBottom }, align);
}
