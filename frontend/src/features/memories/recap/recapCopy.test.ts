import { describe, it, expect } from 'vitest';
import { formatClock, formatMonthDay, s01Copy, s02Copy, s12Copy, s13Copy, withNickname } from './recapCopy';
import { payload } from './__fixtures__/payload';
import type { S01FirstData, S02NameData, S13OyasumiData } from './api';

const member = payload().member;

describe('recapCopy', () => {
    it('s01: the year line and the n-th year sub', () => {
        const data: S01FirstData = { message: null, joined_this_year: false, new_year_midnight: false };
        expect(s01Copy(data, member, 2026, 'ja')).toEqual({
            title: { key: 'recap.s01.title', params: { year: 2026 } },
            sub: { key: 'recap.s01.sub', params: { count: 3 } },
        });
    });

    it('s01: no sub without years_together', () => {
        const data: S01FirstData = { message: null, joined_this_year: false, new_year_midnight: false };
        expect(s01Copy(data, { ...member, years_together: null }, 2026, 'ja').sub).toBeNull();
    });

    it('s01: joined this year starts from the subscription day', () => {
        const data: S01FirstData = { message: null, joined_this_year: true, new_year_midnight: false };
        const joined = { ...member, subscription_start: '2026-10-14', years_together: 1 };
        expect(s01Copy(data, joined, 2026, 'ja')).toEqual({
            title: { key: 'recap.s01.joined', params: { year: 2026, date: '10月14日' } },
            sub: null,
        });
    });

    it('s01: joined without a known day falls back to the year line', () => {
        const data: S01FirstData = { message: null, joined_this_year: true, new_year_midnight: false };
        expect(s01Copy(data, { ...member, subscription_start: null }, 2026, 'ja').title.key).toBe('recap.s01.title');
    });

    it('s02: count, single and daisuki lines', () => {
        const base: S02NameData = { mode: 'nickname', count: 42, first: null, last: null, fragments: [], single: false };
        expect(s02Copy(base).count).toEqual({ key: 'recap.s02.count', params: { count: 42 } });
        expect(s02Copy({ ...base, count: 1, single: true }).count).toEqual({ key: 'recap.s02.single' });
        expect(s02Copy({ ...base, mode: 'daisuki', count: 5 }).count).toEqual({ key: 'recap.s02.daisuki', params: { count: 5 } });
        expect(s02Copy({ ...base, mode: 'daisuki', count: 1, single: true }).count).toEqual({ key: 'recap.s02.single' });
        expect(s02Copy(base).title).toEqual({ key: 'recap.s02.title' });
        expect(s02Copy({ ...base, mode: 'daisuki' }).title).toEqual({ key: 'recap.s02.daisukiTitle' });
    });

    it('s12: the year title', () => {
        expect(s12Copy(2026)).toEqual({ title: { key: 'recap.s12.title', params: { year: 2026 } } });
    });

    it('s13: final, partial and graduated copy', () => {
        const d = (final: boolean, graduated: boolean): S13OyasumiData => ({ message: null, final, graduated });
        expect(s13Copy(d(true, false), null, 2026)).toEqual({
            title: { key: 'recap.s13.title', params: { year: 2026 } }, note: null, narration: { key: 'recap.s13.narration' },
        });
        expect(s13Copy(d(false, false), null, 2026)).toEqual({
            title: { key: 'recap.s13.partialTitle' }, note: { key: 'recap.s13.partialNote' }, narration: null,
        });
        expect(s13Copy(d(false, true), null, 2026)).toEqual({
            title: { key: 'recap.s13.graduatedTitle' }, note: null, narration: { key: 'recap.s13.graduatedLine' },
        });
    });

    it('s13: the last-text fallback never calls it an oyasumi', () => {
        const d = (final: boolean): S13OyasumiData => ({ message: null, final, graduated: false });
        expect(s13Copy(d(true), 'last_text', 2026).title).toEqual({ key: 'recap.s13.lastTextTitle', params: { year: 2026 } });
        expect(s13Copy(d(false), 'last_text', 2026).title).toEqual({ key: 'recap.s13.lastTextPartialTitle' });
        expect(s13Copy(d(false), 'last_text', 2026).note).toEqual({ key: 'recap.s13.lastTextPartialNote' });
    });

    it('formats a JST month-day and a JST clock with seconds', () => {
        expect(formatMonthDay('2026-10-14', 'ja')).toBe('10月14日');
        expect(formatMonthDay('2026-10-14', 'en')).toBe('October 14');
        expect(formatClock('2025-12-31T15:00:07Z', 'ja')).toBe('0:00:07');
        expect(formatMonthDay('nope', 'ja')).toBeNull();
        expect(formatClock('nope', 'ja')).toBeNull();
    });

    it('replaces the nickname placeholder (ASCII and fullwidth, literally)', () => {
        expect(withNickname('%%%、おやすみ ％％％', 'ゆき')).toBe('ゆき、おやすみ ゆき');
        expect(withNickname('%%%!', '$&')).toBe('$&!');
    });
});
