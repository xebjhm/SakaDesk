import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../../i18n';
import { Select } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';
import { buildMonthGrid, MONTH_KEYS, pickerYearRange } from '../../../core/calendar/monthGrid';
import { MonthYearPicker } from '../../../core/calendar/MonthYearPicker';
import { MonthTitleButton, NewerMonthButton, OlderMonthButton, WeekdayHeader } from '../../../core/calendar/MonthNav';
import { useMonthPickerView } from '../../../core/calendar/useMonthPickerView';
import type { MemoriesRoute } from '../MemoriesFeature';
import { fetchCalendarMonth, fetchCalendarMonths, fetchMemoirMembers } from '../api';
import { logMemoriesToggle } from '../memoriesLog';
import { LoadState } from '../shared/LoadState';
import { PageHeader } from '../shared/PageHeader';
import { jstNow } from '../shared/jst';
import { nameFromRoom } from '../shared/nameFromRoom';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import type { CalendarDay, CalendarMonthPayload } from '../types';
import { cellThumbPx, DEFAULT_CELL_PX } from './cellSize';
import { DayCell } from './DayCell';

export type CalendarRoute = Extract<MemoriesRoute, { page: 'calendar' }>;

interface CalendarAlbumPageProps {
    service: string;
    route: CalendarRoute;
    go: (next: MemoriesRoute) => void;
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

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

/** The measured cell size of a 7 × 6 grid element (`DEFAULT_CELL_PX` where it cannot be measured). */
function useCellPx(el: HTMLElement | null): number {
    const [px, setPx] = useState(DEFAULT_CELL_PX);
    useEffect(() => {
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const measure = () => setPx(cellThumbPx(el.clientWidth, el.clientHeight));
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [el]);
    return px;
}

interface MonthGridProps {
    service: string;
    month: string;
    member: string | undefined;
    label: string;
    onOpenDay: (date: string) => void;
}

/**
 * The weekday header and the 6 × 7 day cells of one month, filling the pane (no page scroll).
 * While the next month loads, the month already on screen stays (dimmed, `aria-busy`) instead
 * of a loading line; the very first load and an error show the load state.
 */
const MonthGrid: React.FC<MonthGridProps> = ({ service, month, member, label, onOpenDay }) => {
    const { t } = useTranslation();
    const query = useMemoriesQuery(
        'calendar',
        (signal) => fetchCalendarMonth(service, month, member, signal),
        [service, month, member],
        { count: (d) => d.days.length },
    );
    // The last month drawn, kept on screen while another one loads.
    const [kept, setKept] = useState<CalendarMonthPayload | null>(null);
    if (query.data && kept !== query.data) setKept(query.data);
    const shown = query.data ?? (query.status === 'loading' ? kept : null);
    const busy = shown !== null && shown !== query.data;

    const shownMonth = shown?.month;
    const cells = useMemo(() => {
        const parts = parseMonth(shownMonth);
        return parts ? buildMonthGrid(parts.year, parts.month0) : [];
    }, [shownMonth]);
    const byDate = useMemo(
        () => new Map<string, CalendarDay>((shown?.days ?? []).map((d) => [d.date, d])),
        [shown],
    );
    const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
    const cellPx = useCellPx(gridEl);

    return (
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
            <WeekdayHeader className="shrink-0 gap-1 pb-1" cellClassName="" />
            {!shown || cells.length === 0 ? (
                <LoadState status={query.status === 'error' ? 'error' : 'loading'} onRetry={query.retry} />
            ) : (
                <div
                    ref={setGridEl}
                    role="group"
                    aria-label={label}
                    aria-busy={busy || undefined}
                    className={cn(
                        'relative grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-1 transition-opacity duration-fast ease-standard',
                        busy && 'opacity-60',
                    )}
                >
                    {cells.map((cell) => (
                        <DayCell key={cell.dateStr} cell={cell} data={byDate.get(cell.dateStr)} px={cellPx} onOpen={onOpenDay} />
                    ))}
                    {!busy && shown.days.length === 0 && (
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
 * month title (months without data dimmed; the host side is `useMonthPickerView`, shared with
 * `CalendarModal`) and filters by member (「全員」, then the memoir list, oshi first; a route path
 * of any of her rooms selects her row; logs `memories_toggle` `calendar_member`). The route keeps
 * the month and the member; a day opens 那一天 with both (`{page: 'day', from: 'calendar'}`).
 * Months are JST.
 */
export const CalendarAlbumPage: React.FC<CalendarAlbumPageProps> = ({ service, route, go }) => {
    const { t } = useTranslation();
    const member = route.memberPath;
    const pickerView = useMonthPickerView();
    const { picking, titleRef } = pickerView;

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
    const pickerYears = useMemo(
        () => pickerYearRange([...monthSet].map((m) => Number(m.slice(0, 4))), parsed?.year ?? now.year, now.year),
        [monthSet, parsed?.year, now.year],
    );

    // The member filter's option: her row when the route path is any of her rooms, else an option
    // named from the path's room (an unlisted person, or the list still loading), never 「全員」.
    const people = members.data?.members ?? [];
    const matched = member === undefined
        ? undefined
        : people.find((m) => m.member_path === member || (m.member_paths ?? []).includes(member));
    const selectValue = member === undefined ? '' : matched?.member_path ?? member;

    const goMonth = (month: string) => go({ page: 'calendar', month, memberPath: member });
    const step = (delta: number) => {
        if (parsed) goMonth(toMonth(parsed.year, parsed.month0 + delta));
    };
    const pickMember = (value: string) => {
        const next = value || undefined;
        if (next === selectValue || (next === undefined && member === undefined)) return;
        logMemoriesToggle('calendar_member', next !== undefined);
        go({ page: 'calendar', month: shown, memberPath: next });
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
                    onPick={(year, month0) => { pickerView.dismiss(); goMonth(toMonth(year, month0)); }}
                    onBack={pickerView.dismiss}
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
                onOpenDay={(date) => go({ page: 'day', date, from: 'calendar', memberPath: member })}
            />
        );
    }

    return (
        <div
            data-testid="memories-page-calendar"
            data-service={service}
            onKeyDown={pickerView.onKeyDown}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
            <PageHeader title={t('memories.calendar.title')} onBack={() => go({ page: 'home' })} />
            <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-2">
                <OlderMonthButton
                    picking={picking}
                    label={t('memories.calendar.prevMonth')}
                    disabled={!parsed}
                    onClick={() => step(-1)}
                    onBack={() => pickerView.closePicker('button')}
                />
                <MonthTitleButton
                    ref={titleRef}
                    title={monthTitle}
                    pickLabel={t('memories.calendar.pickMonth')}
                    expanded={picking}
                    disabled={!parsed}
                    onClick={() => (picking ? pickerView.closePicker('button') : pickerView.openPicker(pickerYears.length))}
                    className="font-display"
                />
                <NewerMonthButton picking={picking} label={t('memories.calendar.nextMonth')} disabled={!parsed} onClick={() => step(1)} />
                <Select
                    aria-label={t('memories.calendar.memberFilter')}
                    value={selectValue}
                    onChange={(e) => pickMember(e.target.value)}
                    className="ml-auto w-48"
                >
                    <option value="">{t('memories.calendar.all')}</option>
                    {people.map((m) => (
                        <option key={m.member_path} value={m.member_path} lang="ja">{m.name}</option>
                    ))}
                    {member !== undefined && !matched && (
                        <option value={member} lang="ja">{nameFromRoom(member)}</option>
                    )}
                </Select>
            </div>
            {body}
        </div>
    );
};
