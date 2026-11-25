import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';
import {
    META_BATCH_MAX, invalidateMediaMeta, primeMediaMeta, readMediaMeta, resetMediaMetaForTests,
    setMetaCacheMaxForTests, useMediaMeta, type MediaMeta,
} from './mediaMeta';

const url = (n: number | string) => `/api/content/media/hinatazaka46/messages/m/picture/${n}.jpg`;
const item = (over: Partial<MediaMeta> = {}): MediaMeta => ({
    kind: 'picture', v: 'a1b2c3d4e5f6', color: 'teal', blur: null, w: 1440, h: 1080, poster: false, ...over,
});

type Body = { urls: string[] };
let fetchMock: ReturnType<typeof vi.fn>;
const posted = (): string[][] => fetchMock.mock.calls.map(([, init]) => (JSON.parse((init as RequestInit).body as string) as Body).urls);

/** Answer every POST with an item for each URL. */
function answerAll() {
    fetchMock.mockImplementation(async (_input: RequestInfo, init?: RequestInit) => {
        const { urls } = JSON.parse(init!.body as string) as Body;
        return new Response(JSON.stringify({ items: Object.fromEntries(urls.map(u => [u, item()])) }), { status: 200 });
    });
}

async function flush() {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    resetMediaMetaForTests();
    vi.mocked(clientLog).mockClear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    answerAll();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('mediaMeta', () => {
    it('batches three hooks of one tick into one POST', async () => {
        const hooks = [1, 2, 3].map(n => renderHook(() => useMediaMeta(url(n))));
        expect(hooks[0].result.current).toBeUndefined();
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/media/meta');
        expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
        expect(posted()[0]).toEqual([url(1), url(2), url(3)]);
        hooks.forEach(h => expect(h.result.current).toEqual(item()));
    });

    it('splits more than META_BATCH_MAX URLs into several POSTs', async () => {
        primeMediaMeta(Array.from({ length: META_BATCH_MAX + 5 }, (_, i) => url(i)));
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(posted()[0]).toHaveLength(META_BATCH_MAX);
        expect(posted()[1]).toHaveLength(5);
    });

    it('deduplicates queued, in-flight and known URLs', async () => {
        let release!: () => void;
        fetchMock.mockImplementationOnce((_i: RequestInfo, init?: RequestInit) => new Promise((resolve) => {
            release = () => {
                const { urls } = JSON.parse(init!.body as string) as Body;
                resolve(new Response(JSON.stringify({ items: Object.fromEntries(urls.map(u => [u, item()])) })));
            };
        }));
        primeMediaMeta([url(1), url(1), url(2), null, undefined]);
        await flush();
        primeMediaMeta([url(1), url(2)]); // in flight
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(posted()[0]).toEqual([url(1), url(2)]);
        await act(async () => { release(); await vi.advanceTimersByTimeAsync(1); });
        primeMediaMeta([url(1)]); // known
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(readMediaMeta(url(1))).toEqual(item());
    });

    it('evicts the least recently used entries past the cap', async () => {
        setMetaCacheMaxForTests(3);
        primeMediaMeta([url(1), url(2), url(3)]);
        await flush();
        primeMediaMeta([url(4)]);
        await flush();
        expect(readMediaMeta(url(1))).toBeUndefined();
        expect(readMediaMeta(url(4))).toEqual(item());
        expect(readMediaMeta(url(2))).toEqual(item());
    });

    it('never evicts an entry a mounted tile is reading', async () => {
        setMetaCacheMaxForTests(1);
        const held = renderHook(() => useMediaMeta(url(1)));
        await flush();
        primeMediaMeta([url(2)]);
        await flush();
        expect(held.result.current).toEqual(item());
        expect(readMediaMeta(url(1))).toEqual(item());
    });

    it('marks a failed batch null for the session and logs once a minute', async () => {
        fetchMock.mockResolvedValue(new Response('no', { status: 500 }));
        const h = renderHook(() => useMediaMeta(url(1)));
        await flush();
        expect(h.result.current).toBeNull();
        primeMediaMeta([url(2)]);
        await flush();
        expect(clientLog).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('media_grid', { reason: 'meta_failed', count: 1 });
        await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
        primeMediaMeta([url(3)]);
        await flush();
        expect(clientLog).toHaveBeenCalledTimes(2);
        // The session keeps the null: no refetch.
        primeMediaMeta([url(1)]);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('treats a network error or a malformed body as a failure', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('offline'));
        primeMediaMeta([url(1)]);
        await flush();
        expect(readMediaMeta(url(1))).toBeNull();
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ nope: 1 })));
        primeMediaMeta([url(2)]);
        await flush();
        expect(readMediaMeta(url(2))).toBeNull();
    });

    it('keeps null items and drops malformed ones to null', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: { [url(1)]: null, [url(2)]: { kind: 'x' } } })));
        primeMediaMeta([url(1), url(2), url(3)]);
        await flush();
        expect(readMediaMeta(url(1))).toBeNull();
        expect(readMediaMeta(url(2))).toBeNull();
        expect(readMediaMeta(url(3))).toBeNull(); // absent from the answer
    });

    it('resolves non-media URLs to null without a request', async () => {
        const h = renderHook(() => useMediaMeta('/api/blogs/image?x=1'));
        expect(h.result.current).toBeNull();
        const none = renderHook(() => useMediaMeta(null));
        expect(none.result.current).toBeNull();
        primeMediaMeta(['https://cdn.example/a.jpg']);
        await flush();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refetches an invalidated entry on the next read', async () => {
        const h = renderHook(() => useMediaMeta(url(1)));
        await flush();
        expect(h.result.current).toEqual(item());
        fetchMock.mockImplementation(async () => new Response(JSON.stringify({ items: { [url(1)]: item({ poster: true }) } })));
        act(() => invalidateMediaMeta(url(1)));
        expect(h.result.current).toBeUndefined();
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(h.result.current).toEqual(item({ poster: true }));
    });

    it('encodes CJK and emoji paths unchanged in the batch', async () => {
        const cjk = `/api/content/media/hinatazaka46/${encodeURIComponent('62 石森 璃花')}/${encodeURIComponent('🌸.jpg')}`;
        primeMediaMeta([cjk]);
        await flush();
        expect(posted()[0]).toEqual([cjk]);
        expect(readMediaMeta(cjk)).toEqual(item());
    });
});
