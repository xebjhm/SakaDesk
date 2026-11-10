import { holidayName } from '../../utils/jpHolidays';

/** One cell of a month grid: a calendar day (local midnight), its `YYYY-MM-DD` and whether it is in the month. */
export interface MonthCell {
    date: Date;
    dateStr: string;
    inMonth: boolean;
}

/** Weeks × days of every month grid: six full weeks, so the grid never changes height. */
export const MONTH_GRID_CELLS = 42;

/** The weekday a day falls on, in calendar-tone terms: Sunday / 祝日 red, Saturday blue, else neutral. */
export type DayTone = 'holiday' | 'saturday';

/**
 * The text colour of each tone (fixed meanings, never the group accent: DESIGN_SYSTEM.md
 * "Date-search calendar"). Literal class names, so Tailwind sees them.
 */
export const DAY_TONE_CLASS: Record<DayTone, string> = {
    holiday: 'text-calendar-holiday',
    saturday: 'text-calendar-saturday',
};

/** `calendar.months.*` keys, January first. */
export const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

/** `YYYY-MM` of a year and a 0-based month. */
export const monthKey = (year: number, month0: number) => `${year}-${String(month0 + 1).padStart(2, '0')}`;

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` from the day's own year / month / day (no time zone applies). */
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * The Japanese wall-calendar grid of a month (`month0` is 0-based): 42 cells starting on the
 * Sunday on or before the 1st, the days around the month filled from the previous and next
 * months (`inMonth` false). Each cell's `date` is a local midnight built from its Y/M/D and
 * `dateStr` is read back from the same fields, so no time zone shifts a day.
 */
export function buildMonthGrid(year: number, month0: number): MonthCell[] {
    const first = new Date(year, month0, 1);
    const lead = first.getDay();
    return Array.from({ length: MONTH_GRID_CELLS }, (_, i) => {
        const date = new Date(year, month0, 1 - lead + i);
        return { date, dateStr: dayKey(date), inMonth: date.getMonth() === first.getMonth() };
    });
}

/** The tone of a weekday column (0 = Sunday): the weekday header's colour. */
export function weekdayTone(weekday: number): DayTone | null {
    if (weekday === 0) return 'holiday';
    if (weekday === 6) return 'saturday';
    return null;
}

/** A day's tone: Sundays and 祝日 (`holidayName`) are `holiday`, Saturdays `saturday`, else null. */
export function dayTone(date: Date): DayTone | null {
    if (holidayName(dayKey(date)) !== null) return 'holiday';
    return weekdayTone(date.getDay());
}
