import { jstNow } from '../recap/availability';

/**
 * The sepia step that ages a keepsake from `year` (DESIGN_SYSTEM.md "Memories keepsake
 * surfaces"): `''` for this year (and any later one), then `sepia-memories-1` (last year),
 * `-2` (two years ago) and `-3` (three or more). Years are counted in JST.
 */
export function sepiaClass(year: number, now: Date = new Date()): string {
    const age = jstNow(now).year - year;
    if (age <= 0) return '';
    return `sepia-memories-${Math.min(age, 3)}`;
}

/** The JST year of a UTC ISO timestamp (a message's `ts`). */
export function jstYearOf(ts: string): number {
    return jstNow(new Date(ts)).year;
}
