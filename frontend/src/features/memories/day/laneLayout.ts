export interface LaneItem {
    key: string;
    /** Epoch ms of the message. */
    ts: number;
}

export interface HourBandOptions {
    /** The ruler's first hour edge (epoch ms, see `rulerSpan`). */
    start: number;
    /** Number of hour bands (the ruler's hour edges minus one, at least 1). */
    hourCount: number;
    /** The height of a quiet hour (a minute keeps this scale inside its hour). */
    pxPerHour: number;
    cardHeight: number;
    /** Space kept between two cards of a lane. */
    gap: number;
}

export interface HourBandLayout {
    /** The top of every hour edge (`hourCount + 1` values): where the ruler draws `HH:00`. */
    edges: number[];
    /** Per lane, each card's top (input order kept). */
    lanes: { key: string; top: number }[][];
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Positions the swimlanes' cards on an hour ruler that stays true in busy hours. Pure.
 *
 * Every hour is a band; a band grows to hold the busiest lane's cards of that hour (a quiet hour
 * keeps `pxPerHour`). Inside its band a card sits at its minute and is pushed down past the card
 * before it, but never below the room the lane's remaining cards of that hour still need, so a
 * card always stays inside its own hour (08:16 never drifts to the 09:00 line). Pass each lane in
 * time order.
 */
export function hourBands(lanes: LaneItem[][], opts: HourBandOptions): HourBandLayout {
    const { start, pxPerHour, cardHeight, gap } = opts;
    const count = Math.max(1, opts.hourCount);
    const step = cardHeight + gap;
    const hourOf = (ts: number) => Math.min(count - 1, Math.max(0, Math.floor((ts - start) / HOUR_MS)));
    const perLane = lanes.map((lane) => {
        const byHour = new Map<number, LaneItem[]>();
        for (const item of lane) {
            const h = hourOf(item.ts);
            byHour.set(h, [...(byHour.get(h) ?? []), item]);
        }
        return byHour;
    });
    const heights = Array.from({ length: count }, (_, h) =>
        Math.max(pxPerHour, ...perLane.map((byHour) => (byHour.get(h)?.length ?? 0) * step)));
    const edges = [0];
    for (const height of heights) edges.push(edges[edges.length - 1] + height);

    const placed = perLane.map((byHour, li) => {
        const tops = new Map<string, number>();
        for (const [h, items] of byHour) {
            const bandTop = edges[h];
            const bandEnd = edges[h + 1];
            let floor = bandTop;
            items.forEach((item, k) => {
                const atMinute = bandTop + ((item.ts - start - h * HOUR_MS) / HOUR_MS) * pxPerHour;
                const latest = bandEnd - (items.length - k) * step;
                const top = Math.max(floor, Math.min(atMinute, latest));
                tops.set(item.key, top);
                floor = top + step;
            });
        }
        return lanes[li].map((item) => ({ key: item.key, top: tops.get(item.key) ?? 0 }));
    });
    return { edges, lanes: placed };
}
