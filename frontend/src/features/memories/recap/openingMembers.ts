/** Who the multi-member opening shows, and in which order. */
import type { RecapOverview, RecapOverviewMember } from './api';

/** The members in `star_order` (oshi → the fan's ★ → subscription age; never message volume). */
export function starMembers(overview: RecapOverview): RecapOverviewMember[] {
    const byId = new Map(overview.members.map((m) => [m.member_id, m]));
    return overview.opening.star_order.flatMap((id) => {
        const m = byId.get(id);
        return m ? [m] : [];
    });
}

export function titledMembers(overview: RecapOverview): RecapOverviewMember[] {
    return starMembers(overview).filter((m) => m.tier !== 'none' && m.title_key);
}

/**
 * Share of a grid cell's height each part of a star takes: the star, then up to two
 * caption lines (her name, the first-message label) at {@link STAR_LINE_HEIGHT}.
 * They sum to at most 1, so a cell never clips its star whatever the member count.
 */
export const STAR_SHARE = 0.4;
export const STAR_LABEL_SHARE = 0.22;
export const STAR_LINE_HEIGHT = 1.2;

export interface StarGrid {
    cols: number;
    rows: number;
}

/**
 * Columns and rows for `count` equal stars on the 9:16 stage: three columns up to
 * nine members, then more columns as the roster grows (cells a little wider than
 * tall, since names run horizontally). `cols * rows >= count` always holds.
 */
export function starGrid(count: number): StarGrid {
    const n = Math.max(1, count);
    const cols = Math.max(3, Math.ceil(Math.sqrt(n / 1.6)));
    return { cols, rows: Math.ceil(n / cols) };
}
