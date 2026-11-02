import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBlogTranslationVisibility } from './useBlogTranslationVisibility';

let ioCallback: IntersectionObserverCallback | null = null;
const disconnect = vi.fn();

class MockIntersectionObserver {
    constructor(cb: IntersectionObserverCallback) { ioCallback = cb; }
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = disconnect;
    takeRecords = vi.fn(() => []);
}

const fireIntersection = (isIntersecting: boolean) =>
    act(() => {
        ioCallback?.([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

describe('useBlogTranslationVisibility', () => {
    beforeEach(() => {
        ioCallback = null;
        disconnect.mockClear();
        vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    });
    afterEach(() => vi.unstubAllGlobals());

    const contentRef = { current: document.createElement('div') };

    it('auto-expands when translations arrive', () => {
        const { result, rerender } = renderHook(({ n }) => useBlogTranslationVisibility(n, contentRef), {
            initialProps: { n: 0 },
        });
        expect(result.current.expanded).toBe(false);
        rerender({ n: 12 });
        expect(result.current.expanded).toBe(true);
    });

    it('toggles manually', () => {
        const { result } = renderHook(() => useBlogTranslationVisibility(5, contentRef));
        expect(result.current.expanded).toBe(true);
        act(() => result.current.toggle());
        expect(result.current.expanded).toBe(false);
        act(() => result.current.toggle());
        expect(result.current.expanded).toBe(true);
    });

    it('auto-collapses when the post content scrolls out of view', () => {
        const { result } = renderHook(() => useBlogTranslationVisibility(5, contentRef));
        expect(result.current.expanded).toBe(true);
        fireIntersection(true);
        expect(result.current.expanded).toBe(true);
        fireIntersection(false);
        expect(result.current.expanded).toBe(false);
    });

    it('collapses when translations are cleared (switching blogs)', () => {
        const { result, rerender } = renderHook(({ n }) => useBlogTranslationVisibility(n, contentRef), {
            initialProps: { n: 5 },
        });
        expect(result.current.expanded).toBe(true);
        rerender({ n: 0 });
        expect(result.current.expanded).toBe(false);
    });

    it('does not observe while collapsed and stops observing on collapse', () => {
        const { result } = renderHook(() => useBlogTranslationVisibility(5, contentRef));
        act(() => result.current.toggle());
        expect(disconnect).toHaveBeenCalled();
    });

    it('works without IntersectionObserver (no auto-collapse, no crash)', () => {
        vi.stubGlobal('IntersectionObserver', undefined);
        const { result } = renderHook(() => useBlogTranslationVisibility(5, contentRef));
        expect(result.current.expanded).toBe(true);
    });
});
