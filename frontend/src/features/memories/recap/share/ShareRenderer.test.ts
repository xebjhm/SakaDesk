import { describe, it, expect, beforeAll } from 'vitest';
import i18n from '../../../../i18n';
import {
    availableScenes, COLLAGE_FALLBACK_PASSES, COLLAGE_MAX_TILE_RATIO, collageLayout, HAZE_ALPHA, SHARE_HEIGHT, SHARE_WIDTH, ShareRenderer,
    type SharePalette,
} from './ShareRenderer';
import { buildShareModel, defaultShareOptions, NICKNAME_MASK, type ShareOptions } from './shareModel';
import { FROST_SOURCE_PX, loadShareAssets, markFrosted, isFrosted, type FrostedImage, type ShareAssets } from './sharePhotos';
import {
    drawnSources, drawnText, filterAt, GRADIENT, hashLog, recordingCanvas, recordingEnv, type LogEntry,
} from '../__fixtures__/recordingCanvas';
import { clockData, greetingsData, message, payload, photosData, s02, s12, specialData } from '../__fixtures__/payload';
import type { RecapPayload, RecapSlide } from '../api';

const t = (key: string, params?: Record<string, string | number>) => i18n.t(key, params);

/** Token stand-ins: every colour the renderer uses must be one of these or a month colour. */
const PALETTE: SharePalette = {
    backgroundTop: 'tok-surface-sheet',
    backgroundBottom: 'tok-accent-subtle',
    text: 'tok-text-primary',
    textSecondary: 'tok-text-secondary',
    textMuted: 'tok-text-muted',
    haze: 'tok-surface-card',
    card: 'tok-surface-card',
    border: 'tok-border-subtle',
    star: 'tok-text-secondary',
    peak: 'tok-text-primary',
};
const FONTS = { display: 'DisplaySerif', sans: 'UiSans', quote: 'QuoteSerif' };

const recap = (): RecapPayload => payload({
    slides: [
        { ...s02, data: { ...(s02.data as object), last: message(8, '%%%、また明日ね') } } as RecapSlide,
        { key: 's03_clock', fallback: null, data: clockData() },
        { key: 's04_greetings', fallback: null, data: greetingsData() },
        { key: 's09_special', fallback: null, data: specialData() },
        s12,
    ],
});

function frostedPhotos(n: number) {
    const { env } = recordingEnv();
    return Array.from({ length: n }, () => markFrosted(env.createCanvas(32, 32)));
}

function setup(over: Partial<ShareOptions> = {}, assetsOver: Partial<ShareAssets & { avatar: CanvasImageSource | null }> = {}, scale = 1, format: 'gif' | 'video' = 'video') {
    const r = recap();
    const model = buildShareModel(r, { ...defaultShareOptions(r), ...over }, 'ゆき', t, 'ja');
    const { env, made } = recordingEnv();
    const assets = {
        photos: frostedPhotos(6),
        months: [{ month: 1, colour: '#102030' }, { month: 5, colour: '#405060' }],
        skipped: 0,
        avatar: null,
        ...assetsOver,
    };
    const renderer = new ShareRenderer(model, assets, { format, scale, palette: PALETTE, fonts: FONTS, env });
    return { renderer, made, model };
}

function frame(renderer: ShareRenderer, tMs: number, scale = 1) {
    const rc = recordingCanvas(SHARE_WIDTH * scale, SHARE_HEIGHT * scale);
    renderer.drawAt(rc.ctx, tMs);
    return rc.log;
}

beforeAll(async () => { await i18n.changeLanguage('ja'); });

describe('ShareRenderer', () => {
    it('is deterministic: the same input draws the same frame', () => {
        for (const tMs of [0, 700, 2500, 5000, 7000, 9000, 11500]) {
            expect(hashLog(frame(setup().renderer, tMs))).toBe(hashLog(frame(setup().renderer, tMs)));
        }
    });

    it('draws different scenes at different times', () => {
        const { renderer } = setup();
        const hashes = new Set([1000, 2500, 5000, 7000, 9000, 11500].map((ms) => hashLog(frame(renderer, ms))));
        expect(hashes.size).toBe(6);
    });

    it('holds still once a scene has entered (so the GIF can merge held frames)', () => {
        const { renderer } = setup();
        expect(hashLog(frame(renderer, 3000))).toBe(hashLog(frame(renderer, 3400)));
    });

    it('follows the spec timeline: 12 s video, 8 s GIF without the stubs', () => {
        expect(setup().renderer.durationMs).toBe(12000);
        const gif = setup({}, {}, 1, 'gif').renderer;
        expect(gif.durationMs).toBe(8000);
        expect(gif.timeline.map((s) => s.kind)).not.toContain('stubs');
        expect(gif.frameCount(15)).toBe(120);
    });

    it('draws only frosted photos, never a raw image', () => {
        const { renderer } = setup();
        for (const ms of [5000, 11500]) {
            const sources = drawnSources(frame(renderer, ms));
            expect(sources.length).toBeGreaterThan(0);
            expect(sources.every((s) => isFrosted(s))).toBe(true);
        }
    });

    it('draws the fan\'s own avatar only when opted in', () => {
        const avatar = { width: 64, height: 64 } as unknown as CanvasImageSource;
        const off = drawnSources(frame(setup({ avatar: false }, { avatar }).renderer, 11500));
        expect(off).not.toContain(avatar);
        const on = drawnSources(frame(setup({ avatar: true }, { avatar }).renderer, 11500));
        expect(on).toContain(avatar);
    });

    it('masks the nickname by default and never draws the placeholder', () => {
        const texts = [11500, 1000, 2500, 7000, 9000].flatMap((ms) => drawnText(frame(setup().renderer, ms)));
        expect(texts.join('')).not.toMatch(/%%%|ゆき/);
        expect(texts.join('')).toContain(NICKNAME_MASK);
        const on = drawnText(frame(setup({ nickname: true }).renderer, 11500)).join('');
        expect(on).toContain('ゆき、また明日ね');
        expect(on).toContain('with ゆき');
    });

    it('draws the SakaDesk footer only when on', () => {
        expect(drawnText(frame(setup().renderer, 11500))).toContain('SakaDesk');
        expect(drawnText(frame(setup({ footer: false }).renderer, 11500))).not.toContain('SakaDesk');
    });

    it('uses only token colours and sampled month colours', () => {
        const allowed = new Set([...Object.values(PALETTE), '#102030', '#405060']);
        const { renderer, made } = setup({ style: 'colour' });
        const logs = [0, 2500, 5000, 7000, 9000, 11500].flatMap((ms) => frame(renderer, ms));
        const colours = [...logs, ...made.flatMap((m) => m.log)]
            .filter((e) => e[0] === 'set:fillStyle' || e[0] === 'set:strokeStyle' || e[0] === 'addColorStop' || e[0] === 'set:shadowColor')
            .map((e) => (e[0] === 'addColorStop' ? e[2] : e[1]))
            .filter((c) => typeof c === 'string' && c !== GRADIENT);
        expect(colours.length).toBeGreaterThan(0);
        for (const c of colours) expect(allowed).toContain(c);
    });

    it('frosts the collage with a scaled blur and an 8% haze', () => {
        for (const scale of [1, 2]) {
            const { renderer, made } = setup({}, {}, scale);
            frame(renderer, 5000, scale);
            const layer = made.find((m) => m.log.some((e) => e[0] === 'set:filter' && String(e[1]).startsWith('blur')));
            expect(layer).toBeDefined();
            expect(layer?.log).toContainEqual(['set:filter', `blur(${6 * scale}px)`]);
            const hazeAt = layer!.log.findIndex((e) => e[0] === 'set:globalAlpha' && e[1] === HAZE_ALPHA);
            expect(hazeAt).toBeGreaterThan(-1);
            expect(layer!.log.slice(hazeAt)).toContainEqual(['set:fillStyle', PALETTE.haze]);
        }
    });

    it('box-blurs the collage by rescaling where the canvas has no filter', () => {
        const r = recap();
        const model = buildShareModel(r, defaultShareOptions(r), 'ゆき', t, 'ja');
        const { env, made } = recordingEnv({ filter: false });
        const renderer = new ShareRenderer(model, { photos: frostedPhotos(6), months: [], avatar: null }, {
            format: 'video', scale: 2, palette: PALETTE, fonts: FONTS, env,
        });
        frame(renderer, 5000, 2);
        const layer = made.find((m) => m.canvas.width === SHARE_WIDTH * 2)!;
        expect(layer).toBeDefined();
        const scratch = made.filter((m) => drawnSources(m.log).includes(layer.canvas));
        expect(scratch.map((m) => m.canvas.width)).toEqual(COLLAGE_FALLBACK_PASSES.map((f) => Math.round((SHARE_WIDTH * 2) / f)));
        // Each pass is drawn back over the whole layer before the haze.
        const backAt = layer.log.findIndex((e) => e[0] === 'drawImage' && (e[e.length - 1] as { source: unknown }).source === scratch[0].canvas);
        const hazeAt = layer.log.findIndex((e) => e[0] === 'set:globalAlpha' && e[1] === HAZE_ALPHA);
        expect(backAt).toBeGreaterThan(-1);
        expect(backAt).toBeLessThan(hazeAt);
    });

    it('carries no voice or music: nothing audio is created', () => {
        const { renderer } = setup();
        const log = frame(renderer, 5000);
        expect(JSON.stringify(log)).not.toMatch(/audio|voice/i);
    });
});

describe('availableScenes', () => {
    it('lists the scenes with data', () => {
        const { model } = setup();
        expect([...availableScenes(model, { photos: frostedPhotos(1), months: [] }, 'collage')].sort())
            .toEqual(['clock', 'greeting', 'photos', 'stubs']);
        expect(availableScenes(model, { photos: [], months: [] }, 'collage').has('photos')).toBe(false);
        expect(availableScenes(model, { photos: [], months: [{ month: 1, colour: '#000000' }] }, 'colour').has('photos')).toBe(true);
    });

    it('leaves out the stubs scene without special days', () => {
        const r = payload({ slides: [{ key: 's09_special', fallback: null, data: specialData({ stubs: [] }) }] });
        const model = buildShareModel(r, defaultShareOptions(r), 'ゆき', t, 'ja');
        expect(availableScenes(model, { photos: [], months: [] }, 'collage').has('stubs')).toBe(false);
    });
});

describe('collageLayout', () => {
    it('keeps every thumbnail small, tilted at most 8° and overlapping 30–50%', () => {
        const tiles = collageLayout(12, 42, SHARE_WIDTH, 600);
        expect(tiles.length).toBeGreaterThanOrEqual(12);
        for (const tile of tiles) {
            expect(tile.size).toBeLessThanOrEqual(SHARE_WIDTH * COLLAGE_MAX_TILE_RATIO);
            expect(Math.abs(tile.rotation)).toBeLessThanOrEqual((8 * Math.PI) / 180 + 1e-9);
            expect(tile.overlap).toBeGreaterThanOrEqual(0.3);
            expect(tile.overlap).toBeLessThanOrEqual(0.5);
        }
    });

    it('is the same for the same seed', () => {
        expect(collageLayout(8, 7, 540, 600)).toEqual(collageLayout(8, 7, 540, 600));
        expect(collageLayout(8, 7, 540, 600)).not.toEqual(collageLayout(8, 8, 540, 600));
    });
});

describe('privacy: a raw photo through loading and rendering', () => {
    for (const filter of [true, false]) {
        it(`draws the raw source only at <= 32 px, blurred, never at stage scale (filter ${filter ? 'on' : 'off'})`, async () => {
            const raw = document.createElement('img');
            raw.width = 1200;
            raw.height = 900;
            const r = payload({ slides: [...recap().slides, { key: 's05_photos', fallback: null, data: photosData() }] });
            const { env, made } = recordingEnv({ filter });
            const assets = await loadShareAssets(r, { env, loadImage: async () => raw });
            expect(assets.photos.length).toBeGreaterThan(0);
            const model = buildShareModel(r, { ...defaultShareOptions(r), style: 'collage' }, 'ゆき', t, 'ja');
            // The raw image is also handed straight to the renderer, as a bug that skipped frosting would.
            const renderer = new ShareRenderer(
                model,
                { ...assets, photos: [...assets.photos, raw as unknown as FrostedImage], avatar: null },
                { format: 'video', scale: 2, palette: PALETTE, fonts: FONTS, env },
            );
            const stage: LogEntry[][] = [];
            for (let ms = 0; ms < renderer.durationMs; ms += 250) stage.push(frame(renderer, ms, 2));
            const poster = recordingCanvas(SHARE_WIDTH * 2, SHARE_HEIGHT * 2);
            renderer.drawPoster(poster.ctx);
            stage.push(poster.log);
            // Never at stage scale: no frame, the poster or a stage-sized layer draws the raw source.
            for (const log of stage) expect(drawnSources(log)).not.toContain(raw);
            const rawDraws = made.flatMap((m) => m.log
                .map((e, i) => ({ m, e, i }))
                .filter(({ e }) => e[0] === 'drawImage' && (e[e.length - 1] as { source: unknown }).source === raw));
            // Once per frosted copy, each into a tiny canvas, with blur applied.
            expect(rawDraws).toHaveLength(assets.photos.length);
            for (const { m, i } of rawDraws) {
                expect(m.canvas.width).toBeLessThanOrEqual(FROST_SOURCE_PX);
                expect(m.canvas.height).toBeLessThanOrEqual(FROST_SOURCE_PX);
                if (filter) {
                    expect(filterAt(m.log, i)).toMatch(/^blur\(/);
                } else {
                    // The box blur: the tiny copy is shrunk into scratch canvases and drawn back over itself.
                    const back = drawnSources(m.log.slice(i + 1));
                    expect(back.length).toBeGreaterThanOrEqual(2);
                    expect(back).not.toContain(raw);
                    for (const src of back) expect((src as HTMLCanvasElement).width).toBeLessThan(FROST_SOURCE_PX);
                }
            }
            // The collage layer was composed (so the scene ran) from frosted copies only.
            const layer = made.find((m) => m.canvas.width === SHARE_WIDTH * 2);
            expect(layer).toBeDefined();
            expect(drawnSources(layer!.log).filter((src) => src !== layer!.canvas).length).toBeGreaterThan(0);
        });
    }
});
