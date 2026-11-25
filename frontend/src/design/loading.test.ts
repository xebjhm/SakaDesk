import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));

import { clientLog } from '../utils/clientLog';
import { motion } from './tokens';
import { logWait, settleDelay, useDelayedLoading, useKeepPrevious, useLoadingStages } from './loading';

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(clientLog).mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('motion.loading tokens', () => {
    it('holds the wait timing in milliseconds', () => {
        expect(motion.loading).toEqual({ reveal: 200, slow: 3000, verySlow: 10000, minVisible: 400 });
    });
});

describe('settleDelay', () => {
    it.each([
        [0, 0], [199, 0], [200, 400], [450, 150], [600, 0], [5000, 0],
    ])('%i ms elapsed -> hold %i ms', (elapsed, hold) => {
        expect(settleDelay(elapsed)).toBe(hold);
    });
});

describe('useLoadingStages', () => {
    it('walks the stage boundaries', () => {
        const { result } = renderHook(() => useLoadingStages(true));
        advance(199);
        expect(result.current.stage).toBe('hidden');
        advance(1);
        expect(result.current.stage).toBe('shown');
        advance(2799);
        expect(result.current.stage).toBe('shown');
        advance(1);
        expect(result.current.stage).toBe('slow');
        expect(result.current.waitMs).toBe(3000);
        advance(6999);
        expect(result.current.stage).toBe('slow');
        advance(1);
        expect(result.current.stage).toBe('verySlow');
        expect(result.current.waitMs).toBe(10000);
    });

    it('resets to hidden when the wait ends', () => {
        const { result, rerender } = renderHook(({ active }) => useLoadingStages(active), { initialProps: { active: true } });
        advance(3500);
        expect(result.current.stage).toBe('slow');
        rerender({ active: false });
        expect(result.current).toEqual({ stage: 'hidden', waitMs: 0 });
        rerender({ active: true });
        expect(result.current.stage).toBe('hidden');
        advance(200);
        expect(result.current.stage).toBe('shown');
    });

    it('logs ui_wait once for slow and once for very slow when a surface is given', () => {
        const { rerender } = renderHook(({ active }) => useLoadingStages(active, { surface: 'chat_room' }), { initialProps: { active: true } });
        advance(2999);
        expect(clientLog).not.toHaveBeenCalled();
        advance(1);
        expect(clientLog).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenLastCalledWith('ui_wait', { surface: 'chat_room', phase: 'slow', wait_ms: 3000 });
        advance(7000);
        expect(clientLog).toHaveBeenCalledTimes(2);
        expect(clientLog).toHaveBeenLastCalledWith('ui_wait', { surface: 'chat_room', phase: 'very_slow', wait_ms: 10000 });
        advance(30000);
        rerender({ active: true });
        expect(clientLog).toHaveBeenCalledTimes(2);
    });

    it('never logs without a surface', () => {
        renderHook(() => useLoadingStages(true));
        advance(20000);
        expect(clientLog).not.toHaveBeenCalled();
    });

    it('re-arms when a boundary timer fires before the clock reaches it', () => {
        const { result } = renderHook(() => useLoadingStages(true));
        // The clock steps back 5 ms after the wait started (sleep / resume, a timer firing early).
        const realPerf = performance.now.bind(performance);
        const realDate = Date.now.bind(Date);
        const perf = vi.spyOn(performance, 'now').mockImplementation(() => realPerf() - 5);
        const date = vi.spyOn(Date, 'now').mockImplementation(() => realDate() - 5);
        advance(200);
        expect(result.current.stage).toBe('hidden');
        advance(5);
        expect(result.current.stage).toBe('shown');
        advance(2800);
        expect(result.current.stage).toBe('slow');
        advance(7000);
        expect(result.current.stage).toBe('verySlow');
        perf.mockRestore();
        date.mockRestore();
    });

    it('logs once under StrictMode when the wait is already slow at mount', () => {
        const startedAt = Date.now() - 3500;
        renderHook(() => useLoadingStages(true, { surface: 'chat_room', startedAt }), { wrapper: StrictMode });
        advance(0);
        expect(clientLog).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('ui_wait', { surface: 'chat_room', phase: 'slow', wait_ms: 3500 });
    });

    it('starts the clock at startedAt', () => {
        const startedAt = Date.now() - 2500;
        const { result } = renderHook(() => useLoadingStages(true, { startedAt }));
        expect(result.current.stage).toBe('shown');
        advance(499);
        expect(result.current.stage).toBe('shown');
        advance(1);
        expect(result.current.stage).toBe('slow');
    });
});

describe('useDelayedLoading', () => {
    it('never shows a 150 ms wait', () => {
        const { result, rerender } = renderHook(({ active }) => useDelayedLoading(active), { initialProps: { active: true } });
        advance(150);
        rerender({ active: false });
        advance(1000);
        expect(result.current).toBe(false);
    });

    it('shows a 250 ms wait at 200 ms and keeps it until 600 ms', () => {
        const { result, rerender } = renderHook(({ active }) => useDelayedLoading(active), { initialProps: { active: true } });
        advance(199);
        expect(result.current).toBe(false);
        advance(1);
        expect(result.current).toBe(true);
        advance(50);
        rerender({ active: false });
        expect(result.current).toBe(true);
        advance(349);
        expect(result.current).toBe(true);
        advance(1);
        expect(result.current).toBe(false);
    });

    it('stays shown when a new wait starts during the min-visible hold', () => {
        const { result, rerender } = renderHook(({ active }) => useDelayedLoading(active), { initialProps: { active: true } });
        advance(250);
        expect(result.current).toBe(true);
        rerender({ active: false });
        advance(100);
        rerender({ active: true });
        advance(1000);
        expect(result.current).toBe(true);
        rerender({ active: false });
        expect(result.current).toBe(false);
    });

    it('hides a 2 s wait when it ends', () => {
        const { result, rerender } = renderHook(({ active }) => useDelayedLoading(active), { initialProps: { active: true } });
        advance(2000);
        expect(result.current).toBe(true);
        rerender({ active: false });
        expect(result.current).toBe(false);
    });
});

describe('useKeepPrevious', () => {
    type P = { data: string | null; scope: string; loading: boolean };
    const setup = (initial: P) =>
        renderHook(({ data, scope, loading }: P) => useKeepPrevious(data, { scope, loading }), { initialProps: initial });

    it('gives ready data as not stale', () => {
        const { result } = setup({ data: '日向坂 🌸', scope: 'm1', loading: false });
        expect(result.current).toEqual({ shown: '日向坂 🌸', stale: false });
    });

    it('keeps the last payload of the same scope while loading', () => {
        const { result, rerender } = setup({ data: 'may', scope: 'm1', loading: false });
        rerender({ data: null, scope: 'm1', loading: true });
        expect(result.current).toEqual({ shown: 'may', stale: true });
        rerender({ data: 'june', scope: 'm1', loading: false });
        expect(result.current).toEqual({ shown: 'june', stale: false });
    });

    it('survives a payload rebuilt on every render', () => {
        const { result, rerender } = renderHook(
            ({ loading }: { loading: boolean }) => useKeepPrevious(loading ? null : [{ id: 1, name: '日向坂 🌸' }], { scope: 'm1', loading }),
            { initialProps: { loading: false } },
        );
        expect(result.current.shown).toEqual([{ id: 1, name: '日向坂 🌸' }]);
        rerender({ loading: false });
        rerender({ loading: true });
        expect(result.current).toEqual({ shown: [{ id: 1, name: '日向坂 🌸' }], stale: true });
    });

    it('drops the payload on a new scope', () => {
        const { result, rerender } = setup({ data: 'may', scope: 'm1', loading: false });
        rerender({ data: null, scope: 'm2', loading: true });
        expect(result.current).toEqual({ shown: null, stale: false });
    });
});

describe('logWait', () => {
    it('posts a ui_wait breadcrumb', () => {
        logWait('dialog_search', 'timeout', 20000);
        expect(clientLog).toHaveBeenCalledWith('ui_wait', { surface: 'dialog_search', phase: 'timeout', wait_ms: 20000 });
    });

    it('swallows a throwing logger', () => {
        vi.mocked(clientLog).mockImplementationOnce(() => { throw new TypeError('fetch failed'); });
        expect(() => logWait('chat_room', 'cancelled', 12)).not.toThrow();
    });

    it.each(['Chat Room', 'chat-room', '', 'a'.repeat(41), '読み込み'])('refuses the surface %j', (surface) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        logWait(surface, 'slow', 3000);
        expect(clientLog).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('rounds and clamps wait_ms to a non-negative integer', () => {
        logWait('chat_room', 'slow', 3000.7);
        logWait('chat_room', 'slow', -5);
        expect(vi.mocked(clientLog).mock.calls.map(([, f]) => f?.wait_ms)).toEqual([3001, 0]);
    });
});
