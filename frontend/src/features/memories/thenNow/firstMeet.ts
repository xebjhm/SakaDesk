/** Pure helpers of 初見と今 (kept out of the component file for fast refresh). */
import type { TFunction } from 'i18next';
import type { FirstMeetRow } from '../types';

/** The time between the two sides: 「1 年 8 天」, 「1 年」 or 「8 天」 (never 0: the sides are on different days). */
export function formatElapsed(t: TFunction, elapsed: FirstMeetRow['elapsed']): string {
    const { years, days } = elapsed;
    if (years > 0 && days > 0) {
        return t('memories.thenNow.elapsedJoin', {
            years: t('memories.thenNow.elapsedYears', { count: years }),
            days: t('memories.thenNow.elapsedDays', { count: days }),
        });
    }
    if (years > 0) return t('memories.thenNow.elapsedYears', { count: years });
    return t('memories.thenNow.elapsedDays', { count: days });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The voice row's length change, now minus then, in whole seconds: 「長了 33 秒」 / 「短了 5 秒」,
 * or null when either length is unknown or they differ by less than a second.
 */
export function voiceDelta(t: TFunction, row: FirstMeetRow): string | null {
    if (row.kind !== 'voice') return null;
    const a = row.then.duration_s;
    const b = row.now.duration_s;
    if (a === null || b === null) return null;
    const diff = Math.round(b - a);
    if (diff === 0) return null;
    return t(diff > 0 ? 'memories.thenNow.voiceLonger' : 'memories.thenNow.voiceShorter', { count: Math.abs(diff) });
}

/**
 * The panel's subtitle: the span from her earliest first to her latest recent message,
 * 「從最初到現在・相隔約 N 年」, in months under a year (never 0: at least one month).
 */
export function spanLine(t: TFunction, rows: FirstMeetRow[]): string | null {
    if (!rows.length) return null;
    const first = Math.min(...rows.map((r) => Date.parse(r.then.ts)));
    const last = Math.max(...rows.map((r) => Date.parse(r.now.ts)));
    if (Number.isNaN(first) || Number.isNaN(last)) return null;
    const days = (last - first) / DAY_MS;
    const years = Math.round(days / 365);
    if (years >= 1) return t('memories.thenNow.spanYears', { count: years });
    return t('memories.thenNow.spanMonths', { count: Math.max(1, Math.round(days / 30)) });
}
