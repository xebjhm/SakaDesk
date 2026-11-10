import React, { useMemo, useState } from 'react';
import { CalendarDays, CalendarHeart, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Button, EmptyState, IconButton } from '../../../design/primitives';
import { CalendarModal } from '../../../core/modals/CalendarModal';
import type { CorePageProps, MemoriesRoute } from '../MemoriesFeature';
import { fetchOnThisDay } from '../api';
import { PageHeader } from '../shared/PageHeader';
import { LoadState } from '../shared/LoadState';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import { formatMonthDayLabel } from '../day/format';
import { YearStrip } from './YearStrip';
import { monthDayInThisYear, shiftMonthDay, todayMonthDay } from './monthDay';
import { OnThisDayDetail } from './OnThisDayDetail';
import type { OnThisDayYear } from '../types';

export type OnThisDayRoute = Extract<MemoriesRoute, { page: 'onThisDay' }>;

interface OnThisDayPageProps extends Omit<CorePageProps, 'route'> {
    route: OnThisDayRoute;
}

const pad = (n: number) => String(n).padStart(2, '0');

const isEditable = (el: EventTarget | null) =>
    el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/**
 * あの年の今日 (spec 6). Without `route.year` it is the overview (B): ‹ › step the month-day,
 * the date button picks any date, and the year strip shows the years with messages (a column
 * opens that year). With `route.year` it is the detail (A): the year list and that year's
 * 那一天 view, ← / → (and ‹ ›) stepping between years with messages (older / newer). One
 * request per month-day serves both.
 */
export const OnThisDayPage: React.FC<OnThisDayPageProps> = ({ service, route, go }) => {
    const { t, i18n } = useTranslation();
    const monthDay = route.monthDay ?? todayMonthDay();
    const [calendarOpen, setCalendarOpen] = useState(false);
    const query = useMemoriesQuery('on_this_day', (signal) => fetchOnThisDay(service, monthDay, signal), [service, monthDay], {
        count: (d) => d.years.filter((y) => y.has_messages).length,
    });
    const data = query.data;
    const years = useMemo(() => data?.years ?? [], [data]);
    // Stable across re-renders (the picker opening, a language change), so the strip keeps its scroll.
    const withMessages = useMemo(() => years.filter((y): y is OnThisDayYear => y.has_messages), [years]);
    const dateLabel = formatMonthDayLabel(monthDay, i18n.language);

    const toDay = (next: string) => go({ page: 'onThisDay', monthDay: next });
    const toYear = (year: number) => go({ page: 'onThisDay', monthDay, year });

    const detail = route.year !== undefined;
    const at = detail ? withMessages.findIndex((y) => y.year === route.year) : -1;
    const older = at > 0 ? withMessages[at - 1].year : null;
    const newer = at >= 0 && at < withMessages.length - 1 ? withMessages[at + 1].year : null;

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (!detail || e.defaultPrevented || isEditable(e.target)) return;
        // Keys from a portaled dialog (the media viewer) bubble through React but are not ours.
        if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
        const target = e.key === 'ArrowLeft' ? older : e.key === 'ArrowRight' ? newer : null;
        if (target === null) return;
        e.preventDefault();
        toYear(target);
    };

    const pickDate = (
        <Button variant="secondary" size="sm" onClick={() => setCalendarOpen(true)}>
            <CalendarDays aria-hidden="true" className="h-4 w-4" />
            {t('memories.onThisDay.pickDate')}
        </Button>
    );

    let right: React.ReactNode;
    let body: React.ReactNode;
    if (detail) {
        right = (
            <>
                <IconButton aria-label={t('memories.onThisDay.olderYear')} icon={<ChevronLeft className="h-5 w-5" />} disabled={older === null} onClick={() => older !== null && toYear(older)} />
                <span className="text-small text-secondary">{dateLabel}</span>
                <IconButton aria-label={t('memories.onThisDay.newerYear')} icon={<ChevronRight className="h-5 w-5" />} disabled={newer === null} onClick={() => newer !== null && toYear(newer)} />
            </>
        );
    } else {
        right = (
            <>
                <IconButton aria-label={t('memories.onThisDay.prevDay')} icon={<ChevronLeft className="h-5 w-5" />} onClick={() => toDay(shiftMonthDay(monthDay, -1))} />
                <Button variant="ghost" size="sm" title={t('memories.onThisDay.pickDate')} onClick={() => setCalendarOpen(true)}>
                    <CalendarDays aria-hidden="true" className="h-4 w-4" />
                    <span>{dateLabel}</span>
                    <span className="sr-only">{t('memories.onThisDay.pickDate')}</span>
                </Button>
                <IconButton aria-label={t('memories.onThisDay.nextDay')} icon={<ChevronRight className="h-5 w-5" />} onClick={() => toDay(shiftMonthDay(monthDay, 1))} />
            </>
        );
    }

    if (query.status !== 'ready') {
        body = <LoadState status={query.status === 'error' ? 'error' : 'loading'} onRetry={query.retry} />;
    } else if (detail) {
        body = <OnThisDayDetail service={service} monthDay={monthDay} year={route.year!} years={years} onSelectYear={toYear} />;
    } else if (!withMessages.length) {
        body = (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState icon={<CalendarHeart />} title={dateLabel} description={t('memories.onThisDay.empty')} action={pickDate} />
            </div>
        );
    } else {
        body = <YearStrip years={withMessages} resetKey={monthDay} onOpen={toYear} />;
    }

    return (
        <div
            data-testid="memories-page-onThisDay"
            data-service={service}
            onKeyDown={onKeyDown}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
            <PageHeader
                title={t('memories.onThisDay.title')}
                onBack={() => go(detail ? { page: 'onThisDay', monthDay } : { page: 'home' })}
                right={right}
            />
            {body}
            <CalendarModal
                isOpen={calendarOpen}
                onClose={() => setCalendarOpen(false)}
                title={t('memories.onThisDay.pickDate')}
                dates={[]}
                selectAnyDay
                initialMonth={monthDayInThisYear(monthDay)}
                onSelectDate={(d) => toDay(`${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)}
            />
        </div>
    );
};
