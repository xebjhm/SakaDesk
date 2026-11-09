import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { motion } from '../../../design/tokens/motion';
import { useLandingHighlight } from './useLandingHighlight';

describe('useLandingHighlight', () => {
    let frames: Map<number, FrameRequestCallback>;
    let nextId: number;
    const runFrame = () => {
        const pending = [...frames.entries()];
        frames.clear();
        for (const [, cb] of pending) cb(0);
    };

    beforeEach(() => {
        vi.useFakeTimers();
        frames = new Map();
        nextId = 1;
        vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => { frames.set(nextId, cb); return nextId++; }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { frames.delete(id); }));
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('sets the row key on the next animation frame, not synchronously', () => {
        const { result } = renderHook(() => useLandingHighlight('a'));
        act(() => result.current.flash('msg-7'));
        expect(result.current.highlightedRowKey).toBeNull();
        act(() => runFrame());
        expect(result.current.highlightedRowKey).toBe('msg-7');
    });

    it('flashing the same id twice restarts it: null, then the id again', () => {
        const { result } = renderHook(() => useLandingHighlight('a'));
        act(() => result.current.flash('msg-7'));
        act(() => runFrame());
        expect(result.current.highlightedRowKey).toBe('msg-7');
        act(() => result.current.flash('msg-7'));
        expect(result.current.highlightedRowKey).toBeNull();
        act(() => runFrame());
        expect(result.current.highlightedRowKey).toBe('msg-7');
    });

    it('clears after the landing duration, and not before', () => {
        const { result } = renderHook(() => useLandingHighlight('a'));
        act(() => result.current.flash('msg-7'));
        act(() => runFrame());
        act(() => { vi.advanceTimersByTime(motion.duration.landing - 1); });
        expect(result.current.highlightedRowKey).toBe('msg-7');
        act(() => { vi.advanceTimersByTime(1); });
        expect(result.current.highlightedRowKey).toBeNull();
    });

    it('a restart gets a fresh full duration', () => {
        const { result } = renderHook(() => useLandingHighlight('a'));
        act(() => result.current.flash('msg-7'));
        act(() => runFrame());
        act(() => { vi.advanceTimersByTime(motion.duration.landing - 100); });
        act(() => result.current.flash('letter-8'));
        act(() => runFrame());
        act(() => { vi.advanceTimersByTime(motion.duration.landing - 1); });
        expect(result.current.highlightedRowKey).toBe('letter-8');
    });

    it('unmounting cancels the pending frame', () => {
        const { result, unmount } = renderHook(() => useLandingHighlight('a'));
        act(() => result.current.flash('msg-7'));
        expect(frames.size).toBe(1);
        unmount();
        expect(frames.size).toBe(0);
        expect(cancelAnimationFrame).toHaveBeenCalled();
    });

    it('unmounting cancels the pending timer', () => {
        const { result, unmount } = renderHook(() => useLandingHighlight('a'));
        act(() => result.current.flash('msg-7'));
        act(() => runFrame());
        expect(vi.getTimerCount()).toBe(1);
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('a resetKey change cancels the pending frame and clears the highlight', () => {
        const { result, rerender } = renderHook(({ k }) => useLandingHighlight(k), { initialProps: { k: 'a' } });
        act(() => result.current.flash('msg-7'));
        expect(frames.size).toBe(1);
        rerender({ k: 'b' });
        expect(frames.size).toBe(0);
        act(() => runFrame());
        expect(result.current.highlightedRowKey).toBeNull();
    });

    it('a resetKey change cancels the pending timer and clears a shown highlight', () => {
        const { result, rerender } = renderHook(({ k }) => useLandingHighlight(k), { initialProps: { k: 'a' } });
        act(() => result.current.flash('msg-7'));
        act(() => runFrame());
        expect(result.current.highlightedRowKey).toBe('msg-7');
        rerender({ k: 'b' });
        expect(result.current.highlightedRowKey).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });
});
