/**
 * Year-end unlocks of the recap (spec §9.3), computed on the Tokyo wall clock
 * whatever the machine's zone: the recap's year is a JST calendar year.
 *
 * - The current year's recap opens on Dec 1 00:00 JST, as "{year}年の、ここまで" (partial).
 * - From Jan 1 00:00 JST the year just ended is shown first (the default selection).
 * - Before Dec 1 only past years are offered: the shelf of yearbooks, limited to
 *   years with data (`GET /api/memories/{service}/recap/years`).
 */

/** The first year the recap API accepts (`MIN_YEAR` in `backend/api/memories.py`). */
export const RECAP_MIN_YEAR = 2020;

/** Japan has no daylight saving time: JST is always UTC+9. */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** The IANA zone of every Memories clock (hand it to `MessageBubble`'s `timeZone`). */
export const JST_TIME_ZONE = 'Asia/Tokyo';

/** The month (1-12) the current year's recap opens. */
const OPEN_MONTH = 12;

export interface JstParts {
    year: number;
    /** 1-12. */
    month: number;
    day: number;
    hour: number;
    minute: number;
}

/** The wall clock in Asia/Tokyo at `now` (defaults to the current time). */
export function jstNow(now: Date = new Date()): JstParts {
    const t = new Date(now.getTime() + JST_OFFSET_MS);
    return {
        year: t.getUTCFullYear(),
        month: t.getUTCMonth() + 1,
        day: t.getUTCDate(),
        hour: t.getUTCHours(),
        minute: t.getUTCMinutes(),
    };
}

export interface RecapAvailability {
    /** The current JST year. */
    year: number;
    /** The current year's recap is open (Dec 1 00:00 JST onwards; it stays partial until Jan 1). */
    currentOpen: boolean;
    /** The newest year that may be offered. */
    maxYear: number;
    /** The year shown first when it has data: the current year in December, else the year just ended. */
    defaultYear: number;
}

/** Which recap years are open at `now` (defaults to the current time). */
export function recapAvailability(now: Date = new Date()): RecapAvailability {
    const { year, month } = jstNow(now);
    const currentOpen = month >= OPEN_MONTH;
    const maxYear = currentOpen ? year : year - 1;
    return { year, currentOpen, maxYear, defaultYear: maxYear };
}

/**
 * The years the entry offers, ascending. `dataYears` are the years with a recap
 * (the shelf); `null` when unknown (still loading or failed), which offers every
 * year from {@link RECAP_MIN_YEAR} up to the newest open one (a year without data
 * then shows the gentle empty state). Only the recap page uses that fallback: the
 * hub card waits for the shelf and offers a retry when it fails. The current year
 * is offered from Dec 1 even before it has data.
 */
export function offeredRecapYears(avail: RecapAvailability, dataYears: readonly number[] | null): number[] {
    if (dataYears === null) {
        const out: number[] = [];
        for (let y = RECAP_MIN_YEAR; y <= avail.maxYear; y += 1) out.push(y);
        return out;
    }
    const years = new Set(dataYears.filter((y) => y >= RECAP_MIN_YEAR && y < avail.year));
    if (avail.currentOpen) years.add(avail.year);
    return [...years].sort((a, b) => a - b);
}

/** The year to open first: the default year when offered, else the newest offered, else null (nothing open yet). */
export function defaultRecapYear(avail: RecapAvailability, offered: readonly number[]): number | null {
    if (offered.includes(avail.defaultYear)) return avail.defaultYear;
    return offered.length ? offered[offered.length - 1] : null;
}

/**
 * A timestamp's Tokyo wall-clock time as `HH:MM` (leading zeros), whatever the machine's zone:
 * Memories shows JST everywhere, like its JST dates. '' for an invalid timestamp.
 */
export function formatJstClock(ts: string | number | Date): string {
    const d = ts instanceof Date ? ts : new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const { hour, minute } = jstNow(d);
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** A timestamp's Tokyo calendar date as `YYYY-MM-DD` (the day view's date), or '' when invalid. */
export function formatJstDate(ts: string | number | Date): string {
    const d = ts instanceof Date ? ts : new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const { year, month, day } = jstNow(d);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
