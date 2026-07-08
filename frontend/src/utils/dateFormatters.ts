// src/utils/dateFormatters.ts
// Shared timezone-consistent date helpers.

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
  const d = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
