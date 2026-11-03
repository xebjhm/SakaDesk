import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { persisted } from '../../../core/persistence/persisted';
import { revealInStore } from '../readStateStore';
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
});
