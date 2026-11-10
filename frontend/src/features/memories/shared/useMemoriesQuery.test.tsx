import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';
import { useMemoriesQuery } from './useMemoriesQuery';
import { MEMORIES_TIMEOUT_MS, MemoriesFetchError, fetchHub } from '../api';

beforeEach(() => { vi.mocked(clientLog).mockClear(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('useMemoriesQuery', () => {
    it('loads, then logs ok with the top-level list length', async () => {
        const load = vi.fn(async () => ({ total: 3, members: [{}, {}, {}] }));
        const { result } = renderHook(() => useMemoriesQuery('album', load, []));
        expect(result.current.status).toBe('loading');
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.data?.members).toHaveLength(3);
        expect(clientLog).toHaveBeenCalledWith('memories_load', { target: 'album', outcome: 'ok', count: 3 });
    });

    it('logs no count when the payload has no top-level list', async () => {
        const { result } = renderHook(() => useMemoriesQuery('memoir', async () => ({ name: 'x', chips: {} }), []));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(clientLog).toHaveBeenCalledWith('memories_load', { target: 'memoir', outcome: 'ok' });
    });

    it('logs error with the HTTP status and retries', async () => {
        let fail = true;
        const load = vi.fn(async () => {
            if (fail) throw new MemoriesFetchError(404);
            return { items: [] as number[] };
        });
        const { result } = renderHook(() => useMemoriesQuery('favorites', load, []));
        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(result.current.data).toBeNull();
        expect(clientLog).toHaveBeenCalledWith('memories_load', { target: 'favorites', outcome: 'error', error_code: 404 });
        fail = false;
        act(() => result.current.retry());
        expect(result.current.status).toBe('loading');
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(clientLog).toHaveBeenLastCalledWith('memories_load', { target: 'favorites', outcome: 'ok', count: 0 });
    });

    it('aborts on unmount and logs nothing for the aborted load', async () => {
        let seen: AbortSignal | null = null;
        const load = vi.fn((signal: AbortSignal) => {
            seen = signal;
            return new Promise<never>((_, reject) => {
                signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            });
        });
        const { unmount } = renderHook(() => useMemoriesQuery('hub', load, []));
        expect(seen).not.toBeNull();
        unmount();
        expect(seen!.aborted).toBe(true);
        await Promise.resolve();
        expect(clientLog).not.toHaveBeenCalled();
    });

    it('aborts the old load when the deps change and keeps only the newest result', async () => {
        const signals: AbortSignal[] = [];
        const resolvers: Array<(v: { n: number }) => void> = [];
        const load = (signal: AbortSignal) => {
            signals.push(signal);
            return new Promise<{ n: number }>((resolve) => { resolvers.push(resolve); });
        };
        const { result, rerender } = renderHook(({ dep }) => useMemoriesQuery('timeline', load, [dep]), { initialProps: { dep: 1 } });
        rerender({ dep: 2 });
        expect(signals[0].aborted).toBe(true);
        expect(signals[1].aborted).toBe(false);
        expect(result.current.status).toBe('loading');
        await act(async () => { resolvers[0]({ n: 1 }); resolvers[1]({ n: 2 }); });
        expect(result.current.data).toEqual({ n: 2 });
        expect(vi.mocked(clientLog).mock.calls).toHaveLength(1);
    });

    it('a request that never answers times out into error, logs timeout and can retry', async () => {
        vi.useFakeTimers();
        let answer = false;
        vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((resolve, reject) => {
            if (answer) { resolve(new Response(JSON.stringify({ months: [1, 2] }), { status: 200 })); return; }
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }));
        const { result } = renderHook(() => useMemoriesQuery('hub', (signal) => fetchHub('hinatazaka46', signal), []));
        expect(result.current.status).toBe('loading');
        await act(async () => { await vi.advanceTimersByTimeAsync(MEMORIES_TIMEOUT_MS); });
        expect(result.current.status).toBe('error');
        expect(clientLog).toHaveBeenCalledWith('memories_load', { target: 'hub', outcome: 'timeout' });
        answer = true;
        await act(async () => { result.current.retry(); await vi.advanceTimersByTimeAsync(0); });
        expect(result.current.status).toBe('ready');
    });

    it('counts with the caller selector when given', async () => {
        const load = async () => ({ total: 9, members: [{}], items: [{}, {}, {}] });
        const { result } = renderHook(() => useMemoriesQuery('favorites', load, [], { count: (d) => d.items.length }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(clientLog).toHaveBeenCalledWith('memories_load', { target: 'favorites', outcome: 'ok', count: 3 });
    });

    it('never shows the data of the previous deps as ready after a change', async () => {
        const seen: string[] = [];
        const load = async (_signal: AbortSignal, n: number) => ({ n });
        const { result, rerender } = renderHook(({ dep }) => {
            const q = useMemoriesQuery('timeline', (signal) => load(signal, dep), [dep]);
            seen.push(`${dep}:${q.status}:${q.data?.n ?? '-'}`);
            return q;
        }, { initialProps: { dep: 1 } });
        await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
        seen.length = 0;
        rerender({ dep: 2 });
        expect(seen[0]).toBe('2:loading:-');
        await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
        expect(seen.filter((s) => s.startsWith('2:ready:1'))).toEqual([]);
    });

    it('under StrictMode aborts the first mount and logs one load', async () => {
        const signals: AbortSignal[] = [];
        const load = async (signal: AbortSignal) => { signals.push(signal); return { items: [1] }; };
        const { result } = renderHook(() => useMemoriesQuery('album', load, []), { wrapper: React.StrictMode });
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(signals).toHaveLength(2);
        expect(signals[0].aborted).toBe(true);
        expect(vi.mocked(clientLog).mock.calls.filter((c) => c[0] === 'memories_load')).toHaveLength(1);
    });

    it('a disabled query never loads or logs, and reads as ready with no data', async () => {
        const load = vi.fn(async () => ({ items: [1] }));
        const { result, rerender } = renderHook(({ on }) => useMemoriesQuery('then_now', load, [on], { enabled: on }), {
            initialProps: { on: false },
        });
        expect(result.current).toMatchObject({ status: 'ready', data: null });
        await act(async () => {});
        expect(load).not.toHaveBeenCalled();
        expect(clientLog).not.toHaveBeenCalled();
        rerender({ on: true });
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.data).toEqual({ items: [1] });
        expect(clientLog).toHaveBeenCalledWith('memories_load', { target: 'then_now', outcome: 'ok', count: 1 });
    });
});
