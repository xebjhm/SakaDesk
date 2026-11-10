/**
 * Maps recap slide data to i18n keys and parameters (pure; the slides call `t`).
 *
 * Years are always a `{{year}}` parameter (the payload's year), never part of
 * the copy. Dates and clocks are shown in JST, the time zone the recap is
 * computed in (a New Year 0:00 message stays 0:00).
 */
import { replaceNickname } from '../../messages/utils/nickname';
import { JST_TIME_ZONE } from '../shared/jst';
import type {
    RecapMemberBlock, RecapStub, S01FirstData, S02NameData, S03ClockData, S04GreetingsData, S05PhotosData,
    S06VoiceData, S07LetterData, S08EchoData, S10YouData, S11DaisukiData, S13OyasumiData,
} from './api';

export interface CopyLine {
    key: string;
    params?: Record<string, string | number>;
}

/** Her raw text with the nickname placeholder replaced. */
export function withNickname(text: string, nickname: string): string {
    return replaceNickname(text, nickname);
}

/** `YYYY-MM-DD` (a JST calendar day) as a localized month and day, or null. */
export function formatMonthDay(day: string, lang: string): string | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!m) return null;
    const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return new Intl.DateTimeFormat(lang, { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
}

/**
 * A UTC ISO timestamp as a JST time of day, `HH:MM` with a leading zero ("01:47"), or null. A
 * message's clock time is metadata, so it does not count against the one-number-per-slide rule.
 */
export function formatTimeOfDay(ts: string, lang: string): string | null {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat(lang, {
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: JST_TIME_ZONE,
    }).format(date);
}

/** A UTC ISO timestamp as a JST clock with seconds ("0:00:07"), or null. */
export function formatClock(ts: string, lang: string): string | null {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat(lang, {
        hour: 'numeric', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: JST_TIME_ZONE,
    }).format(date);
}

export function s01Copy(
    data: S01FirstData, member: RecapMemberBlock, year: number, lang: string,
): { title: CopyLine; sub: CopyLine | null } {
    const joinedDay = data.joined_this_year && member.subscription_start
        ? formatMonthDay(member.subscription_start, lang)
        : null;
    if (joinedDay) return { title: { key: 'recap.s01.joined', params: { year, date: joinedDay } }, sub: null };
    const years = member.years_together;
    return {
        title: { key: 'recap.s01.title', params: { year } },
        sub: years && years > 0 ? { key: 'recap.s01.sub', params: { count: years } } : null,
    };
}

export function s02Copy(data: S02NameData): { title: CopyLine; count: CopyLine } {
    const title = { key: data.mode === 'daisuki' ? 'recap.s02.daisukiTitle' : 'recap.s02.title' };
    // A single occurrence never prints "1回". In daisuki mode she never wrote the fan's name,
    // so its single line speaks only of the 大好き, never of a name being called.
    if (data.single || data.count <= 1) {
        return { title, count: { key: data.mode === 'daisuki' ? 'recap.s02.daisukiSingle' : 'recap.s02.single' } };
    }
    const key = data.mode === 'daisuki' ? 'recap.s02.daisuki' : 'recap.s02.count';
    return { title, count: { key, params: { count: data.count } } };
}

type DayPart = 'night' | 'noon' | 'morning';

/** The part of the day of a JST hour, with the backend's bands (morning 5-10, noon 11-16, night 17-4). */
function dayPart(hour: number): DayPart {
    if (hour >= 5 && hour <= 10) return 'morning';
    if (hour >= 11 && hour <= 16) return 'noon';
    return 'night';
}

const DAY_PART_TITLE: Record<DayPart, string> = {
    night: 'recap.s03.titleNight', noon: 'recap.s03.titleNoon', morning: 'recap.s03.titleMorning',
};

/** The longest streak line appears from this many days (the spec: "if ≥ 7"). */
export const STREAK_MIN_DAYS = 7;

/**
 * s03. The title follows the peak hour's part of the day; a flat day (`band`)
 * has no peak to glow, so it takes the band and says her words were there at
 * every hour. The streak is the slide's one number.
 */
export function s03Copy(data: S03ClockData): { title: CopyLine; lead: CopyLine | null; streak: CopyLine | null; glow: boolean } {
    const flat = data.band !== undefined;
    const part = data.band ?? dayPart(data.peak_hour);
    let lead: CopyLine | null = null;
    if (flat) lead = { key: 'recap.s03.flat' };
    else if (data.representative) lead = { key: 'recap.s03.peak' };
    const streak = data.longest_streak !== null && data.longest_streak >= STREAK_MIN_DAYS
        ? { key: 'recap.s03.streak', params: { count: data.longest_streak } }
        : null;
    return { title: { key: DAY_PART_TITLE[part] }, lead, streak, glow: !flat };
}

const VARIANT_SUFFIX: Record<S04GreetingsData['variant'], string> = {
    oyasumi: 'Oyasumi', arigato: 'Arigato', otsukare: 'Otsukare',
};

/**
 * s04. The spec title 「おはようと、おやすみ」 only when both really are an
 * おはよう and an おやすみ; otherwise a title that names neither word. The
 * evening message is the latest one by clock time, so its label says so and
 * never "the latest of the year". A count below 2 is never shown.
 */
export function s04Copy(
    data: S04GreetingsData, fallback: string | null,
): { title: CopyLine; morning: CopyLine | null; evening: CopyLine | null; count: CopyLine | null } {
    const ohayo = fallback !== 'morning';
    const hasMorning = data.first_ohayo !== null;
    const hasEvening = data.latest_oyasumi !== null;
    const suffix = VARIANT_SUFFIX[data.variant];
    let title: string;
    if (hasMorning && hasEvening) title = ohayo && data.variant === 'oyasumi' ? 'recap.s04.title' : 'recap.s04.titleDay';
    else title = hasMorning ? 'recap.s04.titleMorning' : 'recap.s04.titleEvening';
    const count = hasEvening && data.oyasumi_count !== null && data.oyasumi_count >= 2
        ? { key: `recap.s04.count${suffix}`, params: { count: data.oyasumi_count } }
        : null;
    return {
        title: { key: title },
        morning: hasMorning ? { key: ohayo ? 'recap.s04.firstOhayo' : 'recap.s04.firstMorning' } : null,
        evening: hasEvening ? { key: `recap.s04.latest${suffix}` } : null,
        count,
    };
}

/** s05. No number: the mostly-bursts line under a fanned burst, or the best-photo line under the single photo. */
export function s05Copy(data: S05PhotosData): { title: CopyLine; line: CopyLine | null } {
    // Follow what the slide shows: a fan needs burst items with media, the best photo needs its media.
    // The mostly-bursts line sits only under a fanned burst, never under one photo.
    const fanned = data.burst.some((m) => m.media_url);
    let line: CopyLine | null = null;
    if (fanned) line = data.mostly_bursts ? { key: 'recap.s05.mostlyBursts' } : null;
    else if (data.best_photo?.media_url) line = { key: 'recap.s05.bestPhoto' };
    return { title: { key: 'recap.s05.title' }, line };
}

/** s06. Video audio says where the voice came from; otherwise the voice count (from 2) is the one number. */
export function s06Copy(data: S06VoiceData, fallback: string | null): { title: CopyLine; sub: CopyLine | null } {
    let sub: CopyLine | null = null;
    if (fallback === 'video') sub = { key: 'recap.s06.video' };
    else if (data.voice_count !== null && data.voice_count >= 2) sub = { key: 'recap.s06.count', params: { count: data.voice_count } };
    return { title: { key: 'recap.s06.title' }, sub };
}

/** A count grouped in the UI language ("1,240"). */
export function formatCount(n: number, lang: string): string {
    return new Intl.NumberFormat(lang).format(n);
}

/** The JST month and day of a UTC ISO timestamp ("07-30"), or null. */
function jstMonthDay(ts: string): string | null {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', { month: '2-digit', day: '2-digit', timeZone: JST_TIME_ZONE }).format(date);
}

/**
 * Length of her letter as the fan reads it: after the nickname replacement, in code points (as
 * the backend's `len()`), so the count matches the text on the paper. The backend's `char_count`
 * counts the raw `%%%` and is not shown.
 */
export function letterCharCount(text: string, nickname: string): number {
    return Array.from(withNickname(text, nickname)).length;
}

/** s07. The count of the letter (after the nickname replacement) is the one number. */
export function s07Copy(data: S07LetterData, nickname: string, lang: string): { title: CopyLine; count: CopyLine | null } {
    const text = data.message?.text;
    const n = text ? letterCharCount(text, nickname) : 0;
    return {
        title: { key: 'recap.s07.title' },
        count: n > 0 ? { key: 'recap.s07.count', params: { count: n, n: formatCount(n, lang) } } : null,
    };
}

/**
 * s08. "The same day" only when both messages really share the JST month and day; the backend
 * also pairs messages by keyword alone. Years apart is the one number (in the title on the same
 * day, else in the line when no keyword is shared). `first_week`: the fan's first week with her
 * messages and now, no number. Without a known subscription start the backend counts the week
 * from the archive's first message, so the copy says "the first week on record", never "your".
 */
export function s08Copy(data: S08EchoData, subscriptionStart: string | null): {
    title: CopyLine; line: CopyLine | null; thenLabel: CopyLine | null; nowLabel: CopyLine | null;
} {
    if (data.mode === 'first_week') {
        const yours = !!subscriptionStart;
        return {
            title: { key: yours ? 'recap.s08.firstWeekTitle' : 'recap.s08.firstRecordedWeekTitle' }, line: null,
            thenLabel: { key: yours ? 'recap.s08.firstWeek' : 'recap.s08.firstRecordedWeek' }, nowLabel: { key: 'recap.s08.now' },
        };
    }
    const thenDay = data.then ? jstMonthDay(data.then.ts) : null;
    const sameDay = thenDay !== null && data.now !== null && thenDay === jstMonthDay(data.now.ts);
    const years = data.years_apart !== null && data.years_apart >= 1 ? data.years_apart : null;
    const keyword: CopyLine | null = data.shared_keyword ? { key: 'recap.s08.keyword' } : null;
    if (sameDay && years !== null) {
        const title = years === 1 ? { key: 'recap.s08.title' } : { key: 'recap.s08.titleYears', params: { count: years } };
        return { title, line: keyword, thenLabel: null, nowLabel: null };
    }
    const line = keyword ?? (years !== null ? { key: 'recap.s08.years', params: { count: years } } : null);
    return { title: { key: 'recap.s08.titleEcho' }, line, thenLabel: null, nowLabel: null };
}

/** Seconds after JST midnight as a clock with seconds ("0:00:07"), or null when out of range. */
export function formatSecondsOfDay(seconds: number): string | null {
    if (!Number.isInteger(seconds) || seconds < 0 || seconds >= 86400) return null;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function s09Copy(): { title: CopyLine } {
    return { title: { key: 'recap.s09.title' } };
}

const STUB_LABEL: Record<RecapStub['kind'], string> = {
    birthday: 'recap.s09.birthday', christmas: 'recap.s09.christmas',
    newyear: 'recap.s09.newyear', anniversary: 'recap.s09.anniversary',
};

/**
 * One s09 ticket stub. A sealed stub has only its opening line. The anniversary is the fan's own
 * day: its note says only that her words arrived that day too, never that she knew it.
 */
export function s09StubCopy(stub: RecapStub): { label: CopyLine; sealed: CopyLine | null; note: CopyLine | null } {
    return {
        label: { key: STUB_LABEL[stub.kind] },
        sealed: stub.sealed ? { key: 'recap.s09.sealed' } : null,
        note: !stub.sealed && stub.kind === 'anniversary' ? { key: 'recap.s09.anniversaryNote' } : null,
    };
}

/** The current calendar year in JST, the time zone the recap's year is cut in. */
export function currentJstYear(now: Date = new Date()): number {
    return Number(new Intl.DateTimeFormat('en-CA', { year: 'numeric', timeZone: JST_TIME_ZONE }).format(now));
}

/**
 * s10, the fan's own traces. One number: the favourites count, else the letters count; letters
 * beside a favourites count get a label instead of their count. The first star's day shows only when its time was logged
 * (`favorited_at`); the message time that stands in for older stars is not the day it was starred.
 * Invite: forward-looking lines, never a claim about her seeing anything. Its "next year" title
 * holds only for the running year's recap; a past year's recap (its next year has already come)
 * gets the year-free "from here on" title.
 */
export function s10Copy(data: S10YouData, year: number, now: Date = new Date()): {
    title: CopyLine; stat: CopyLine | null; lettersLabel: CopyLine | null;
    firstFavorite: boolean; invite: CopyLine[];
} {
    if (data.invite) {
        const past = year < currentJstYear(now);
        return {
            title: { key: past ? 'recap.s10.inviteTitleLater' : 'recap.s10.inviteTitle' }, stat: null, lettersLabel: null,
            firstFavorite: false, invite: [{ key: 'recap.s10.inviteFavorites' }, { key: 'recap.s10.inviteLetters' }],
        };
    }
    const favs = data.favorites_count !== null && data.favorites_count > 0 ? data.favorites_count : null;
    const letters = data.letters_count !== null && data.letters_count > 0 && data.letters.length > 0 ? data.letters_count : null;
    let stat: CopyLine | null = null;
    if (favs !== null) stat = { key: 'recap.s10.favorites', params: { count: favs } };
    else if (letters !== null) stat = { key: 'recap.s10.letters', params: { count: letters } };
    return {
        title: { key: 'recap.s10.title' },
        stat,
        lettersLabel: favs !== null && letters !== null ? { key: 'recap.s10.lettersLabel' } : null,
        firstFavorite: favs !== null && !!data.first_favorite?.favorited_at,
        invite: [],
    };
}

/** s11. The joy variant's petals are not all 大好き / ありがとう, so its title names neither. */
export function s11Copy(data: S11DaisukiData): { title: CopyLine } {
    return { title: { key: data.variant === 'joy' ? 'recap.s11.joyTitle' : 'recap.s11.title' } };
}

export function s12Copy(year: number): { title: CopyLine } {
    return { title: { key: 'recap.s12.title', params: { year } } };
}

/**
 * s13. Graduated in the year: her last message ("最後のメッセージ"). The
 * `last_text` fallback (no おやすみ at all) never calls the message an おやすみ.
 * The 「来年も、よろしくね。」 narration plays on the running year's and the just-ended year's
 * recap; an older recap (`year` before the current JST year minus one) shows no narration line.
 */
export function s13Copy(
    data: S13OyasumiData, fallback: string | null, year: number, now: Date = new Date(),
): { title: CopyLine; note: CopyLine | null; narration: CopyLine | null } {
    if (data.graduated) {
        return { title: { key: 'recap.s13.graduatedTitle' }, note: null, narration: { key: 'recap.s13.graduatedLine' } };
    }
    const lastText = fallback === 'last_text';
    if (data.final) {
        return {
            title: { key: lastText ? 'recap.s13.lastTextTitle' : 'recap.s13.title', params: { year } },
            note: null,
            narration: year < currentJstYear(now) - 1 ? null : { key: 'recap.s13.narration' },
        };
    }
    return {
        title: { key: lastText ? 'recap.s13.lastTextPartialTitle' : 'recap.s13.partialTitle' },
        note: { key: lastText ? 'recap.s13.lastTextPartialNote' : 'recap.s13.partialNote' },
        narration: null,
    };
}
