// frontend/src/features/ai/__tests__/useIndexStatusPoll.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIndexStatusPoll, REBUILD_POLL_INTERVAL_MS } from '../useIndexStatusPoll';

/** Build a `GET /api/ai/index/status` payload with the given progress. */
function statusPayload(phase: string, done = 0, total = 0, documentCount = 5) {
    return {
        service: 'hinatazaka46',
        document_count: documentCount,
        by_type: { blog: documentCount },
        progress: { service: 'hinatazaka46', phase, done, total, started_at: null },
        last_built: null,
    };
}

/** Mock fetch whose response payload is pulled from a mutable queue: each call
 * shifts the next payload; the last one repeats once the queue drains. */
function queueFetch(payloads: object[]) {
    const queue = [...payloads];
    const fetchMock = vi.fn(() => {
        const payload = queue.length > 1 ? queue.shift()! : queue[0];
        return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

/** Flush pending microtasks under fake timers (lets a resolved fetch's `.then`
 * chain run without advancing the clock). */
async function flush() {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
    });
}

async function advance(ms: number) {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

describe('useIndexStatusPoll', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('start() fetches the status for the service immediately and exposes it', async () => {
        const fetchMock = queueFetch([statusPayload('embedding', 3, 20)]);
        const { result } = renderHook(() => useIndexStatusPoll());

        expect(result.current.isActive).toBe(false);
        act(() => result.current.start('hinatazaka46'));
        await flush();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith('/api/ai/index/status?service=hinatazaka46');
        expect(result.current.isActive).toBe(true);
        expect(result.current.status?.progress.phase).toBe('embedding');
        expect(result.current.status?.progress.done).toBe(3);
        expect(result.current.status?.documentCount).toBe(5);
    });

    it('keeps polling on the interval while the phase is not idle', async () => {
        const fetchMock = queueFetch([statusPayload('embedding', 3, 20)]);
        const { result } = renderHook(() => useIndexStatusPoll());

        act(() => result.current.start('hinatazaka46'));
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await advance(REBUILD_POLL_INTERVAL_MS);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await advance(REBUILD_POLL_INTERVAL_MS);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(result.current.isActive).toBe(true);
    });

    it('does NOT stop on a single idle read (mid-rebuild flicker debounce)', async () => {
        // embedding -> idle (flicker between passes) -> embedding again.
        const fetchMock = queueFetch([
            statusPayload('embedding', 3, 20),
            statusPayload('idle'),
            statusPayload('embedding', 10, 20),
        ]);
        const { result } = renderHook(() => useIndexStatusPoll());

        act(() => result.current.start('hinatazaka46'));
        await flush();
        await advance(REBUILD_POLL_INTERVAL_MS); // idle read #1 -- keep going
        expect(result.current.isActive).toBe(true);

        await advance(REBUILD_POLL_INTERVAL_MS); // embedding again
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(result.current.isActive).toBe(true);
        expect(result.current.status?.progress.done).toBe(10);
    });

    it('stops after TWO consecutive idle reads and fires onSettled once', async () => {
        const fetchMock = queueFetch([
            statusPayload('embedding', 19, 20),
            statusPayload('idle'),
            statusPayload('idle'),
        ]);
        const onSettled = vi.fn();
        const { result } = renderHook(() => useIndexStatusPoll({ onSettled }));

        act(() => result.current.start('hinatazaka46'));
        await flush();
        await advance(REBUILD_POLL_INTERVAL_MS); // idle #1
        expect(onSettled).not.toHaveBeenCalled();
        await advance(REBUILD_POLL_INTERVAL_MS); // idle #2 -- settle

        expect(result.current.isActive).toBe(false);
        expect(onSettled).toHaveBeenCalledTimes(1);

        // No further polling after settling.
        const callsAtSettle = fetchMock.mock.calls.length;
        await advance(REBUILD_POLL_INTERVAL_MS * 3);
        expect(fetchMock).toHaveBeenCalledTimes(callsAtSettle);
    });

    it('stop() halts polling without firing onSettled', async () => {
        const fetchMock = queueFetch([statusPayload('embedding', 3, 20)]);
        const onSettled = vi.fn();
        const { result } = renderHook(() => useIndexStatusPoll({ onSettled }));

        act(() => result.current.start('hinatazaka46'));
        await flush();
        act(() => result.current.stop());

        expect(result.current.isActive).toBe(false);
        const callsAtStop = fetchMock.mock.calls.length;
        await advance(REBUILD_POLL_INTERVAL_MS * 3);
        expect(fetchMock).toHaveBeenCalledTimes(callsAtStop);
        expect(onSettled).not.toHaveBeenCalled();
    });

    it('restarting resets the idle debounce (an idle read before start() does not count)', async () => {
        const fetchMock = queueFetch([
            statusPayload('idle'), // pre-existing idle read
            statusPayload('idle'), // first read after restart -- streak must be 1, not 2
            statusPayload('embedding', 1, 10),
        ]);
        const { result } = renderHook(() => useIndexStatusPoll());

        act(() => result.current.start('hinatazaka46'));
        await flush(); // idle #1
        act(() => result.current.start('hinatazaka46')); // restart (e.g. Build clicked)
        await flush(); // idle -- but streak restarted, so polling continues

        expect(result.current.isActive).toBe(true);
        await advance(REBUILD_POLL_INTERVAL_MS); // embedding
        expect(result.current.status?.progress.phase).toBe('embedding');
        expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('cleans up the pending timer on unmount', async () => {
        const fetchMock = queueFetch([statusPayload('embedding', 3, 20)]);
        const { result, unmount } = renderHook(() => useIndexStatusPoll());

        act(() => result.current.start('hinatazaka46'));
        await flush();
        const callsBeforeUnmount = fetchMock.mock.calls.length;
        unmount();

        await advance(REBUILD_POLL_INTERVAL_MS * 3);
        expect(fetchMock).toHaveBeenCalledTimes(callsBeforeUnmount);
    });

    it('treats fetch failures as idle reads (two consecutive failures settle the poll)', async () => {
        const fetchMock = vi.fn(() => Promise.reject(new Error('network down')));
        vi.stubGlobal('fetch', fetchMock);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const onSettled = vi.fn();
        const { result } = renderHook(() => useIndexStatusPoll({ onSettled }));

        act(() => result.current.start('hinatazaka46'));
        await flush(); // failure #1 -- keep going (grace poll)
        expect(result.current.isActive).toBe(true);
        await advance(REBUILD_POLL_INTERVAL_MS); // failure #2 -- settle

        expect(result.current.isActive).toBe(false);
        expect(onSettled).toHaveBeenCalledTimes(1);
        consoleError.mockRestore();
    });
});
