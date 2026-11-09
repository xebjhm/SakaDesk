import { describe, it, expect } from 'vitest';
import {
    clipWindow, formatClock, formatMonthDay, s01Copy, s02Copy, s03Copy, s04Copy, s05Copy, s06Copy, s12Copy, s13Copy,
    withNickname,
} from './recapCopy';
import { payload } from './__fixtures__/payload';
import { message } from './__fixtures__/payload';
import type {
    RecapClip, S01FirstData, S02NameData, S03ClockData, S04GreetingsData, S05PhotosData, S06VoiceData, S13OyasumiData,
} from './api';

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
        expect(s02Copy({ ...base, mode: 'daisuki', count: 1, single: true }).count).toEqual({ key: 'recap.s02.daisukiSingle' });
        expect(s02Copy({ ...base, mode: 'daisuki', count: 1, single: false }).count).toEqual({ key: 'recap.s02.daisukiSingle' });
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
    describe('s03', () => {
        const clock = (over: Partial<S03ClockData> = {}): S03ClockData => ({
            stars: [], peak_hour: 22, representative: message(9, 'x'), longest_streak: null, ...over,
        });

        it('titles the peak hour by its time of day and glows it', () => {
            expect(s03Copy(clock()).title).toEqual({ key: 'recap.s03.titleNight' });
            expect(s03Copy(clock({ peak_hour: 2 })).title).toEqual({ key: 'recap.s03.titleNight' });
            expect(s03Copy(clock({ peak_hour: 7 })).title).toEqual({ key: 'recap.s03.titleMorning' });
            expect(s03Copy(clock({ peak_hour: 13 })).title).toEqual({ key: 'recap.s03.titleNoon' });
            expect(s03Copy(clock()).glow).toBe(true);
            expect(s03Copy(clock()).lead).toEqual({ key: 'recap.s03.peak' });
        });

        it('a flat day takes the band for its title, has no glow and no peak lead', () => {
            const c = s03Copy(clock({ peak_hour: 22, band: 'morning' }));
            expect(c.title).toEqual({ key: 'recap.s03.titleMorning' });
            expect(c.glow).toBe(false);
            expect(c.lead).toEqual({ key: 'recap.s03.flat' });
        });

        it('no peak lead without a representative message', () => {
            expect(s03Copy(clock({ representative: null })).lead).toBeNull();
        });

        it('shows the longest streak only from 7 days', () => {
            expect(s03Copy(clock({ longest_streak: 6 })).streak).toBeNull();
            expect(s03Copy(clock({ longest_streak: null })).streak).toBeNull();
            expect(s03Copy(clock({ longest_streak: 7 })).streak).toEqual({ key: 'recap.s03.streak', params: { count: 7 } });
        });
    });

    describe('s04', () => {
        const g = (over: Partial<S04GreetingsData> = {}): S04GreetingsData => ({
            first_ohayo: message(1, 'おはよう'), latest_oyasumi: message(2, 'おやすみ'),
            oyasumi_count: 120, distinct_days: 100, variant: 'oyasumi', ...over,
        });

        it('both greetings: the spec title, labels and the oyasumi count', () => {
            expect(s04Copy(g(), null)).toEqual({
                title: { key: 'recap.s04.title' },
                morning: { key: 'recap.s04.firstOhayo' },
                evening: { key: 'recap.s04.latestOyasumi' },
                count: { key: 'recap.s04.countOyasumi', params: { count: 120 } },
            });
        });

        it('a morning fallback is never called an ohayo', () => {
            const c = s04Copy(g(), 'morning');
            expect(c.title).toEqual({ key: 'recap.s04.titleDay' });
            expect(c.morning).toEqual({ key: 'recap.s04.firstMorning' });
        });

        it('the arigato and otsukare variants name their own word', () => {
            const a = s04Copy(g({ variant: 'arigato', oyasumi_count: 9 }), 'variant');
            expect(a.title).toEqual({ key: 'recap.s04.titleDay' });
            expect(a.evening).toEqual({ key: 'recap.s04.latestArigato' });
            expect(a.count).toEqual({ key: 'recap.s04.countArigato', params: { count: 9 } });
            expect(s04Copy(g({ variant: 'otsukare' }), 'variant').evening).toEqual({ key: 'recap.s04.latestOtsukare' });
        });

        it('one side missing: a title for the side that is there, no label for the other', () => {
            const m = s04Copy(g({ latest_oyasumi: null }), null);
            expect(m.title).toEqual({ key: 'recap.s04.titleMorning' });
            expect(m.evening).toBeNull();
            expect(m.count).toBeNull();
            const e = s04Copy(g({ first_ohayo: null }), null);
            expect(e.title).toEqual({ key: 'recap.s04.titleEvening' });
            expect(e.morning).toBeNull();
        });

        it('never shows a count below 2', () => {
            expect(s04Copy(g({ oyasumi_count: 1 }), null).count).toBeNull();
            expect(s04Copy(g({ oyasumi_count: null }), null).count).toBeNull();
        });
    });

    describe('s05', () => {
        const p = (over: Partial<S05PhotosData> = {}): S05PhotosData => ({
            burst: [message(1, null, { type: 'picture' })], burst_caption: null, mostly_bursts: false, ...over,
        });

        it('the mostly-bursts line when she mostly sends bursts', () => {
            expect(s05Copy(p({ mostly_bursts: true }), null).line).toEqual({ key: 'recap.s05.mostlyBursts' });
            expect(s05Copy(p(), null)).toEqual({ title: { key: 'recap.s05.title' }, line: null });
        });

        it('the best-photo fallback has its own line', () => {
            expect(s05Copy(p({ burst: [], best_photo: message(2, null) }), 'best_photo').line).toEqual({ key: 'recap.s05.bestPhoto' });
        });
    });

    describe('s06', () => {
        const v = (over: Partial<S06VoiceData> = {}): S06VoiceData => ({ clips: [], voice_count: 12, ...over });

        it('the voice count from 2', () => {
            expect(s06Copy(v(), null)).toEqual({ title: { key: 'recap.s06.title' }, sub: { key: 'recap.s06.count', params: { count: 12 } } });
            expect(s06Copy(v({ voice_count: 1 }), 'single').sub).toBeNull();
            expect(s06Copy(v({ voice_count: null }), null).sub).toBeNull();
        });

        it('video audio says so instead of a count', () => {
            expect(s06Copy(v({ voice_count: null }), 'video').sub).toEqual({ key: 'recap.s06.video' });
        });

        it('clip windows default a missing start to 0 and a missing end to the clip length', () => {
            const clip = (start: number | null, end: number | null): RecapClip => ({
                message: message(1, null, { type: 'voice' }), start, end, transcript_segments: null,
            });
            expect(clipWindow(clip(0, 6), 3)).toEqual({ start: 0, end: 6 });
            expect(clipWindow(clip(null, null), 3)).toEqual({ start: 0, end: 6 });
            expect(clipWindow(clip(null, null), 1)).toEqual({ start: 0, end: 12 });
            expect(clipWindow(clip(2, 1), 3)).toEqual({ start: 2, end: 8 });
        });
    });
});
