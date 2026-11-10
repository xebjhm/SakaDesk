import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../utils/download', () => ({ openDownloadUrl: vi.fn() }));
import { openDownloadUrl } from '../../../../utils/download';
import {
    ensureShareFonts, GIF_FPS, GIF_MAX_BODY_BYTES, mergeHeldFrames, postShareGif, recordVideo, renderGifFrames, shareFilename, videoSupport,
} from './shareExport';
import { SaveError } from '../posterImage';

beforeEach(() => vi.mocked(openDownloadUrl).mockClear());

describe('ensureShareFonts', () => {
    const fonts = { display: '"Noto Serif TC", serif', sans: '"Noto Sans TC", sans-serif', quote: '"Noto Serif JP", serif' };

    it('loads each family for the text and reports no fallback', async () => {
        const load = vi.fn(async () => [{}]);
        expect(await ensureShareFonts(fonts, '一年', { fontsApi: { load } as unknown as FontFaceSet })).toBeNull();
        expect(load).toHaveBeenCalledTimes(3);
        expect(load.mock.calls[0]).toEqual([expect.stringContaining('Noto Serif TC'), '一年']);
    });

    it('falls back to system fonts on a timeout', async () => {
        vi.useFakeTimers();
        const load = vi.fn(() => new Promise<FontFace[]>(() => {}));
        const p = ensureShareFonts(fonts, 'x', { fontsApi: { load } as unknown as FontFaceSet, timeoutMs: 50 });
        await vi.advanceTimersByTimeAsync(60);
        expect(await p).toBe('font_timeout');
        vi.useRealTimers();
    });

    it('reports a failed load and a missing font API', async () => {
        const load = vi.fn(async () => { throw new Error('x'); });
        expect(await ensureShareFonts(fonts, 'x', { fontsApi: { load } as unknown as FontFaceSet })).toBe('font_failed');
        expect(await ensureShareFonts(fonts, 'x', { fontsApi: null })).toBe('font_unsupported');
    });
});

describe('GIF frames', () => {
    it('merges held frames into one longer frame', () => {
        expect(mergeHeldFrames(['a', 'a', 'b', 'b', 'b', 'a'], 66)).toEqual({ frames: ['a', 'b', 'a'], durations: [132, 198, 66] });
    });

    it('renders 15 fps for the whole timeline and keeps the total length', async () => {
        const drawn: number[] = [];
        const renderer = {
            durationMs: 8000,
            frameCount: (fps: number) => Math.round((8000 * fps) / 1000),
            drawFrame: (_ctx: unknown, i: number) => drawn.push(i),
        };
        const canvas = { width: 540, height: 960, getContext: () => ({}) } as unknown as HTMLCanvasElement;
        // Frames hold still in pairs of 10.
        const encode = vi.fn(async () => `f${Math.floor(drawn[drawn.length - 1] / 10)}`);
        const progress = vi.fn();
        const out = await renderGifFrames(renderer, canvas, { encode, onProgress: progress });
        expect(drawn).toHaveLength(8 * GIF_FPS);
        expect(out.frames).toHaveLength(12);
        expect(out.durations.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(7990);
        expect(progress).toHaveBeenLastCalledWith(1);
    });
});

describe('postShareGif', () => {
    const body = { frames: ['AAAA'], durations_ms: [100], fps: 15, width: 540, height: 960 };

    it('hands the token to the download iframe', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ token: 'a'.repeat(43) }), { status: 200 }));
        expect(await postShareGif(body, 'sakadesk-recap-2026-58-share.gif', fetchImpl as unknown as typeof fetch)).toEqual({ outcome: 'handed_off' });
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('/api/memories/share/gif');
        expect(JSON.parse(String(init.body))).toEqual(body);
        expect(openDownloadUrl).toHaveBeenCalledWith(`/api/memories/export/${'a'.repeat(43)}?filename=sakadesk-recap-2026-58-share.gif`);
    });

    it('maps refusals to error codes', async () => {
        const tooBig = vi.fn(async () => new Response('{}', { status: 413 }));
        await expect(postShareGif(body, 'x.gif', tooBig as unknown as typeof fetch)).rejects.toMatchObject({ code: 'export_too_large' });
        const bad = vi.fn(async () => new Response(JSON.stringify({ detail: 'frame_size' }), { status: 400 }));
        const err = await postShareGif(body, 'x.gif', bad as unknown as typeof fetch).catch((e) => e);
        expect(err).toBeInstanceOf(SaveError);
        expect(err.code).toBe('export_rejected');
        expect(err.detail).toBe('frame_size');
        expect(openDownloadUrl).not.toHaveBeenCalled();
    });

    it('refuses a body over the endpoint cap before sending it', async () => {
        const fetchImpl = vi.fn();
        const huge = { ...body, frames: ['A'.repeat(GIF_MAX_BODY_BYTES)] };
        await expect(postShareGif(huge, 'x.gif', fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ code: 'export_too_large', detail: 'body_too_large' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});

describe('video', () => {
    it('is unsupported without MediaRecorder or captureStream', () => {
        expect(videoSupport({ MediaRecorder: undefined, canvasCapture: true })).toEqual({ supported: false, reason: 'no_media_recorder' });
        const MR = { isTypeSupported: () => true };
        expect(videoSupport({ MediaRecorder: MR, canvasCapture: false })).toEqual({ supported: false, reason: 'no_capture_stream' });
        expect(videoSupport({ MediaRecorder: { isTypeSupported: () => false }, canvasCapture: true })).toEqual({ supported: false, reason: 'no_codec' });
    });

    it('prefers vp9, then vp8, never an audio codec', () => {
        const vp8only = { isTypeSupported: (t: string) => t === 'video/webm;codecs=vp8' };
        expect(videoSupport({ MediaRecorder: vp8only, canvasCapture: true })).toEqual({ supported: true, mimeType: 'video/webm;codecs=vp8' });
        const all = { isTypeSupported: () => true };
        const s = videoSupport({ MediaRecorder: all, canvasCapture: true });
        expect(s).toEqual({ supported: true, mimeType: 'video/webm;codecs=vp9' });
    });

    it('records only the canvas stream: no voice or music track', async () => {
        const videoTrack = { kind: 'video', stop: vi.fn() };
        const stream = { getTracks: () => [videoTrack], getAudioTracks: () => [], addTrack: vi.fn() };
        const canvas = { width: 540, height: 960, getContext: () => ({}), captureStream: vi.fn(() => stream) } as unknown as HTMLCanvasElement;
        const recorders: { stream: unknown; options: { mimeType: string } }[] = [];
        class FakeRecorder {
            mimeType: string;
            ondataavailable: ((e: { data: Blob }) => void) | null = null;
            onstop: (() => void) | null = null;
            constructor(readonly stream: unknown, readonly options: { mimeType: string }) {
                this.mimeType = options.mimeType;
                recorders.push(this);
            }
            start() {}
            stop() {
                this.ondataavailable?.({ data: new Blob(['webm'], { type: 'video/webm' }) });
                this.onstop?.();
            }
        }
        let now = 0;
        const raf = (cb: () => void) => { now += 500; setTimeout(cb, 0); return 1; };
        const drawAt = vi.fn();
        const renderer = { durationMs: 12000, drawAt };
        const out = await recordVideo(renderer, canvas, {
            mimeType: 'video/webm;codecs=vp9',
            MediaRecorderImpl: FakeRecorder as unknown as typeof MediaRecorder,
            raf, now: () => now,
        });
        expect(canvas.captureStream).toHaveBeenCalledWith(30);
        expect(recorders[0].stream).toBe(stream);
        expect(stream.addTrack).not.toHaveBeenCalled();
        expect(recorders[0].options.mimeType).not.toMatch(/opus|vorbis|aac|mp4a/);
        expect(out.kind).toBe('webm');
        expect(out.blob.size).toBeGreaterThan(0);
        expect(drawAt).toHaveBeenCalled();
        expect(videoTrack.stop).toHaveBeenCalled();
    });
});

describe('shareFilename', () => {
    it('carries the year and member id only', () => {
        expect(shareFilename(2026, '58', 'gif')).toBe('sakadesk-recap-2026-58-share.gif');
        expect(shareFilename(2026, '金村', 'png')).toBe('sakadesk-recap-2026-share.png');
    });
});
