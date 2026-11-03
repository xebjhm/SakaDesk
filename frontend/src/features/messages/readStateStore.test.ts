import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { persisted } from '../../core/persistence/persisted';
import {
    EMPTY_READ_STATE, applyReveal, isUnreadIn, loadReadState, parseReadState,
    readStateKey, revealInStore, subscribeReadState,
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
});
