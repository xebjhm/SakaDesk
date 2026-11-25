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

    // fisheyePosition is the exact inverse of fisheyeIndex: piecewise linear, no folds or jumps.
    it('keeps positions in order around any centre', () => {
        for (const count of [12, 42, 60, 100, 500]) {
            for (const center of [0, Math.floor(count / 3), Math.floor(count / 2), count - 1]) {
                for (let i = 1; i < count; i += 1) {
                    expect(
                        fisheyePosition(i, count, center),
                        `count ${count} centre ${center} index ${i}`,
                    ).toBeGreaterThanOrEqual(fisheyePosition(i - 1, count, center));
                }
            }
        }
    });

    it('round-trips every index that is not pushed against an end', () => {
        for (const count of [12, 42, 60, 100, 500]) {
            for (const center of [0, Math.floor(count / 3), Math.floor(count / 2), count - 1]) {
                for (let i = 0; i < count; i += 1) {
                    const pos = fisheyePosition(i, count, center);
                    if (pos <= 0 || pos >= 1) continue; // pushed against an end (the clamp)
                    const back = fisheyeIndex(pos, count, center);
                    expect(back, `count ${count} centre ${center} index ${i}`).toBe(i);
                }
            }
        }
    });

    it('leaves no gap in a centred zoom: neighbours never jump far apart', () => {
        const count = 60;
        for (let i = 1; i < count; i += 1) {
            const gap = fisheyePosition(i, count, 30) - fisheyePosition(i - 1, count, 30);
            expect(gap, `index ${i}`).toBeLessThan(0.1);
        }
    });

    it('spreads the items next to the centre apart', () => {
        const count = 100;
        const center = 50;
        const plain = fisheyePosition(51, count, null) - fisheyePosition(50, count, null);
        const zoomed = fisheyePosition(51, count, center) - fisheyePosition(50, count, center);
        expect(zoomed).toBeCloseTo(plain * ZOOM_CONFIG.magnification);
        expect(fisheyePosition(50, count, center)).toBeCloseTo(50 / 99);
        expect(fisheyePosition(0, count, center)).toBeCloseTo(0);
        expect(fisheyePosition(99, count, center)).toBeCloseTo(1);
    });
});
