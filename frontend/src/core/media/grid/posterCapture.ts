/**
 * The client-side poster capture of the media pipeline (0.5.0): the fallback when the backend has
 * no poster frame for a video (no Windows Shell thumbnail, or an evicted poster). A visible
 * `MediaTile` asks for it; the frame is drawn from a detached `<video>` and uploaded to
 * `PUT /api/media/poster/<path>`, which re-encodes and caches it, so every later open gets the
 * poster from the thumbnail route.
 *
 * - **One at a time**, and each capture also takes a slot of the load scheduler (it opens a media
 *   connection, like a thumbnail).
 * - **Visible tiles only:** the tile's `AbortSignal` cancels a capture at every stage (waiting in
 *   the serial chain, waiting for a scheduler slot, or running: the video load and the upload
 *   are aborted and the element released). A cancelled request is not counted as an attempt.
 * - **Bounded per session:** at most `POSTER_CAPTURE_MAX` captures, and a URL is attempted once.
 * - **Frame:** seeks to `min(1 s, 10 %)`, draws the longest side at most `POSTER_MAX_SIDE` px,
 *   encodes WebP (q 0.8; JPEG when WebP encoding is unavailable). The backend accepts WebP / JPEG
 *   of at most 1 MiB and 4096 px, so a 640 px frame always fits.
 * - **Always released:** the `<video>` is paused, its `src` removed and `load()` called
 *   (`releaseMediaElement`), on success, failure and timeout (`POSTER_CAPTURE_TIMEOUT_MS`).
 *
 * Logs `media_poster` with `outcome` (`captured` / `failed` / `skipped`) and `reason`
 * (`timeout` / `decode` / `upload` / `limit` / `hidden`: the tile left the screen first) only,
 * never the URL.
 */
import { clientLog } from '../../../utils/clientLog';
import { MEDIA_API_BASE } from '../../../features/messages/mediaUrl';
import { releaseMediaElement } from '../mediaElement';
import { scheduleTask } from './loadScheduler';

/** Captures per session (a gallery full of poster-less videos must not hammer the disk). */
export const POSTER_CAPTURE_MAX = 300;
/** One capture (metadata, seek, draw, encode, upload) gives up after this long. */
export const POSTER_CAPTURE_TIMEOUT_MS = 8_000;
/** The captured frame's longest side (the backend's poster size). */
export const POSTER_MAX_SIDE = 640;
/** Where in the video the frame is taken: 10 % in, at most 1 s (skips black lead-ins). */
const SEEK_SHARE = 0.1;
const SEEK_MAX_S = 1;
const WEBP_QUALITY = 0.8;
const JPEG_QUALITY = 0.85;

const MEDIA_PREFIX = `${MEDIA_API_BASE}/`;
const POSTER_ENDPOINT = '/api/media/poster/';

type FailReason = 'timeout' | 'decode' | 'upload';

class CaptureError extends Error {
    constructor(readonly reason: FailReason) {
        super(reason);
    }
}

interface Deps {
    createVideo(): HTMLVideoElement;
    createCanvas(): HTMLCanvasElement;
}

const DEFAULT_DEPS: Deps = {
    createVideo: () => document.createElement('video'),
    createCanvas: () => document.createElement('canvas'),
};

let deps: Deps = DEFAULT_DEPS;
let captureMax = POSTER_CAPTURE_MAX;
let started = 0;
let limitLogged = false;
/** URLs attempted (or being attempted) this session → their result. */
const attempts = new Map<string, Promise<boolean>>();
/** The serial chain: each capture starts after the previous one settled. */
let chain: Promise<unknown> = Promise.resolve();

function once(target: EventTarget, ok: string, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            target.removeEventListener(ok, onOk);
            target.removeEventListener('error', onError);
            signal.removeEventListener('abort', onAbort);
        };
        const onOk = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new CaptureError('decode')); };
        const onAbort = () => { cleanup(); reject(new CaptureError('timeout')); };
        target.addEventListener(ok, onOk);
        target.addEventListener('error', onError);
        signal.addEventListener('abort', onAbort);
    });
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function capture(url: string, signal: AbortSignal): Promise<void> {
    const video = deps.createVideo();
    let canvas: HTMLCanvasElement | null = null;
    try {
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.crossOrigin = 'anonymous';
        const metadata = once(video, 'loadedmetadata', signal);
        video.src = url;
        await metadata;
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
        const seeked = once(video, 'seeked', signal);
        video.currentTime = Math.min(SEEK_MAX_S, duration * SEEK_SHARE);
        await seeked;
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) throw new CaptureError('decode');
        const scale = Math.min(1, POSTER_MAX_SIDE / Math.max(vw, vh));
        const width = Math.max(1, Math.round(vw * scale));
        const height = Math.max(1, Math.round(vh * scale));
        canvas = deps.createCanvas();
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new CaptureError('decode');
        ctx.drawImage(video, 0, 0, width, height);
        let blob = await encode(canvas, 'image/webp', WEBP_QUALITY);
        if (!blob || blob.type !== 'image/webp') blob = await encode(canvas, 'image/jpeg', JPEG_QUALITY);
        if (!blob || blob.type !== 'image/jpeg' && blob.type !== 'image/webp') throw new CaptureError('decode');
        if (signal.aborted) throw new CaptureError('timeout');
        let ok = false;
        try {
            const res = await fetch(`${POSTER_ENDPOINT}${url.slice(MEDIA_PREFIX.length)}`, {
                method: 'PUT',
                headers: { 'Content-Type': blob.type },
                body: blob,
                signal,
            });
            ok = res.status === 200 || res.status === 201;
        } catch {
            throw new CaptureError(signal.aborted ? 'timeout' : 'upload');
        }
        if (!ok) throw new CaptureError('upload');
    } finally {
        releaseMediaElement(video);
        if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
        }
    }
}

/** A capture's end: stored, failed, or cancelled because its tile left the screen. */
type CaptureEnd = 'captured' | 'failed' | 'hidden';

/**
 * One capture in a scheduler slot, bounded by the timeout. `signal` (the tile's) cancels it at
 * any stage: while it waits for a slot the scheduler ticket is cancelled (the capture never
 * starts and the slot is never taken); once running, the video load and the upload are aborted
 * and the element is released (`capture`'s `finally`). A cancel is not a failure: no log here.
 */
function runCapture(url: string, signal?: AbortSignal): Promise<CaptureEnd> {
    return new Promise<CaptureEnd>((resolve) => {
        if (signal?.aborted) {
            resolve('hidden');
            return;
        }
        const controller = new AbortController();
        let running = false;
        let ticket: { cancel(): void } | null = null;
        const onAbort = () => {
            if (running) {
                controller.abort();
                return;
            }
            ticket?.cancel();
            resolve('hidden');
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        ticket = scheduleTask('visible', async () => {
            running = true;
            const timer = setTimeout(() => controller.abort(), POSTER_CAPTURE_TIMEOUT_MS);
            try {
                await capture(url, controller.signal);
                clientLog('media_poster', { outcome: 'captured' });
                resolve('captured');
            } catch (err) {
                if (signal?.aborted) {
                    resolve('hidden');
                } else {
                    const reason: FailReason = err instanceof CaptureError ? err.reason : 'decode';
                    clientLog('media_poster', { outcome: 'failed', reason });
                    resolve('failed');
                }
            } finally {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
            }
        });
    });
}

/**
 * Capture and upload the poster of the media-route video `url`. Resolves `true` when the backend
 * stored it (201) or already had one (200); `false` on failure, past the session cap, for a
 * non-media URL, or when `signal` aborts first (the tile left the screen or unmounted). A URL
 * already attempted this session is never captured again: asking again returns the first
 * attempt's result. An aborted request is not an attempt (it is refunded and may run later).
 */
function request(url: string, signal?: AbortSignal): Promise<boolean> {
    if (!url.startsWith(MEDIA_PREFIX)) return Promise.resolve(false);
    const known = attempts.get(url);
    if (known) return known;
    if (signal?.aborted) return Promise.resolve(false);
    if (started >= captureMax) {
        if (!limitLogged) {
            limitLogged = true;
            clientLog('media_poster', { outcome: 'skipped', reason: 'limit' });
        }
        return Promise.resolve(false);
    }
    started += 1;
    let settled = false;
    // `refund` runs only after `result` exists (an abort or the chain, never inside the executor).
    const refund = () => {
        if (attempts.get(url) === result) attempts.delete(url);
        started -= 1;
        clientLog('media_poster', { outcome: 'skipped', reason: 'hidden' });
    };
    const result: Promise<boolean> = new Promise<boolean>((resolve) => {
        // Waiting in the serial chain: an abort resolves at once (the chain skips it later).
        const onQueuedAbort = () => {
            if (settled) return;
            settled = true;
            refund();
            resolve(false);
        };
        signal?.addEventListener('abort', onQueuedAbort, { once: true });
        chain = chain.then(async () => {
            if (settled) return;
            signal?.removeEventListener('abort', onQueuedAbort);
            const end = await runCapture(url, signal);
            settled = true;
            if (end === 'hidden') refund();
            resolve(end === 'captured');
        });
    });
    attempts.set(url, result);
    return result;
}

export const posterCapture = { request };

/** Test hook: forget every attempt, the cap count and the chain. */
export function resetPosterCaptureForTests(): void {
    attempts.clear();
    started = 0;
    limitLogged = false;
    captureMax = POSTER_CAPTURE_MAX;
    chain = Promise.resolve();
    deps = DEFAULT_DEPS;
}

/** Test hook: stand-ins for the `<video>` and `<canvas>` elements. */
export function setPosterCaptureDepsForTests(next: Deps): void {
    deps = next;
}

/** Test hook: a small session cap. */
export function setPosterCaptureMaxForTests(max: number): void {
    captureMax = max;
}
