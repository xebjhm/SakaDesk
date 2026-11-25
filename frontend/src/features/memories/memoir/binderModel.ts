/** Pure helpers of the memoir and its binder (kept out of the component files for fast refresh). */
import { useTranslation } from '../../../i18n';
import type { BinderShelfKey } from '../types';
import type { CopyRef } from './cardCopy';

/** Shelf order (`cards.SHELVES`): the payload already follows it; this keeps it if it ever does not. */
export const SHELVES: readonly BinderShelfKey[] = [
    'first', 'anniversary', 'numbers', 'special', 'records', 'moments', 'you', 'change', 'graduation',
];

/** `YYYY-MM-DD` as a short numeric date in the UI language ("2024/9/14"), or the raw string. */
export function formatCardDate(day: string, lang: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!m) return day;
    const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' }).format(date);
}

/** Renders a copy reference. */
export function useCopy(): (ref: CopyRef) => string {
    const { t } = useTranslation();
    return (ref) => t(ref.key, ref.params);
}

/**
 * The voice chip's copy for `seconds`: 「声 {{h}}時間{{m}}分」, minutes only under an hour, hours
 * only on the hour, and null (hidden) under a minute or without a value, so it never reads 「0分」.
 */
export function voiceChip(seconds: number | null): CopyRef | null {
    if (!seconds || seconds < 60) return null;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (!h) return { key: 'memories.memoir.chipVoiceMinutes', params: { m } };
    if (!m) return { key: 'memories.memoir.chipVoiceHours', params: { h } };
    return { key: 'memories.memoir.chipVoice', params: { h, m } };
}
