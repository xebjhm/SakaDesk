import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/clientLog', async (orig) => ({
    ...(await orig<typeof import('../../utils/clientLog')>()),
    clientLog: vi.fn(),
}));

import { clientLog } from '../../utils/clientLog';
import { persisted } from '../../core/persistence/persisted';
import {
    EMPTY_READ_STATE, applyReveal, isUnreadIn, loadReadState, mergeReadState, parseReadState,
    readStateEquals, readStateKey, revealInStore, saveReadState, subscribeReadState,
} from './readStateStore';
import type { ReadState } from './readStateStore';

const PATH = '日向坂46/messages/34 金村 美玖/58 金村 美玖';

describe('parseReadState', () => {
    const stored: ReadState = { lastReadId: 4, readCount: 2, revealedIds: [7] };
    it.each([
        ['empty row', {}],
        ['empty value', { value: '' }],
        ['bad json', { value: 'not json' }],
        ['null row', null],
    ])('falls back to empty for %s', (_n, row) => {
        expect(parseReadState(row)).toEqual(EMPTY_READ_STATE);
    });
    it('parses a stored value', () => {
        expect(parseReadState({ value: JSON.stringify(stored) })).toEqual(stored);
    });
    it('returns a fresh object each time', () => {
        expect(parseReadState({})).not.toBe(parseReadState({}));
    });
});

describe('parseReadState with malformed stored rows', () => {
    it.each([
        ['JSON null', 'null', { lastReadId: 0, readCount: 0, revealedIds: [] }],
        ['JSON number', '5', { lastReadId: 0, readCount: 0, revealedIds: [] }],
        ['empty object', '{}', { lastReadId: 0, readCount: 0, revealedIds: [] }],
        ['missing revealedIds', '{"lastReadId":4,"readCount":2}', { lastReadId: 4, readCount: 2, revealedIds: [] }],
        ['missing lastReadId', '{"revealedIds":[7,"x"],"readCount":1}', { lastReadId: 0, readCount: 1, revealedIds: [7] }],
        ['non-array revealedIds', '{"lastReadId":3,"revealedIds":"7"}', { lastReadId: 3, readCount: 0, revealedIds: [] }],
    ])('repairs %s so isUnreadIn and applyReveal never throw', (_n, value, expected) => {
        const state = parseReadState({ value });
        expect(state).toEqual(expected);
        expect(() => isUnreadIn(state)(9)).not.toThrow();
        expect(() => applyReveal(state, 9, [])).not.toThrow();
    });
    it('returns a well-formed row as the parsed object (extra fields kept)', () => {
        const value = JSON.stringify({ lastReadId: 1, revealedIds: [], readCount: 0, extra: true });
        expect(parseReadState({ value })).toEqual({ lastReadId: 1, revealedIds: [], readCount: 0, extra: true });
    });
});

describe('mergeReadState', () => {
    const rs = (lastReadId: number, revealedIds: number[], readCount: number): ReadState =>
        ({ lastReadId, revealedIds, readCount });
    it('returns base itself when other adds nothing', () => {
        const base = rs(3, [5], 2);
        expect(mergeReadState(base, rs(3, [5], 2))).toBe(base);
        expect(mergeReadState(base, rs(2, [], 1))).toBe(base);
    });
    it('unions revealed ids and counts each reveal once', () => {
        expect(mergeReadState(rs(0, [5], 1), rs(0, [7], 1))).toEqual(rs(0, [5, 7], 2));
    });
    it('takes the max lastReadId and drops ids it covers', () => {
        expect(mergeReadState(rs(2, [5], 1), rs(6, [], 3))).toEqual(rs(6, [], 3));
        expect(mergeReadState(rs(2, [5, 8], 2), rs(6, [], 3))).toEqual(rs(6, [8], 3));
    });
    it('adopts the loaded state when base is stale', () => {
        expect(mergeReadState(rs(0, [], 0), rs(0, [7], 1))).toEqual(rs(0, [7], 1));
    });
    it('readStateEquals ignores revealedIds order', () => {
        expect(readStateEquals(rs(0, [5, 7], 2), rs(0, [7, 5], 2))).toBe(true);
        expect(readStateEquals(rs(0, [5], 2), rs(0, [5], 3))).toBe(false);
    });
});

describe('applyReveal', () => {
    const base: ReadState = { lastReadId: 2, readCount: 0, revealedIds: [] };
    it('returns prev when already revealed', () => {
        const prev = { ...base, revealedIds: [5] };
        expect(applyReveal(prev, 5, [1, 2, 3, 4, 5])).toBe(prev);
    });
    it('advances lastReadId for the first unread id', () => {
        expect(applyReveal(base, 3, [1, 2, 3, 4, 5]))
            .toEqual({ lastReadId: 3, revealedIds: [], readCount: 1 });
    });
    it('keeps a gap in revealedIds', () => {
        const s = { lastReadId: 2, readCount: 0, revealedIds: [] };
        expect(applyReveal(s, 5, [3, 4, 5]))
            .toEqual({ lastReadId: 2, revealedIds: [5], readCount: 1 });
    });
    it('consolidates once the gap is filled', () => {
        const ids = [3, 4, 5];
        let s: ReadState = { lastReadId: 2, readCount: 0, revealedIds: [] };
        s = applyReveal(s, 5, ids);
        s = applyReveal(s, 3, ids);
        s = applyReveal(s, 4, ids);
        expect(s).toEqual({ lastReadId: 5, revealedIds: [], readCount: 3 });
    });
    it('only appends when no message ids are loaded', () => {
        expect(applyReveal(base, 9, []))
            .toEqual({ lastReadId: 2, revealedIds: [9], readCount: 1 });
    });
});

describe('isUnreadIn', () => {
    it('is unread above lastReadId and not revealed', () => {
        const un = isUnreadIn({ lastReadId: 3, readCount: 0, revealedIds: [5] });
        expect(un(3)).toBe(false);
        expect(un(4)).toBe(true);
        expect(un(5)).toBe(false);
    });
});

describe('revealInStore', () => {
    let getConv: ReturnType<typeof vi.spyOn>;
    let setConv: ReturnType<typeof vi.spyOn>;
    let fetchMock: ReturnType<typeof vi.fn>;
    let row: Record<string, unknown>;

    beforeEach(() => {
        row = {};
        vi.spyOn(persisted, 'conversationsReady').mockReturnValue(true);
        getConv = vi.spyOn(persisted, 'getConv').mockImplementation(((k: string, fb: unknown) => row[k] ?? fb) as never);
        setConv = vi.spyOn(persisted, 'setConv').mockImplementation(((k: string, v: unknown) => { row[k] = v; }) as never);
        fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('writes the row, PUTs the search copy, notifies and returns true', () => {
        const seen: string[] = [];
        const off = subscribeReadState(p => seen.push(p));
        expect(revealInStore(PATH, 10)).toBe(true);
        const next = { lastReadId: 0, revealedIds: [10], readCount: 1 };
        expect(setConv).toHaveBeenCalledWith(`read_state_${PATH}`, { value: JSON.stringify(next) });
        expect(readStateKey(PATH)).toBe(`read_state_${PATH}`);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/read-states');
        expect(init.method).toBe('PUT');
        expect(JSON.parse(init.body)).toEqual({
            service: 'hinatazaka46', group_id: 34, member_id: 58,
            last_read_id: 0, read_count: 1, revealed_ids: [10],
        });
        expect(seen).toEqual([PATH]);
        expect(loadReadState(PATH)).toEqual(next);
        off();
    });

    it('returns false and writes nothing when already heard', () => {
        revealInStore(PATH, 10);
        setConv.mockClear();
        fetchMock.mockClear();
        const seen: string[] = [];
        const off = subscribeReadState(p => seen.push(p));
        expect(revealInStore(PATH, 10)).toBe(false);
        expect(setConv).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(seen).toEqual([]);
        off();
        expect(getConv).toHaveBeenCalled();
    });

    it('stops notifying after unsubscribe and survives a throwing listener', () => {
        const seen: string[] = [];
        const offBad = subscribeReadState(() => { throw new Error('boom'); });
        const off = subscribeReadState(p => seen.push(p));
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        expect(revealInStore(PATH, 1)).toBe(true);
        expect(seen).toEqual([PATH]);
        off();
        revealInStore(PATH, 2);
        expect(seen).toEqual([PATH]);
        offBad();
    });

    it('repairs a malformed stored row and still marks the voice heard', () => {
        row[`read_state_${PATH}`] = { value: 'null' };
        expect(revealInStore(PATH, 10)).toBe(true);
        expect(loadReadState(PATH)).toEqual({ lastReadId: 0, revealedIds: [10], readCount: 1 });
    });
});

describe('saveReadState', () => {
    let row: Record<string, unknown>;
    let setConv: ReturnType<typeof vi.spyOn>;
    let fetchMock: ReturnType<typeof vi.fn>;
    const state: ReadState = { lastReadId: 3, readCount: 1, revealedIds: [] };

    beforeEach(() => {
        row = {};
        vi.mocked(clientLog).mockClear();
        vi.spyOn(persisted, 'getConv').mockImplementation(((k: string, fb: unknown) => row[k] ?? fb) as never);
        setConv = vi.spyOn(persisted, 'setConv').mockImplementation(((k: string, v: unknown) => { row[k] = v; }) as never);
        fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('skips the persist (row and search copy) while the conversation cache is not loaded', () => {
        vi.spyOn(persisted, 'conversationsReady').mockReturnValue(false);
        saveReadState(PATH, state);
        expect(setConv).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(clientLog).toHaveBeenCalledWith('read_state_save_deferred', {
            reason: 'not_ready', service: 'hinatazaka46', group_id: 34, member_id: 58,
        });
        expect(JSON.stringify(vi.mocked(clientLog).mock.calls)).not.toMatch(/金村|messages/);
    });

    it('logs a skipped save once per chat', () => {
        vi.spyOn(persisted, 'conversationsReady').mockReturnValue(false);
        const other = '日向坂46/messages/35 小坂 菜緒/59 小坂 菜緒';
        saveReadState(other, state);
        saveReadState(other, state);
        const skips = () => vi.mocked(clientLog).mock.calls.filter(([event]) => event === 'read_state_save_deferred');
        expect(skips()).toHaveLength(1);
        saveReadState('日向坂46/messages/36 正源司 陽子/60 正源司 陽子', state);
        expect(skips()).toHaveLength(2);
    });

    it('writes the row and the search copy once the cache is loaded', () => {
        vi.spyOn(persisted, 'conversationsReady').mockReturnValue(true);
        saveReadState(PATH, state);
        expect(setConv).toHaveBeenCalledWith(`read_state_${PATH}`, { value: JSON.stringify(state) });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(clientLog).not.toHaveBeenCalled();
    });

    it('logs read_state_sync_failed when the search copy PUT fails or is refused', async () => {
        vi.spyOn(persisted, 'conversationsReady').mockReturnValue(true);
        fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ ok: false, status: 500 });
        saveReadState(PATH, state);
        saveReadState(PATH, state);
        await vi.waitFor(() => expect(vi.mocked(clientLog).mock.calls).toHaveLength(2));
        expect(vi.mocked(clientLog).mock.calls).toEqual(expect.arrayContaining([
            ['read_state_sync_failed', { error_type: 'typeerror' }],
            ['read_state_sync_failed', { error_type: 'http', error_code: 500 }],
        ]));
    });
});

/** The pre-0.5.1 implementation, kept as the reference for equivalence. */
function referenceApplyReveal(prev: ReadState, msgId: number, messageIds: number[]): ReadState {
    if (prev.revealedIds.includes(msgId)) return prev;
    const newRevealedIds = [...prev.revealedIds, msgId];
    const unreadMsgIds = messageIds.filter(id => id > prev.lastReadId).sort((a, b) => a - b);
    let newLastReadId = prev.lastReadId;
    for (const id of unreadMsgIds) {
        if (newRevealedIds.includes(id)) {
            const allPreviousRead = unreadMsgIds.filter(uid => uid <= id && uid > newLastReadId).every(uid => newRevealedIds.includes(uid));
            if (allPreviousRead) newLastReadId = id;
        }
    }
    return { lastReadId: newLastReadId, revealedIds: newRevealedIds.filter(id => id > newLastReadId), readCount: (prev.readCount || 0) + 1 };
}

describe('applyReveal is linear and unchanged in meaning (UI health P-B2)', () => {
    it('matches the reference on 2 000 generated cases', () => {
        let seed = 7;
        const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
        for (let c = 0; c < 2000; c += 1) {
            const ids = Array.from({ length: 1 + rand(30) }, (_, i) => i + 1 + rand(3) * 100);
            const lastReadId = rand(20);
            const revealedIds = ids.filter(() => rand(3) === 0).filter(id => id > lastReadId);
            const prev: ReadState = { lastReadId, readCount: rand(5), revealedIds };
            const msgId = ids[rand(ids.length)];
            expect(applyReveal(prev, msgId, ids)).toEqual(referenceApplyReveal(prev, msgId, ids));
        }
    });

    it('round-trips through the saved row format unchanged', () => {
        const next = applyReveal({ lastReadId: 2, readCount: 1, revealedIds: [5] }, 3, [1, 2, 3, 4, 5, 6]);
        expect(parseReadState({ value: JSON.stringify(next) })).toEqual(next);
        expect(Array.isArray(JSON.parse(JSON.stringify(next)).revealedIds)).toBe(true);
    });
});
