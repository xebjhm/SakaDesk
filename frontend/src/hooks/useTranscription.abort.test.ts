import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { clientLog } from '../utils/clientLog';
import { useTranscription } from './useTranscription';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));

describe('useTranscription cached lookup', () => {
    afterEach(() => { vi.restoreAllMocks(); vi.mocked(clientLog).mockClear(); });

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

    it('a rejected lookup stays idle and logs only the message id', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down for /private/path'));
        const { result } = renderHook(() => useTranscription('hinatazaka46', 7, 'room/member'));
        await waitFor(() => expect(clientLog).toHaveBeenCalledTimes(1));
        expect(clientLog).toHaveBeenCalledWith('chat_load', { outcome: 'transcript_lookup_failed', message_id: 7 });
        expect(result.current.state).toBe('idle');
    });

    it('an aborted lookup (the bubble scrolled away) logs nothing', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }));
        const { unmount } = renderHook(() => useTranscription('hinatazaka46', 7, 'room/member'));
        unmount();
        await new Promise((r) => setTimeout(r, 30));
        expect(clientLog).not.toHaveBeenCalled();
    });
});
