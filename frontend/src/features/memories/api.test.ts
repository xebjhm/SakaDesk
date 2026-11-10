import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import * as api from './api';
import { MEMBER_PATH } from './__fixtures__/memories';

const S = 'hinatazaka46';
const signal = () => new AbortController().signal;

/** Answer every GET under the service and record the path + query it saw. */
function record(): { seen: URL[] } {
    const out = { seen: [] as URL[] };
    server.use(http.get(`/api/memories/${S}/*`, ({ request }) => {
        out.seen.push(new URL(request.url));
        return HttpResponse.json({ ok: true });
    }));
    return out;
}

describe('memories api', () => {
    it.each([
        ['fetchHub', () => api.fetchHub(S, signal()), '/hub', {}],
        ['fetchOnThisDay', () => api.fetchOnThisDay(S, '09-14', signal()), '/on-this-day', { date: '09-14' }],
        ['fetchDay', () => api.fetchDay(S, { date: '2024-09-14', member: MEMBER_PATH, others: true }, signal()), '/day', { date: '2024-09-14', member: MEMBER_PATH, others: 'true' }],
        ['fetchDay (plain)', () => api.fetchDay(S, { date: '2024-09-14' }, signal()), '/day', { date: '2024-09-14' }],
        ['fetchAlbumMembers', () => api.fetchAlbumMembers(S, signal()), '/album/members', {}],
        ['fetchAlbumMonths', () => api.fetchAlbumMonths(S, { member: MEMBER_PATH, kind: 'favorite' }, signal()), '/album/months', { member: MEMBER_PATH, kind: 'favorite' }],
        ['fetchAlbumMonths (all)', () => api.fetchAlbumMonths(S, { kind: 'all' }, signal()), '/album/months', { kind: 'all' }],
        ['fetchAlbumMonth', () => api.fetchAlbumMonth(S, '2024-09', { kind: 'video' }, signal()), '/album/month/2024-09', { kind: 'video' }],
        ['fetchAlbumColors', () => api.fetchAlbumColors(S, MEMBER_PATH, signal()), '/album/colors', { member: MEMBER_PATH }],
        ['fetchFavorites', () => api.fetchFavorites(S, undefined, signal()), '/favorites', {}],
        ['fetchMemoirMembers', () => api.fetchMemoirMembers(S, signal()), '/memoir/members', {}],
        ['fetchMemoirHeader', () => api.fetchMemoirHeader(S, MEMBER_PATH, signal()), '/memoir', { member: MEMBER_PATH }],
        ['fetchMemoirCards', () => api.fetchMemoirCards(S, MEMBER_PATH, signal()), '/memoir/cards', { member: MEMBER_PATH }],
        ['fetchNameMoments', () => api.fetchNameMoments(S, MEMBER_PATH, 2024, signal()), '/memoir/names', { member: MEMBER_PATH, year: '2024' }],
        ['fetchNameMoments (all years)', () => api.fetchNameMoments(S, MEMBER_PATH, undefined, signal()), '/memoir/names', { member: MEMBER_PATH }],
        ['fetchTimelineMonths', () => api.fetchTimelineMonths(S, MEMBER_PATH, signal()), '/memoir/timeline', { member: MEMBER_PATH }],
        ['fetchTimelineMonth', () => api.fetchTimelineMonth(S, MEMBER_PATH, '2024-09', signal()), '/memoir/timeline/2024-09', { member: MEMBER_PATH }],
    ] as const)('%s calls its endpoint', async (_name, call, path, query) => {
        const rec = record();
        await expect(call()).resolves.toEqual({ ok: true });
        expect(rec.seen).toHaveLength(1);
        const url = rec.seen[0];
        expect(url.pathname).toBe(`/api/memories/${S}${path}`);
        expect(Object.fromEntries(url.searchParams)).toEqual(query);
    });

    it('percent-encodes query values (spaces, CJK, &, #)', async () => {
        let raw = '';
        server.use(http.get(`/api/memories/${S}/memoir`, ({ request }) => {
            raw = request.url;
            return HttpResponse.json({});
        }));
        await api.fetchMemoirHeader(S, 'a b&c#d/金村', signal());
        expect(raw).toContain(`member=${encodeURIComponent('a b&c#d/金村')}`);
    });

    it('throws a MemoriesFetchError with the HTTP status on a rejected request', async () => {
        server.use(http.get(`/api/memories/${S}/hub`, () => HttpResponse.json({ detail: 'x' }, { status: 404 })));
        const err = await api.fetchHub(S, signal()).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(api.MemoriesFetchError);
        expect((err as api.MemoriesFetchError).httpStatus).toBe(404);
    });

    it('passes the caller signal so an unmount aborts the request', async () => {
        server.use(http.get(`/api/memories/${S}/hub`, async () => {
            await new Promise((r) => setTimeout(r, 50));
            return HttpResponse.json({});
        }));
        const controller = new AbortController();
        const pending = api.fetchHub(S, controller.signal);
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });
});

describe('memories api timeout', () => {
    it(`gives up after ${api.MEMORIES_TIMEOUT_MS} ms with a MemoriesTimeoutError`, async () => {
        vi.useFakeTimers();
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }));
        try {
            const pending = api.fetchHub(S, new AbortController().signal).catch((e: unknown) => e);
            await vi.advanceTimersByTimeAsync(api.MEMORIES_TIMEOUT_MS - 1);
            expect(fetchSpy.mock.calls[0][1]?.signal?.aborted).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            expect(await pending).toBeInstanceOf(api.MemoriesTimeoutError);
        } finally {
            fetchSpy.mockRestore();
            vi.useRealTimers();
        }
    });

    it('a caller abort is an AbortError, not a timeout', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }));
        try {
            const controller = new AbortController();
            const pending = api.fetchHub(S, controller.signal).catch((e: unknown) => e);
            controller.abort();
            const err = await pending;
            expect(err).not.toBeInstanceOf(api.MemoriesTimeoutError);
            expect((err as Error).name).toBe('AbortError');
        } finally {
            fetchSpy.mockRestore();
        }
    });
});
