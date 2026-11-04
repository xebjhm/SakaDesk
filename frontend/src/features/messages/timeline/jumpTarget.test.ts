import { describe, it, expect } from 'vitest';
import { resolveJump, jumpTargetCode } from './jumpTarget';
import { toLocalDateStr } from '../../../utils/dateFormatters';

const msgs = [
    { id: 10, timestamp: '2022-01-14T10:00:00Z' },
    { id: 11, timestamp: '2022-01-15T10:00:00Z' },
    { id: 12, timestamp: '2022-01-15T11:00:00Z' },
    { id: 13, timestamp: '2026-11-03T10:00:00Z' },
];
const none = () => false;

describe('resolveJump', () => {
    it('finds a message by id, aligned start and highlighted by default', () => {
        expect(resolveJump(msgs, { kind: 'message', id: 12 }, none))
            .toEqual({ index: 2, messageId: 12, align: 'start', highlight: true, verify: true });
    });

    it('keeps an explicit centre alignment for a message', () => {
        expect(resolveJump(msgs, { kind: 'message', id: 12, align: 'center' }, none)?.align).toBe('center');
    });

    it('returns null for an unknown message id', () => {
        expect(resolveJump(msgs, { kind: 'message', id: 99 }, none)).toBeNull();
    });

    it('finds the first message of a local date', () => {
        const date = toLocalDateStr(msgs[1].timestamp);
        const r = resolveJump(msgs, { kind: 'date', date }, none);
        expect(r?.messageId).toBe(msgs.find(m => toLocalDateStr(m.timestamp) === date)!.id);
        expect(r?.align).toBe('start');
        expect(r?.highlight).toBe(true);
    });

    it('returns null for a date without messages', () => {
        expect(resolveJump(msgs, { kind: 'date', date: '2023-06-01' }, none)).toBeNull();
    });

    it('finds the first unread, centred and not highlighted', () => {
        expect(resolveJump(msgs, { kind: 'firstUnread' }, id => id >= 12))
            .toEqual({ index: 2, messageId: 12, align: 'center', highlight: false, verify: true });
    });

    it('returns null when nothing is unread', () => {
        expect(resolveJump(msgs, { kind: 'firstUnread' }, none)).toBeNull();
    });

    it('top and bottom skip verification and highlight', () => {
        expect(resolveJump(msgs, { kind: 'top' }, none))
            .toEqual({ index: 0, messageId: 10, align: 'start', highlight: false, verify: false });
        expect(resolveJump(msgs, { kind: 'bottom' }, none))
            .toEqual({ index: 3, messageId: 13, align: 'end', highlight: false, verify: false });
    });

    it('returns null for every kind on an empty list', () => {
        for (const t of [{ kind: 'top' }, { kind: 'bottom' }, { kind: 'firstUnread' }] as const) {
            expect(resolveJump([], t, () => true)).toBeNull();
        }
    });
});

describe('jumpTargetCode', () => {
    it('maps kinds to log-safe snake_case codes', () => {
        expect(jumpTargetCode({ kind: 'firstUnread' })).toBe('first_unread');
        expect(jumpTargetCode({ kind: 'message', id: 1 })).toBe('message');
        expect(jumpTargetCode({ kind: 'date', date: '2022-01-15' })).toBe('date');
    });
});
