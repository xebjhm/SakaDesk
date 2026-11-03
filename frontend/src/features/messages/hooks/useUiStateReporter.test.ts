import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUiStateReporter } from './useUiStateReporter';

const ONE_ON_ONE = '日向坂46/messages/34 金村 美玖/58 金村 美玖';
const ROOM = '日向坂46/messages/43 日向坂46';

let fetchMock: ReturnType<typeof vi.fn>;
let hasFocus: boolean;
let visibility: DocumentVisibilityState;

function bodies(): Array<Record<string, unknown>> {
    return fetchMock.mock.calls.map(c => JSON.parse((c[1] as RequestInit).body as string));
}

describe('useUiStateReporter', () => {
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

    it('debounces: nothing is sent before 300 ms, one post after', () => {
        renderHook(() => useUiStateReporter(ONE_ON_ONE));
        vi.advanceTimersByTime(299);
        expect(fetchMock).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/ui-state');
        expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
    });

    it('posts string ids for a 1:1 chat', () => {
        renderHook(() => useUiStateReporter(ONE_ON_ONE));
        vi.advanceTimersByTime(300);
        expect(bodies()).toEqual([
            { service: 'hinatazaka46', group_id: '34', member_id: '58', focused: true },
        ]);
    });

    it('posts member_id "0" for a room', () => {
        renderHook(() => useUiStateReporter(ROOM));
        vi.advanceTimersByTime(300);
        expect(bodies()).toEqual([
            { service: 'hinatazaka46', group_id: '43', member_id: '0', focused: true },
        ]);
    });

    it('posts nulls when no chat is open or the path is unparseable', () => {
        renderHook(() => useUiStateReporter(undefined));
        vi.advanceTimersByTime(300);
        renderHook(() => useUiStateReporter('garbage'));
        vi.advanceTimersByTime(300);
        expect(bodies()).toEqual([
            { service: null, group_id: null, member_id: null, focused: true },
            { service: null, group_id: null, member_id: null, focused: true },
        ]);
    });

    it('reports a chat change once, after the debounce', () => {
        const { rerender } = renderHook(({ dir }) => useUiStateReporter(dir), {
            initialProps: { dir: ONE_ON_ONE },
        });
        vi.advanceTimersByTime(300);
        rerender({ dir: ROOM });
        vi.advanceTimersByTime(300);
        expect(bodies().map(b => b.member_id)).toEqual(['58', '0']);
    });

    it('coalesces rapid chat changes into the last one', () => {
        const { rerender } = renderHook(({ dir }) => useUiStateReporter(dir), {
            initialProps: { dir: ONE_ON_ONE },
        });
        vi.advanceTimersByTime(100);
        rerender({ dir: ROOM });
        vi.advanceTimersByTime(300);
        expect(bodies()).toEqual([
            { service: 'hinatazaka46', group_id: '43', member_id: '0', focused: true },
        ]);
    });

    it('reports focused=false on window blur and true on focus', () => {
        renderHook(() => useUiStateReporter(ROOM));
        vi.advanceTimersByTime(300);
        hasFocus = false;
        window.dispatchEvent(new Event('blur'));
        vi.advanceTimersByTime(300);
        hasFocus = true;
        window.dispatchEvent(new Event('focus'));
        vi.advanceTimersByTime(300);
        expect(bodies().map(b => b.focused)).toEqual([true, false, true]);
    });

    it('reports focused=false when the document is hidden', () => {
        renderHook(() => useUiStateReporter(ROOM));
        vi.advanceTimersByTime(300);
        visibility = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(300);
        expect(bodies().map(b => b.focused)).toEqual([true, false]);
    });

    it('swallows fetch failures', async () => {
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
        fetchMock.mockRejectedValue(new Error('down'));
        renderHook(() => useUiStateReporter(ROOM));
        await vi.advanceTimersByTimeAsync(300);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(debug).toHaveBeenCalled();
    });

    it('cancels a pending post and removes listeners on unmount', () => {
        const { unmount } = renderHook(() => useUiStateReporter(ROOM));
        vi.advanceTimersByTime(100);
        unmount();
        vi.advanceTimersByTime(1000);
        expect(fetchMock).not.toHaveBeenCalled();
        window.dispatchEvent(new Event('blur'));
        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(1000);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
