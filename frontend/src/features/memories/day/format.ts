import { dateTimeFormat } from '../../../utils/intlCache';

/** `YYYY-MM-DD` as a calendar date (UTC midnight, so the day never shifts), or null. */
function utcDay(day: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

/** A day heading with the weekday in the UI language ("2024年9月14日(土)"), or the raw string. */
export function formatDayHeading(day: string, lang: string): string {
    const date = utcDay(day);
    if (!date) return day;
    return dateTimeFormat(lang, {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC',
    }).format(date);
}

/** An `MM-DD` month-day in the UI language ("9月14日" / "September 14"). */
export function formatMonthDayLabel(monthDay: string, lang: string): string {
    const date = utcDay(`2000-${monthDay}`);
    if (!date) return monthDay;
    return dateTimeFormat(lang, { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
}

/** A short day with its weekday in the UI language ("11/1(土)" / "Sat, 11/1"), or the raw string. */
export function formatShortDayWeekday(day: string, lang: string): string {
    const date = utcDay(day);
    if (!date) return day;
    return dateTimeFormat(lang, { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'UTC' }).format(date);
}
