import { describe, it, expect } from 'vitest';
import { clampView, zoomAt, wheelZoom, FIT, MAX_ZOOM, MIN_ZOOM } from './useZoomPan';

const box = { width: 400, height: 300 };

describe('zoom / pan math', () => {
    it('clamps the scale to 1–4× and snaps the pan to 0 at fit', () => {
        expect(clampView({ scale: 9, x: 0, y: 0 }, box).scale).toBe(MAX_ZOOM);
        expect(clampView({ scale: 0.2, x: 50, y: -50 }, box)).toEqual(FIT);
        expect(MIN_ZOOM).toBe(1);
    });

    it('keeps the zoomed image covering its own box (it cannot leave the screen)', () => {
        // At 2× a 400×300 image overhangs 200 / 150 px on each side.
        expect(clampView({ scale: 2, x: 999, y: -999 }, box)).toEqual({ scale: 2, x: 200, y: -150 });
    });

    it('zooming around a point keeps that point under the cursor', () => {
        // Cursor 100 px right of and 50 px above the centre; zoom 1 → 2.
        const next = zoomAt(FIT, 2, { x: 100, y: -50 }, box);
        expect(next).toEqual({ scale: 2, x: -100, y: 50 });
        // The image point under the cursor: (p − t) / s is the same before and after.
        expect((100 - next.x) / next.scale).toBe(100);
        expect((-50 - next.y) / next.scale).toBe(-50);
    });

    it('zooming around the centre does not pan', () => {
        expect(zoomAt(FIT, 1.25, { x: 0, y: 0 }, box)).toEqual({ scale: 1.25, x: 0, y: 0 });
    });

    it('wheel up zooms in, wheel down zooms out, in small smooth steps', () => {
        const up = wheelZoom(1, -100, 0);
        expect(up).toBeGreaterThan(1);
        expect(up).toBeLessThan(1.3);
        expect(wheelZoom(2, 100, 0)).toBeLessThan(2);
        // A trackpad's tiny deltas give a tiny step.
        expect(wheelZoom(1, -4, 0)).toBeLessThan(1.01);
        // Line-mode deltas (3 lines per notch) feel like a pixel notch.
        expect(wheelZoom(1, -3, 1)).toBeCloseTo(wheelZoom(1, -48, 0));
    });
});
