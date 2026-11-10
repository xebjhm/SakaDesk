import { describe, it, expect } from 'vitest';
import { cellThumbPx, DEFAULT_CELL_PX } from './cellSize';

describe('cellThumbPx', () => {
    it('sizes the photo to the larger side of one cell, rounded up to 40 px', () => {
        expect(cellThumbPx(700, 480)).toBe(120); // 100 × 80 → 120
        expect(cellThumbPx(1400, 900)).toBe(200); // 200 × 150 → 200
        expect(cellThumbPx(1680, 1500)).toBe(280); // 240 × 250 → 280
    });

    it('falls back to the default before the grid is measured', () => {
        expect(cellThumbPx(0, 0)).toBe(DEFAULT_CELL_PX);
    });
});
