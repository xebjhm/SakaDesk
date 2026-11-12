/**
 * Maps the year poster's data to i18n keys and parameters (pure; `PosterView` calls `t`).
 *
 * The poster carries up to three relationship numbers (spec §9.4), each phrased
 * as something that happened between her words and the fan's day, never a total
 * message count. A message's date or clock time is metadata, not a number.
 */
import type { PosterNumberKey, RecapPoster } from './api';
import type { CopyLine } from './recapCopy';

/** The poster shows at most this many numbers (spec §9.4). */
export const POSTER_MAX_NUMBERS = 3;
/** "N年目" appears from the second year; a first year says nothing about years. */
export const POSTER_YEARS_MIN = 2;

const NUMBER_KEYS: Record<PosterNumberKey, string> = {
    nickname: 'recap.poster.numbers.nickname',
    oyasumi: 'recap.poster.numbers.oyasumi',
    photos: 'recap.poster.numbers.photos',
    voice: 'recap.poster.numbers.voice',
    daisuki: 'recap.poster.numbers.daisuki',
};

/** The numbers to show, in the payload's priority order: known keys only, never a zero, at most three. */
export function posterNumbers(poster: RecapPoster): CopyLine[] {
    return poster.numbers
        .filter((n) => Object.prototype.hasOwnProperty.call(NUMBER_KEYS, n.key) && Number.isInteger(n.count) && n.count > 0)
        .slice(0, POSTER_MAX_NUMBERS)
        .map((n) => ({ key: NUMBER_KEYS[n.key], params: { count: n.count } }));
}

/** Years of receiving her messages, from the second year only. */
export function posterYears(years: number | null): CopyLine | null {
    return years !== null && years >= POSTER_YEARS_MIN ? { key: 'recap.poster.years', params: { count: years } } : null;
}

/** `YYYY-MM-DD` (a JST calendar day) as a localized date with its year, or null. */
export function formatFullDay(day: string, lang: string): string | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!m) return null;
    const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
}

/** "Subscribed since …": the fan's own subscription start, or null when unknown. */
export function posterSince(subscriptionStart: string | null, lang: string): CopyLine | null {
    const date = subscriptionStart ? formatFullDay(subscriptionStart, lang) : null;
    return date ? { key: 'recap.poster.since', params: { date } } : null;
}

/** The member id when it is a safe log code (`[a-z0-9_]{1,40}`), else undefined. */
export function safeMemberId(id: string): string | undefined {
    return /^[a-z0-9_]{1,40}$/.test(id) ? id : undefined;
}

/** The saved file's name: the year and the member id only, never a name. */
export function posterFilename(year: number, memberId: string): string {
    const id = safeMemberId(memberId);
    return id ? `sakadesk-recap-${year}-${id}.png` : `sakadesk-recap-${year}.png`;
}
