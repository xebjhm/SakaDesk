import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';
import { REFRESH_WHILE_MAX, REFRESH_WHILE_MS, useMemoriesQuery } from './useMemoriesQuery';
import { MEMORIES_TIMEOUT_MS, MemoriesFetchError, MemoriesTimeoutError, fetchHub } from '../api';

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
        expect(result.current.failure).toBe('timeout');
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

    describe('refreshWhile', () => {
        it('reloads quietly while the flag holds, keeps data on a failed reload, and stops when final', async () => {
            vi.useFakeTimers();
            const load = vi.fn()
                .mockResolvedValueOnce({ n: 1, refreshing: true })
                .mockRejectedValueOnce(new MemoriesFetchError(500))
                ;
            const { result } = renderHook(() => useMemoriesQuery('hub', load, [], {
                refreshWhile: (d: { refreshing: boolean }) => d.refreshing,
            }));
            await act(async () => { await Promise.resolve(); });
            expect(result.current.data).toEqual({ n: 1, refreshing: true });
            await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_WHILE_MS); });
            // The failed quiet reload kept the payload and did not flip to error or loading.
            expect(result.current.status).toBe('ready');
            expect(result.current.data).toEqual({ n: 1, refreshing: true });
            expect(load).toHaveBeenCalledTimes(2);
            await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_WHILE_MS * 3); });
            expect(load).toHaveBeenCalledTimes(2); // a failed reload ends the polling
        });

        it('replaces the data with the final payload and caps the reloads', async () => {
            vi.useFakeTimers();
            const load = vi.fn(async () => ({ refreshing: true }));
            const { result, unmount } = renderHook(() => useMemoriesQuery('hub', load, [], {
                refreshWhile: (d: { refreshing: boolean }) => d.refreshing,
            }));
            await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_WHILE_MS * (REFRESH_WHILE_MAX + 5)); });
            expect(load).toHaveBeenCalledTimes(REFRESH_WHILE_MAX + 1);
            expect(result.current.status).toBe('ready');
            unmount();
        });

        it('clears the pending reload on unmount', async () => {
            vi.useFakeTimers();
            const load = vi.fn(async () => ({ refreshing: true }));
            const { unmount } = renderHook(() => useMemoriesQuery('hub', load, [], {
                refreshWhile: (d: { refreshing: boolean }) => d.refreshing,
            }));
            await act(async () => { await Promise.resolve(); });
            unmount();
            await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_WHILE_MS * 2); });
            expect(load).toHaveBeenCalledTimes(1);
        });
    });
    describe('failure', () => {
        it('a MemoriesTimeoutError reads failure timeout, a MemoriesFetchError(500) failure error', async () => {
            const { result: timedOut } = renderHook(() => useMemoriesQuery('album', async () => { throw new MemoriesTimeoutError(); }, []));
            await waitFor(() => expect(timedOut.current.status).toBe('error'));
            expect(timedOut.current.failure).toBe('timeout');
            const { result: failed } = renderHook(() => useMemoriesQuery('album', async () => { throw new MemoriesFetchError(500); }, []));
            await waitFor(() => expect(failed.current.status).toBe('error'));
            expect(failed.current.failure).toBe('error');
        });

        it('reads failure null while loading and once ready', async () => {
            const { result } = renderHook(() => useMemoriesQuery('album', async () => ({ items: ['金村 🌸'] }), []));
            expect(result.current.failure).toBeNull();
            await waitFor(() => expect(result.current.status).toBe('ready'));
            expect(result.current.failure).toBeNull();
            expect(result.current.stale).toBe(false);
        });
    });

    describe('keepPrevious', () => {
        type P = { n: number; title: string };
        const deferred = () => {
            const resolvers: Array<(v: P) => void> = [];
            const signals: AbortSignal[] = [];
            const load = (signal: AbortSignal) => {
                signals.push(signal);
                return new Promise<P>((resolve) => { resolvers.push(resolve); });
            };
            return { load, resolvers, signals };
        };

        it('keeps the previous payload (stale) while the next key of the same scope loads', async () => {
            const { load, resolvers } = deferred();
            const { result, rerender } = renderHook(
                ({ dep, scope }) => useMemoriesQuery('timeline_month', load, [dep], { keepPrevious: { scope } }),
                { initialProps: { dep: 1, scope: ['hinatazaka46', '金村 美玖'] as unknown } },
            );
            await act(async () => { resolvers[0]({ n: 1, title: '思い出 🌸' }); });
            expect(result.current).toMatchObject({ status: 'ready', data: { n: 1 }, stale: false });
            // A fresh array of the same values is the same scope (compared element-wise).
            rerender({ dep: 2, scope: ['hinatazaka46', '金村 美玖'] });
            expect(result.current).toMatchObject({ status: 'loading', data: { n: 1, title: '思い出 🌸' }, stale: true });
            await act(async () => { resolvers[1]({ n: 2, title: '二月' }); });
            expect(result.current).toMatchObject({ status: 'ready', data: { n: 2 }, stale: false });
        });

        it('a different scope has nothing to keep', async () => {
            const { load, resolvers } = deferred();
            const { result, rerender } = renderHook(
                ({ dep, scope }) => useMemoriesQuery('timeline_month', load, [dep], { keepPrevious: { scope } }),
                { initialProps: { dep: 1, scope: 'hinatazaka46' } },
            );
            await act(async () => { resolvers[0]({ n: 1, title: 'a' }); });
            rerender({ dep: 2, scope: 'sakurazaka46' });
            expect(result.current).toMatchObject({ status: 'loading', data: null, stale: false });
        });

        it('the first load reads null data, and without the option nothing is kept', async () => {
            const { load, resolvers } = deferred();
            const { result, rerender } = renderHook(({ dep }) => useMemoriesQuery('timeline_month', load, [dep]), { initialProps: { dep: 1 } });
            expect(result.current).toMatchObject({ status: 'loading', data: null, stale: false });
            await act(async () => { resolvers[0]({ n: 1, title: 'a' }); });
            rerender({ dep: 2 });
            expect(result.current).toMatchObject({ status: 'loading', data: null, stale: false });
        });

        it('an aborted run never commits over the kept payload', async () => {
            const { load, resolvers, signals } = deferred();
            const { result, rerender } = renderHook(
                ({ dep }) => useMemoriesQuery('timeline_month', load, [dep], { keepPrevious: { scope: 's' } }),
                { initialProps: { dep: 1 } },
            );
            await act(async () => { resolvers[0]({ n: 1, title: 'a' }); });
            rerender({ dep: 2 });
            rerender({ dep: 3 });
            expect(signals[1].aborted).toBe(true);
            await act(async () => { resolvers[1]({ n: 2, title: 'b' }); });
            expect(result.current).toMatchObject({ status: 'loading', data: { n: 1 }, stale: true });
            await act(async () => { resolvers[2]({ n: 3, title: 'c' }); });
            expect(result.current).toMatchObject({ status: 'ready', data: { n: 3 }, stale: false });
        });

        it('never keeps an empty payload (isEmpty): the next load reads as a plain loading', async () => {
            const { load, resolvers } = deferred();
            const { result, rerender } = renderHook(
                ({ dep }) => useMemoriesQuery('day', load, [dep], { keepPrevious: { scope: 's', isEmpty: (d) => d.n === 0 } }),
                { initialProps: { dep: 1 } },
            );
            await act(async () => { resolvers[0]({ n: 0, title: '空' }); });
            rerender({ dep: 2 });
            expect(result.current).toMatchObject({ status: 'loading', data: null, stale: false });
            await act(async () => { resolvers[1]({ n: 5, title: '思い出 🌸' }); });
            rerender({ dep: 3 });
            expect(result.current).toMatchObject({ status: 'loading', data: { n: 5 }, stale: true });
        });

        it('a Retry after an error does not bring back the older kept payload', async () => {
            let fail = false;
            const load = vi.fn(async () => {
                if (fail) throw new MemoriesTimeoutError();
                return { n: 1 };
            });
            const { result, rerender } = renderHook(
                ({ dep }) => useMemoriesQuery('timeline_month', load, [dep], { keepPrevious: { scope: 's' } }),
                { initialProps: { dep: 1 } },
            );
            await waitFor(() => expect(result.current.status).toBe('ready'));
            fail = true;
            rerender({ dep: 2 });
            await waitFor(() => expect(result.current.failure).toBe('timeout'));
            load.mockImplementation(() => new Promise(() => {}));
            act(() => result.current.retry());
            expect(result.current).toMatchObject({ status: 'loading', data: null, stale: false });
        });

        it('an error of the next key drops the kept payload', async () => {
            let fail = false;
            const load = async () => {
                if (fail) throw new MemoriesFetchError(500);
                return { n: 1 };
            };
            const { result, rerender } = renderHook(
                ({ dep }) => useMemoriesQuery('day', load, [dep], { keepPrevious: { scope: 's' } }),
                { initialProps: { dep: 1 } },
            );
            await waitFor(() => expect(result.current.status).toBe('ready'));
            fail = true;
            rerender({ dep: 2 });
            await waitFor(() => expect(result.current.status).toBe('error'));
            expect(result.current).toMatchObject({ data: null, stale: false, failure: 'error' });
        });
    });

    describe('min-visible settle', () => {
        const after = <T,>(ms: number, value: T) => () => new Promise<T>((resolve) => { setTimeout(() => resolve(value), ms); });

        it('a load finishing at 300 ms commits at 600 ms (the shown indicator stays minVisible)', async () => {
            vi.useFakeTimers();
            const { result } = renderHook(() => useMemoriesQuery('album', after(300, { items: [1] }), []));
            await act(async () => { await vi.advanceTimersByTimeAsync(300); });
            expect(result.current.status).toBe('loading');
            await act(async () => { await vi.advanceTimersByTimeAsync(299); });
            expect(result.current.status).toBe('loading');
            await act(async () => { await vi.advanceTimersByTimeAsync(1); });
            expect(result.current.status).toBe('ready');
        });

        it('a load finishing at 100 ms commits at once', async () => {
            vi.useFakeTimers();
            const { result } = renderHook(() => useMemoriesQuery('album', after(100, { items: [1] }), []));
            await act(async () => { await vi.advanceTimersByTimeAsync(100); });
            expect(result.current.status).toBe('ready');
        });

        it('a load finishing at 2 s commits at once', async () => {
            vi.useFakeTimers();
            const { result } = renderHook(() => useMemoriesQuery('album', after(2000, { items: [1] }), []));
            await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
            expect(result.current.status).toBe('ready');
        });

        it('an error at 300 ms is held to 600 ms too', async () => {
            vi.useFakeTimers();
            const load = vi.fn((_signal: AbortSignal) => new Promise<never>((_, reject) => {
                setTimeout(() => reject(new MemoriesFetchError(500)), 300);
            }));
            const { result } = renderHook(() => useMemoriesQuery('album', load, []));
            await act(async () => { await vi.advanceTimersByTimeAsync(300); });
            expect(result.current.status).toBe('loading');
            await act(async () => { await vi.advanceTimersByTimeAsync(300); });
            expect(result.current).toMatchObject({ status: 'error', failure: 'error' });
        });

        it('a deps change during the hold drops the held result; nothing commits under the new key', async () => {
            vi.useFakeTimers();
            const load = vi.fn((_signal: AbortSignal) => new Promise<{ n: number }>((resolve) => { setTimeout(() => resolve({ n: 1 }), 300); }));
            const { result, rerender } = renderHook(({ dep }) => useMemoriesQuery('album', load, [dep]), { initialProps: { dep: 1 } });
            await act(async () => { await vi.advanceTimersByTimeAsync(300); });
            expect(result.current.status).toBe('loading');
            load.mockImplementation(() => new Promise(() => {}));
            rerender({ dep: 2 });
            await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
            expect(result.current).toMatchObject({ status: 'loading', data: null });
            expect(vi.getTimerCount()).toBe(0);
        });

        it('an unmount during the hold clears its timer', async () => {
            vi.useFakeTimers();
            const load = () => new Promise<{ n: number }>((resolve) => { setTimeout(() => resolve({ n: 1 }), 300); });
            const { unmount } = renderHook(() => useMemoriesQuery('album', load, []));
            await act(async () => { await vi.advanceTimersByTimeAsync(300); });
            unmount();
            expect(vi.getTimerCount()).toBe(0);
        });

        it('settle: false commits at once (the album month loader frees its fetch slot on arrival)', async () => {
            vi.useFakeTimers();
            const load = () => new Promise<{ n: number }>((resolve) => { setTimeout(() => resolve({ n: 1 }), 300); });
            const { result } = renderHook(() => useMemoriesQuery('album_month', load, [], { settle: false }));
            await act(async () => { await vi.advanceTimersByTimeAsync(300); });
            expect(result.current.status).toBe('ready');
        });

        it('a quiet reload commits at once', async () => {
            vi.useFakeTimers();
            let n = 0;
            const load = vi.fn(() => new Promise<{ n: number; refreshing: boolean }>((resolve) => {
                n += 1;
                const value = { n, refreshing: n < 2 };
                setTimeout(() => resolve(value), n === 1 ? 0 : 300);
            }));
            const { result } = renderHook(() => useMemoriesQuery('hub', load, [], {
                refreshWhile: (d: { refreshing: boolean }) => d.refreshing,
            }));
            await act(async () => { await vi.advanceTimersByTimeAsync(0); });
            expect(result.current.data).toMatchObject({ n: 1 });
            await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_WHILE_MS + 300); });
            expect(result.current.data).toMatchObject({ n: 2 });
        });
    });

    describe('polling', () => {
        it('is true while a quiet reload is pending and false once the flag clears', async () => {
            vi.useFakeTimers();
            const load = vi.fn()
                .mockResolvedValueOnce({ refreshing: true })
                .mockResolvedValueOnce({ refreshing: false });
            const { result } = renderHook(() => useMemoriesQuery('hub', load, [], {
                refreshWhile: (d: { refreshing: boolean }) => d.refreshing,
            }));
            expect(result.current.polling).toBe(false);
            await act(async () => { await Promise.resolve(); });
            expect(result.current.polling).toBe(true);
            await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_WHILE_MS); });
            expect(result.current.data).toEqual({ refreshing: false });
            expect(result.current.polling).toBe(false);
        });

        it('turns false after REFRESH_WHILE_MAX reloads even while the flag holds', async () => {
            vi.useFakeTimers();
            const load = vi.fn(async () => ({ refreshing: true }));
            const { result } = renderHook(() => useMemoriesQuery('hub', load, [], {
                refreshWhile: (d: { refreshing: boolean }) => d.refreshing,
            }));
            await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_WHILE_MS * (REFRESH_WHILE_MAX - 1)); });
            expect(result.current.polling).toBe(true);
            await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_WHILE_MS * 3); });
            expect(load).toHaveBeenCalledTimes(REFRESH_WHILE_MAX + 1);
            expect(result.current.polling).toBe(false);
        });

        it('turns false when a quiet reload fails', async () => {
            vi.useFakeTimers();
            const load = vi.fn()
                .mockResolvedValueOnce({ refreshing: true })
                .mockRejectedValueOnce(new MemoriesFetchError(500));
            const { result } = renderHook(() => useMemoriesQuery('hub', load, [], {
                refreshWhile: (d: { refreshing: boolean }) => d.refreshing,
            }));
            await act(async () => { await Promise.resolve(); });
            expect(result.current.polling).toBe(true);
            await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_WHILE_MS); });
            expect(result.current).toMatchObject({ status: 'ready', polling: false });
        });

        it('is false for a query without refreshWhile', async () => {
            const { result } = renderHook(() => useMemoriesQuery('album', async () => ({ items: [] }), []));
            await waitFor(() => expect(result.current.status).toBe('ready'));
            expect(result.current.polling).toBe(false);
        });
    });
});
