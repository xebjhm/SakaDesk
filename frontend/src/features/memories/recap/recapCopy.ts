/**
 * Maps recap slide data to i18n keys and parameters (pure; the slides call `t`).
 *
 * Years are always a `{{year}}` parameter (the payload's year), never part of
 * the copy. Dates and clocks are shown in JST, the time zone the recap is
 * computed in (a New Year 0:00 message stays 0:00).
 */
import { replaceNickname } from '../../messages/utils/nickname';
import type {
    RecapClip, RecapMemberBlock, S01FirstData, S02NameData, S03ClockData, S04GreetingsData, S05PhotosData,
    S06VoiceData, S13OyasumiData,
} from './api';

export interface CopyLine {
    key: string;
    params?: Record<string, string | number>;
}

const RECAP_TIME_ZONE = 'Asia/Tokyo';

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

/** A UTC ISO timestamp as a JST clock with seconds ("0:00:07"), or null. */
export function formatClock(ts: string, lang: string): string | null {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat(lang, {
        hour: 'numeric', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: RECAP_TIME_ZONE,
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

/** s05. No number: the mostly-bursts line, or the best-photo fallback's own line. */
export function s05Copy(data: S05PhotosData, fallback: string | null): { title: CopyLine; line: CopyLine | null } {
    let line: CopyLine | null = null;
    if (data.mostly_bursts) line = { key: 'recap.s05.mostlyBursts' };
    else if (fallback === 'best_photo' || (data.burst.length === 0 && data.best_photo)) line = { key: 'recap.s05.bestPhoto' };
    return { title: { key: 'recap.s05.title' }, line };
}

/** s06. Video audio says where the voice came from; otherwise the voice count (from 2) is the one number. */
export function s06Copy(data: S06VoiceData, fallback: string | null): { title: CopyLine; sub: CopyLine | null } {
    let sub: CopyLine | null = null;
    if (fallback === 'video') sub = { key: 'recap.s06.video' };
    else if (data.voice_count !== null && data.voice_count >= 2) sub = { key: 'recap.s06.count', params: { count: data.voice_count } };
    return { title: { key: 'recap.s06.title' }, sub };
}

/** Opening length when the payload has no end: ~6 s of each of three, 12 s of a single one (the backend's values). */
const CLIP_SECONDS = 6;
const SINGLE_CLIP_SECONDS = 12;

/** The part of the media a clip plays, in seconds. A missing or inverted end takes the default length. */
export function clipWindow(clip: RecapClip, total: number): { start: number; end: number } {
    const start = clip.start ?? 0;
    const length = total === 1 ? SINGLE_CLIP_SECONDS : CLIP_SECONDS;
    const end = clip.end !== null && clip.end > start ? clip.end : start + length;
    return { start, end };
}

export function s12Copy(year: number): { title: CopyLine } {
    return { title: { key: 'recap.s12.title', params: { year } } };
}

/**
 * s13. Graduated in the year: her last message ("最後のメッセージ"). The
 * `last_text` fallback (no おやすみ at all) never calls the message an おやすみ.
 */
export function s13Copy(
    data: S13OyasumiData, fallback: string | null, year: number,
): { title: CopyLine; note: CopyLine | null; narration: CopyLine | null } {
    if (data.graduated) {
        return { title: { key: 'recap.s13.graduatedTitle' }, note: null, narration: { key: 'recap.s13.graduatedLine' } };
    }
    const lastText = fallback === 'last_text';
    if (data.final) {
        return {
            title: { key: lastText ? 'recap.s13.lastTextTitle' : 'recap.s13.title', params: { year } },
            note: null,
            narration: { key: 'recap.s13.narration' },
        };
    }
    return {
        title: { key: lastText ? 'recap.s13.lastTextPartialTitle' : 'recap.s13.partialTitle' },
        note: { key: lastText ? 'recap.s13.lastTextPartialNote' : 'recap.s13.partialNote' },
        narration: null,
    };
}
