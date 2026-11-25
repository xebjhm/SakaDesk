import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMediaQuery } from './useMediaQuery';

describe('useMediaQuery', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('is false without matchMedia', () => {
        vi.stubGlobal('matchMedia', undefined);
        expect(renderHook(() => useMediaQuery('(max-width: 767.98px)')).result.current).toBe(false);
    });

    it('follows the query', () => {
        let matches = true;
        const listeners = new Set<() => void>();
        vi.stubGlobal('matchMedia', () => ({
            get matches() { return matches; },
            addEventListener: (_: string, cb: () => void) => listeners.add(cb),
            removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
        }));
        const { result } = renderHook(() => useMediaQuery('(max-width: 767.98px)'));
        expect(result.current).toBe(true);
        matches = false;
        act(() => listeners.forEach((cb) => cb()));
        expect(result.current).toBe(false);
    });
});
