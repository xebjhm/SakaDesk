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

    it('stops on unmount', () => {
        const cb = vi.fn();
        const { unmount } = renderHook(() => useVisiblePolling(cb, 1000, []));
        unmount();
        vi.advanceTimersByTime(5000);
        setVisibility('visible');
        expect(cb).toHaveBeenCalledTimes(1);
    });
});
