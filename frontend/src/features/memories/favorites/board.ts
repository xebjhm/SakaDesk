/** Cork-board layout constants and the deterministic tilt (kept apart so `CorkBoard.tsx` exports components only). */

/** Items per board chunk: the unit that mounts and unmounts as the board scrolls. */
export const BOARD_CHUNK = 40;
/** A chunk stays mounted while it is within this of the board's viewport (two screens). */
export const LIVE_MARGIN = '200% 0px';
/** A print's drawn longest side in CSS px (thumbnail width). */
export const PRINT_PX = 240;

/** The tilts an item may take (−2…2°): literal classes, so Tailwind sees every one. */
export const TILTS = ['-rotate-2', '-rotate-1', 'rotate-0', 'rotate-1', 'rotate-2'] as const;

/** A stable tilt for a message id (Knuth's multiplicative hash): the same id always leans the same way. */
export function tiltClass(id: number): (typeof TILTS)[number] {
    const h = Math.imul(Math.trunc(id), 2654435761) >>> 0;
    return TILTS[h % TILTS.length];
}
