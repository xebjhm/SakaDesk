import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { IconButton, Select } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';
import { buildMonthGrid, DAY_TONE_CLASS, MONTH_KEYS, weekdayTone } from '../../../core/calendar/monthGrid';
import { MonthYearPicker } from '../../../core/calendar/MonthYearPicker';
import { monthYearPickerLog } from '../../../core/calendar/pickerLog';
import type { MemoriesRoute } from '../MemoriesFeature';
import { fetchCalendarMonth, fetchCalendarMonths, fetchMemoirMembers } from '../api';
import { logMemoriesToggle } from '../memoriesLog';
import { LoadState } from '../shared/LoadState';
import { PageHeader } from '../shared/PageHeader';
import { jstNow } from '../shared/jst';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import type { CalendarDay } from '../types';
import { DayCell } from './DayCell';

export type CalendarRoute = Extract<MemoriesRoute, { page: 'calendar' }>;

interface CalendarAlbumPageProps {
    service: string;
    route: CalendarRoute;
    go: (next: MemoriesRoute) => void;
}

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
/** Years the picker offers when there are no months at all: this year and the nine before it. */
const FALLBACK_PICKER_YEARS = 10;

const pad = (n: number) => String(n).padStart(2, '0');
const parseMonth = (ym: string | undefined) => {
    const m = ym ? MONTH_RE.exec(ym) : null;
    return m ? { year: Number(m[1]), month0: Number(m[2]) - 1 } : null;
};
const toMonth = (year: number, month0: number) => {
    const d = new Date(year, month0, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

/** The month to open without one in the route: this JST month when it has data, else the newest month that does. */
function defaultMonth(months: string[], thisMonth: string): string {
    if (months.includes(thisMonth) || months.length === 0) return thisMonth;
    return months[months.length - 1];
}

interface MonthGridProps {
    service: string;
    month: string;
    member: string | undefined;
    label: string;
    onOpenDay: (date: string) => void;
}

/** The weekday header and the 6 × 7 day cells of one month, filling the pane (no page scroll). */
const MonthGrid: React.FC<MonthGridProps> = ({ service, month, member, label, onOpenDay }) => {
    const { t } = useTranslation();
    const { year, month0 } = parseMonth(month)!;
    const query = useMemoriesQuery(
        'calendar',
        (signal) => fetchCalendarMonth(service, month, member, signal),
        [service, month, member],
        { count: (d) => d.days.length },
    );
    const cells = useMemo(() => buildMonthGrid(year, month0), [year, month0]);
    const byDate = useMemo(
        () => new Map<string, CalendarDay>((query.data?.days ?? []).map((d) => [d.date, d])),
        [query.data],
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
            <div className="grid shrink-0 grid-cols-7 gap-1 pb-1">
                {WEEKDAY_KEYS.map((key, i) => {
                    const tone = weekdayTone(i);
                    return (
                        <div
                            key={key}
                            data-testid="calendar-weekday"
                            className={cn('text-center text-caption font-semibold', tone ? DAY_TONE_CLASS[tone] : 'text-muted')}
                        >
                            {t(`calendar.weekdays.${key}`)}
                        </div>
                    );
                })}
            </div>
            {query.status !== 'ready' || !query.data ? (
                <LoadState status={query.status === 'error' ? 'error' : 'loading'} onRetry={query.retry} />
            ) : (
                <div role="group" aria-label={label} className="relative grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-1">
                    {cells.map((cell) => (
                        <DayCell key={cell.dateStr} cell={cell} data={byDate.get(cell.dateStr)} onOpen={onOpenDay} />
                    ))}
                    {query.data.days.length === 0 && (
                        <p className="pointer-events-none absolute inset-0 m-auto h-fit w-fit rounded-pill bg-frost px-4 py-2 text-small text-secondary backdrop-blur-frost">
                            {t('memories.calendar.empty')}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

/**
 * The calendar album (spec 13): the existing Japanese calendar (Sunday first, Sunday / 祝日 red,
 * Saturday blue, holiday names) with each day's best photo and member dots (`DayCell`). The
 * toolbar steps months with ‹ (older) / › (newer), opens the shared year / month picker from the
 * month title (months without data dimmed) and filters by member (「全員」, then the memoir list,
 * oshi first; logs `memories_toggle` `calendar_member`). The route keeps the month and the member;
 * a day opens 那一天 (`{page: 'day', from: 'calendar'}`). Months are JST.
 */
export const CalendarAlbumPage: React.FC<CalendarAlbumPageProps> = ({ service, route, go }) => {
    const { t } = useTranslation();
    const member = route.memberPath;
    const [picking, setPicking] = useState(false);
    const titleRef = useRef<HTMLButtonElement>(null);
    const wasPicking = useRef(picking);

    const months = useMemoriesQuery('calendar_months', (signal) => fetchCalendarMonths(service, member, signal), [service, member], {
        count: (d) => d.months.length,
    });
    const members = useMemoriesQuery('memoir_members', (signal) => fetchMemoirMembers(service, signal), [service], {
        count: (d) => d.members.length,
    });

    const now = jstNow();
    const thisMonth = `${now.year}-${pad(now.month)}`;
    const dataMonths = months.data?.months;
    const routeMonth = parseMonth(route.month) ? route.month : undefined;
    const shown = routeMonth ?? (dataMonths ? defaultMonth(dataMonths, thisMonth) : undefined);
    const parsed = parseMonth(shown);

    const monthSet = useMemo(() => new Set(dataMonths ?? []), [dataMonths]);
    const pickerYears = useMemo(() => {
        const shownYear = parsed?.year ?? now.year;
        const dated = [...monthSet].map((m) => Number(m.slice(0, 4)));
        const first = Math.min(dated.length ? Math.min(...dated) : now.year - FALLBACK_PICKER_YEARS + 1, shownYear);
        const last = Math.max(now.year, shownYear, ...dated);
        return Array.from({ length: last - first + 1 }, (_, i) => first + i);
    }, [monthSet, parsed?.year, now.year]);

    // Focus returns to the month title when the picker closes.
    useEffect(() => {
        if (wasPicking.current && !picking) titleRef.current?.focus();
        wasPicking.current = picking;
    }, [picking]);

    const goMonth = (month: string, memberPath = member) => go({ page: 'calendar', month, memberPath });
    const step = (delta: number) => {
        if (parsed) goMonth(toMonth(parsed.year, parsed.month0 + delta));
    };
    const openPicker = () => {
        setPicking(true);
        monthYearPickerLog.open(pickerYears.length);
    };
    const closePicker = (reason: 'escape' | 'button') => {
        setPicking(false);
        monthYearPickerLog.back(reason);
    };
    const pickMember = (value: string) => {
        const next = value || undefined;
        if (next === member) return;
        logMemoriesToggle('calendar_member', next !== undefined);
        go({ page: 'calendar', month: shown, memberPath: next });
    };
    // Escape anywhere in the picker view returns to the days (the picker claims it when focus is inside it).
    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (!picking || e.key !== 'Escape' || e.defaultPrevented || e.nativeEvent.isComposing) return;
        e.preventDefault();
        closePicker('escape');
    };

    const monthTitle = parsed
        ? t('calendar.monthYear', { month: t(`calendar.months.${MONTH_KEYS[parsed.month0]}`), year: parsed.year })
        : '';

    let body: React.ReactNode;
    if (!parsed) {
        body = <LoadState status={months.status === 'error' ? 'error' : 'loading'} onRetry={months.retry} />;
    } else if (picking) {
        body = months.status !== 'ready' ? (
            <LoadState status={months.status === 'error' ? 'error' : 'loading'} onRetry={months.retry} />
        ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                <MonthYearPicker
                    years={pickerYears}
                    year={parsed.year}
                    month={parsed.month0}
                    hasData={(ym) => monthSet.has(ym)}
                    onPick={(year, month0) => { setPicking(false); goMonth(toMonth(year, month0)); }}
                    onBack={() => setPicking(false)}
                    anchorRef={titleRef}
                />
            </div>
        );
    } else {
        body = (
            <MonthGrid
                service={service}
                month={shown!}
                member={member}
                label={monthTitle}
                onOpenDay={(date) => go({ page: 'day', date, from: 'calendar' })}
            />
        );
    }

    return (
        <div
            data-testid="memories-page-calendar"
            data-service={service}
            onKeyDown={onKeyDown}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
            <PageHeader title={t('memories.calendar.title')} onBack={() => go({ page: 'home' })} />
            <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-2">
                {picking ? (
                    <IconButton size="sm" aria-label={t('calendar.backToDays')} icon={<ArrowLeft />} onClick={() => closePicker('button')} />
                ) : (
                    <IconButton size="sm" aria-label={t('memories.calendar.prevMonth')} icon={<ChevronLeft />} disabled={!parsed} onClick={() => step(-1)} />
                )}
                <button
                    ref={titleRef}
                    type="button"
                    aria-expanded={picking}
                    disabled={!parsed}
                    onClick={() => (picking ? closePicker('button') : openPicker())}
                    className={cn(
                        'flex items-center gap-1 rounded-lg px-2 py-1 font-display text-title text-primary',
                        'transition-colors duration-fast ease-standard hover:bg-sunken',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    )}
                >
                    <span>{monthTitle}</span>
                    <span className="sr-only">, {t('memories.calendar.pickMonth')}</span>
                    <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center text-secondary">
                        {picking ? <ChevronUp /> : <ChevronDown />}
                    </span>
                </button>
                {picking ? (
                    <span aria-hidden="true" className="h-8 w-8" />
                ) : (
                    <IconButton size="sm" aria-label={t('memories.calendar.nextMonth')} icon={<ChevronRight />} disabled={!parsed} onClick={() => step(1)} />
                )}
                <Select
                    aria-label={t('memories.calendar.memberFilter')}
                    value={member ?? ''}
                    onChange={(e) => pickMember(e.target.value)}
                    className="ml-auto w-48"
                >
                    <option value="">{t('memories.calendar.all')}</option>
                    {(members.data?.members ?? []).map((m) => (
                        <option key={m.member_path} value={m.member_path} lang="ja">{m.name}</option>
                    ))}
                </Select>
            </div>
            {body}
        </div>
    );
};
