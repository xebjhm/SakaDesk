import { describe, it, expect } from 'vitest';
import type { Message } from '../../../types';
import type { Letter } from '../letters';
import { toLocalDateStr } from '../../../utils/dateFormatters';
import { buildTimeline } from './buildTimeline';
import { resolveJump, jumpTargetCode, firstUnreadIndex } from './jumpTarget';

const msg = (id: number, timestamp: string): Message => ({ id, timestamp, type: 'text', is_favorite: false, content: `m${id}` });
const letter = (id: number, created_at: string): Letter => ({ id, text: '', created_at, image_url: null, width: null, height: null });
// Rows: msg-10, msg-11, letter-12, msg-12, msg-13 (letter 12 and message 12 share an id).
const timeline = buildTimeline(
    [msg(10, '2022-01-14T10:00:00Z'), msg(11, '2022-01-15T10:00:00Z'), msg(12, '2022-01-15T11:00:00Z'), msg(13, '2026-11-03T10:00:00Z')],
    [letter(12, '2022-01-15T10:30:00Z')],
);
const none = () => false;
const dayOf = (i: number) => {
    const item = timeline.items[i];
    return toLocalDateStr(item.kind === 'message' ? item.message.timestamp : item.letter.created_at);
};

describe('resolveJump', () => {
    it('finds a message by id, aligned start and highlighted by default', () => {
        expect(resolveJump(timeline, { kind: 'message', id: 11 }, none))
            .toEqual({ index: 1, rowKey: 'msg-11', align: 'start', highlight: true, verify: true });
    });

    it('keeps message and letter ids apart', () => {
        expect(resolveJump(timeline, { kind: 'message', id: 12 }, none)?.rowKey).toBe('msg-12');
        expect(resolveJump(timeline, { kind: 'letter', id: 12 }, none))
            .toEqual({ index: 2, rowKey: 'letter-12', align: 'start', highlight: true, verify: true });
    });

    it('keeps an explicit centre alignment for a message', () => {
        expect(resolveJump(timeline, { kind: 'message', id: 12, align: 'center' }, none)?.align).toBe('center');
    });

    it('returns null for unknown ids', () => {
        expect(resolveJump(timeline, { kind: 'message', id: 99 }, none)).toBeNull();
        expect(resolveJump(timeline, { kind: 'letter', id: 99 }, none)).toBeNull();
    });

    it('finds the first row of a local date', () => {
        const date = dayOf(1);
        const expected = timeline.items.findIndex((_, i) => dayOf(i) === date);
        const r = resolveJump(timeline, { kind: 'date', date }, none);
        expect(r?.index).toBe(expected);
        expect(r?.rowKey).toBe(timeline.rowKeyAt(expected));
        expect(r?.highlight).toBe(true);
    });

    it('returns null for a date without rows', () => {
        expect(resolveJump(timeline, { kind: 'date', date: '2023-06-01' }, none)).toBeNull();
    });

    it('first unread skips letters, is centred and not highlighted', () => {
        expect(resolveJump(timeline, { kind: 'firstUnread' }, (id) => id >= 12))
            .toEqual({ index: 3, rowKey: 'msg-12', align: 'center', highlight: false, verify: true });
        expect(firstUnreadIndex(timeline, (id) => id >= 12)).toBe(3);
        expect(firstUnreadIndex(timeline, none)).toBe(-1);
    });

    it('top and bottom skip verification and highlight', () => {
        expect(resolveJump(timeline, { kind: 'top' }, none))
            .toEqual({ index: 0, rowKey: 'msg-10', align: 'start', highlight: false, verify: false });
        expect(resolveJump(timeline, { kind: 'bottom' }, none))
            .toEqual({ index: 4, rowKey: 'msg-13', align: 'end', highlight: false, verify: false });
    });

    it('returns null for every kind on an empty timeline', () => {
        const empty = buildTimeline([], []);
        for (const t of [{ kind: 'top' }, { kind: 'bottom' }, { kind: 'firstUnread' }] as const) {
            expect(resolveJump(empty, t, () => true)).toBeNull();
        }
    });
});

describe('jumpTargetCode', () => {
    it('maps kinds to log-safe snake_case codes', () => {
        expect(jumpTargetCode({ kind: 'firstUnread' })).toBe('first_unread');
        expect(jumpTargetCode({ kind: 'message', id: 1 })).toBe('message');
        expect(jumpTargetCode({ kind: 'letter', id: 1 })).toBe('letter');
        expect(jumpTargetCode({ kind: 'date', date: '2022-01-15' })).toBe('date');
    });
});
