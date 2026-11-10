import { jstNow } from '../recap/availability';

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's `MM-DD` in JST (the archive's calendar). */
export function todayMonthDay(now: Date = new Date()): string {
    const { month, day } = jstNow(now);
    return `${pad(month)}-${pad(day)}`;
}

/** The `MM-DD` `delta` days from `monthDay`, over a leap year (02-29 is a day of its own). */
export function shiftMonthDay(monthDay: string, delta: number): string {
    const [month, day] = monthDay.split('-').map(Number);
    const d = new Date(Date.UTC(2000, month - 1, day + delta));
    return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The local `Date` of `monthDay` in this JST year (where the date picker opens); 02-29 rolls to 03-01 in a common year. */
export function monthDayInThisYear(monthDay: string, now: Date = new Date()): Date {
    const [month, day] = monthDay.split('-').map(Number);
    return new Date(jstNow(now).year, month - 1, day);
}
