import { describe, it, expect } from 'vitest';
import { glideScroll, waitUntilStill, type GlideDeps, type Scroller } from './glide';

const linear = (t: number) => t;

function fakeDeps(onFrame?: (n: number) => void): GlideDeps & { frames: () => number } {
    let t = 0;
    let frames = 0;
    return {
        nextFrame: () => { frames += 1; t += 16; onFrame?.(frames); return Promise.resolve(); },
        now: () => t,
        frames: () => frames,
    };
}

interface FakeScroller { scrollTop: number; scrollHeight: number; clientHeight: number }
const scroller = (scrollTop: number): FakeScroller => ({ scrollTop, scrollHeight: 100000, clientHeight: 600 });

describe('glideScroll', () => {
    it('glides the full delta and ends exactly at start + delta', async () => {
        const s = scroller(1000);
        const seen: number[] = [];
        const deps = fakeDeps(() => seen.push(s.scrollTop));
        await expect(glideScroll(s, 480, 400, linear, () => false, deps)).resolves.toBe(true);
        expect(s.scrollTop).toBe(1480);
        // It moves over several frames, monotonically.
        expect(deps.frames()).toBeGreaterThan(5);
        for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    });

    it('clamps at 0', async () => {
        const s = scroller(100);
        await expect(glideScroll(s, -480, 400, linear, () => false, fakeDeps())).resolves.toBe(true);
        expect(s.scrollTop).toBe(0);
    });

    it('clamps at the bottom of the scroll range', async () => {
        const s = scroller(100000 - 600 - 50);
        await expect(glideScroll(s, 480, 400, linear, () => false, fakeDeps())).resolves.toBe(true);
        expect(s.scrollTop).toBe(100000 - 600);
    });

    it('absorbs an external scrollTop change mid-glide smoothly and still ends at start + delta', async () => {
        // Virtuoso compensating for rows that measured taller than estimated: +30 on frame 3.
        const s = scroller(1000);
        const seen: number[] = [];
        const deps = fakeDeps(n => { if (n === 3) s.scrollTop += 30; seen.push(s.scrollTop); });
        await expect(glideScroll(s, 480, 400, linear, () => false, deps)).resolves.toBe(true);
        expect(s.scrollTop).toBe(1480);
        // No hop back: the glide never undoes the change in one frame, it keeps moving forward.
        for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    });

    it('homes in on the measured target once aim() can see it', async () => {
        // The real target is 50 px past the planned end; aim() sees it from frame 5 on.
        const s = scroller(1000);
        const deps = fakeDeps();
        const aim = () => (deps.frames() >= 5 ? 1530 - s.scrollTop : null);
        await expect(glideScroll(s, 480, 400, linear, () => false, deps, aim)).resolves.toBe(true);
        expect(s.scrollTop).toBe(1530);
    });

    it('returns false and stops moving when cancelled mid-way', async () => {
        const s = scroller(1000);
        let cancelled = false;
        const deps = fakeDeps(n => { if (n === 4) cancelled = true; });
        await expect(glideScroll(s, 480, 400, linear, () => cancelled, deps)).resolves.toBe(false);
        const stoppedAt = s.scrollTop;
        expect(stoppedAt).toBeGreaterThan(1000);
        expect(stoppedAt).toBeLessThan(1480);
        expect(deps.frames()).toBe(4);
    });

    it('resolves a zero delta without waiting for frames', async () => {
        const s = scroller(1000);
        const deps = fakeDeps();
        await expect(glideScroll(s, 0, 400, linear, () => false, deps)).resolves.toBe(true);
        expect(s.scrollTop).toBe(1000);
        expect(deps.frames()).toBe(0);
    });

    it('follows the easing curve', async () => {
        const s = scroller(0);
        const seen: number[] = [];
        // Ease-in: nothing moves until the last frame.
        const deps = fakeDeps(() => seen.push(s.scrollTop));
        await glideScroll(s, 400, 160, t => (t < 1 ? 0 : 1), () => false, deps);
        expect(seen.slice(0, -1).every(v => v === 0)).toBe(true);
        expect(s.scrollTop).toBe(400);
    });

    it('ends exactly on target when the browser rounds scrollTop to whole pixels', async () => {
        let top = 1000;
        const s: Scroller = {
            get scrollTop() { return top; },
            set scrollTop(v: number) { top = Math.round(v); },
            scrollHeight: 100000,
            clientHeight: 600,
        };
        // A long ease-out tail of sub-pixel steps would be lost if each frame rounded on its own.
        await glideScroll(s, 480, 400, t => 1 - (1 - t) ** 4, () => false, fakeDeps());
        expect(s.scrollTop).toBe(1480);
    });
});

describe('waitUntilStill', () => {
    it('resolves still once nothing has changed for the quiet time', async () => {
        const deps = fakeDeps();
        await expect(waitUntilStill(scroller(0), 150, 2, 60, () => false, deps)).resolves.toBe('still');
        expect(deps.frames()).toBe(10); // 10 × 16 ms ≥ 150 ms
    });

    it('restarts the quiet time on every scrollTop or height change', async () => {
        const s = scroller(0);
        const deps = fakeDeps(n => { if (n === 2) s.scrollTop = 40; if (n === 5) s.scrollHeight += 10; });
        await expect(waitUntilStill(s, 150, 2, 60, () => false, deps)).resolves.toBe('still');
        expect(deps.frames()).toBe(5 + 10);
    });

    it('waits at least minFrames even with no quiet time', async () => {
        const deps = fakeDeps();
        await expect(waitUntilStill(scroller(0), 0, 2, 60, () => false, deps)).resolves.toBe('still');
        expect(deps.frames()).toBe(2);
    });

    it('resolves moving when it never settles within maxFrames', async () => {
        const s = scroller(0);
        const deps = fakeDeps(() => { s.scrollHeight += 1; });
        await expect(waitUntilStill(s, 150, 2, 60, () => false, deps)).resolves.toBe('moving');
        expect(deps.frames()).toBe(60);
    });

    it('resolves cancelled as soon as it is cancelled', async () => {
        let cancelled = false;
        const deps = fakeDeps(n => { if (n === 3) cancelled = true; });
        await expect(waitUntilStill(scroller(0), 150, 2, 60, () => cancelled, deps)).resolves.toBe('cancelled');
        expect(deps.frames()).toBe(3);
    });
});
