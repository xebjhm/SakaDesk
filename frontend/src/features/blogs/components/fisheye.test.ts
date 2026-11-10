import { describe, it, expect } from 'vitest';
import { fisheyeIndex, fisheyePosition, ZOOM_CONFIG } from './fisheye';

describe('fisheye', () => {
    it('is the identity without a centre', () => {
        for (const i of [0, 7, 21, 41]) expect(fisheyePosition(i, 42, null)).toBeCloseTo(i / 41);
        expect(fisheyeIndex(0.5, 42, null)).toBe(21); // round(20.5)
        expect(fisheyeIndex(1, 42, null)).toBe(41);
    });

    it('maps a single item (or none) to the start', () => {
        expect(fisheyePosition(0, 1, 0)).toBe(0);
        expect(fisheyeIndex(0.7, 1, 0)).toBe(0);
        expect(fisheyeIndex(0.7, 0, null)).toBe(0);
    });

    // The e4e4118 maths is kept verbatim: the inverse is exact only in the magnified
    // neighbourhood of the centre (where the pointer is while zoomed), not across the whole rail.
    it('round-trips within one index next to the centre', () => {
        for (const count of [12, 42, 100]) {
            for (const center of [Math.floor(count / 2), Math.floor(count / 3)]) {
                for (let i = Math.max(0, center - 2); i <= Math.min(count - 1, center + 2); i += 1) {
                    const back = fisheyeIndex(fisheyePosition(i, count, center), count, center);
                    expect(Math.abs(back - i), `count ${count} centre ${center} index ${i}`).toBeLessThanOrEqual(1);
                }
            }
        }
    });

    it('spreads the items next to the centre apart', () => {
        const count = 100;
        const center = 50;
        const plain = fisheyePosition(51, count, null) - fisheyePosition(50, count, null);
        const zoomed = fisheyePosition(51, count, center) - fisheyePosition(50, count, center);
        expect(zoomed).toBeGreaterThan(plain * (ZOOM_CONFIG.magnification - 1));
        expect(fisheyePosition(50, count, center)).toBeCloseTo(50 / 99);
        const before = fisheyePosition(50, count, center) - fisheyePosition(49, count, center);
        expect(before).toBeGreaterThan(plain * (ZOOM_CONFIG.magnification - 1));
    });

    it('stays inside the rail', () => {
        for (let i = 0; i < 100; i += 1) {
            const pos = fisheyePosition(i, 100, 10);
            expect(pos).toBeGreaterThanOrEqual(0);
            expect(pos).toBeLessThanOrEqual(1);
        }
    });
});
