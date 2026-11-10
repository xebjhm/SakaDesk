import { jstNow } from '../recap/availability';
import type { DayMessage } from '../types';

const HOUR_MS = 60 * 60 * 1000;

/**
 * The ruler's span on the JST clock: the floor of the first message's hour to the ceiling of the
 * last one's. JST is a whole-hour offset from UTC, so JST hour edges are UTC hour edges.
 */
export function rulerSpan(messages: Pick<DayMessage, 'ts'>[]): { start: number; hours: number[] } {
    const times = messages.map((m) => Date.parse(m.ts)).filter((n) => !Number.isNaN(n));
    if (!times.length) return { start: 0, hours: [] };
    const start = Math.floor(Math.min(...times) / HOUR_MS) * HOUR_MS;
    const end = Math.max(Math.ceil(Math.max(...times) / HOUR_MS) * HOUR_MS, start + HOUR_MS);
    const hours: number[] = [];
    for (let t = start; t <= end; t += HOUR_MS) hours.push(t);
    return { start, hours };
}

/** A ruler hour as `HH:00` on the JST clock (the day's end reads `24:00`, never the next day's `00:00`). */
export function hourLabel(t: number, start: number): string {
    const hour = jstNow(new Date(t)).hour;
    const pastMidnight = hour === 0 && t > start;
    return `${String(pastMidnight ? 24 : hour).padStart(2, '0')}:00`;
}
