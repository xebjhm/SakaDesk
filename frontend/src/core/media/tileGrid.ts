/**
 * The one tile density of every media grid (the Memories album today; the media pipeline's
 * grids reuse it). Tiles are at least `MEDIA_TILE_MIN_REM` wide and a row holds at most
 * `MEDIA_GRID_MAX_COLS`, so a wide window gets generous tiles instead of ~15 tiny columns (N3)
 * and the 960 x 640 minimum window still fits two tiles beside the album's polaroid.
 *
 * Tailwind only generates classes it finds written out in full, so the class strings below repeat
 * the numbers; `tileGrid.test.ts` keeps them in step.
 */

/** Smallest tile edge, in rem (144 px): room for the 「N 枚」 badge, the ★ and the video mark. */
export const MEDIA_TILE_MIN_REM = 9;
/** Most columns in one row, however wide the grid. */
export const MEDIA_GRID_MAX_COLS = 6;
/** The grid gap, in rem (`gap-2`). */
export const MEDIA_GRID_GAP_REM = 0.5;

/**
 * The grid's columns: as many as fit at the minimum tile, capped at the maximum count (the tile
 * never gets narrower than a sixth of the row). They follow the grid's own width, never the
 * window's. `calc` subtracts the five gaps of a full row (5 x 0.5rem).
 */
export const MEDIA_GRID_COLS = 'grid-cols-[repeat(auto-fill,minmax(max(9rem,calc((100%-2.5rem)/6)),1fr))]';
/** The grid's gap; `MEDIA_GRID_GAP_REM` in a class. */
export const MEDIA_GRID_GAP = 'gap-2';
/**
 * The smallest grid width beside a cover (two minimum tiles and the gap): a row narrower than
 * cover + this wraps the grid below the cover instead of squeezing it.
 */
export const MEDIA_GRID_MIN = 'min-w-[18.5rem] basis-[18.5rem]';

/**
 * The column count `MEDIA_GRID_COLS` lays out in a grid `widthPx` wide (a mirror of the CSS, for
 * code that lays tiles out itself and for the tests).
 */
export function mediaGridColumns(widthPx: number, remPx = 16): number {
    const gap = MEDIA_GRID_GAP_REM * remPx;
    const capped = (widthPx - gap * (MEDIA_GRID_MAX_COLS - 1)) / MEDIA_GRID_MAX_COLS;
    const track = Math.max(MEDIA_TILE_MIN_REM * remPx, capped);
    // The epsilon absorbs float error at an exact fit (a capped row is exactly six tracks).
    return Math.max(1, Math.floor((widthPx + gap) / (track + gap) + 1e-9));
}
