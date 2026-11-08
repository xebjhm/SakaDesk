import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../utils/clientLog';
import { useDevicePixelRatio } from './useDevicePixelRatio';

/** A fake `matchMedia`: one list per query, listeners kept so a test can fire `change`. */
function installMatchMedia() {
    const lists: { query: string; listeners: Set<() => void> }[] = [];
    const matchMedia = vi.fn((query: string) => {
        const entry = { query, listeners: new Set<() => void>() };
        lists.push(entry);
        return {
            media: query,
            matches: true,
            addEventListener: (_: string, fn: () => void) => entry.listeners.add(fn),
            removeEventListener: (_: string, fn: () => void) => entry.listeners.delete(fn),
        };
    });
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: matchMedia });
    const active = () => lists.filter(l => l.listeners.size > 0);
    return { matchMedia, active };
}

function setRatio(value: number) {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, writable: true, value });
}

describe('useDevicePixelRatio', () => {
    const original = window.devicePixelRatio;

    beforeEach(() => vi.mocked(clientLog).mockClear());
    afterEach(() => {
        setRatio(original);
        // jsdom has no matchMedia of its own
        delete (window as { matchMedia?: unknown }).matchMedia;
    });

    it('returns the current device pixel ratio', () => {
        setRatio(1.75);
        const { result } = renderHook(() => useDevicePixelRatio());
        expect(result.current).toBe(1.75);
    });

    it('treats a missing ratio as 1 and works without matchMedia', () => {
        setRatio(0);
        const { result } = renderHook(() => useDevicePixelRatio());
        expect(result.current).toBe(1);
    });

    it('follows a ratio change and watches the new ratio', () => {
        setRatio(1.75);
        const { matchMedia, active } = installMatchMedia();
        const { result } = renderHook(() => useDevicePixelRatio());
        expect(matchMedia).toHaveBeenLastCalledWith('(resolution: 1.75dppx)');

        setRatio(1);
        act(() => active()[0].listeners.forEach(fn => fn()));

        expect(result.current).toBe(1);
        expect(matchMedia).toHaveBeenLastCalledWith('(resolution: 1dppx)');
        expect(active()).toHaveLength(1);
        expect(active()[0].query).toBe('(resolution: 1dppx)');
    });

    it('shares one watcher between users and logs each change once', () => {
        setRatio(1.75);
        const { active } = installMatchMedia();
        const a = renderHook(() => useDevicePixelRatio());
        const b = renderHook(() => useDevicePixelRatio());
        expect(active()).toHaveLength(1);

        setRatio(1.25);
        act(() => active()[0].listeners.forEach(fn => fn()));

        expect(a.result.current).toBe(1.25);
        expect(b.result.current).toBe(1.25);
        expect(clientLog).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('display_density_change', { dppx_pct: 125 });
    });

    it('stops watching when the last user unmounts', () => {
        setRatio(2);
        const { active } = installMatchMedia();
        const a = renderHook(() => useDevicePixelRatio());
        const b = renderHook(() => useDevicePixelRatio());
        a.unmount();
        expect(active()).toHaveLength(1);
        b.unmount();
        expect(active()).toHaveLength(0);
    });
});
