import React, { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import type { MemoriesRoute } from '../MemoriesFeature';
import { fetchSameTime, MemoriesFetchError, MemoriesTimeoutError } from '../api';
import { formatMonthDayLabel } from '../day/format';
import { logMemoriesLoad, logMemoriesSkip } from '../memoriesLog';
import { formatJstClock, jstNow } from '../shared/jst';
import { MemoryText } from '../shared/MemoryText';
import type { SameTimeMoment } from '../types';

interface SameTimeLineProps {
    service: string;
    /** The hub's `same_time` (this minute's moment), or null. */
    initial: SameTimeMoment | null;
    go: (next: MemoriesRoute) => void;
}

const MINUTE_MS = 60_000;
/** Past the boundary, so the backend's clock has turned too. */
const BOUNDARY_SLACK_MS = 250;

/** JST minutes are UTC minutes (whole-hour offset): the minute index of an epoch time. */
const minuteOf = (ms: number) => Math.floor(ms / MINUTE_MS);
const msToNextMinute = (ms: number) => MINUTE_MS - (ms % MINUTE_MS) + BOUNDARY_SLACK_MS;
const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

/**
 * 同じ時刻 (spec 14.3), a quiet hub line: 「いま {{clock}}」 (now, JST) ·
 * 「{{year}}年のこの時刻、{{name}}は」 (「{{date}}のこの時刻、…」 for a moment of this JST year) ·
 * her words on one line. The year and date are the message's real ones (metadata, never chosen
 * for the fan). Click opens that day (`{page: 'day', date}`).
 *
 * It starts from the hub's moment and refetches `fetchSameTime` at each minute boundary with one
 * `setTimeout` at a time, only while the window is visible: hidden, the timer is cleared and the
 * request aborted; shown again, it refetches at once when the minute has turned, then re-arms.
 * Unmount aborts and clears everything. It renders nothing while there is no moment.
 * Logs `memories_load` `same_time` only for failures, and `memories_skip` `same_time_none` when
 * a shown moment goes away (never once a minute while nothing changes).
 */
export const SameTimeLine: React.FC<SameTimeLineProps> = ({ service, initial, go }) => {
    const { t, i18n } = useTranslation();
    const [moment, setMoment] = useState<SameTimeMoment | null>(initial);
    const [now, setNow] = useState(() => Date.now());
    const shownRef = useRef(initial !== null);

    // A new hub payload (a reload, another service) replaces the line.
    useEffect(() => {
        setMoment(initial);
        shownRef.current = initial !== null;
        setNow(Date.now());
    }, [initial]);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let controller: AbortController | null = null;
        let lastMinute = minuteOf(Date.now());

        const clear = () => {
            if (timer !== null) clearTimeout(timer);
            timer = null;
        };
        const refetch = () => {
            controller?.abort();
            const c = new AbortController();
            controller = c;
            lastMinute = minuteOf(Date.now());
            fetchSameTime(service, c.signal).then(
                (next) => {
                    if (c.signal.aborted) return;
                    if (next === null && shownRef.current) logMemoriesSkip('same_time', 'same_time_none');
                    shownRef.current = next !== null;
                    setMoment(next);
                },
                (err: unknown) => {
                    if (c.signal.aborted || isAbort(err)) return;
                    // The line keeps its last moment (still within minutes of now).
                    if (err instanceof MemoriesTimeoutError) logMemoriesLoad('same_time', 'timeout');
                    else logMemoriesLoad('same_time', 'error', err instanceof MemoriesFetchError ? { error_code: err.httpStatus } : {});
                },
            );
        };
        const arm = () => {
            clear();
            if (document.visibilityState === 'hidden') return;
            timer = setTimeout(() => {
                timer = null;
                setNow(Date.now());
                refetch();
                arm();
            }, msToNextMinute(Date.now()));
        };
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') {
                clear();
                controller?.abort();
                return;
            }
            if (minuteOf(Date.now()) !== lastMinute) {
                setNow(Date.now());
                refetch();
            }
            arm();
        };

        arm();
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            clear();
            controller?.abort();
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [service]);

    if (!moment) return null;
    const thisYear = moment.year === jstNow(new Date(now)).year;
    const label = thisYear
        ? t('memories.sameTime.thisYear', { date: formatMonthDayLabel(moment.date.slice(5), i18n.language), name: moment.name })
        : t('memories.sameTime.pastYear', { year: moment.year, name: moment.name });
    const words = moment.message.text ?? moment.message.caption;

    return (
        <button
            type="button"
            data-testid="memories-same-time"
            onClick={() => go({ page: 'day', date: moment.date })}
            className="flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-1 text-left text-small text-secondary transition-colors duration-fast ease-standard hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
            <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted" />
            <span className="shrink-0 tabular-nums text-muted">{t('memories.sameTime.now', { clock: formatJstClock(now) })}</span>
            <span aria-hidden="true" className="shrink-0 text-muted">·</span>
            <span className="shrink-0">{label}</span>
            {words && <MemoryText as="span" text={words} className="min-w-0 flex-1 truncate whitespace-nowrap text-primary" />}
        </button>
    );
};
