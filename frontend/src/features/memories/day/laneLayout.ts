export interface LaneLayoutItem {
    key: string;
    /** Minutes from the top of the lane (the ruler's first hour). */
    minutes: number;
}

export interface LaneLayoutOptions {
    pxPerMinute: number;
    cardHeight: number;
    /** Space kept between two cards of a lane. */
    gap: number;
}

/**
 * Positions one swimlane's cards. Pure. Each card sits at its time (`minutes * pxPerMinute`)
 * and is pushed down when it would overlap the card before it (same-minute messages stack).
 * The input order is kept (pass the lane in time order).
 */
export function laneLayout(items: LaneLayoutItem[], opts: LaneLayoutOptions): { key: string; top: number }[] {
    let floor = -Infinity;
    return items.map(({ key, minutes }) => {
        const top = Math.max(minutes * opts.pxPerMinute, floor);
        floor = top + opts.cardHeight + opts.gap;
        return { key, top };
    });
}
