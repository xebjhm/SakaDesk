/**
 * Maps recap slide data to i18n keys and parameters (pure; the slides call `t`).
 *
 * Years are always a `{{year}}` parameter (the payload's year), never part of
 * the copy. Dates and clocks are shown in JST, the time zone the recap is
 * computed in (a New Year 0:00 message stays 0:00).
 */
import { replaceNickname } from '../../messages/utils/nickname';
import type { RecapMemberBlock, S01FirstData, S02NameData, S13OyasumiData } from './api';

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
    if (data.single || data.count <= 1) return { title, count: { key: 'recap.s02.single' } };
    const key = data.mode === 'daisuki' ? 'recap.s02.daisuki' : 'recap.s02.count';
    return { title, count: { key, params: { count: data.count } } };
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
