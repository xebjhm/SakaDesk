import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';
import {
    POSTER_CAPTURE_MAX, POSTER_CAPTURE_TIMEOUT_MS, POSTER_MAX_SIDE, posterCapture,
    resetPosterCaptureForTests, setPosterCaptureDepsForTests, setPosterCaptureMaxForTests,
} from './posterCapture';
import { resetLoadSchedulerForTests } from './loadScheduler';

type Mode = 'ok' | 'metaError' | 'hang' | 'seekError' | 'noFrame';

/** A detached `<video>` stand-in: metadata and seeks answer on a microtask, per `mode`. */
class FakeVideo extends EventTarget {
    static all: FakeVideo[] = [];
    static mode: Mode = 'ok';
    static duration = 5;
    static size: [number, number] = [1920, 1080];
    muted = false;
    playsInline = false;
    preload = '';
    crossOrigin: string | null = null;
    videoWidth = FakeVideo.size[0];
    videoHeight = FakeVideo.size[1];
    duration = FakeVideo.duration;
    seekedTo: number | null = null;
    attrs = new Map<string, string>();
    pause = vi.fn();
    load = vi.fn();
    constructor() { super(); FakeVideo.all.push(this); }
    set src(v: string) {
        this.attrs.set('src', v);
        const mode = FakeVideo.mode;
        queueMicrotask(() => {
            if (mode === 'metaError') this.dispatchEvent(new Event('error'));
            else if (mode !== 'hang') {
                if (mode === 'noFrame') { this.videoWidth = 0; this.videoHeight = 0; }
                this.dispatchEvent(new Event('loadedmetadata'));
            }
        });
    }
    get src() { return this.attrs.get('src') ?? ''; }
    set currentTime(t: number) {
        this.seekedTo = t;
        queueMicrotask(() => this.dispatchEvent(new Event(FakeVideo.mode === 'seekError' ? 'error' : 'seeked')));
    }
    get currentTime() { return this.seekedTo ?? 0; }
    removeAttribute(name: string) { this.attrs.delete(name); }
    getAttribute(name: string) { return this.attrs.get(name) ?? null; }
    querySelectorAll() { return [] as unknown as NodeListOf<Element>; }
    released() { return this.pause.mock.calls.length > 0 && !this.attrs.has('src') && this.load.mock.calls.length > 0; }
}

class FakeCanvas {
    static all: FakeCanvas[] = [];
    static webp = true;
    width = 0;
    height = 0;
    draw = vi.fn();
    constructor() { FakeCanvas.all.push(this); }
    getContext() { return { drawImage: this.draw }; }
    toBlob(cb: (b: Blob | null) => void, type: string) {
        const out = type === 'image/webp' && !FakeCanvas.webp ? 'image/png' : type;
        cb(new Blob(['frame'], { type: out }));
    }
}

const VIDEO = '/api/content/media/hinatazaka46/messages/m/video/124.mp4';
let fetchMock: ReturnType<typeof vi.fn>;
const flushMicro = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

beforeEach(() => {
    FakeVideo.all = [];
    FakeVideo.mode = 'ok';
    FakeVideo.duration = 5;
    FakeVideo.size = [1920, 1080];
    FakeCanvas.all = [];
    FakeCanvas.webp = true;
    resetLoadSchedulerForTests();
    resetPosterCaptureForTests();
    setPosterCaptureDepsForTests({
        createVideo: () => new FakeVideo() as unknown as HTMLVideoElement,
        createCanvas: () => new FakeCanvas() as unknown as HTMLCanvasElement,
    });
    vi.mocked(clientLog).mockClear();
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ v: 'abc' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('posterCapture', () => {
    it('has the agreed bounds', () => {
        expect(POSTER_CAPTURE_MAX).toBe(300);
        expect(POSTER_CAPTURE_TIMEOUT_MS).toBe(8000);
        expect(POSTER_MAX_SIDE).toBe(640);
    });

    it('seeks to 10% of the video, PUTs a WebP and releases the element', async () => {
        await expect(posterCapture.request(VIDEO)).resolves.toBe(true);
        const video = FakeVideo.all[0];
        expect(video.muted).toBe(true);
        expect(video.playsInline).toBe(true);
        expect(video.preload).toBe('metadata');
        expect(video.crossOrigin).toBe('anonymous');
        expect(video.seekedTo).toBeCloseTo(0.5);
        const canvas = FakeCanvas.all[0];
        expect(canvas.draw).toHaveBeenCalledWith(video, 0, 0, 640, 360);
        expect([canvas.width, canvas.height]).toEqual([0, 0]); // released after the upload
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(target).toBe('/api/media/poster/hinatazaka46/messages/m/video/124.mp4');
        expect(init.method).toBe('PUT');
        expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/webp');
        expect((init.body as Blob).type).toBe('image/webp');
        expect(video.released()).toBe(true);
        expect(clientLog).toHaveBeenCalledWith('media_poster', { outcome: 'captured' });
    });

    it('caps the seek at 1 s', async () => {
        FakeVideo.duration = 60;
        await posterCapture.request(VIDEO);
        expect(FakeVideo.all[0].seekedTo).toBe(1);
    });

    it('keeps a small frame unscaled', async () => {
        FakeVideo.size = [320, 480];
        await posterCapture.request(VIDEO);
        expect(FakeCanvas.all[0].draw).toHaveBeenCalledWith(FakeVideo.all[0], 0, 0, 320, 480);
    });

    it('treats a 200 (poster already there) as captured', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ v: 'abc' }), { status: 200 }));
        await expect(posterCapture.request(VIDEO)).resolves.toBe(true);
    });

    it('falls back to JPEG when WebP encoding is unavailable', async () => {
        FakeCanvas.webp = false;
        await posterCapture.request(VIDEO);
        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect((init.body as Blob).type).toBe('image/jpeg');
        expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/jpeg');
    });

    it.each([
        ['metaError', 'decode'],
        ['seekError', 'decode'],
        ['noFrame', 'decode'],
    ] as const)('releases the element and logs a %s as failed (%s)', async (mode, reason) => {
        FakeVideo.mode = mode;
        await expect(posterCapture.request(VIDEO)).resolves.toBe(false);
        expect(FakeVideo.all[0].released()).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(clientLog).toHaveBeenCalledWith('media_poster', { outcome: 'failed', reason });
    });

    it('fails an upload the backend refuses', async () => {
        fetchMock.mockResolvedValueOnce(new Response('{"detail":"bad_image"}', { status: 400 }));
        await expect(posterCapture.request(VIDEO)).resolves.toBe(false);
        expect(clientLog).toHaveBeenCalledWith('media_poster', { outcome: 'failed', reason: 'upload' });
        fetchMock.mockRejectedValueOnce(new TypeError('offline'));
        await expect(posterCapture.request(`${VIDEO}2`)).resolves.toBe(false);
    });

    it('times out after 8 s and releases the element', async () => {
        vi.useFakeTimers();
        FakeVideo.mode = 'hang';
        const req = posterCapture.request(VIDEO);
        await vi.advanceTimersByTimeAsync(POSTER_CAPTURE_TIMEOUT_MS + 1);
        await expect(req).resolves.toBe(false);
        expect(FakeVideo.all[0].released()).toBe(true);
        expect(clientLog).toHaveBeenCalledWith('media_poster', { outcome: 'failed', reason: 'timeout' });
    });

    it('captures one video at a time', async () => {
        let release!: () => void;
        fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => {
            release = () => resolve(new Response('{}', { status: 201 }));
        }));
        const a = posterCapture.request(`${VIDEO}?a`);
        const b = posterCapture.request(`${VIDEO}?b`);
        await flushMicro();
        await flushMicro();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(FakeVideo.all).toHaveLength(1);
        release();
        await expect(a).resolves.toBe(true);
        await b;
        expect(FakeVideo.all).toHaveLength(2);
    });

    it('never retries a URL in the session', async () => {
        FakeVideo.mode = 'metaError';
        await posterCapture.request(VIDEO);
        FakeVideo.mode = 'ok';
        await expect(posterCapture.request(VIDEO)).resolves.toBe(false);
        expect(FakeVideo.all).toHaveLength(1);
        const same = [posterCapture.request(`${VIDEO}x`), posterCapture.request(`${VIDEO}x`)];
        await Promise.all(same);
        expect(FakeVideo.all).toHaveLength(2);
    });

    it('honours the session cap', async () => {
        setPosterCaptureMaxForTests(1);
        await posterCapture.request(`${VIDEO}1`);
        await expect(posterCapture.request(`${VIDEO}2`)).resolves.toBe(false);
        await posterCapture.request(`${VIDEO}3`);
        expect(FakeVideo.all).toHaveLength(1);
        const skips = vi.mocked(clientLog).mock.calls.filter(([, f]) => (f as { outcome?: string }).outcome === 'skipped');
        expect(skips).toEqual([['media_poster', { outcome: 'skipped', reason: 'limit' }]]);
    });

    it('drops a queued capture whose tile left the screen, so it can run later', async () => {
        const first = posterCapture.request(`${VIDEO}a`);
        const controller = new AbortController();
        const queued = posterCapture.request(`${VIDEO}b`, controller.signal);
        controller.abort();
        await expect(queued).resolves.toBe(false);
        await first;
        expect(FakeVideo.all).toHaveLength(1);
        await expect(posterCapture.request(`${VIDEO}b`)).resolves.toBe(true);
        expect(FakeVideo.all).toHaveLength(2);
        const pre = new AbortController();
        pre.abort();
        await expect(posterCapture.request(`${VIDEO}c`, pre.signal)).resolves.toBe(false);
    });

    it('ignores URLs outside the media route', async () => {
        await expect(posterCapture.request('/api/blogs/image?x=1')).resolves.toBe(false);
        expect(FakeVideo.all).toHaveLength(0);
    });
});
