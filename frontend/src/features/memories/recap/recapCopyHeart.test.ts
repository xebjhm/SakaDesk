import { describe, it, expect } from 'vitest';
import {
    formatCount, formatMessageDate, formatSecondsOfDay, letterCharCount, s07Copy, s08Copy, s09Copy, s09StubCopy,
    s10Copy, s11Copy,
} from './recapCopy';
import { daisukiData, echoData, LETTER_TEXT, letterData, message, stub, youData } from './__fixtures__/payload';

const SUB_START = '2024-07-24';
/** A moment in the recap's own year (JST), so "next year" is still ahead. */
const IN_2026 = new Date('2026-12-10T03:00:00Z');
const s08 = (data: Parameters<typeof s08Copy>[0]) => s08Copy(data, SUB_START);
const s10 = (data: Parameters<typeof s10Copy>[0]) => s10Copy(data, 2026, IN_2026);

describe('recapCopy: the heart act (s07-s11)', () => {
    it('s07: counts the letter after the nickname replacement, by code point', () => {
        expect(letterCharCount('%%%へ', 'ゆき')).toBe(3);
        expect(letterCharCount('％％％へ', 'ゆき')).toBe(3);
        // An emoji outside the BMP is one character, as in the backend's len().
        expect(letterCharCount('🌸%%%', 'a')).toBe(2);
        expect(letterCharCount(LETTER_TEXT, 'ゆき')).toBe(LETTER_TEXT.length - 3 + 2);
    });

    it('s07: the title and the count line use the replaced length, never the raw char_count', () => {
        const copy = s07Copy(letterData({ char_count: 9999 }), 'ゆき', 'ja');
        const n = LETTER_TEXT.length - 1;
        expect(copy.title).toEqual({ key: 'recap.s07.title' });
        expect(copy.count).toEqual({ key: 'recap.s07.count', params: { count: n, n: String(n) } });
    });

    it('s07: a large count is grouped in the UI language', () => {
        const text = 'あ'.repeat(1240);
        const copy = s07Copy(letterData({ message: message(1, text) }), 'ゆき', 'en');
        expect(copy.count?.params).toEqual({ count: 1240, n: '1,240' });
        expect(formatCount(1240, 'ja')).toBe('1,240');
    });

    it('s07: no message or no text gives no count line (never 0)', () => {
        expect(s07Copy(letterData({ message: null }), 'ゆき', 'ja').count).toBeNull();
        expect(s07Copy(letterData({ message: message(1, null) }), 'ゆき', 'ja').count).toBeNull();
    });

    it('formats a message date in JST, with or without the year', () => {
        // 2025-12-31T15:00:03Z is January 1 in Tokyo.
        expect(formatMessageDate('2025-12-31T15:00:03Z', 'ja')).toBe('1月1日');
        expect(formatMessageDate('2025-12-31T15:00:03Z', 'ja', true)).toBe('2026年1月1日');
        expect(formatMessageDate('nope', 'ja')).toBeNull();
    });

    it('s08: last year on the same day', () => {
        const copy = s08(echoData());
        expect(copy.title).toEqual({ key: 'recap.s08.title' });
        expect(copy.line).toEqual({ key: 'recap.s08.keyword' });
        expect(copy.thenLabel).toBeNull();
        expect(copy.nowLabel).toBeNull();
    });

    it('s08: the same day some years ago puts the years in the title, the one number', () => {
        const copy = s08(echoData({ years_apart: 3, then: message(40, '花火', { ts: '2023-07-30T12:00:00Z' }) }));
        expect(copy.title).toEqual({ key: 'recap.s08.titleYears', params: { count: 3 } });
        expect(copy.line).toEqual({ key: 'recap.s08.keyword' });
    });

    it('s08: another day never says "the same day"', () => {
        const then = message(40, '花火', { ts: '2025-08-10T12:00:00Z' });
        expect(s08(echoData({ then })).title).toEqual({ key: 'recap.s08.titleEcho' });
        const noKw = s08(echoData({ then, shared_keyword: null, years_apart: 2 }));
        expect(noKw.line).toEqual({ key: 'recap.s08.years', params: { count: 2 } });
        expect(s08(echoData({ then, shared_keyword: null, years_apart: null })).line).toBeNull();
    });

    it('s08: the same day is the JST calendar day', () => {
        // 15:30Z on 7/29 is 7/30 00:30 in Tokyo.
        const then = message(40, '花火', { ts: '2025-07-29T15:30:00Z' });
        expect(s08(echoData({ then })).title).toEqual({ key: 'recap.s08.title' });
    });

    it('s08: first_week mode compares the first week with now, no number', () => {
        const copy = s08(echoData({ mode: 'first_week', years_apart: null, shared_keyword: null }));
        expect(copy.title).toEqual({ key: 'recap.s08.firstWeekTitle' });
        expect(copy.thenLabel).toEqual({ key: 'recap.s08.firstWeek' });
        expect(copy.nowLabel).toEqual({ key: 'recap.s08.now' });
        expect(copy.line).toBeNull();
    });

    it('s08: first_week without a subscription start is the first week on record, never "yours"', () => {
        const copy = s08Copy(echoData({ mode: 'first_week', years_apart: null, shared_keyword: null }), null);
        expect(copy.title).toEqual({ key: 'recap.s08.firstRecordedWeekTitle' });
        expect(copy.thenLabel).toEqual({ key: 'recap.s08.firstRecordedWeek' });
        expect(copy.nowLabel).toEqual({ key: 'recap.s08.now' });
        // Echo mode does not depend on the subscription start.
        expect(s08Copy(echoData(), null).title).toEqual({ key: 'recap.s08.title' });
    });

    it('s09: seconds after midnight as H:MM:SS', () => {
        expect(formatSecondsOfDay(7)).toBe('0:00:07');
        expect(formatSecondsOfDay(3661)).toBe('1:01:01');
        expect(formatSecondsOfDay(-1)).toBeNull();
        expect(formatSecondsOfDay(86400)).toBeNull();
    });

    it('s09: the title and a label per stub kind; the sealed stub only has its line', () => {
        expect(s09Copy().title).toEqual({ key: 'recap.s09.title' });
        expect(s09StubCopy(stub('birthday'))).toEqual({ label: { key: 'recap.s09.birthday' }, sealed: null, note: null });
        expect(s09StubCopy(stub('newyear')).label).toEqual({ key: 'recap.s09.newyear' });
        expect(s09StubCopy(stub('christmas')).label).toEqual({ key: 'recap.s09.christmas' });
        expect(s09StubCopy(stub('anniversary'))).toEqual({
            label: { key: 'recap.s09.anniversary' }, sealed: null, note: { key: 'recap.s09.anniversaryNote' },
        });
        expect(s09StubCopy({ kind: 'christmas', message: null, seconds_after_midnight: null, sealed: true })).toEqual({
            label: { key: 'recap.s09.christmas' }, sealed: { key: 'recap.s09.sealed' }, note: null,
        });
    });

    it('s10: favourites take the one number; letters get a label', () => {
        const copy = s10(youData());
        expect(copy.title).toEqual({ key: 'recap.s10.title' });
        expect(copy.stat).toEqual({ key: 'recap.s10.favorites', params: { count: 12 } });
        expect(copy.lettersLabel).toEqual({ key: 'recap.s10.lettersLabel' });
        expect(copy.firstFavorite).toBe(true);
        expect(copy.invite).toEqual([]);
    });

    it('s10: only letters: the letters count is the number', () => {
        const copy = s10(youData({ favorites_count: null, first_favorite: null }));
        expect(copy.stat).toEqual({ key: 'recap.s10.letters', params: { count: 2 } });
        expect(copy.lettersLabel).toBeNull();
        expect(copy.firstFavorite).toBe(false);
    });

    it('s10: with no letters there is no letters label', () => {
        const copy = s10(youData({ favorites_count: null, first_favorite: null }));
        expect(copy.stat?.key).toBe('recap.s10.letters');
        const favOnly = s10(youData({ letters_count: null, letters: [] }));
        expect(favOnly.lettersLabel).toBeNull();
    });

    it('s10: an unlogged favourite time is never presented as the day it was starred', () => {
        const base = youData();
        if (base.invite) throw new Error('fixture');
        const copy = s10({ ...base, first_favorite: { ...base.first_favorite!, favorited_at: null } });
        expect(copy.firstFavorite).toBe(false);
    });

    it('s10: invite state looks forward', () => {
        const copy = s10({ invite: true });
        expect(copy.title).toEqual({ key: 'recap.s10.inviteTitle' });
        expect(copy.stat).toBeNull();
        expect(copy.invite).toEqual([{ key: 'recap.s10.inviteFavorites' }, { key: 'recap.s10.inviteLetters' }]);
    });

    it('s10: a past year\'s invite never says "next year" (that year has come)', () => {
        // Viewed on 2027-01-02 JST, the 2026 recap is a past year's.
        expect(s10Copy({ invite: true }, 2026, new Date('2027-01-01T15:00:00Z')).title).toEqual({ key: 'recap.s10.inviteTitleLater' });
        expect(s10Copy({ invite: true }, 2024, IN_2026).title).toEqual({ key: 'recap.s10.inviteTitleLater' });
        // 2026-12-31T15:00Z is already 2027 in Tokyo, though still 2026 in UTC.
        expect(s10Copy({ invite: true }, 2026, new Date('2026-12-31T15:00:00Z')).title).toEqual({ key: 'recap.s10.inviteTitleLater' });
        expect(s10Copy({ invite: true }, 2026, new Date('2026-12-31T14:59:59Z')).title).toEqual({ key: 'recap.s10.inviteTitle' });
    });

    it('s11: the daisuki title, and the joy variant names neither word', () => {
        expect(s11Copy(daisukiData()).title).toEqual({ key: 'recap.s11.title' });
        expect(s11Copy(daisukiData({ variant: 'joy' })).title).toEqual({ key: 'recap.s11.joyTitle' });
    });
});
