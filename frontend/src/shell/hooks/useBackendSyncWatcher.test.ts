import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBackendSyncWatcher } from './useBackendSyncWatcher';
import { clientLog } from '../../utils/clientLog';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
}

type Progress = { state: string; run_id: number; error_code?: string };
let progress: Record<string, Progress>;
const fetchMock = vi.fn();

async function flush() {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
async function tick(ms = 5000) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

describe('useBackendSyncWatcher', () => {
    const follow = vi.fn();
    const isPolling = vi.fn((_s: string) => false);

    const mount = (services = ['hinatazaka46']) =>
        renderHook(() => useBackendSyncWatcher({ services, isPolling, follow }));

    beforeEach(() => {
        vi.useFakeTimers();
        setVisibility('visible');
        progress = { hinatazaka46: { state: 'idle', run_id: 1 } };
        fetchMock.mockReset();
        fetchMock.mockImplementation(async (url: string) => {
            const service = new URL(url, 'http://x').searchParams.get('service') ?? '';
            return { ok: true, json: async () => progress[service] };
        });
        vi.stubGlobal('fetch', fetchMock);
        follow.mockReset();
        isPolling.mockReset();
        isPolling.mockReturnValue(false);
        vi.mocked(clientLog).mockReset();
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    it('follows a running sync that is not being polled and logs once', async () => {
        progress.hinatazaka46 = { state: 'running', run_id: 3 };
        mount();
        await flush();
        expect(follow).toHaveBeenCalledTimes(1);
        expect(follow).toHaveBeenCalledWith('hinatazaka46');
        expect(clientLog).toHaveBeenCalledWith('backend_sync_followed', { service: 'hinatazaka46' });
    });

    it('does not fetch or follow a service that is already polled', async () => {
        progress.hinatazaka46 = { state: 'running', run_id: 3 };
        isPolling.mockReturnValue(true);
        mount();
        await flush();
        await tick();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(follow).not.toHaveBeenCalled();
    });

    it('logs a breadcrumb and does nothing when the progress request is rejected', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
        mount();
        await flush();
        expect(clientLog).toHaveBeenCalledWith('poll_failed', { key: 'watch_progress_hinatazaka46', error_code: 503 });
        expect(follow).not.toHaveBeenCalled();
    });

    it('reads progress uncached', async () => {
        mount();
        await flush();
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
    });

    describe('with a progress request that never answers', () => {
        beforeEach(() => {
            fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_res, reject) => {
                init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            }));
        });

        it('does not start another check while the previous one is pending, then times out', async () => {
            mount();
            await flush();
            await tick(3000); // second interval tick (5 s) not reached yet
            expect(fetchMock).toHaveBeenCalledTimes(1);
            await tick(1000); // 4 s: the pending request is aborted
            expect(clientLog).toHaveBeenCalledWith('poll_timeout', { key: 'watch_progress_hinatazaka46', timeout_ms: 4000 });
            await tick(1000); // 5 s tick: a fresh check starts
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(follow).not.toHaveBeenCalled();
        });

        it('skips interval ticks that land while a check is pending and reports them', async () => {
            const { unmount } = mount();
            await flush();
            // Becoming visible triggers an extra check while the first is pending: skipped.
            setVisibility('visible');
            await flush();
            expect(fetchMock).toHaveBeenCalledTimes(1);
            await tick(4000);
            expect(clientLog).toHaveBeenCalledWith('poll_skipped', { key: 'watch_progress_hinatazaka46', count: 1 });
            unmount();
        });

        it('aborts on unmount without logging a timeout', async () => {
            const { unmount } = mount();
            await flush();
            unmount();
            await tick(10000);
            expect(clientLog).not.toHaveBeenCalledWith('poll_timeout', expect.anything());
            expect(clientLog).not.toHaveBeenCalledWith('poll_failed', expect.anything());
            expect(follow).not.toHaveBeenCalled();
        });
    });

    it('only records run_id on first observation (no follow)', async () => {
        progress.hinatazaka46 = { state: 'complete', run_id: 7 };
        mount();
        await flush();
        await tick();
        expect(follow).not.toHaveBeenCalled();
    });

    it('only records run_id on first observation of an error too', async () => {
        progress.hinatazaka46 = { state: 'error', run_id: 7 };
        mount();
        await flush();
        await tick();
        expect(follow).not.toHaveBeenCalled();
    });

    it('follows a run that completed while nobody was looking, once per new run_id', async () => {
        mount();
        await flush();
        progress.hinatazaka46 = { state: 'complete', run_id: 2 };
        await tick();
        expect(follow).toHaveBeenCalledTimes(1);
        expect(follow).toHaveBeenCalledWith('hinatazaka46');
        expect(clientLog).toHaveBeenCalledWith('backend_sync_followed', {
            service: 'hinatazaka46', reason: 'finished_complete',
        });
        await tick();
        expect(follow).toHaveBeenCalledTimes(1);
        progress.hinatazaka46 = { state: 'idle', run_id: 3 };
        await tick();
        expect(follow).toHaveBeenCalledTimes(2);
    });

    it('does not follow a run the frontend poller already handled between two checks', async () => {
        const lastHandledRunId = vi.fn((_s: string): number | undefined => undefined);
        renderHook(() => useBackendSyncWatcher({
            services: ['hinatazaka46'], isPolling, follow, lastHandledRunId,
        }));
        await flush();
        // Run 2 starts, is polled to completion by the frontend and ends before the next tick.
        progress.hinatazaka46 = { state: 'complete', run_id: 2 };
        lastHandledRunId.mockReturnValue(2);
        await tick();
        expect(follow).not.toHaveBeenCalled();
        expect(clientLog).toHaveBeenCalledWith('backend_sync_skipped', {
            service: 'hinatazaka46', reason: 'already_handled',
        });
    });

    it('still follows a scheduler run the frontend never saw once', async () => {
        const lastHandledRunId = vi.fn((_s: string): number | undefined => 2);
        renderHook(() => useBackendSyncWatcher({
            services: ['hinatazaka46'], isPolling, follow, lastHandledRunId,
        }));
        await flush();
        // Frontend handled run 2 earlier; the scheduler's run 3 is new to it.
        progress.hinatazaka46 = { state: 'error', run_id: 3, error_code: 'session_expired' };
        await tick();
        expect(follow).toHaveBeenCalledTimes(1);
        await tick();
        expect(follow).toHaveBeenCalledTimes(1);
    });

    it('follows a run that failed with session_expired so the normal poller can surface it', async () => {
        mount();
        await flush();
        progress.hinatazaka46 = { state: 'error', run_id: 2, error_code: 'session_expired' };
        await tick();
        expect(follow).toHaveBeenCalledTimes(1);
        expect(follow).toHaveBeenCalledWith('hinatazaka46');
        expect(clientLog).toHaveBeenCalledWith('backend_sync_followed', {
            service: 'hinatazaka46', reason: 'finished_error',
        });
        // The same failed run is not followed again.
        await tick();
        await tick();
        expect(follow).toHaveBeenCalledTimes(1);
    });

    it('does not follow a finished run while a poller owns the service', async () => {
        mount();
        await flush();
        isPolling.mockReturnValue(true);
        progress.hinatazaka46 = { state: 'error', run_id: 2, error_code: 'session_expired' };
        await tick();
        expect(follow).not.toHaveBeenCalled();
        // Once the poller is done the handled run is only recorded, not re-followed.
        isPolling.mockReturnValue(false);
        await tick();
        expect(follow).not.toHaveBeenCalled();
    });

    it('does not follow a second time while the new run is still running', async () => {
        mount();
        await flush();
        progress.hinatazaka46 = { state: 'running', run_id: 2 };
        await tick();
        expect(follow).toHaveBeenCalledTimes(1);
        // The followed poll resolves the completion itself: same run_id -> no extra follow.
        isPolling.mockReturnValue(false);
        progress.hinatazaka46 = { state: 'complete', run_id: 2 };
        await tick();
        expect(follow).toHaveBeenCalledTimes(1);
    });

    it('does not follow a run that finished under a user poll', async () => {
        mount();
        await flush();
        isPolling.mockReturnValue(true);
        progress.hinatazaka46 = { state: 'running', run_id: 2 };
        await tick();
        progress.hinatazaka46 = { state: 'complete', run_id: 2 };
        isPolling.mockReturnValue(false);
        await tick();
        expect(follow).not.toHaveBeenCalled();
    });

    it('skips hidden ticks and checks immediately on visibility regain', async () => {
        mount();
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        setVisibility('hidden');
        await tick(20000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        progress.hinatazaka46 = { state: 'complete', run_id: 2 };
        setVisibility('visible');
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(follow).toHaveBeenCalledTimes(1);
    });

    it('swallows fetch failures and keeps polling', async () => {
        mount();
        await flush();
        fetchMock.mockRejectedValueOnce(new Error('boom'));
        await tick();
        progress.hinatazaka46 = { state: 'running', run_id: 2 };
        await tick();
        expect(follow).toHaveBeenCalledTimes(1);
    });

    it('stops after unmount', async () => {
        const { unmount } = mount();
        await flush();
        unmount();
        await tick(20000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
