import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPreload } from './fetchPreload';

const response = (status: number, type: string | null) =>
    ({ ok: status >= 200 && status < 300, status, headers: new Headers(type ? { 'content-type': type } : {}) }) as Response;

describe('fetchPreload', () => {
    afterEach(() => vi.useRealTimers());

    it('resolves when the voice is served as audio, asking for one byte', async () => {
        const fetchFn = vi.fn().mockResolvedValue(response(206, 'audio/mp4'));
        await expect(fetchPreload('/api/content/media/x/v.m4a', undefined, 1000, fetchFn)).resolves.toBeUndefined();
        expect(fetchFn).toHaveBeenCalledWith('/api/content/media/x/v.m4a', expect.objectContaining({
            headers: { Range: 'bytes=0-0' },
        }));
    });

    it.each([
        ['a 404', response(404, 'application/json')],
        ['a non-audio type', response(200, 'text/html')],
        ['no content type', response(200, null)],
    ])('rejects media_unavailable on %s', async (_label, res) => {
        const fetchFn = vi.fn().mockResolvedValue(res);
        await expect(fetchPreload('/u', undefined, 1000, fetchFn)).rejects.toThrow('media_unavailable');
    });

    it('rejects media_unavailable on a network error', async () => {
        const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(fetchPreload('/u', undefined, 1000, fetchFn)).rejects.toThrow('media_unavailable');
    });

    it('rejects media_unavailable after the timeout and aborts the request', async () => {
        vi.useFakeTimers();
        let seen: AbortSignal | undefined;
        const fetchFn = vi.fn((_u: string, init?: RequestInit) => {
            seen = init?.signal ?? undefined;
            return new Promise<Response>(() => {});
        });
        const p = fetchPreload('/u', undefined, 500, fetchFn as unknown as typeof fetch);
        vi.advanceTimersByTime(500);
        await expect(p).rejects.toThrow('media_unavailable');
        expect(seen?.aborted).toBe(true);
    });

    it('rejects aborted when the caller aborts, before or during the request', async () => {
        const pre = new AbortController();
        pre.abort();
        const fetchFn = vi.fn();
        await expect(fetchPreload('/u', pre.signal, 1000, fetchFn)).rejects.toThrow('aborted');
        expect(fetchFn).not.toHaveBeenCalled();

        const during = new AbortController();
        const pending = fetchPreload('/u', during.signal, 1000, vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch);
        during.abort();
        await expect(pending).rejects.toThrow('aborted');
    });
});
