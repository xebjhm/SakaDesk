import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';
import { PREGEN_POLL_MS, pregenProgress, useHeldLoading, usePregenProgress } from './galleryStatus';

interface Status {
    state: string;
    paused_reason?: string | null;
    thumbs_full?: boolean;
    services?: Record<string, { done: number; total: number }>;
}
const body = (over: Partial<Status> = {}) => ({
    state: 'running', paused_reason: null, thumbs_full: false, services: { hinatazaka46: { done: 3, total: 10 } },
    posters: { ready: 0, failed: 0, pending_client: 0, shell_off: false },
    cache: { thumbs_bytes: 0, posters_bytes: 0, thumbs_cap: 1, posters_cap: 1 },
    ...over,
});

const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('useHeldLoading (L1 minVisible)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('never holds a load shorter than reveal', () => {
        const { result, rerender } = renderHook(({ on }) => useHeldLoading(on), { initialProps: { on: true } });
        expect(result.current).toBe(true);
        act(() => { vi.advanceTimersByTime(100); });
        rerender({ on: false });
        expect(result.current).toBe(false);
    });

    it('keeps a shown indicator until reveal + minVisible', async () => {
        const { result, rerender } = renderHook(({ on }) => useHeldLoading(on), { initialProps: { on: true } });
        await advance(250); // shown at 200 ms
        rerender({ on: false });
        expect(result.current).toBe(true); // held: shown only 50 ms so far
        await advance(300);
        expect(result.current).toBe(true);
        await advance(60); // 200 + 400 = 600 ms
        expect(result.current).toBe(false);
    });

    it('does not hold a load that outlasted minVisible', async () => {
        const { result, rerender } = renderHook(({ on }) => useHeldLoading(on), { initialProps: { on: true } });
        await advance(900);
        rerender({ on: false });
        expect(result.current).toBe(false);
    });

    it('is false when it never started', () => {
        const { result } = renderHook(() => useHeldLoading(false));
        expect(result.current).toBe(false);
    });
});

describe('pregenProgress', () => {
    it('reads the service while the worker runs or pauses with work left', () => {
        expect(pregenProgress(body(), 'hinatazaka46')).toEqual({ done: 3, total: 10, paused: false });
        expect(pregenProgress(body({ state: 'paused', paused_reason: 'foreground' }), 'hinatazaka46')).toEqual({ done: 3, total: 10, paused: true });
    });

    it('marks every pause the worker resumes from as paused (sync, refresh, blog backup, browsing)', () => {
        for (const reason of ['sync', 'refresh', 'blog_backup', 'foreground', null]) {
            expect(pregenProgress(body({ state: 'paused', paused_reason: reason }), 'hinatazaka46')?.paused).toBe(true);
        }
    });

    it('is null while the worker shuts down (it will not resume)', () => {
        expect(pregenProgress(body({ state: 'paused', paused_reason: 'shutdown' }), 'hinatazaka46')).toBeNull();
        expect(pregenProgress(body({ state: 'stopped' }), 'hinatazaka46')).toBeNull();
    });

    it('sums every service without a service id', () => {
        expect(pregenProgress(body({ services: { a: { done: 1, total: 2 }, b: { done: 3, total: 4 } } }), undefined)).toEqual({ done: 4, total: 6, paused: false });
    });

    it('is null when done, idle, full, for another service or malformed', () => {
        expect(pregenProgress(body({ services: { hinatazaka46: { done: 10, total: 10 } } }), 'hinatazaka46')).toBeNull();
        expect(pregenProgress(body({ state: 'idle' }), 'hinatazaka46')).toBeNull();
        expect(pregenProgress(body({ thumbs_full: true }), 'hinatazaka46')).toBeNull();
        expect(pregenProgress(body(), 'sakurazaka46')).toBeNull();
        expect(pregenProgress(null, 'hinatazaka46')).toBeNull();
        expect(pregenProgress({ state: 'running', services: { x: { done: 'a', total: 2 } } }, 'x')).toBeNull();
    });
});

describe('usePregenProgress', () => {
    let replies: unknown[];
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        vi.useFakeTimers();
        vi.mocked(clientLog).mockClear();
        replies = [];
        fetchMock = vi.fn(async () => {
            const next = replies.length > 1 ? replies.shift() : replies[0];
            if (next instanceof Error) throw next;
            if (next === 500) return new Response('', { status: 500 });
            return new Response(JSON.stringify(next));
        });
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('polls gently while pre-generation runs, then stops and hides when done', async () => {
        replies = [body(), body({ services: { hinatazaka46: { done: 6, total: 10 } } }), body({ state: 'idle', services: {} })];
        const { result } = renderHook(() => usePregenProgress(true, 'hinatazaka46'));
        await advance(0);
        expect(fetchMock).toHaveBeenCalledWith('/api/media/status', expect.anything());
        expect(result.current).toEqual({ done: 3, total: 10, paused: false });
        await advance(PREGEN_POLL_MS - 1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await advance(1);
        expect(result.current).toEqual({ done: 6, total: 10, paused: false });
        await advance(PREGEN_POLL_MS);
        expect(result.current).toBeNull();
        await advance(PREGEN_POLL_MS * 3);
        expect(fetchMock).toHaveBeenCalledTimes(3); // idle: no more polls
        expect(clientLog).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'media_gallery_pregen', outcome: 'ok' });
    });

    it('keeps polling through a pause and shows the resumed progress', async () => {
        replies = [body({ state: 'paused', paused_reason: 'foreground' }), body({ services: { hinatazaka46: { done: 5, total: 10 } } })];
        const { result } = renderHook(() => usePregenProgress(true, 'hinatazaka46'));
        await advance(0);
        expect(result.current).toEqual({ done: 3, total: 10, paused: true });
        await advance(PREGEN_POLL_MS);
        expect(result.current).toEqual({ done: 5, total: 10, paused: false });
    });

    it('logs ok once per activation: each open (or return from the voice tab) reads afresh', async () => {
        replies = [body({ state: 'idle', services: {} })];
        const { rerender } = renderHook(({ on }) => usePregenProgress(on, 'hinatazaka46'), { initialProps: { on: true } });
        await advance(0);
        rerender({ on: false });
        rerender({ on: true });
        await advance(0);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(vi.mocked(clientLog).mock.calls.filter(([, f]) => (f as { outcome?: string }).outcome === 'ok')).toHaveLength(2);
    });

    it('reads once and never polls when nothing runs', async () => {
        replies = [body({ state: 'idle', services: {} })];
        const { result } = renderHook(() => usePregenProgress(true, 'hinatazaka46'));
        await advance(PREGEN_POLL_MS * 3);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result.current).toBeNull();
    });

    it('does not poll while a full cache stops new thumbnails', async () => {
        replies = [body({ thumbs_full: true })];
        const { result } = renderHook(() => usePregenProgress(true, 'hinatazaka46'));
        await advance(PREGEN_POLL_MS * 3);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result.current).toBeNull();
    });

    it('does nothing while inactive and stops polling once inactive', async () => {
        replies = [body()];
        const { result, rerender } = renderHook(({ on }) => usePregenProgress(on, 'hinatazaka46'), { initialProps: { on: false } });
        await advance(PREGEN_POLL_MS);
        expect(fetchMock).not.toHaveBeenCalled();
        rerender({ on: true });
        await advance(0);
        expect(result.current).toEqual({ done: 3, total: 10, paused: false });
        rerender({ on: false });
        expect(result.current).toBeNull();
        await advance(PREGEN_POLL_MS * 3);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('hides the row and logs one error on a refused or failed read, without retrying', async () => {
        replies = [500];
        const { result } = renderHook(() => usePregenProgress(true, 'hinatazaka46'));
        await advance(PREGEN_POLL_MS * 3);
        expect(result.current).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'media_gallery_pregen', outcome: 'error' });
    });

    it('treats a network error like a refused read', async () => {
        replies = [new Error('offline')];
        const { result } = renderHook(() => usePregenProgress(true, undefined));
        await advance(0);
        expect(result.current).toBeNull();
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'media_gallery_pregen', outcome: 'error' });
    });
});
