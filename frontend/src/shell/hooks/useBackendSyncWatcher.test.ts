import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBackendSyncWatcher } from './useBackendSyncWatcher';
import { clientLog } from '../../utils/clientLog';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
}

type Progress = { state: string; run_id: number };
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
    const onMissedCompletion = vi.fn();
    const isPolling = vi.fn((_s: string) => false);

    const mount = (services = ['hinatazaka46']) =>
        renderHook(() => useBackendSyncWatcher({ services, isPolling, follow, onMissedCompletion }));

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
        onMissedCompletion.mockReset();
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
        expect(onMissedCompletion).not.toHaveBeenCalled();
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

    it('only records run_id on first observation (no missed completion)', async () => {
        progress.hinatazaka46 = { state: 'complete', run_id: 7 };
        mount();
        await flush();
        await tick();
        expect(onMissedCompletion).not.toHaveBeenCalled();
    });

    it('reports a missed completion once per new run_id', async () => {
        mount();
        await flush();
        progress.hinatazaka46 = { state: 'complete', run_id: 2 };
        await tick();
        expect(onMissedCompletion).toHaveBeenCalledTimes(1);
        expect(onMissedCompletion).toHaveBeenCalledWith('hinatazaka46');
        await tick();
        expect(onMissedCompletion).toHaveBeenCalledTimes(1);
        progress.hinatazaka46 = { state: 'idle', run_id: 3 };
        await tick();
        expect(onMissedCompletion).toHaveBeenCalledTimes(2);
    });

    it('does not report a completion while the new run is still running', async () => {
        mount();
        await flush();
        progress.hinatazaka46 = { state: 'running', run_id: 2 };
        await tick();
        expect(follow).toHaveBeenCalledTimes(1);
        expect(onMissedCompletion).not.toHaveBeenCalled();
        // The followed poll resolves the completion itself: same run_id -> no extra bump.
        isPolling.mockReturnValue(false);
        progress.hinatazaka46 = { state: 'complete', run_id: 2 };
        await tick();
        expect(onMissedCompletion).not.toHaveBeenCalled();
    });

    it('does not report a bogus completion for a run that finished under a user poll', async () => {
        mount();
        await flush();
        isPolling.mockReturnValue(true);
        progress.hinatazaka46 = { state: 'running', run_id: 2 };
        await tick();
        progress.hinatazaka46 = { state: 'complete', run_id: 2 };
        isPolling.mockReturnValue(false);
        await tick();
        expect(onMissedCompletion).not.toHaveBeenCalled();
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
        expect(onMissedCompletion).toHaveBeenCalledTimes(1);
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
