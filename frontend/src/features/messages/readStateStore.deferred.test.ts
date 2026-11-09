import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted: the store registers its listener at import time, before plain consts initialise.
const { ready, listeners, store } = vi.hoisted(() => ({
    ready: { value: false },
    listeners: [] as Array<() => void>,
    store: {} as Record<string, unknown>,
}));
vi.mock('../../core/persistence/persisted', () => ({
    persisted: {
        conversationsReady: () => ready.value,
        onConversationsReady: (fn: () => void) => { listeners.push(fn); return () => {}; },
        getConv: (k: string, fb: unknown) => (k in store ? store[k] : fb),
        setConv: (k: string, v: unknown) => { store[k] = v; },
    },
}));
vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

import { saveReadState, mergeReadStates, readStateKey } from './readStateStore';
import { clientLog } from '../../utils/clientLog';

const PATH = '日向坂46/messages/34 金村 美玖/58 金村 美玖';

describe('deferred read-state saves (spec B2 §2-3)', () => {
    beforeEach(() => {
        ready.value = false;
        vi.mocked(clientLog).mockClear();
        for (const k of Object.keys(store)) delete store[k];
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response));
    });

    it('merges monotonically: max lastReadId and readCount, revealed ids above it', () => {
        expect(mergeReadStates(
            { lastReadId: 100, readCount: 50, revealedIds: [105] },
            { lastReadId: 0, readCount: 3, revealedIds: [101, 102, 105, 90] },
        )).toEqual({ lastReadId: 100, readCount: 50, revealedIds: [101, 102, 105] });
    });

    it('defers while not ready, writes nothing, then flushes only what is ahead', () => {
        store[readStateKey(PATH)] = { value: JSON.stringify({ lastReadId: 100, readCount: 50, revealedIds: [] }) };
        saveReadState(PATH, { lastReadId: 0, readCount: 2, revealedIds: [120] });
        expect(JSON.parse((store[readStateKey(PATH)] as { value: string }).value).revealedIds).toEqual([]);
        expect(fetch).not.toHaveBeenCalled();
        expect(clientLog).toHaveBeenCalledWith('read_state_save_deferred', expect.anything());
        ready.value = true;
        listeners.forEach((fn) => fn());
        const saved = JSON.parse((store[readStateKey(PATH)] as { value: string }).value);
        expect(saved).toEqual({ lastReadId: 100, readCount: 50, revealedIds: [120] });
        expect(clientLog).toHaveBeenCalledWith('read_state_pending_flushed', { written: 1, dropped: 0 });
    });

    it('drops a deferred save that is not ahead of the stored row', () => {
        store[readStateKey(PATH)] = { value: JSON.stringify({ lastReadId: 100, readCount: 50, revealedIds: [] }) };
        saveReadState(PATH, { lastReadId: 40, readCount: 10, revealedIds: [] });
        ready.value = true;
        listeners.forEach((fn) => fn());
        expect(clientLog).toHaveBeenCalledWith('read_state_pending_flushed', { written: 0, dropped: 1 });
    });
});
