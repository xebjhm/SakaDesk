import { describe, it, expect } from 'vitest';
import type { Message } from '../../../types';
import type { Letter } from '../letters';
import { toLocalDateStr } from '../../../utils/dateFormatters';
import { buildTimeline, rowKeyOf, RUN_GAP_MS } from './buildTimeline';

// Local wall-clock times, so day boundaries hold in every time zone the suite runs in.
const at = (d: number, h: number, m: number, s = 0) => new Date(2026, 0, d, h, m, s).toISOString();
const msg = (id: number, timestamp: string, member_id: number | string = 1): Message =>
    ({ id, timestamp, member_id, type: 'text', is_favorite: false, content: `m${id}` });
const letter = (id: number, created_at: string): Letter =>
    ({ id, text: `l${id}`, created_at, image_url: null, width: null, height: null });
const keys = (t: ReturnType<typeof buildTimeline>) => t.items.map(rowKeyOf);

describe('buildTimeline', () => {
    it('is empty for no rows', () => {
        const t = buildTimeline([], []);
        expect(t.items).toEqual([]);
        expect(t.groupCounts).toEqual([]);
        expect(t.indexOfDate('2026-01-01')).toBe(-1);
        expect(t.rowKeyAt(0)).toBeNull();
        expect(t.messageIdNear(0)).toBeNull();
    });

    it('groups rows by local day and counts them', () => {
        const t = buildTimeline([msg(1, at(1, 9, 0)), msg(2, at(1, 20, 0)), msg(3, at(2, 8, 0))], []);
        expect(t.groupDates).toEqual(['2026-01-01', '2026-01-02']);
        expect(t.groupCounts).toEqual([2, 1]);
        expect(t.groupStarts).toEqual([0, 2]);
        expect(t.groupOfIndex(2)).toBe(1);
        expect(t.groupOfIndex(9)).toBe(-1);
    });

    it('splits at local midnight, even 3 minutes apart', () => {
        const t = buildTimeline([msg(1, at(1, 23, 58)), msg(2, at(2, 0, 1))], []);
        expect(t.groupDates).toEqual([toLocalDateStr(at(1, 23, 58)), toLocalDateStr(at(2, 0, 1))]);
        expect(t.items.map((i) => i.runStart)).toEqual([true, true]);
    });

    it('merges letters by time; a tie puts the message first', () => {
        const t = buildTimeline(
            [msg(1, at(1, 9, 0)), msg(2, at(1, 10, 0))],
            [letter(7, at(1, 10, 0)), letter(8, at(1, 9, 30)), letter(9, at(1, 8, 0))],
        );
        expect(keys(t)).toEqual(['letter-9', 'msg-1', 'letter-8', 'msg-2', 'letter-7']);
    });

    it('keeps a day that has only letters', () => {
        const t = buildTimeline([msg(1, at(1, 9, 0)), msg(2, at(3, 9, 0))], [letter(5, at(2, 12, 0))]);
        expect(t.groupDates).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
        expect(t.groupCounts).toEqual([1, 1, 1]);
        expect(t.indexOfDate('2026-01-02')).toBe(1);
        expect(t.groupIndexOfDate('2026-01-02')).toBe(1);
    });

    it('a run continues for the same sender within 5 minutes, inclusive', () => {
        const t = buildTimeline([
            msg(1, at(1, 9, 0)),
            msg(2, at(1, 9, 5)), // exactly RUN_GAP_MS later
            msg(3, at(1, 9, 10, 1)), // 1 s over
        ], []);
        expect(RUN_GAP_MS).toBe(5 * 60 * 1000);
        expect(t.items.map((i) => i.runStart)).toEqual([true, false, true]);
    });

    it('a new sender starts a run', () => {
        const t = buildTimeline([msg(1, at(1, 9, 0), 1), msg(2, at(1, 9, 1), 2), msg(3, at(1, 9, 2), '2')], []);
        expect(t.items.map((i) => i.runStart)).toEqual([true, true, false]);
    });

    it('a letter breaks a run and always starts one', () => {
        const t = buildTimeline([msg(1, at(1, 9, 0)), msg(2, at(1, 9, 2))], [letter(5, at(1, 9, 1))]);
        expect(keys(t)).toEqual(['msg-1', 'letter-5', 'msg-2']);
        expect(t.items.map((i) => i.runStart)).toEqual([true, true, true]);
    });

    it('keeps message and letter ids apart (row keys)', () => {
        const t = buildTimeline([msg(100, at(1, 9, 0))], [letter(100, at(1, 10, 0))]);
        expect(t.indexOfMessage(100)).toBe(0);
        expect(t.indexOfLetter(100)).toBe(1);
        expect(t.indexOfRowKey('letter-100')).toBe(1);
        expect(t.indexOfRowKey('msg-999')).toBe(-1);
        expect(t.rowKeyAt(1)).toBe('letter-100');
    });

    it('messageIdNear prefers the message above, else the one below', () => {
        const t = buildTimeline([msg(1, at(1, 9, 0)), msg(2, at(1, 11, 0))], [letter(5, at(1, 8, 0)), letter(6, at(1, 10, 0))]);
        // letter-5, msg-1, letter-6, msg-2
        expect(t.messageIdNear(2)).toBe(1);
        expect(t.messageIdNear(0)).toBe(1);
        expect(t.messageIdNear(3)).toBe(2);
    });

    it('drops letters whose created_at cannot be parsed', () => {
        const t = buildTimeline([msg(1, at(1, 9, 0))], [letter(5, 'not a date')]);
        expect(keys(t)).toEqual(['msg-1']);
    });

    it('handles CJK and emoji content without touching it', () => {
        const m = { ...msg(1, at(1, 9, 0)), content: '你好こんにちは😀' };
        const l = { ...letter(2, at(1, 9, 1)), text: '手紙💌' };
        const t = buildTimeline([m], [l]);
        expect(keys(t)).toEqual(['msg-1', 'letter-2']);
        const first = t.items[0];
        expect(first.kind === 'message' && first.message.content).toBe('你好こんにちは😀');
    });
});
