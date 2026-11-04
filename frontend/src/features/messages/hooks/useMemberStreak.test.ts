import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import { useMemberStreak, resetStreakCache, streakCacheKey, streakGroupId } from './useMemberStreak';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';

/** Serves /api/chat/streak/:id (days = id * 2) and counts the requests. */
function serveStreak(opts: { fail?: () => boolean; wait?: number } = {}) {
    const calls = { count: 0 };
    server.use(http.get('/api/chat/streak/:id', async ({ params }) => {
        calls.count += 1;
        if (opts.wait) await delay(opts.wait);
        if (opts.fail?.()) return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
        return HttpResponse.json({ days: Number(params.id) * 2, is_active: true });
    }));
    return calls;
}

beforeEach(() => {
    resetStreakCache();
    vi.mocked(clientLog).mockClear();
});

describe('useMemberStreak', () => {
    it('is idle without a group id and makes no request', () => {
        const calls = serveStreak();
        const { result } = renderHook(() => useMemberStreak(undefined, 'hinatazaka46'));
        expect(result.current.streak).toEqual({ status: 'idle' });
        expect(calls.count).toBe(0);
    });

    it('keys the cache by service, group and local day', () => {
        expect(streakCacheKey('hinatazaka46', '64', new Date(2026, 10, 4, 23, 59))).toBe('hinatazaka46|64|2026-11-04');
        expect(streakCacheKey('hinatazaka46', '64', new Date(2026, 10, 5, 0, 1))).toBe('hinatazaka46|64|2026-11-05');
    });

    it('reads the member group id from a member room path, never from a group chat', () => {
        expect(streakGroupId('hinatazaka46/messages/90 高井 俐香/142 高井 俐香', false)).toBe('90');
        expect(streakGroupId('hinatazaka46/messages/43 日向坂46/43 日向坂46', true)).toBeUndefined();
        expect(streakGroupId('hinatazaka46/messages/abc/1 x', false)).toBeUndefined();
        expect(streakGroupId('hinatazaka46', false)).toBeUndefined();
        expect(streakGroupId(null, false)).toBeUndefined();
    });

    it('makes no request for a group chat room', async () => {
        const calls = serveStreak();
        const { result } = renderHook(() => useMemberStreak(
            streakGroupId('hinatazaka46/messages/43 日向坂46/43 日向坂46', true), 'hinatazaka46'));
        expect(result.current.streak).toEqual({ status: 'idle' });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(calls.count).toBe(0);
    });

    it('makes no request for an id that is not a member group id', async () => {
        const calls = serveStreak();
        const { result } = renderHook(() => useMemberStreak('abc', 'hinatazaka46'));
        expect(result.current.streak).toEqual({ status: 'idle' });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(calls.count).toBe(0);
    });

    it('fetches once for a member room', async () => {
        const calls = serveStreak();
        const { result } = renderHook(() => useMemberStreak(
            streakGroupId('hinatazaka46/messages/90 高井 俐香/142 高井 俐香', false), 'hinatazaka46'));
        await waitFor(() => expect(result.current.streak).toEqual({ status: 'ready', days: 180 }));
        expect(calls.count).toBe(1);
    });

    it('fetches once across repeated opens of the same room on the same day', async () => {
        const calls = serveStreak();
        const first = renderHook(() => useMemberStreak('64', 'hinatazaka46'));
        await waitFor(() => expect(first.result.current.streak).toEqual({ status: 'ready', days: 128 }));
        first.unmount();
        // Another room in between, then back: the cached value is used at once.
        const other = renderHook(({ id }) => useMemberStreak(id, 'hinatazaka46'), { initialProps: { id: '5' } });
        await waitFor(() => expect(other.result.current.streak).toEqual({ status: 'ready', days: 10 }));
        other.rerender({ id: '64' });
        expect(other.result.current.streak).toEqual({ status: 'ready', days: 128 });
        const again = renderHook(() => useMemberStreak('64', 'hinatazaka46'));
        expect(again.result.current.streak).toEqual({ status: 'ready', days: 128 });
        expect(calls.count).toBe(2); // room 64 once, room 5 once
    });

    it('fetches again once the local date has changed', async () => {
        const calls = serveStreak();
        let now = new Date(2026, 10, 4, 23, 50);
        const first = renderHook(() => useMemberStreak('64', 'hinatazaka46', () => now));
        await waitFor(() => expect(first.result.current.streak.status).toBe('ready'));
        first.unmount();
        now = new Date(2026, 10, 5, 0, 10);
        const next = renderHook(() => useMemberStreak('64', 'hinatazaka46', () => now));
        await waitFor(() => expect(next.result.current.streak.status).toBe('ready'));
        expect(calls.count).toBe(2);
    });

    it('shares one in-flight request between concurrent users of the same room', async () => {
        const calls = serveStreak({ wait: 30 });
        const header = renderHook(() => useMemberStreak('64', 'hinatazaka46'));
        const popup = renderHook(() => useMemberStreak('64', 'hinatazaka46'));
        await waitFor(() => expect(header.result.current.streak).toEqual({ status: 'ready', days: 128 }));
        await waitFor(() => expect(popup.result.current.streak).toEqual({ status: 'ready', days: 128 }));
        expect(calls.count).toBe(1);
        expect(vi.mocked(clientLog).mock.calls.filter(([event]) => event === 'streak_load')).toEqual([
            ['streak_load', { outcome: 'ok' }],
        ]);
    });

    it('does not cache a failure: it logs, and the next open (or retry) fetches again', async () => {
        let fail = true;
        const calls = serveStreak({ fail: () => fail });
        const first = renderHook(() => useMemberStreak('64', 'hinatazaka46'));
        await waitFor(() => expect(first.result.current.streak).toEqual({ status: 'error', message: 'Not authenticated' }));
        expect(clientLog).toHaveBeenCalledWith('streak_load', { outcome: 'error' });
        first.unmount();
        fail = false;
        const again = renderHook(() => useMemberStreak('64', 'hinatazaka46'));
        await waitFor(() => expect(again.result.current.streak).toEqual({ status: 'ready', days: 128 }));
        expect(calls.count).toBe(2);
        fail = true;
        resetStreakCache();
        act(() => again.result.current.retry());
        await waitFor(() => expect(again.result.current.streak.status).toBe('error'));
        fail = false;
        act(() => again.result.current.retry());
        await waitFor(() => expect(again.result.current.streak).toEqual({ status: 'ready', days: 128 }));
    });

    it('ignores a late answer for the previous room', async () => {
        server.use(http.get('/api/chat/streak/:id', async ({ params }) => {
            if (params.id === '1') await delay(50);
            return HttpResponse.json({ days: Number(params.id), is_active: true });
        }));
        const { result, rerender } = renderHook(({ id }) => useMemberStreak(id, 'hinatazaka46'), { initialProps: { id: '1' } });
        rerender({ id: '2' });
        await waitFor(() => expect(result.current.streak).toEqual({ status: 'ready', days: 2 }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(result.current.streak).toEqual({ status: 'ready', days: 2 });
    });
});
