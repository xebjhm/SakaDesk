import { describe, it, expect, vi } from 'vitest';
import {
    assignMonths, averageColour, colourHex, FROST_SOURCE_PX, frostImage, isFrosted, jstMonth, loadShareAssets,
    monthlyColours, monthWindow, sharePhotoSources, type CanvasEnv,
} from './sharePhotos';
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

describe('colour record', () => {
    it('averages opaque pixels', () => {
        expect(averageColour([10, 20, 30, 255, 30, 40, 50, 255, 0, 0, 0, 0])).toEqual([20, 30, 40]);
        expect(averageColour([0, 0, 0, 0])).toBeNull();
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

    it('averages per month and never lists an empty month', () => {
        const m = monthlyColours([
            { month: 3, rgb: [0, 0, 0] }, { month: 3, rgb: [100, 100, 100] }, { month: 1, rgb: [10, 10, 10] },
        ]);
        expect(m).toEqual([{ month: 1, colour: '#0a0a0a' }, { month: 3, colour: '#323232' }]);
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
});
