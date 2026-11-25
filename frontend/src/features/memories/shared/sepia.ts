import { jstNow } from './jst';

// Literal class names, so Tailwind's scanner sees every one of them.
const SEPIA_STEPS = { 1: 'sepia-memories-1', 2: 'sepia-memories-2', 3: 'sepia-memories-3' } as const;

/**
 * The sepia step that ages a keepsake from `year` (DESIGN_SYSTEM.md "Memories keepsake
 * surfaces"): `''` for this year (and any later one), then `sepia-memories-1` (last year),
 * `-2` (two years ago) and `-3` (three or more). Years are counted in JST.
 */
export function sepiaClass(year: number, now: Date = new Date()): string {
    const age = jstNow(now).year - year;
    if (age <= 0) return '';
    return SEPIA_STEPS[Math.min(age, 3) as 1 | 2 | 3];
}
