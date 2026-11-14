import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVisiblePolling } from './useVisiblePolling';

function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
}

describe('useVisiblePolling', () => {
    beforeEach(() => { vi.useFakeTimers(); setVisibility('visible'); });
    afterEach(() => { vi.useRealTimers(); });

    it('runs immediately and on every interval while visible', () => {
        const cb = vi.fn();
        renderHook(() => useVisiblePolling(cb, 1000, []));
        expect(cb).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(3000);
        expect(cb).toHaveBeenCalledTimes(4);
    });

    it('skips ticks while hidden and refreshes once on becoming visible', () => {
        const cb = vi.fn();
        renderHook(() => useVisiblePolling(cb, 1000, []));
        setVisibility('hidden');
        vi.advanceTimersByTime(5000);
        expect(cb).toHaveBeenCalledTimes(1);
        setVisibility('visible');
        expect(cb).toHaveBeenCalledTimes(2);
    });

    it('passes the trigger: immediate on mount and dep change, tick on the interval, visible on visibilitychange', () => {
        const cb = vi.fn();
        const { rerender } = renderHook(({ dep }) => useVisiblePolling(cb, 1000, [dep]), { initialProps: { dep: 'a' } });
        expect(cb.mock.calls.map(c => c[0])).toEqual(['immediate']);
        vi.advanceTimersByTime(1000);
        expect(cb.mock.calls.map(c => c[0])).toEqual(['immediate', 'tick']);
        setVisibility('visible');
        expect(cb.mock.calls.map(c => c[0])).toEqual(['immediate', 'tick', 'visible']);
        rerender({ dep: 'b' });
        expect(cb.mock.calls.map(c => c[0])).toEqual(['immediate', 'tick', 'visible', 'immediate']);
    });

    it('stops on unmount', () => {
        const cb = vi.fn();
        const { unmount } = renderHook(() => useVisiblePolling(cb, 1000, []));
        unmount();
        vi.advanceTimersByTime(5000);
        setVisibility('visible');
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('re-runs immediately and restarts the interval when a dep changes', () => {
        const cb = vi.fn();
        const { rerender } = renderHook(({ dep }) => useVisiblePolling(cb, 1000, [dep]), { initialProps: { dep: 'a' } });
        vi.advanceTimersByTime(600);
        expect(cb).toHaveBeenCalledTimes(1);
        rerender({ dep: 'b' });
        expect(cb).toHaveBeenCalledTimes(2);
        // The old interval would have fired at t=1000 (400ms from now); the restarted one has not.
        vi.advanceTimersByTime(600);
        expect(cb).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(400);
        expect(cb).toHaveBeenCalledTimes(3);
    });

    it('does not fire anything when the window becomes hidden', () => {
        const cb = vi.fn();
        renderHook(() => useVisiblePolling(cb, 1000, []));
        setVisibility('hidden');
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('does not run while disabled and refreshes at once when enabled again', () => {
        const cb = vi.fn();
        const { rerender } = renderHook(({ enabled }) => useVisiblePolling(cb, 1000, [], { enabled }), { initialProps: { enabled: false } });
        vi.advanceTimersByTime(5000);
        expect(cb).not.toHaveBeenCalled();
        rerender({ enabled: true });
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenLastCalledWith('immediate');
    });
});
