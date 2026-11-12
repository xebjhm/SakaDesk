/** A cell photo's drawn size before the grid is measured (and where it cannot be). */
export const DEFAULT_CELL_PX = 120;
/** Cell sizes are rounded up to this step, so a resize only re-requests at a real change. */
const STEP_PX = 40;

/**
 * The longest side, in CSS px, of one cell of a 7 × 6 grid of `width` × `height` (gaps ignored:
 * a little larger is fine), rounded up to {@link STEP_PX}; `DEFAULT_CELL_PX` for an unmeasured grid.
 * `thumbWidthFor` then picks the thumbnail width for the device pixel ratio.
 */
export function cellThumbPx(width: number, height: number): number {
    const side = Math.max(width / 7, height / 6);
    if (!Number.isFinite(side) || side <= 0) return DEFAULT_CELL_PX;
    return Math.ceil(side / STEP_PX) * STEP_PX;
}
