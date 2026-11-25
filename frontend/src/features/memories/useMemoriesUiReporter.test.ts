import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
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

    afterEach(async () => {
        // Drain the module-level post queue so no post of this test lands in the next one.
        await vi.advanceTimersByTimeAsync(5000);
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('posts open + focused once, after the 300 ms debounce', async () => {
        expect(MEMORIES_UI_DEBOUNCE_MS).toBe(300);
        renderHook(() => useMemoriesUiReporter());
        await vi.advanceTimersByTimeAsync(299);
        expect(fetchMock).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/ui-state/memories');
        expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
        expect(bodies()).toEqual([{ open: true, focused: true }]);
    });

    it('reports focused=false on blur and true again on focus', async () => {
        renderHook(() => useMemoriesUiReporter());
        await vi.advanceTimersByTimeAsync(300);
        hasFocus = false;
        window.dispatchEvent(new Event('blur'));
        await vi.advanceTimersByTimeAsync(300);
        hasFocus = true;
        window.dispatchEvent(new Event('focus'));
        await vi.advanceTimersByTimeAsync(300);
        expect(bodies()).toEqual([
            { open: true, focused: true },
            { open: true, focused: false },
            { open: true, focused: true },
        ]);
    });

    it('reports focused=false when the document is hidden', async () => {
        renderHook(() => useMemoriesUiReporter());
        await vi.advanceTimersByTimeAsync(300);
        visibility = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(300);
        expect(bodies().map((b) => b.focused)).toEqual([true, false]);
    });

    it('sends only on change', async () => {
        renderHook(() => useMemoriesUiReporter());
        await vi.advanceTimersByTimeAsync(300);
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(1000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('coalesces a blur/focus flicker inside the debounce into nothing', async () => {
        renderHook(() => useMemoriesUiReporter());
        await vi.advanceTimersByTimeAsync(300);
        hasFocus = false;
        window.dispatchEvent(new Event('blur'));
        await vi.advanceTimersByTimeAsync(100);
        hasFocus = true;
        window.dispatchEvent(new Event('focus'));
        await vi.advanceTimersByTimeAsync(300);
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

    it('on unmount sends one immediate open=false, and no stale debounced report after it', async () => {
        const { unmount } = renderHook(() => useMemoriesUiReporter());
        await vi.advanceTimersByTimeAsync(300);
        hasFocus = false;
        window.dispatchEvent(new Event('blur'));
        await vi.advanceTimersByTimeAsync(100); // a report is still pending
        unmount();
        expect(bodies()).toEqual([{ open: true, focused: true }, { open: false, focused: false }]);
        await vi.advanceTimersByTimeAsync(1000);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('removes its listeners on unmount', async () => {
        const { unmount } = renderHook(() => useMemoriesUiReporter());
        unmount();
        fetchMock.mockClear();
        window.dispatchEvent(new Event('blur'));
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(1000);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips the unmount report when nothing was sent yet', async () => {
        const { unmount } = renderHook(() => useMemoriesUiReporter());
        await vi.advanceTimersByTimeAsync(100);
        unmount();
        await vi.advanceTimersByTimeAsync(1000);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends one open report under StrictMode double effects', async () => {
        const { unmount } = renderHook(() => useMemoriesUiReporter(), { wrapper: StrictMode });
        await vi.advanceTimersByTimeAsync(300);
        expect(bodies()).toEqual([{ open: true, focused: true }]);
        unmount();
        await vi.advanceTimersByTimeAsync(0);
        expect(bodies()).toEqual([{ open: true, focused: true }, { open: false, focused: true }]);
    });

    it('serialises posts: the next one waits for the previous answer', async () => {
        let answer: (v: { ok: boolean; status: number }) => void = () => {};
        fetchMock.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
        const { unmount } = renderHook(() => useMemoriesUiReporter());
        await vi.advanceTimersByTimeAsync(300);
        hasFocus = false;
        window.dispatchEvent(new Event('blur'));
        await vi.advanceTimersByTimeAsync(300);
        unmount();
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        answer({ ok: true, status: 204 });
        await vi.advanceTimersByTimeAsync(0);
        expect(bodies()).toEqual([
            { open: true, focused: true },
            { open: true, focused: false },
            { open: false, focused: false },
        ]);
    });

    it('a post that never answers stops blocking after the timeout', async () => {
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_r, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }));
        renderHook(() => useMemoriesUiReporter());
        await vi.advanceTimersByTimeAsync(300);
        hasFocus = false;
        window.dispatchEvent(new Event('blur'));
        await vi.advanceTimersByTimeAsync(300);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(4000);
        expect(bodies()).toEqual([{ open: true, focused: true }, { open: true, focused: false }]);
    });
});
