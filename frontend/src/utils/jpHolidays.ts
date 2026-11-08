/**
 * Japanese public holidays (祝日), offline: the `@holiday-jp/holiday_jp` dataset bundled with the
 * app (1970–2050, including substitute and citizens' holidays). No network access.
 */
import holidayJp from '@holiday-jp/holiday_jp';
import { toLocalDateStr } from './dateFormatters';

const HOLIDAYS = holidayJp.holidays as Readonly<Record<string, { name: string } | undefined>>;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The Japanese name of the public holiday on a calendar day (e.g. "文化の日"), or null when the
 * day is not a holiday, is invalid or is outside the dataset. A `Date` is read by its LOCAL
 * calendar day (the calendar grid's days); a string must be a local "YYYY-MM-DD" day.
 */
export function holidayName(date: Date | string): string | null {
    const key = typeof date === 'string' ? date : toLocalDateStr(date);
    if (!DAY_KEY.test(key)) return null;
    // The key is digits only, so it can never reach an Object.prototype member.
    return HOLIDAYS[key]?.name ?? null;
}
