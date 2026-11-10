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
