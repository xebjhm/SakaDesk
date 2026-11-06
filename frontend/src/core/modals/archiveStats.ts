import { useEffect, useState } from 'react';
import { clientLog } from '../../utils/clientLog';
import { fromLocalDateStr, toLocalDateStr } from '../../utils/dateFormatters';

/** About's "your archive" numbers (decision D9). */
export interface ArchiveStats {
    messages: number;
    photos: number;
    /** Calendar days the archive spans; `null` when the earliest message time is unknown (shown as "—"). */
    days: number | null;
}

export type ArchiveStatsState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; stats: ArchiveStats };

const DAY_MS = 86_400_000;

/**
 * Calendar days from the earliest archived message to today, both counted (local dates, so the
 * number changes at the user's midnight); `null` when the earliest time is missing or unreadable
 * (an empty archive, or messages without a readable time), so the caller shows "—", not 0.
 */
export function archiveDays(firstMessageAt: string | null, now: Date): number | null {
    if (!firstMessageAt) return null;
    const first = fromLocalDateStr(toLocalDateStr(firstMessageAt));
    const today = fromLocalDateStr(toLocalDateStr(now));
    if (!first || !today) return null;
    // Rounded: a daylight-saving day is 23 or 25 hours long.
    return Math.max(1, Math.round((today.getTime() - first.getTime()) / DAY_MS) + 1);
}

/** Loads `GET /api/archive/stats` each time `isOpen` becomes true; one `archive_stats_load` breadcrumb per load. */
export function useArchiveStats(isOpen: boolean): ArchiveStatsState {
    const [state, setState] = useState<ArchiveStatsState>({ status: 'loading' });
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setState({ status: 'loading' });
        (async () => {
            try {
                const res = await fetch('/api/archive/stats');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json() as { messages?: number; photos?: number; first_message_at?: string | null };
                if (cancelled) return;
                setState({
                    status: 'ready',
                    stats: { messages: data.messages ?? 0, photos: data.photos ?? 0, days: archiveDays(data.first_message_at ?? null, new Date()) },
                });
                clientLog('archive_stats_load', { outcome: 'ok' });
            } catch {
                if (cancelled) return;
                setState({ status: 'error' });
                clientLog('archive_stats_load', { outcome: 'failed' });
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen]);
    return state;
}
