import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { SETTLE_MS, useAlbumWindow } from './useAlbumWindow';

/** An IntersectionObserver whose `near(month)` reports the band inside every margin. */
function stubObserver() {
    const observers: { cb: IntersectionObserverCallback; els: Set<Element> }[] = [];
    class FakeObserver {
        els = new Set<Element>();
        constructor(public cb: IntersectionObserverCallback) { observers.push(this); }
        observe(el: Element) { this.els.add(el); }
        unobserve(el: Element) { this.els.delete(el); }
        disconnect() { this.els.clear(); }
        takeRecords() { return []; }
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    return (month: string) => act(() => {
        for (const o of observers) {
            const el = [...o.els].find((e) => e.getAttribute('data-month') === month);
            if (el) o.cb([{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry], o as unknown as IntersectionObserver);
        }
    });
}

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('useAlbumWindow jump re-align', () => {
    it('stops waiting for a band that unmounts, so a finished jump never pulls the view back', () => {
        vi.useFakeTimers();
        const near = stubObserver();
        const months = ['2026-10', '2026-09', '2026-08'];
        const scrolled: string[] = [];
        const bands = new Map(months.map((m) => {
            const el = document.createElement('section');
            el.setAttribute('data-month', m);
            el.scrollIntoView = () => { scrolled.push(m); };
            return [m, el] as const;
        }));
        const root = { current: document.createElement('div') };
        const { result } = renderHook(() => useAlbumWindow(months, root));
        act(() => { for (const [m, el] of bands) result.current.registerRef(m, el); });

        // Jump to 2026-09; it settles with 2026-10 and 2026-09 near (both still to load).
        act(() => { result.current.jump('2026-09'); });
        near('2026-10');
        near('2026-09');
        act(() => { vi.advanceTimersByTime(SETTLE_MS); });
        // The target settles (re-aligned); the other waited-for band is removed before it settles.
        act(() => { result.current.onSettled('2026-09'); });
        act(() => { result.current.registerRef('2026-10', null); });
        scrolled.length = 0;
        // A later band settling (the user scrolled on) must not scroll back to the old target.
        act(() => { result.current.onSettled('2026-08'); });
        expect(scrolled).toEqual([]);
    });
});

describe('useAlbumWindow firstAlone (D-M3 warm open)', () => {
    function setup(firstAlone: boolean) {
        vi.useFakeTimers();
        const near = stubObserver();
        const months = ['2026-10', '2026-09', '2026-08'];
        const bands = months.map((m) => {
            const el = document.createElement('section');
            el.setAttribute('data-month', m);
            el.scrollIntoView = () => {};
            return [m, el] as const;
        });
        const root = { current: document.createElement('div') };
        const hook = renderHook(() => useAlbumWindow(months, root, { firstAlone }));
        act(() => { for (const [m, el] of bands) hook.result.current.registerRef(m, el); });
        months.forEach((m) => near(m));
        return hook;
    }

    it('grants only the top month until it is cached', () => {
        const { result } = setup(true);
        expect(result.current.isRequested('2026-10', 0)).toBe(true);
        expect(result.current.isRequested('2026-09', 1)).toBe(false);
        act(() => { result.current.onLoaded('2026-10', { month: '2026-10', items: [] } as never); });
        expect(result.current.isRequested('2026-09', 1)).toBe(true);
        expect(result.current.isRequested('2026-08', 2)).toBe(true);
    });

    it('a jump releases the hold', () => {
        const { result } = setup(true);
        expect(result.current.isRequested('2026-09', 1)).toBe(false);
        act(() => { result.current.jump('2026-09'); });
        act(() => { vi.advanceTimersByTime(SETTLE_MS); });
        expect(result.current.isRequested('2026-09', 1)).toBe(true);
    });

    it('without it, two months are fetched at once', () => {
        const { result } = setup(false);
        expect(result.current.isRequested('2026-10', 0)).toBe(true);
        expect(result.current.isRequested('2026-09', 1)).toBe(true);
    });
});
