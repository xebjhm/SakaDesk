import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from './clientLog';
import { pollJson, POLL_TIMEOUT_MS } from './pollJson';

type FetchInit = RequestInit & { signal: AbortSignal };

/** A fetch that never answers on its own, but rejects with AbortError when aborted. */
function hangingFetch() {
    return vi.fn((_url: string, init: FetchInit) => new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(clientLog).mockClear();
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('pollJson', () => {
    it('fetches with cache: no-store and returns the parsed body', async () => {
        const fetchMock = vi.fn().mockResolvedValue(json({ state: 'idle' }));
        vi.stubGlobal('fetch', fetchMock);
        const result = await pollJson('t_ok', '/api/x', { init: { method: 'POST' } });
        expect(result).toEqual({ status: 'ok', data: { state: 'idle' } });
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store', method: 'POST' });
        expect(clientLog).not.toHaveBeenCalled();
    });

    it('skips (does not queue) while the same key is pending and reports the count once', async () => {
        let resolveFirst!: (r: Response) => void;
        const fetchMock = vi.fn(() => new Promise<Response>(r => { resolveFirst = r; }));
        vi.stubGlobal('fetch', fetchMock);
        const first = pollJson('t_skip', '/api/x');
        expect(await pollJson('t_skip', '/api/x')).toEqual({ status: 'skipped' });
        expect(await pollJson('t_skip', '/api/x')).toEqual({ status: 'skipped' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(clientLog).not.toHaveBeenCalled();
        resolveFirst(json({}));
        await first;
        expect(clientLog).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('poll_skipped', { key: 't_skip', count: 2 });
        // Next poll starts normally.
        fetchMock.mockResolvedValueOnce(json({}) as never);
        expect((await pollJson('t_skip', '/api/x')).status).toBe('ok');
    });

    it('different keys do not block each other', async () => {
        vi.stubGlobal('fetch', hangingFetch());
        const a = pollJson('t_a', '/api/x');
        const b = pollJson('t_b', '/api/x');
        await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS);
        expect([(await a).status, (await b).status]).toEqual(['timeout', 'timeout']);
    });

    it('aborts after the timeout and logs poll_timeout with key and timeout_ms', async () => {
        const fetchMock = hangingFetch();
        vi.stubGlobal('fetch', fetchMock);
        const p = pollJson('sync:Progress-1', '/api/x');
        await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS - 1);
        expect(clientLog).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(await p).toEqual({ status: 'timeout' });
        expect(clientLog).toHaveBeenCalledWith('poll_timeout', { key: 'sync_progress_1', timeout_ms: POLL_TIMEOUT_MS });
        // Pending cleared: the next poll is not skipped.
        fetchMock.mockResolvedValueOnce(json({}) as never);
        expect((await pollJson('sync:Progress-1', '/api/x')).status).toBe('ok');
    });

    it('a caller abort (unmount) resolves aborted and logs nothing', async () => {
        vi.stubGlobal('fetch', hangingFetch());
        const caller = new AbortController();
        const p = pollJson('t_unmount', '/api/x', { signal: caller.signal });
        caller.abort();
        expect(await p).toEqual({ status: 'aborted' });
        await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS * 2);
        expect(clientLog).not.toHaveBeenCalled();
    });

    it('does not fetch when the signal is already aborted', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const caller = new AbortController();
        caller.abort();
        expect(await pollJson('t_pre', '/api/x', { signal: caller.signal })).toEqual({ status: 'aborted' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports a non-ok response as rejected with poll_failed', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 503)));
        expect(await pollJson('t_503', '/api/x')).toEqual({ status: 'rejected', httpStatus: 503 });
        expect(clientLog).toHaveBeenCalledWith('poll_failed', { key: 't_503', error_code: 503 });
    });

    it('reports a network error as failed with poll_failed and a code-like error_type', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
        const result = await pollJson('t_net', '/api/x');
        expect(result.status).toBe('failed');
        expect(clientLog).toHaveBeenCalledWith('poll_failed', { key: 't_net', error_type: 'typeerror' });
    });

    it('reports an unparseable body as failed', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })));
        expect((await pollJson('t_bad', '/api/x')).status).toBe('failed');
        expect(clientLog).toHaveBeenCalledWith('poll_failed', { key: 't_bad', error_type: 'syntaxerror' });
    });

    it('replace aborts the pending request, resolves the old caller aborted (no log) and starts a new one', async () => {
        const fetchMock = vi.fn()
            .mockImplementationOnce((_u: string, init: FetchInit) => new Promise<Response>((_r, reject) => {
                init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            }))
            .mockResolvedValueOnce(json({ n: 2 }));
        vi.stubGlobal('fetch', fetchMock);
        const first = pollJson('t_replace', '/api/x');
        const second = pollJson('t_replace', '/api/x', { replace: true });
        expect(await first).toEqual({ status: 'aborted' });
        expect(await second).toEqual({ status: 'ok', data: { n: 2 } });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS * 2);
        expect(clientLog).not.toHaveBeenCalled();
    });

    it('a late answer from a replaced request is reported aborted, never ok', async () => {
        let resolveFirst!: (r: Response) => void;
        const fetchMock = vi.fn()
            .mockImplementationOnce(() => new Promise<Response>(r => { resolveFirst = r; })) // ignores abort
            .mockResolvedValueOnce(json({ n: 2 }));
        vi.stubGlobal('fetch', fetchMock);
        const first = pollJson('t_late', '/api/x');
        const second = pollJson('t_late', '/api/x', { replace: true });
        resolveFirst(json({ n: 1 }));
        expect(await first).toEqual({ status: 'aborted' });
        expect(await second).toEqual({ status: 'ok', data: { n: 2 } });
    });

    it('frees the key synchronously when the caller aborts, so a remount starts at once', async () => {
        const fetchMock = hangingFetch();
        vi.stubGlobal('fetch', fetchMock);
        const caller = new AbortController();
        const first = pollJson('t_strict', '/api/x', { signal: caller.signal });
        caller.abort();
        const next = pollJson('t_strict', '/api/x'); // immediately, before first settles
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(clientLog).not.toHaveBeenCalled(); // no poll_skipped
        expect(await first).toEqual({ status: 'aborted' });
        await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS);
        expect((await next).status).toBe('timeout');
    });
});
