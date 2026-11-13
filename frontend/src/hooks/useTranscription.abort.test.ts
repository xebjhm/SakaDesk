import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTranscription } from './useTranscription';

describe('useTranscription cached lookup', () => {
    afterEach(() => vi.restoreAllMocks());

    it('aborts the lookup when the bubble unmounts', () => {
        const signals: (AbortSignal | undefined)[] = [];
        vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
            signals.push(init?.signal ?? undefined);
            return new Promise(() => {});
        });
        const { unmount } = renderHook(() => useTranscription('hinatazaka46', 7, 'room/member'));
        expect(signals).toHaveLength(1);
        unmount();
        expect(signals[0]?.aborted).toBe(true);
    });

    it('asks nothing without a service and message', () => {
        const spy = vi.spyOn(globalThis, 'fetch');
        renderHook(() => useTranscription(undefined, undefined, undefined));
        expect(spy).not.toHaveBeenCalled();
    });
});
