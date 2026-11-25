/** Pure layout of 歷年同一天 (the same calendar day across years, aligned by the clock). */
import type { DayYearsKind } from '../types';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** JST is UTC+9 all year. */
const JST_OFFSET_MS = 9 * HOUR_MS;

/** Two messages of one kind are joined by a guide line when their clocks are at most this far apart. */
export const MATCH_WINDOW_MS = 90 * 60 * 1000;

/** Milliseconds since JST midnight of a UTC ISO time: the shared axis of every year. */
export function clockMs(ts: string): number {
    const t = Date.parse(ts);
    if (Number.isNaN(t)) return 0;
    return (((t + JST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
}

/** The axis: the floor of the earliest clock's hour to the ceiling of the latest one's (at least one hour). */
export function clockSpan(clocks: number[]): { startHour: number; hourCount: number } {
    if (!clocks.length) return { startHour: 0, hourCount: 1 };
    const startHour = Math.floor(Math.min(...clocks) / HOUR_MS);
    const endHour = Math.max(Math.ceil(Math.max(...clocks) / HOUR_MS), startHour + 1);
    return { startHour, hourCount: endHour - startHour };
}

/** `HH:00` of an axis hour. */
export const axisLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

export interface LaneEntry {
    key: string;
    kind: DayYearsKind | null;
    clock: number;
}

export interface GuidePair {
    /** Lane index of the older year (the newer one is `lane + 1`). */
    lane: number;
    from: string;
    to: string;
}

/**
 * Guide lines between neighbouring years: each message with a kind is joined to the message of
 * the same kind in the next year whose clock is nearest, within {@link MATCH_WINDOW_MS}. One
 * line per message on each side (the closest pairs are taken first; ties go to the earlier).
 */
export function guidePairs(lanes: LaneEntry[][], windowMs: number = MATCH_WINDOW_MS): GuidePair[] {
    const out: GuidePair[] = [];
    for (let lane = 0; lane + 1 < lanes.length; lane += 1) {
        const candidates: Array<{ gap: number; a: LaneEntry; b: LaneEntry }> = [];
        for (const a of lanes[lane]) {
            if (!a.kind) continue;
            for (const b of lanes[lane + 1]) {
                if (b.kind !== a.kind) continue;
                const gap = Math.abs(a.clock - b.clock);
                if (gap <= windowMs) candidates.push({ gap, a, b });
            }
        }
        candidates.sort((x, y) => x.gap - y.gap || x.a.clock - y.a.clock || x.b.clock - y.b.clock);
        const usedA = new Set<string>();
        const usedB = new Set<string>();
        for (const { a, b } of candidates) {
            if (usedA.has(a.key) || usedB.has(b.key)) continue;
            usedA.add(a.key);
            usedB.add(b.key);
            out.push({ lane, from: a.key, to: b.key });
        }
    }
    return out;
}

/**
 * The quiet stretches of each lane: runs of axis hours (`[from, to]`, band indexes, inclusive)
 * where this year has nothing while another year does. Hours empty in every year are not gaps.
 */
export function gapRuns(lanes: LaneEntry[][], startHour: number, hourCount: number): Array<Array<[number, number]>> {
    const busy = lanes.map((lane) => new Set(lane.map((e) => Math.min(hourCount - 1, Math.max(0, Math.floor(e.clock / HOUR_MS) - startHour)))));
    return busy.map((mine, li) => {
        const runs: Array<[number, number]> = [];
        let open: number | null = null;
        for (let h = 0; h <= hourCount; h += 1) {
            const quiet = h < hourCount && !mine.has(h) && busy.some((other, oi) => oi !== li && other.has(h));
            if (quiet && open === null) open = h;
            if (!quiet && open !== null) {
                runs.push([open, h - 1]);
                open = null;
            }
        }
        return runs;
    });
}

/** One band of the axis: a busy hour, or a run of hours with no message in any year (collapsed). */
export interface ClockBand {
    /** First and last axis hour of the band (absolute hours, inclusive). */
    from: number;
    to: number;
    quiet: boolean;
    top: number;
    height: number;
}

export interface ClockLayoutOptions {
    startHour: number;
    hourCount: number;
    /** A busy hour's least height (a minute keeps this scale inside its hour). */
    pxPerHour: number;
    /** The height of a collapsed run of hours with no message in any year. */
    quietPx: number;
    cardHeight: number;
    gap: number;
}

export interface ClockLayout {
    bands: ClockBand[];
    /** Each card's top (by key). */
    tops: Map<string, number>;
    /** The band index of an axis hour. */
    bandOf: (hour: number) => number;
    height: number;
}

/**
 * The 歷年同一天 axis. Every hour with a message in some year is a band that grows to hold the
 * busiest year's cards of that hour, each card at its minute (pushed below the card before it,
 * never past its own hour, as the swimlanes' `hourBands`). A run of hours with no message in any
 * year collapses into one short `quietPx` band, so a day with a long silent stretch stays short.
 */
export function clockLayout(lanes: LaneEntry[][], opts: ClockLayoutOptions): ClockLayout {
    const { startHour, pxPerHour, quietPx, cardHeight, gap } = opts;
    const count = Math.max(1, opts.hourCount);
    const step = cardHeight + gap;
    const index = (clock: number) => Math.min(count - 1, Math.max(0, Math.floor(clock / HOUR_MS) - startHour));
    const perLane = lanes.map((lane) => {
        const byHour = new Map<number, LaneEntry[]>();
        for (const e of lane) {
            const h = index(e.clock);
            byHour.set(h, [...(byHour.get(h) ?? []), e]);
        }
        return byHour;
    });
    const bands: ClockBand[] = [];
    const bandIndex: number[] = [];
    let top = 0;
    for (let h = 0; h < count; h += 1) {
        const most = Math.max(0, ...perLane.map((byHour) => byHour.get(h)?.length ?? 0));
        const last = bands[bands.length - 1];
        if (most === 0 && last?.quiet) {
            last.to = startHour + h;
        } else if (most === 0) {
            bands.push({ from: startHour + h, to: startHour + h, quiet: true, top, height: quietPx });
            top += quietPx;
        } else {
            const height = Math.max(pxPerHour, most * step);
            bands.push({ from: startHour + h, to: startHour + h, quiet: false, top, height });
            top += height;
        }
        bandIndex.push(bands.length - 1);
    }
    const tops = new Map<string, number>();
    for (const byHour of perLane) {
        for (const [h, items] of byHour) {
            const band = bands[bandIndex[h]];
            const bandEnd = band.top + band.height;
            let floor = band.top;
            items.forEach((item, k) => {
                const atMinute = band.top + ((item.clock - (startHour + h) * HOUR_MS) / HOUR_MS) * pxPerHour;
                const latest = bandEnd - (items.length - k) * step;
                const placed = Math.max(floor, Math.min(atMinute, latest));
                tops.set(item.key, placed);
                floor = placed + step;
            });
        }
    }
    return { bands, tops, bandOf: (hour) => bandIndex[Math.min(count - 1, Math.max(0, hour - startHour))], height: top };
}
