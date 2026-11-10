import { describe, it, expect } from 'vitest';
import {
    MEDIA_GRID_COLS, MEDIA_GRID_GAP, MEDIA_GRID_GAP_REM, MEDIA_GRID_MAX_COLS, MEDIA_GRID_MIN, MEDIA_TILE_MIN_REM, mediaGridColumns,
} from './tileGrid';

const REM = 16;

describe('media tile grid density (N3)', () => {
    it('keeps the class strings in step with the numbers', () => {
        const gaps = (MEDIA_GRID_MAX_COLS - 1) * MEDIA_GRID_GAP_REM;
        expect(MEDIA_GRID_COLS).toBe(
            `grid-cols-[repeat(auto-fill,minmax(max(${MEDIA_TILE_MIN_REM}rem,calc((100%-${gaps}rem)/${MEDIA_GRID_MAX_COLS})),1fr))]`,
        );
        expect(MEDIA_GRID_GAP).toBe(`gap-${MEDIA_GRID_GAP_REM * 4}`);
        const twoTiles = 2 * MEDIA_TILE_MIN_REM + MEDIA_GRID_GAP_REM;
        expect(MEDIA_GRID_MIN).toBe(`min-w-[${twoTiles}rem] basis-[${twoTiles}rem]`);
    });

    it('uses a generous minimum tile, about 9-10 rem, not the old 6 rem', () => {
        expect(MEDIA_TILE_MIN_REM).toBeGreaterThanOrEqual(9);
        expect(MEDIA_TILE_MIN_REM).toBeLessThanOrEqual(10);
    });

    it('caps the columns on a wide window instead of about 15 tiny ones', () => {
        // The round-2 acceptance grid: ~1,550 px beside the polaroid in a 2,077 px pane.
        expect(mediaGridColumns(1550)).toBe(MEDIA_GRID_MAX_COLS);
        expect(mediaGridColumns(3000)).toBe(MEDIA_GRID_MAX_COLS);
        const tile = (1550 - 5 * MEDIA_GRID_GAP_REM * REM) / mediaGridColumns(1550);
        expect(tile).toBeGreaterThan(240);
    });

    it('fits two minimum tiles beside the polaroid at the 960 x 640 minimum window', () => {
        // 960 minus the rails (120), the 12.5rem member pane, the colour ribbon and the band's
        // padding leaves ~546 px; the 10rem polaroid and its gap take 176.
        const grid = 546 - 176;
        expect(grid).toBeGreaterThanOrEqual((2 * MEDIA_TILE_MIN_REM + MEDIA_GRID_GAP_REM) * REM);
        expect(mediaGridColumns(grid)).toBe(2);
    });

    it('never drops below one column or a tile narrower than the minimum', () => {
        expect(mediaGridColumns(100)).toBe(1);
        for (const w of [300, 500, 800, 1000, 1200]) {
            const cols = mediaGridColumns(w);
            expect((w - (cols - 1) * MEDIA_GRID_GAP_REM * REM) / cols).toBeGreaterThanOrEqual(MEDIA_TILE_MIN_REM * REM);
        }
    });
});
