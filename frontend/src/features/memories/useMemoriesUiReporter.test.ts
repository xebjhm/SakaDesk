import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMemoriesUiReporter, MEMORIES_UI_DEBOUNCE_MS } from './useMemoriesUiReporter';

let fetchMock: ReturnType<typeof vi.fn>;
let hasFocus: boolean;
let visibility: DocumentVisibilityState;

function bodies(): Array<Record<string, unknown>> {
    return fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
}

describe('useMemoriesUiReporter', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
        vi.stubGlobal('fetch', fetchMock);
        hasFocus = true;
        visibility = 'visible';
        vi.spyOn(document, 'hasFocus').mockImplementation(() => hasFocus);
        vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('posts open + focused once, after the 300 ms debounce', () => {
        expect(MEMORIES_UI_DEBOUNCE_MS).toBe(300);
        renderHook(() => useMemoriesUiReporter());
        vi.advanceTimersByTime(299);
        expect(fetchMock).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/ui-state/memories');
        expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
        expect(bodies()).toEqual([{ open: true, focused: true }]);
    });

    it('reports focused=false on blur and true again on focus', () => {
        renderHook(() => useMemoriesUiReporter());
        vi.advanceTimersByTime(300);
        hasFocus = false;
        window.dispatchEvent(new Event('blur'));
        vi.advanceTimersByTime(300);
        hasFocus = true;
        window.dispatchEvent(new Event('focus'));
        vi.advanceTimersByTime(300);
        expect(bodies()).toEqual([
            { open: true, focused: true },
            { open: true, focused: false },
            { open: true, focused: true },
        ]);
    });

    it('reports focused=false when the document is hidden', () => {
        renderHook(() => useMemoriesUiReporter());
        vi.advanceTimersByTime(300);
        visibility = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(300);
        expect(bodies().map((b) => b.focused)).toEqual([true, false]);
    });

    it('sends only on change', () => {
        renderHook(() => useMemoriesUiReporter());
        vi.advanceTimersByTime(300);
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(1000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('coalesces a blur/focus flicker inside the debounce into nothing', () => {
        renderHook(() => useMemoriesUiReporter());
        vi.advanceTimersByTime(300);
        hasFocus = false;
        window.dispatchEvent(new Event('blur'));
        vi.advanceTimersByTime(100);
        hasFocus = true;
        window.dispatchEvent(new Event('focus'));
        vi.advanceTimersByTime(300);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('resends after a failed post', async () => {
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
        fetchMock.mockRejectedValueOnce(new Error('down'));
        renderHook(() => useMemoriesUiReporter());
        await vi.advanceTimersByTimeAsync(300);
        expect(debug).toHaveBeenCalled();
        window.dispatchEvent(new Event('focus'));
        await vi.advanceTimersByTimeAsync(300);
        expect(bodies()).toEqual([{ open: true, focused: true }, { open: true, focused: true }]);
    });

    it('resends after a rejected status', async () => {
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
        renderHook(() => useMemoriesUiReporter());
        await vi.advanceTimersByTimeAsync(300);
        window.dispatchEvent(new Event('focus'));
        await vi.advanceTimersByTimeAsync(300);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('never throws when fetch itself throws', () => {
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        fetchMock.mockImplementation(() => { throw new Error('boom'); });
        const { unmount } = renderHook(() => useMemoriesUiReporter());
        expect(() => vi.advanceTimersByTime(300)).not.toThrow();
        expect(() => unmount()).not.toThrow();
    });

    it('on unmount sends one immediate open=false, and no stale debounced report after it', () => {
        const { unmount } = renderHook(() => useMemoriesUiReporter());
        vi.advanceTimersByTime(300);
        hasFocus = false;
        window.dispatchEvent(new Event('blur'));
        vi.advanceTimersByTime(100); // a report is still pending
        unmount();
        expect(bodies()).toEqual([{ open: true, focused: true }, { open: false, focused: false }]);
        vi.advanceTimersByTime(1000);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('removes its listeners on unmount', () => {
        const { unmount } = renderHook(() => useMemoriesUiReporter());
        unmount();
        fetchMock.mockClear();
        window.dispatchEvent(new Event('blur'));
        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(1000);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
