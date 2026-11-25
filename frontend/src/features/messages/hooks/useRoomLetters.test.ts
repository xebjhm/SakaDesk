import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import { useRoomLetters } from './useRoomLetters';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';

const L = { id: 1, text: '🌸', created_at: '2025-01-01T00:00:00Z', image_url: null, width: null, height: null };
const PROFILE = { name: 'ゆき', avatars: [] };

beforeEach(() => vi.mocked(clientLog).mockClear());

describe('useRoomLetters', () => {
    it('a group chat has no letters and is ready at once, without a letters request', async () => {
        let asked = false;
        server.use(
            http.get('/api/chat/letters_local', () => { asked = true; return HttpResponse.json({ letters: [L] }); }),
            http.get('/api/account/profile', () => HttpResponse.json(PROFILE)),
        );
        const { result } = renderHook(() => useRoomLetters('hinatazaka46', 'group/a', true, 0));
        expect(result.current.ready).toBe(true);
        expect(result.current.letters).toEqual([]);
        expect(clientLog).toHaveBeenCalledWith('letters_load', { outcome: 'skipped_group' });
        await waitFor(() => expect(result.current.profile).toEqual(PROFILE));
        expect(asked).toBe(false);
    });

    it('loads a 1:1 room, then is ready; a revisit is ready at once from the cache', async () => {
        server.use(
            http.get('/api/chat/letters_local', () => HttpResponse.json({ letters: [L] })),
            http.get('/api/account/profile', () => HttpResponse.json(PROFILE)),
        );
        const first = renderHook(() => useRoomLetters('hinatazaka46', 'room/b', false, 0));
        expect(first.result.current.ready).toBe(false);
        await waitFor(() => expect(first.result.current.ready).toBe(true));
        expect(first.result.current.letters).toEqual([L]);
        expect(clientLog).toHaveBeenCalledWith('letters_load', { outcome: 'ok', count: 1 });
        first.unmount();
        const again = renderHook(() => useRoomLetters('hinatazaka46', 'room/b', false, 0));
        expect(again.result.current.ready).toBe(true);
        expect(again.result.current.letters).toEqual([L]);
    });

    it('a refetch with the same letters keeps the same array; changed letters replace it', async () => {
        let letters = [L];
        let calls = 0;
        server.use(
            http.get('/api/chat/letters_local', () => { calls += 1; return HttpResponse.json({ letters }); }),
            http.get('/api/account/profile', () => HttpResponse.json(PROFILE)),
        );
        const { result, rerender } = renderHook(({ key }) => useRoomLetters('hinatazaka46', 'room/same', false, key), { initialProps: { key: 0 } });
        await waitFor(() => expect(result.current.ready).toBe(true));
        const held = result.current.letters;

        rerender({ key: 1 });
        await waitFor(() => expect(calls).toBe(2));
        await new Promise((r) => setTimeout(r, 30));
        expect(result.current.letters).toBe(held);

        letters = [L, { ...L, id: 2 }];
        rerender({ key: 2 });
        await waitFor(() => expect(result.current.letters).toHaveLength(2));
        expect(result.current.letters).not.toBe(held);
    });

    it('I1: switching to a room with cached letters is ready from its very first render', async () => {
        server.use(
            http.get('/api/chat/letters_local', () => HttpResponse.json({ letters: [L] })),
            http.get('/api/account/profile', () => HttpResponse.json(PROFILE)),
        );
        const warm = renderHook(() => useRoomLetters('hinatazaka46', 'room/i1-cached', false, 0));
        await waitFor(() => expect(warm.result.current.ready).toBe(true));
        warm.unmount();
        const seen: Array<{ path: string; ready: boolean; count: number }> = [];
        const { rerender } = renderHook(({ path }) => {
            const r = useRoomLetters('hinatazaka46', path, false, 0);
            seen.push({ path, ready: r.ready, count: r.letters.length });
            return r;
        }, { initialProps: { path: 'room/i1-other' } });
        rerender({ path: 'room/i1-cached' });
        const cachedRenders = seen.filter((s) => s.path === 'room/i1-cached');
        expect(cachedRenders.length).toBeGreaterThan(0);
        expect(cachedRenders.every((s) => s.ready && s.count === 1)).toBe(true);
    });

    it('a failed request logs and leaves the room ready without letters', async () => {
        server.use(
            http.get('/api/chat/letters_local', () => HttpResponse.json({}, { status: 500 })),
            http.get('/api/account/profile', () => HttpResponse.json({}, { status: 500 })),
        );
        const { result } = renderHook(() => useRoomLetters('hinatazaka46', 'room/c', false, 0));
        await waitFor(() => expect(result.current.ready).toBe(true));
        expect(result.current.letters).toEqual([]);
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('account_profile_load', { outcome: 'error' }));
        expect(clientLog).toHaveBeenCalledWith('letters_load', { outcome: 'error' });
        expect(result.current.profile).toBeNull();
    });

    it('never holds the messages back: a hanging request times out to no letters', async () => {
        server.use(
            http.get('/api/chat/letters_local', async () => { await delay('infinite'); return HttpResponse.json({ letters: [] }); }),
            http.get('/api/account/profile', () => HttpResponse.json(PROFILE)),
        );
        const { result } = renderHook(() => useRoomLetters('hinatazaka46', 'room/d', false, 0, 20));
        expect(result.current.ready).toBe(false);
        await waitFor(() => expect(result.current.ready).toBe(true));
        expect(result.current.letters).toEqual([]);
        expect(clientLog).toHaveBeenCalledWith('letters_load', { outcome: 'timeout' });
    });

    it('a failed request without a cached list marks the room unavailable', async () => {
        server.use(
            http.get('/api/chat/letters_local', () => HttpResponse.json({}, { status: 500 })),
            http.get('/api/account/profile', () => HttpResponse.json(PROFILE)),
        );
        const { result } = renderHook(() => useRoomLetters('hinatazaka46', 'room/unavail', false, 0));
        expect(result.current.unavailable).toBe(false);
        await waitFor(() => expect(result.current.ready).toBe(true));
        expect(result.current.unavailable).toBe(true);
    });

    it('a late answer after the timeout is cached for the next visit, never applied to the open room', async () => {
        const L2 = { ...L, id: 2 };
        server.use(
            http.get('/api/chat/letters_local', async () => { await delay(60); return HttpResponse.json({ letters: [L2] }); }),
            http.get('/api/account/profile', () => HttpResponse.json(PROFILE)),
        );
        const first = renderHook(() => useRoomLetters('hinatazaka46', 'room/late', false, 0, 10));
        await waitFor(() => expect(first.result.current.ready).toBe(true));
        expect(first.result.current.unavailable).toBe(true);
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('letters_load', { outcome: 'late', count: 1 }));
        expect(first.result.current.letters).toEqual([]);
        expect(clientLog).not.toHaveBeenCalledWith('letters_load', { outcome: 'ok', count: 1 });
        first.unmount();
        const again = renderHook(() => useRoomLetters('hinatazaka46', 'room/late', false, 0, 10));
        expect(again.result.current.ready).toBe(true);
        expect(again.result.current.letters).toEqual([L2]);
        expect(again.result.current.unavailable).toBe(false);
    });

    it('ignores a late answer for the previous room', async () => {
        const L3 = { ...L, id: 3 };
        server.use(
            http.get('/api/chat/letters_local', async ({ request }) => {
                const path = new URL(request.url).searchParams.get('path');
                if (path === 'room/old') { await delay(50); return HttpResponse.json({ letters: [L3] }); }
                return HttpResponse.json({ letters: [] });
            }),
            http.get('/api/account/profile', () => HttpResponse.json(PROFILE)),
        );
        const { result, rerender } = renderHook(({ path }) => useRoomLetters('hinatazaka46', path, false, 0), { initialProps: { path: 'room/old' } });
        rerender({ path: 'room/new' });
        await waitFor(() => expect(result.current.ready).toBe(true));
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(result.current.letters).toEqual([]);
    });

    it('a new refreshKey refetches and applies the new list', async () => {
        let calls = 0;
        server.use(
            http.get('/api/chat/letters_local', () => {
                calls += 1;
                return HttpResponse.json({ letters: calls === 1 ? [] : [L] });
            }),
            http.get('/api/account/profile', () => HttpResponse.json(PROFILE)),
        );
        const { result, rerender } = renderHook(({ key }) => useRoomLetters('hinatazaka46', 'room/refresh', false, key), { initialProps: { key: 0 } });
        await waitFor(() => expect(result.current.ready).toBe(true));
        expect(result.current.letters).toEqual([]);
        rerender({ key: 1 });
        expect(result.current.ready).toBe(true);
        await waitFor(() => expect(result.current.letters).toEqual([L]));
        expect(calls).toBe(2);
    });

    it('logs a timeout only when it un-gates the room, not on a refetch of a ready room', async () => {
        let calls = 0;
        server.use(
            http.get('/api/chat/letters_local', async () => {
                calls += 1;
                if (calls === 1) return HttpResponse.json({}, { status: 500 });
                await delay('infinite');
                return HttpResponse.json({ letters: [] });
            }),
            http.get('/api/account/profile', () => HttpResponse.json(PROFILE)),
        );
        const { result, rerender } = renderHook(({ key }) => useRoomLetters('hinatazaka46', 'room/refetch-hang', false, key, 10), { initialProps: { key: 0 } });
        await waitFor(() => expect(result.current.ready).toBe(true));
        rerender({ key: 1 });
        await waitFor(() => expect(calls).toBe(2));
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(result.current.ready).toBe(true);
        expect(clientLog).not.toHaveBeenCalledWith('letters_load', { outcome: 'timeout' });
    });
});
