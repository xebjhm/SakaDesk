/** `YYYY-MM-DD` as a calendar date (UTC midnight, so the day never shifts), or null. */
function utcDay(day: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

/** A day heading with the weekday in the UI language ("2024年9月14日(土)"), or the raw string. */
export function formatDayHeading(day: string, lang: string): string {
    const date = utcDay(day);
    if (!date) return day;
    return new Intl.DateTimeFormat(lang, {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC',
    }).format(date);
}

/** An `MM-DD` month-day in the UI language ("9月14日" / "September 14"). */
export function formatMonthDayLabel(monthDay: string, lang: string): string {
    const date = utcDay(`2000-${monthDay}`);
    if (!date) return monthDay;
    return new Intl.DateTimeFormat(lang, { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
}

/**
 * A message time as `HH:MM` on the local clock, the same clock as the chat's `MessageBubble`, so
 * the merged timeline and the lanes agree.
 */
export function formatClock(ts: string): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
