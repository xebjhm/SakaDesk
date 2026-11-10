import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';
import { useMemoriesQuery } from './useMemoriesQuery';
import { MemoriesFetchError } from '../api';

beforeEach(() => { vi.mocked(clientLog).mockClear(); });

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
});
