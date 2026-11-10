/**
 * The Tokyo wall clock of every Memories view: her messages are shown on JST, whatever the
 * machine's zone (the recap's year is a JST calendar year too).
 */

/** Japan has no daylight saving time: JST is always UTC+9. */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** The IANA zone of every Memories clock (hand it to `MessageBubble`'s `timeZone`). */
export const JST_TIME_ZONE = 'Asia/Tokyo';

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

/**
 * A UTC ISO timestamp as its JST calendar day ("8月21日", or "2026年8月21日" with the year), or
 * null. A message's date is metadata, not a screen's number.
 */
export function formatMessageDate(ts: string, lang: string, withYear = false): string | null {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat(lang, {
        ...(withYear ? { year: 'numeric' } : {}), month: 'long', day: 'numeric', timeZone: JST_TIME_ZONE,
    }).format(date);
}

/**
 * A localized JST date formatter (`year`, short `month`, `day`; with `time`, also `HH:MM`) for
 * labels such as a print's date. Build it once per language (`useMemo`).
 */
export function jstDateFormat(language: string, { time = false }: { time?: boolean } = {}): Intl.DateTimeFormat {
    return new Intl.DateTimeFormat(language, {
        timeZone: JST_TIME_ZONE,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
    });
}

/** A JST wall-clock slot `HH:MM` (24 h, ASCII digits only: full-width digits are refused). */
const JST_SLOT_RE = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

/** True when `value` is a well-formed JST slot `HH:MM` (24 h, ASCII digits). */
export function isJstSlot(value: string): boolean {
    return JST_SLOT_RE.test(value);
}

/**
 * The local `HH:MM` (24 h) of today's JST slot `hhmm` in `timeZone` (default: the machine's
 * resolved zone), for the Settings hint beside a JST time. Today is the JST calendar day at
 * `now`; `Intl.DateTimeFormat` resolves the zone's offset on that instant, so DST follows the
 * date. null when the zone is Asia/Tokyo (the hint would repeat the value) or `hhmm` is malformed.
 */
export function jstSlotToLocal(
    hhmm: string,
    { now = new Date(), timeZone }: { now?: Date; timeZone?: string } = {},
): string | null {
    const match = JST_SLOT_RE.exec(hhmm);
    if (!match) return null;
    const zone = timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone === JST_TIME_ZONE) return null;
    const { year, month, day } = jstNow(now);
    const instant = Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2])) - JST_OFFSET_MS;
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(instant));
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
    return `${hour}:${minute}`;
}
