// src/utils/dateFormatters.ts
// Shared timezone-consistent date helpers.
import { dateTimeFormat } from './intlCache';

/**
 * Format a timestamp (ISO string or Date) as a LOCAL calendar date "YYYY-MM-DD".
 *
 * SD-FE-CORE-02 (Theme C): message timestamps are stored as UTC ("...Z"), but
 * message bubbles render LOCAL time (`new Date(ts).getFullYear()/...`) and the
 * date-search calendar buckets by local date (backend `_local_date` + the
 * gallery-mode `formatLocalDate`). Bucketing/matching by the raw UTC prefix
 * (`timestamp.slice(0, 10)` / `startsWith`) put dots and jumps on the wrong day
 * near midnight for any non-UTC user (e.g. a JST idol message at 08:00 JST =
 * 23:00Z the previous day). Convert to the machine's local zone before slicing.
 *
 * Invalid timestamps yield an empty string so callers can skip them (rather than
 * throwing or matching everything).
 */
export function toLocalDateStr(timestamp: string | Date): string {
  const d = toValidDate(timestamp);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * The Date of a timestamp (ISO string or Date), or null when it cannot be parsed, so a
 * caller can skip it instead of formatting an Invalid Date (Intl throws a RangeError).
 */
export function toValidDate(timestamp: string | Date): Date | null {
  const d = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type DatePillKey = 'date.today' | 'date.yesterday';

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/**
 * Label for the floating date pill in timelines.
 *
 * Today / Yesterday come from i18n; otherwise month + day + weekday in the UI
 * locale, with the year added whenever the date is not in `now`'s year.
 * Compares local calendar days (timestamps stay UTC until display).
 */
export function formatDatePillLabel(
  date: Date,
  now: Date,
  locale: string,
  t: (key: DatePillKey) => string,
): string {
  if (isSameLocalDay(date, now)) return t('date.today');
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (isSameLocalDay(date, yesterday)) return t('date.yesterday');
  const options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', weekday: 'short' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return dateTimeFormat(locale, options).format(date);
}

/** Local midnight of a "YYYY-MM-DD" from toLocalDateStr; null for anything else. */
export function fromLocalDateStr(date: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Blog date styles: card and older/newer (short), rail tooltip (medium), reader (long). */
export type BlogDateStyle = 'short' | 'medium' | 'long';

const BLOG_DATE_OPTIONS: Record<BlogDateStyle, Intl.DateTimeFormatOptions> = {
  short: { month: 'short', day: 'numeric' },
  medium: { year: 'numeric', month: 'short', day: 'numeric' },
  long: { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
};

/**
 * A blog date in the app language (pass i18n.language). '' for an invalid date; an
 * invalid locale tag falls back to the runtime default.
 */
export function formatBlogDate(date: Date, locale: string | undefined, style: BlogDateStyle): string {
  if (Number.isNaN(date.getTime())) return '';
  try {
    return dateTimeFormat(locale, BLOG_DATE_OPTIONS[style]).format(date);
  } catch {
    return dateTimeFormat(undefined, BLOG_DATE_OPTIONS[style]).format(date);
  }
}
