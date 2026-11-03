import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { renderHook, act } from '@testing-library/react';
import { persisted } from '../../../core/persistence/persisted';
import {
    applyReveal, loadReadState, mergeReadState, readStateEquals, revealInStore, saveReadState,
} from '../readStateStore';
import type { ReadState } from '../readStateStore';
import { useReadStateSubscription } from './useReadStateSubscription';

const A = '日向坂46/messages/34 金村 美玖/58 金村 美玖';
const B = '日向坂46/messages/35 加藤 史帆/59 加藤 史帆';

describe('useReadStateSubscription', () => {
    let row: Record<string, unknown>;
    beforeEach(() => {
        row = {};
        vi.spyOn(persisted, 'getConv').mockImplementation(((k: string, fb: unknown) => row[k] ?? fb) as never);
        vi.spyOn(persisted, 'setConv').mockImplementation(((k: string, v: unknown) => { row[k] = v; }) as never);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('reports the new state for the selected path and any change', () => {
        const sel = vi.fn();
        const any = vi.fn();
        renderHook(() => useReadStateSubscription(A, sel, any));
        revealInStore(A, 7);
        expect(sel).toHaveBeenCalledWith({ lastReadId: 0, revealedIds: [7], readCount: 1 });
        expect(any).toHaveBeenCalledTimes(1);
    });

    it('only reports any-change for another path', () => {
        const sel = vi.fn();
        const any = vi.fn();
        renderHook(() => useReadStateSubscription(A, sel, any));
        revealInStore(B, 7);
        expect(sel).not.toHaveBeenCalled();
        expect(any).toHaveBeenCalledTimes(1);
    });

    it('follows the latest selected path and stops after unmount', () => {
        const sel = vi.fn();
        const any = vi.fn();
        const { rerender, unmount } = renderHook(
            ({ dir }: { dir: string }) => useReadStateSubscription(dir, sel, any),
            { initialProps: { dir: A } },
        );
        rerender({ dir: B });
        revealInStore(B, 3);
        expect(sel).toHaveBeenCalledTimes(1);
        unmount();
        revealInStore(B, 4);
        expect(sel).toHaveBeenCalledTimes(1);
        expect(any).toHaveBeenCalledTimes(1);
    });

    it('never loses a reveal when a bridge write races a queued in-chat update', () => {
        // Same wiring as MessagesFeature: a merging subscriber that writes back
        // when the merge holds more than the stored row.
        function useHarness(path: string) {
            const [state, setState] = useState<ReadState>({ lastReadId: 0, readCount: 0, revealedIds: [] });
            const [, setBump] = useState(0);
            useReadStateSubscription(path, loaded => {
                setState(prev => {
                    const merged = mergeReadState(prev, loaded);
                    if (!readStateEquals(merged, loaded)) saveReadState(path, merged);
                    return merged;
                });
            }, () => {});
            return { state, setState, setBump };
        }
        const { result } = renderHook(() => useHarness(A));
        act(() => {
            result.current.setBump(1); // schedules a render, so the next update stays queued (not eager)
            result.current.setState(prev => {
                const next = applyReveal(prev, 5, []);
                saveReadState(A, next);
                return next;
            });
            revealInStore(A, 7); // bridge write before the queued updater has run
        });
        const expected = { lastReadId: 0, revealedIds: [5, 7], readCount: 2 };
        expect(result.current.state).toEqual(expected);
        expect(loadReadState(A)).toEqual(expected);
    });
});
