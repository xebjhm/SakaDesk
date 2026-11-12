/**
 * Producing the share files: fonts, the GIF (frames → local Pillow assembly), the WebM/MP4
 * (canvas stream + MediaRecorder) and the share PNG.
 *
 * Every file goes through the local in-memory export handoff and a hidden iframe, never an
 * `<a download>` (the desktop webview ignores it). The GIF endpoint assembles the frames and
 * stores the GIF itself, answering with the same `{token}` as `POST /api/memories/export`.
 * Whether the user then saves the file is not observable, so the outcome is `handed_off`.
 *
 * The video is recorded from `canvas.captureStream(30)` alone: no audio track is ever added,
 * and only video codecs are requested, so the export carries no voice and no music.
 *
 * Cancelling: every step takes an `AbortSignal`. An aborted export stops drawing frames, stops
 * the recorder and every stream track, aborts the GIF upload, and never opens a download; it
 * rejects with {@link ShareCancelledError} (or the handoff's `export_cancelled` code).
 */
import { openDownloadUrl } from '../../../../utils/download';
import { canvasToPng, saveBlob, SaveError, type ExportKind, type SaveErrorCode, type SaveOutcome } from '../posterImage';
import { safeMemberId } from '../posterCopy';
import type { ShareFonts } from './ShareRenderer';

export const GIF_FPS = 15;
export const VIDEO_FPS = 30;
/** Timeout of the font loads before the export falls back to system fonts. */
export const FONT_LOAD_TIMEOUT_MS = 4000;
/** The GIF handoff carries every frame and is assembled server side; give it time. */
export const GIF_POST_TIMEOUT_MS = 120000;
/** Video codecs in preference order (spec: vp9, falling back to vp8). No audio codec. */
export const VIDEO_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'] as const;
const VIDEO_BITS_PER_SECOND = 4_000_000;
/** The GIF endpoint's body cap (`share_gif.MAX_BODY_BYTES`); a larger body is refused before sending. */
export const GIF_MAX_BODY_BYTES = 50 * 1024 * 1024;
const CODE = /^[a-z0-9_]{1,40}$/;

/** The export was cancelled (the dialog closed, or the fan pressed Cancel). */
export class ShareCancelledError extends Error {
    constructor() {
        super('cancelled');
        this.name = 'ShareCancelledError';
    }
}

/** Throws {@link ShareCancelledError} once `signal` is aborted. */
export function throwIfCancelled(signal: AbortSignal | undefined): void {
    if (signal?.aborted) throw new ShareCancelledError();
}

export type FontFallback = 'font_timeout' | 'font_failed' | 'font_unsupported';

/**
 * Loads the export's font families for `text` (canvas text does not wait for web fonts). Returns
 * null when they loaded, else the fallback code; the canvas then uses the system fonts.
 */
export async function ensureShareFonts(
    fonts: ShareFonts, text: string,
    opts: { fontsApi?: FontFaceSet | null; timeoutMs?: number } = {},
): Promise<FontFallback | null> {
    const api = opts.fontsApi === undefined ? (typeof document !== 'undefined' ? document.fonts : null) : opts.fontsApi;
    if (!api || typeof api.load !== 'function') return 'font_unsupported';
    const sample = text || 'あ';
    const work = Promise.all([
        api.load(`600 32px ${fonts.display}`, sample),
        api.load(`400 18px ${fonts.sans}`, sample),
        api.load(`500 24px ${fonts.quote}`, sample),
    ]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), opts.timeoutMs ?? FONT_LOAD_TIMEOUT_MS);
    });
    try {
        const r = await Promise.race([work, timeout]);
        return r === 'timeout' ? 'font_timeout' : null;
    } catch {
        return 'font_failed';
    } finally {
        clearTimeout(timer);
    }
}

/** The saved file's name: the year and the member id only, never a name. */
export function shareFilename(year: number, memberId: string, kind: ExportKind): string {
    const id = safeMemberId(memberId);
    return id ? `sakadesk-recap-${year}-${id}-share.${kind}` : `sakadesk-recap-${year}-share.${kind}`;
}

// ---------------------------------------------------------------------------------------------
// GIF

/** Joins runs of identical frames into one frame that lasts the whole run. */
export function mergeHeldFrames(frames: string[], frameMs: number): { frames: string[]; durations: number[] } {
    const out: string[] = [];
    const durations: number[] = [];
    for (const f of frames) {
        if (out.length && out[out.length - 1] === f) durations[durations.length - 1] += frameMs;
        else {
            out.push(f);
            durations.push(frameMs);
        }
    }
    return { frames: out, durations };
}

interface FrameRenderer {
    durationMs: number;
    frameCount(fps: number): number;
    drawFrame(ctx: CanvasRenderingContext2D, index: number, fps: number): void;
}

async function encodeCanvasBase64(canvas: HTMLCanvasElement): Promise<string> {
    const blob = await canvasToPng(canvas);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

/**
 * Draws every GIF frame (15 fps over the timeline) and returns them as base64 PNGs, held frames
 * merged. `onProgress` gets 0–1.
 */
export async function renderGifFrames(
    renderer: FrameRenderer, canvas: HTMLCanvasElement,
    opts: {
        fps?: number; encode?: (c: HTMLCanvasElement) => Promise<string>; onProgress?: (p: number) => void;
        signal?: AbortSignal;
    } = {},
): Promise<{ frames: string[]; durations: number[] }> {
    const fps = opts.fps ?? GIF_FPS;
    const encode = opts.encode ?? encodeCanvasBase64;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no_canvas');
    const count = renderer.frameCount(fps);
    const raw: string[] = [];
    for (let i = 0; i < count; i++) {
        throwIfCancelled(opts.signal);
        renderer.drawFrame(ctx, i, fps);
        raw.push(await encode(canvas));
        throwIfCancelled(opts.signal);
        opts.onProgress?.((i + 1) / count);
    }
    const merged = mergeHeldFrames(raw, Math.round(1000 / fps));
    return merged;
}

export interface ShareGifBody {
    frames: string[];
    durations_ms: number[];
    fps: number;
    width: number;
    height: number;
}

/** A refused handoff; `detail` is the server's reason code when it sent one. */
export class ShareSaveError extends SaveError {
    constructor(code: SaveErrorCode, readonly detail?: string) {
        super(code);
        this.name = 'ShareSaveError';
    }
}

/**
 * Posts the frames to the local GIF assembly and opens the stored GIF's download URL. Aborting
 * `signal` aborts the upload and rejects with `export_cancelled`; no download is opened then.
 */
export async function postShareGif(
    body: ShareGifBody, filename: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal,
): Promise<{ outcome: SaveOutcome }> {
    if (signal?.aborted) throw new ShareSaveError('export_cancelled');
    const payload = JSON.stringify(body);
    // Base64 and JSON are ASCII, so the string length is the byte count.
    if (payload.length > GIF_MAX_BODY_BYTES) throw new ShareSaveError('export_too_large', 'body_too_large');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GIF_POST_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    let res: Response;
    try {
        res = await fetchImpl('/api/memories/share/gif', {
            method: 'POST',
            body: payload,
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
        });
    } catch (e) {
        if (signal?.aborted) throw new ShareSaveError('export_cancelled');
        const abort = typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
        throw new ShareSaveError(abort ? 'export_timeout' : 'export_network');
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
    let json: { token?: unknown; detail?: unknown } = {};
    try {
        json = (await res.json()) as typeof json;
    } catch {
        json = {};
    }
    if (!res.ok) {
        const detail = typeof json.detail === 'string' && CODE.test(json.detail) ? json.detail : undefined;
        throw new ShareSaveError(res.status === 413 ? 'export_too_large' : 'export_rejected', detail);
    }
    const token = json.token;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) throw new ShareSaveError('export_rejected');
    // Cancelled while the answer was read: never hand an abandoned export to the save dialog.
    if (signal?.aborted) throw new ShareSaveError('export_cancelled');
    openDownloadUrl(`/api/memories/export/${token}?filename=${encodeURIComponent(filename)}`);
    return { outcome: 'handed_off' };
}

// ---------------------------------------------------------------------------------------------
// Video

interface RecorderStatic {
    isTypeSupported(type: string): boolean;
}

export type VideoSupport =
    | { supported: true; mimeType: string }
    | { supported: false; reason: 'no_media_recorder' | 'no_capture_stream' | 'no_codec' };

/** Whether the webview can record the canvas, and with which (video-only) type. */
export function videoSupport(env?: { MediaRecorder: RecorderStatic | undefined; canvasCapture: boolean }): VideoSupport {
    const e = env ?? {
        MediaRecorder: typeof MediaRecorder !== 'undefined' ? MediaRecorder : undefined,
        canvasCapture: typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function',
    };
    if (!e.MediaRecorder || typeof e.MediaRecorder.isTypeSupported !== 'function') return { supported: false, reason: 'no_media_recorder' };
    if (!e.canvasCapture) return { supported: false, reason: 'no_capture_stream' };
    const mimeType = VIDEO_TYPES.find((t) => e.MediaRecorder!.isTypeSupported(t));
    return mimeType ? { supported: true, mimeType } : { supported: false, reason: 'no_codec' };
}

interface TimedRenderer {
    durationMs: number;
    drawAt(ctx: CanvasRenderingContext2D, tMs: number): void;
}

/**
 * Plays the timeline on the canvas in real time while MediaRecorder records its stream.
 * The stream is the canvas's own (video only); the kind follows what the recorder produced.
 *
 * Every way out releases everything: the animation frame is cancelled, the recorder is stopped if
 * it still runs, and every stream track is stopped. That covers a recorder that cannot be created,
 * a recorder error, an empty recording and an aborted `signal` (which rejects with
 * {@link ShareCancelledError}).
 */
export function recordVideo(
    renderer: TimedRenderer, canvas: HTMLCanvasElement,
    opts: {
        mimeType: string;
        MediaRecorderImpl?: typeof MediaRecorder;
        raf?: (cb: () => void) => number;
        cancelRaf?: (id: number) => void;
        now?: () => number;
        onProgress?: (p: number) => void;
        signal?: AbortSignal;
    },
): Promise<{ blob: Blob; kind: 'webm' | 'mp4' }> {
    if (opts.signal?.aborted) return Promise.reject(new ShareCancelledError());
    const Recorder = opts.MediaRecorderImpl ?? MediaRecorder;
    const raf = opts.raf ?? ((cb: () => void) => requestAnimationFrame(cb));
    const cancelRaf = opts.cancelRaf ?? ((id: number) => cancelAnimationFrame(id));
    const now = opts.now ?? (() => performance.now());
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.reject(new Error('no_canvas'));
    const stream = canvas.captureStream(VIDEO_FPS);
    const stopTracks = () => stream.getTracks().forEach((t) => t.stop());
    let recorder: MediaRecorder;
    try {
        recorder = new Recorder(stream, { mimeType: opts.mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
    } catch {
        stopTracks();
        return Promise.reject(new Error('recorder_failed'));
    }
    const chunks: Blob[] = [];
    return new Promise((resolve, reject) => {
        let settled = false;
        let frame: number | null = null;
        const release = () => {
            if (frame !== null) cancelRaf(frame);
            frame = null;
            opts.signal?.removeEventListener('abort', onAbort);
            if (recorder.state !== 'inactive') {
                try {
                    recorder.stop();
                } catch {
                    // Already stopping; the tracks below end the stream either way.
                }
            }
            stopTracks();
        };
        const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            release();
            reject(error);
        };
        const onAbort = () => fail(new ShareCancelledError());
        opts.signal?.addEventListener('abort', onAbort);
        recorder.ondataavailable = (e: BlobEvent) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        recorder.onerror = () => fail(new Error('recorder_error'));
        recorder.onstop = () => {
            if (settled) return;
            const type = recorder.mimeType || opts.mimeType;
            const kind = type.startsWith('video/mp4') ? 'mp4' : 'webm';
            const blob = new Blob(chunks, { type: kind === 'mp4' ? 'video/mp4' : 'video/webm' });
            if (blob.size === 0) {
                fail(new Error('empty_recording'));
                return;
            }
            settled = true;
            release();
            resolve({ blob, kind });
        };
        try {
            renderer.drawAt(ctx, 0);
            recorder.start(250);
        } catch {
            fail(new Error('recorder_failed'));
            return;
        }
        const start = now();
        const tick = () => {
            frame = null;
            if (settled) return;
            const t = now() - start;
            try {
                renderer.drawAt(ctx, Math.min(t, renderer.durationMs - 1));
            } catch {
                fail(new Error('render_failed'));
                return;
            }
            opts.onProgress?.(Math.min(1, t / renderer.durationMs));
            if (t < renderer.durationMs) frame = raf(tick);
            else if (recorder.state !== 'inactive') recorder.stop();
        };
        frame = raf(tick);
    });
}

/** Hands a recorded video or the share PNG to the export handoff (cancellable through `signal`). */
export function saveShareBlob(blob: Blob, kind: ExportKind, filename: string, fetchImpl?: typeof fetch, signal?: AbortSignal) {
    return saveBlob(blob, kind, filename, fetchImpl, signal);
}
