import { describe, it, expect, afterEach, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { act, renderHook } from '@testing-library/react';
import { prefersReducedMotion, useReducedMotion } from './useReducedMotion';

const realMatchMedia = window.matchMedia;
afterEach(() => { window.matchMedia = realMatchMedia; });

/** A `matchMedia` whose reduced-motion answer the test flips; returns the flip. */
function stubMatchMedia(initial: boolean) {
    let matches = initial;
    const listeners = new Set<() => void>();
    window.matchMedia = vi.fn((q: string) => ({
        get matches() { return matches && q.includes('prefers-reduced-motion'); },
        addEventListener: (_: string, cb: () => void) => listeners.add(cb),
        removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    })) as unknown as typeof window.matchMedia;
    return (next: boolean) => { matches = next; listeners.forEach((cb) => cb()); };
}

/** Every non-test source file under `features/memories`. */
function memoriesSources(dir = path.resolve(__dirname, '..')): string[] {
    return readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) return memoriesSources(full);
        return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
    });
}

describe('useReducedMotion', () => {
    it('reads the OS setting and follows its changes', () => {
        const flip = stubMatchMedia(false);
        expect(prefersReducedMotion()).toBe(false);
        const { result } = renderHook(() => useReducedMotion());
        expect(result.current).toBe(false);
        act(() => flip(true));
        expect(result.current).toBe(true);
        expect(prefersReducedMotion()).toBe(true);
    });

    it('is the only reduced-motion query in Memories', () => {
        const own = path.resolve(__dirname, 'useReducedMotion.ts');
        const others = memoriesSources()
            .filter((f) => f !== own && readFileSync(f, 'utf-8').includes('prefers-reduced-motion: reduce'))
            .map((f) => path.relative(path.resolve(__dirname, '..'), f));
        expect(others).toEqual([]);
    });
});
