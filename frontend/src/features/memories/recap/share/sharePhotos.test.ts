import { describe, it, expect, vi } from 'vitest';
import {
    assignMonths, canvasFilterSupported, colourBuckets, colourHex, dominantColour, FROST_SOURCE_PX, frostImage, isFrosted, jstMonth,
    loadImageElement, loadShareAssets, monthlyColours, monthWindow, sharePhotoSources, type CanvasEnv,
} from './sharePhotos';
import { drawnSources, filterAt, recordingEnv } from '../__fixtures__/recordingCanvas';
import { payload, photosData, posterData } from '../__fixtures__/payload';
import type { RecapPayload } from '../api';

/** A fake canvas whose context records draw calls and answers getImageData with one flat colour. */
function fakeEnv(rgba: [number, number, number, number] = [200, 100, 50, 255]) {
    const made: { width: number; height: number; calls: unknown[][]; filters: string[] }[] = [];
    const env: CanvasEnv = {
        createCanvas(width, height) {
            const rec = { width, height, calls: [] as unknown[][], filters: [] as string[] };
            made.push(rec);
            const ctx = {
                set filter(v: string) { rec.filters.push(v); },
                get filter() { return rec.filters[rec.filters.length - 1] ?? 'none'; },
                imageSmoothingEnabled: true,
                imageSmoothingQuality: 'low',
                drawImage: (...a: unknown[]) => rec.calls.push(['drawImage', ...a]),
                getImageData: (_x: number, _y: number, w: number, h: number) => ({
                    data: Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => rgba[i % 4]),
                }),
            };
            const canvas = { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
            return canvas;
        },
    };
    return { env, made };
}

const img = (width = 1200, height = 900) => ({ width, height, naturalWidth: width, naturalHeight: height }) as unknown as HTMLImageElement;

describe('frostImage', () => {
    it('keeps no more than a tiny, blurred copy of the photo', () => {
        const { env, made } = fakeEnv();
        const out = frostImage(img(), env);
        expect(out).not.toBeNull();
        expect(isFrosted(out)).toBe(true);
        const small = made[0];
        expect(small.width).toBeLessThanOrEqual(FROST_SOURCE_PX);
        expect(small.height).toBeLessThanOrEqual(FROST_SOURCE_PX);
        expect(small.filters.some((f) => /^blur\(/.test(f))).toBe(true);
        // The photo is drawn into the tiny canvas only.
        expect(small.calls[0][0]).toBe('drawImage');
    });

    it('never marks the source itself as frosted', () => {
        const source = img();
        frostImage(source, fakeEnv().env);
        expect(isFrosted(source)).toBe(false);
    });

    it('returns null for an empty image', () => {
        expect(frostImage(img(0, 0), fakeEnv().env)).toBeNull();
    });
});

/** RGBA data of `n` pixels of each colour. */
function pixels(...runs: [number, [number, number, number]][]): number[] {
    return runs.flatMap(([n, [r, g, b]]) => Array.from({ length: n }, () => [r, g, b, 255]).flat());
}

describe('frostImage without canvas filter support', () => {
    it('detects the missing filter once per canvas factory', () => {
        const { env, made } = recordingEnv({ filter: false });
        frostImage(img(), env);
        frostImage(img(), env);
        const probes = made.flatMap((m) => m.log.filter((e) => e[0] === 'set:filter' && e[1] === 'blur(1px)'));
        expect(probes).toHaveLength(1);
        expect(canvasFilterSupported(made[0].ctx, env)).toBe(false);
        const fresh = recordingEnv();
        expect(canvasFilterSupported(fresh.env.createCanvas(1, 1).getContext('2d')!, fresh.env)).toBe(true);
    });

    it('keeps the 32 px downscale and adds a box blur by downscale / upscale', () => {
        const { env, made } = recordingEnv({ filter: false });
        const raw = img();
        const out = frostImage(raw, env);
        expect(isFrosted(out)).toBe(true);
        const tiny = made[0];
        expect([tiny.canvas.width, tiny.canvas.height]).toEqual([FROST_SOURCE_PX, FROST_SOURCE_PX]);
        // The raw photo is drawn once, into the tiny canvas only.
        expect(made.flatMap((m) => drawnSources(m.log)).filter((s) => s === raw)).toHaveLength(1);
        expect(drawnSources(tiny.log)[0]).toBe(raw);
        // Then the tiny copy is shrunk into smaller scratch canvases and drawn back over itself.
        const scratch = made.slice(1);
        expect(scratch.length).toBeGreaterThanOrEqual(2);
        for (const s of scratch) {
            expect(s.canvas.width).toBeLessThan(FROST_SOURCE_PX);
            expect(drawnSources(s.log)).toEqual([tiny.canvas]);
        }
        expect(drawnSources(tiny.log).slice(1)).toEqual(scratch.map((s) => s.canvas));
    });

    it('uses the filter blur, not the fallback, where filter works', () => {
        const { env, made } = recordingEnv();
        const raw = img();
        frostImage(raw, env);
        expect(made).toHaveLength(1);
        const i = made[0].log.findIndex((e) => e[0] === 'drawImage');
        expect(filterAt(made[0].log, i)).toMatch(/^blur\(/);
    });

    it('reports the fallback in the loaded assets', async () => {
        const recap = payload({ slides: [{ key: 's05_photos', fallback: null, data: photosData() }] });
        const off = await loadShareAssets(recap, { env: recordingEnv({ filter: false }).env, loadImage: async () => img() });
        expect(off.blurFallback).toBe(true);
        const on = await loadShareAssets(recap, { env: recordingEnv().env, loadImage: async () => img() });
        expect(on.blurFallback).toBe(false);
    });
});

describe('colour record', () => {
    it('takes the dominant colour bucket, not the mean', () => {
        // 6 red, 4 blue: the mean would be a purple that is in neither photo.
        const data = pixels([6, [200, 30, 40]], [4, [30, 40, 200]]);
        expect(dominantColour(data)).toEqual([200, 30, 40]);
    });

    it('ignores near-white, near-black and transparent pixels', () => {
        const data = [...pixels([10, [250, 250, 250]], [10, [5, 5, 5]], [2, [90, 160, 60]]), 120, 120, 120, 0];
        expect(dominantColour(data)).toEqual([90, 160, 60]);
        expect(dominantColour(pixels([4, [255, 255, 255]], [4, [0, 0, 0]]))).toBeNull();
    });

    it('groups close shades into one coarse bucket and averages within it', () => {
        const data = pixels([2, [200, 30, 40]], [2, [210, 20, 50]], [3, [30, 40, 200]]);
        expect(dominantColour(data)).toEqual([205, 25, 45]);
    });

    it('formats a colour without literals', () => {
        expect(colourHex([255, 0, 16])).toBe('#ff0010');
    });

    it('cuts months in JST', () => {
        expect(jstMonth('2026-01-31T15:30:00Z')).toBe(2);
        expect(jstMonth('nope')).toBeNull();
    });

    it('spreads untimed wall photos over the window in order', () => {
        expect(assignMonths([{ ts: null }, { ts: null }, { ts: null }, { ts: '2026-05-01T00:00:00Z' }], { first: 1, last: 12 }))
            .toEqual([1, 5, 9, 5]);
    });

    it('starts the window at the subscription month of a fan who joined this year', () => {
        const recap = payload({ member: { ...payload().member, subscription_start: '2026-10-14' } });
        expect(monthWindow(recap, [])).toEqual({ first: 10, last: 12 });
        expect(monthWindow(payload(), ['2026-06-03T03:00:00Z']).last).toBe(6);
        expect(monthWindow(payload({ phase: 'final' }), ['2026-06-03T03:00:00Z']).last).toBe(12);
    });

    it('pools each month\'s photos and takes the dominant colour, never listing an empty month', () => {
        const m = monthlyColours([
            { month: 3, buckets: colourBuckets(pixels([3, [200, 30, 40]])) },
            { month: 3, buckets: colourBuckets(pixels([2, [30, 40, 200]])) },
            { month: 3, buckets: colourBuckets(pixels([2, [30, 40, 200]])) },
            { month: 1, buckets: colourBuckets(pixels([1, [90, 160, 60]])) },
            { month: 5, buckets: colourBuckets(pixels([4, [255, 255, 255]])) },
        ]);
        expect(m).toEqual([{ month: 1, colour: '#5aa03c' }, { month: 3, colour: '#1e28c8' }]);
    });
});

describe('sharePhotoSources', () => {
    it('takes the s05 wall and the poster\'s start / mid / recent photos, each once', () => {
        const recap: RecapPayload = payload({
            slides: [{ key: 's05_photos', fallback: null, data: photosData({ wall: ['/a.jpg', null, '/api/content/media/s.jpg'] }) }],
            poster: posterData(),
        });
        const s = sharePhotoSources(recap);
        expect(s.map((x) => x.url)).toEqual(['/a.jpg', '/api/content/media/s.jpg', '/api/content/media/m.jpg', '/api/content/media/r.jpg']);
        expect(s[0].ts).toBeNull();
        expect(s[1].ts).toBe('2026-01-03T03:00:00Z');
    });
});

describe('loadShareAssets', () => {
    it('returns frosted photos and monthly colours only', async () => {
        const { env } = fakeEnv();
        const recap = payload({ slides: [{ key: 's05_photos', fallback: null, data: photosData() }] });
        const load = vi.fn(async (url: string) => {
            if (url.endsWith('w2.jpg')) throw new Error('load');
            return img();
        });
        const assets = await loadShareAssets(recap, { env, loadImage: load });
        expect(assets.photos.length).toBeGreaterThan(0);
        expect(assets.photos.every((p) => isFrosted(p))).toBe(true);
        expect(assets.skipped).toBe(1);
        expect(assets.months.length).toBeGreaterThan(0);
        expect(assets.months.every((m) => m.colour === '#c86432')).toBe(true);
    });

    it('stops on abort: passes the signal to every load, rejects with AbortError and frosts nothing', async () => {
        const { env, made } = fakeEnv();
        const recap = payload({ slides: [{ key: 's05_photos', fallback: null, data: photosData() }] });
        const controller = new AbortController();
        const signals: (AbortSignal | undefined)[] = [];
        const load = vi.fn((_url: string, signal?: AbortSignal) => {
            signals.push(signal);
            return new Promise<CanvasImageSource>((resolve) => { setTimeout(() => resolve(img()), 0); });
        });
        const pending = loadShareAssets(recap, { env, loadImage: load, signal: controller.signal });
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(signals.length).toBeGreaterThan(0);
        expect(signals.every((sig) => sig === controller.signal)).toBe(true);
        expect(made).toHaveLength(0);
    });

    it('loadImageElement releases the image and rejects when aborted', async () => {
        const controller = new AbortController();
        const pending = loadImageElement('/api/content/media/s/a.jpg', controller.signal);
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        await expect(loadImageElement('/x.jpg', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    });
});
