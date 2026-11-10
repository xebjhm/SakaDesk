import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../utils/download', () => ({ openDownloadUrl: vi.fn() }));
import { openDownloadUrl } from '../../../../utils/download';
import {
    ensureShareFonts, GIF_FPS, GIF_MAX_BODY_BYTES, mergeHeldFrames, postShareGif, recordVideo, renderGifFrames, saveShareBlob,
    ShareCancelledError, shareFilename, videoSupport,
} from './shareExport';
import { SaveError } from '../posterImage';

/** A MediaRecorder stand-in: `stop()` flushes one chunk and fires onstop; `failOnStart` errors. */
function fakeRecorderClass(opts: { throwOnCreate?: boolean; emptyChunk?: boolean } = {}) {
    const made: FakeRecorder[] = [];
    class FakeRecorder {
        mimeType: string;
        state: 'inactive' | 'recording' = 'inactive';
        ondataavailable: ((e: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        onerror: (() => void) | null = null;
        stop = vi.fn(() => {
            if (this.state === 'inactive') throw new Error('InvalidStateError');
            this.state = 'inactive';
            this.ondataavailable?.({ data: new Blob(opts.emptyChunk ? [] : ['webm'], { type: 'video/webm' }) });
            this.onstop?.();
        });
        constructor(readonly stream: unknown, readonly options: { mimeType: string }) {
            if (opts.throwOnCreate) throw new Error('NotSupportedError');
            this.mimeType = options.mimeType;
            made.push(this);
        }
        start() { this.state = 'recording'; }
    }
    return { Recorder: FakeRecorder as unknown as typeof MediaRecorder, made };
}

function fakeStreamCanvas() {
    const track = { kind: 'video', stop: vi.fn() };
    const stream = { getTracks: () => [track], getAudioTracks: () => [], addTrack: vi.fn() };
    const canvas = { width: 540, height: 960, getContext: () => ({}), captureStream: vi.fn(() => stream) } as unknown as HTMLCanvasElement;
    return { canvas, track };
}

/** A manual animation-frame queue: `step()` runs the pending callback. */
function manualRaf() {
    let pending: (() => void) | null = null;
    let id = 0;
    const cancelled: number[] = [];
    return {
        raf: (cb: () => void) => { pending = cb; return ++id; },
        cancelRaf: (n: number) => { cancelled.push(n); pending = null; },
        step: () => { const cb = pending; pending = null; cb?.(); },
        get pending() { return pending; },
        cancelled,
    };
}

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

describe('cancelling', () => {
    it('cancel during recording stops the loop, the recorder and every track, and rejects as cancelled', async () => {
        const { canvas, track } = fakeStreamCanvas();
        const { Recorder, made } = fakeRecorderClass();
        const frames = manualRaf();
        let now = 0;
        const drawAt = vi.fn();
        const controller = new AbortController();
        const p = recordVideo({ durationMs: 12000, drawAt }, canvas, {
            mimeType: 'video/webm;codecs=vp9', MediaRecorderImpl: Recorder,
            raf: frames.raf, cancelRaf: frames.cancelRaf, now: () => now, signal: controller.signal,
        });
        now = 1000;
        frames.step();
        expect(frames.pending).not.toBeNull();
        const draws = drawAt.mock.calls.length;
        controller.abort();
        await expect(p).rejects.toBeInstanceOf(ShareCancelledError);
        expect(frames.cancelled).toHaveLength(1);
        expect(frames.pending).toBeNull();
        expect(made[0].stop).toHaveBeenCalledTimes(1);
        expect(made[0].state).toBe('inactive');
        expect(track.stop).toHaveBeenCalled();
        // The loop no longer draws.
        frames.step();
        expect(drawAt.mock.calls.length).toBe(draws);
    });

    it('an already-aborted signal records nothing', async () => {
        const { canvas } = fakeStreamCanvas();
        const controller = new AbortController();
        controller.abort();
        await expect(recordVideo({ durationMs: 100, drawAt: vi.fn() }, canvas, {
            mimeType: 'video/webm', MediaRecorderImpl: fakeRecorderClass().Recorder, signal: controller.signal,
        })).rejects.toBeInstanceOf(ShareCancelledError);
        expect(canvas.captureStream).not.toHaveBeenCalled();
    });

    it('cancel during the GIF upload aborts the fetch and never opens a download', async () => {
        const controller = new AbortController();
        let seen: AbortSignal | undefined;
        const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
            seen = init.signal ?? undefined;
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }));
        const p = postShareGif(
            { frames: ['AAAA'], durations_ms: [100], fps: 15, width: 540, height: 960 },
            'x.gif', fetchImpl as unknown as typeof fetch, controller.signal,
        );
        controller.abort();
        await expect(p).rejects.toMatchObject({ code: 'export_cancelled' });
        expect(seen?.aborted).toBe(true);
        expect(openDownloadUrl).not.toHaveBeenCalled();
    });

    it('a GIF answer that lands after cancel is not handed to the save dialog', async () => {
        const controller = new AbortController();
        const fetchImpl = vi.fn(async () => {
            controller.abort();
            return new Response(JSON.stringify({ token: 'a'.repeat(43) }), { status: 200 });
        });
        await expect(postShareGif(
            { frames: ['AAAA'], durations_ms: [100], fps: 15, width: 540, height: 960 },
            'x.gif', fetchImpl as unknown as typeof fetch, controller.signal,
        )).rejects.toMatchObject({ code: 'export_cancelled' });
        expect(openDownloadUrl).not.toHaveBeenCalled();
    });

    it('cancel during the video / PNG handoff aborts it without a download', async () => {
        const controller = new AbortController();
        const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }));
        const p = saveShareBlob(new Blob(['x']), 'webm', 'x.webm', fetchImpl as unknown as typeof fetch, controller.signal);
        controller.abort();
        await expect(p).rejects.toMatchObject({ code: 'export_cancelled' });
        expect(openDownloadUrl).not.toHaveBeenCalled();
    });

    it('stops drawing GIF frames once cancelled', async () => {
        const controller = new AbortController();
        const drawn: number[] = [];
        const renderer = { durationMs: 8000, frameCount: () => 120, drawFrame: (_c: unknown, i: number) => drawn.push(i) };
        const canvas = { getContext: () => ({}) } as unknown as HTMLCanvasElement;
        const encode = vi.fn(async () => {
            if (drawn.length === 3) controller.abort();
            return 'f';
        });
        await expect(renderGifFrames(renderer, canvas, { encode, signal: controller.signal })).rejects.toBeInstanceOf(ShareCancelledError);
        expect(drawn).toHaveLength(3);
    });
});

describe('recorder failures release everything', () => {
    it('a recorder that cannot be created stops the captured stream', async () => {
        const { canvas, track } = fakeStreamCanvas();
        await expect(recordVideo({ durationMs: 100, drawAt: vi.fn() }, canvas, {
            mimeType: 'video/webm', MediaRecorderImpl: fakeRecorderClass({ throwOnCreate: true }).Recorder,
        })).rejects.toThrow('recorder_failed');
        expect(track.stop).toHaveBeenCalled();
    });

    it('a recorder error stops the loop, the recorder and the tracks without a late stop() throw', async () => {
        const { canvas, track } = fakeStreamCanvas();
        const { Recorder, made } = fakeRecorderClass();
        const frames = manualRaf();
        let now = 0;
        const p = recordVideo({ durationMs: 12000, drawAt: vi.fn() }, canvas, {
            mimeType: 'video/webm', MediaRecorderImpl: Recorder, raf: frames.raf, cancelRaf: frames.cancelRaf, now: () => now,
        });
        made[0].onerror?.();
        await expect(p).rejects.toThrow('recorder_error');
        expect(frames.cancelled).toHaveLength(1);
        expect(frames.pending).toBeNull();
        expect(made[0].state).toBe('inactive');
        expect(track.stop).toHaveBeenCalled();
        now = 20000;
        // Nothing is queued, so no rAF callback can call stop() on the inactive recorder.
        expect(() => frames.step()).not.toThrow();
        expect(made[0].stop).toHaveBeenCalledTimes(1);
    });

    it('an empty recording still stops every track', async () => {
        const { canvas, track } = fakeStreamCanvas();
        const { Recorder } = fakeRecorderClass({ emptyChunk: true });
        const frames = manualRaf();
        let now = 0;
        const p = recordVideo({ durationMs: 100, drawAt: vi.fn() }, canvas, {
            mimeType: 'video/webm', MediaRecorderImpl: Recorder, raf: frames.raf, cancelRaf: frames.cancelRaf, now: () => now,
        });
        now = 200;
        frames.step();
        await expect(p).rejects.toThrow('empty_recording');
        expect(track.stop).toHaveBeenCalled();
    });
});

describe('shareFilename', () => {
    it('carries the year and member id only', () => {
        expect(shareFilename(2026, '58', 'gif')).toBe('sakadesk-recap-2026-58-share.gif');
        expect(shareFilename(2026, '金村', 'png')).toBe('sakadesk-recap-2026-share.png');
    });
});
