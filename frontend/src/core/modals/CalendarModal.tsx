import React, { useState, useEffect, useMemo, useCallback, useId, useRef } from 'react';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '../../utils/classnames';
import { IconButton, Button, Modal } from '../../design/primitives';
import { DialogStatus } from '../common/DialogStatus';
import { logDialogLoad } from '../../design/dialog/dialogLog';
import type { BaseModalProps } from '../../types/modal';
import type { Message } from '../../types';
import { useTranslation } from '../../i18n';
import { toLocalDateStr } from '../../utils/dateFormatters';
import { holidayName } from '../../utils/jpHolidays';
import { buildMonthGrid, dayTone, DAY_TONE_CLASS, MONTH_KEYS, weekdayTone } from '../calendar/monthGrid';
import { MonthYearPicker } from '../calendar/MonthYearPicker';
import { monthYearPickerLog } from '../calendar/pickerLog';

export interface DateCount {
    date: string;
    count: number;
}

/**
 * Japanese-style calendar (owner decision R-h): the week starts on Sunday; Sundays and Japanese
 * public holidays (祝日) are red (`text-calendar-holiday`), Saturdays blue
 * (`text-calendar-saturday`). A day's holiday name (Japanese, `lang="ja"`) and its item count show
 * in a dark tooltip on hover and keyboard focus (above the cell, below it in the first row); the
 * holiday is also part of the day's accessible name and the count its description. The month
 * title (`calendar.monthYear`: numeric `2026年11月` in Chinese / Cantonese / Japanese) is a button
 * that swaps the day grid for a year / month picker (years from the first dated year to this
 * year, the selected one scrolled into view; years and months without dates are dimmed but
 * selectable); Escape or the back button returns to the day grid. Opening, picking and leaving
 * the picker log `calendar_picker` breadcrumbs.
 *
 * CalendarModal supports three modes:
 * 1. API mode: Pass `conversationPath` to fetch dates from the server
 * 2. Messages mode: Pass `messages` array to compute dates locally (for media gallery)
 * 3. Dates mode: Pass `dates` array of pre-computed DateCount objects (for blog photo gallery)
 *    With `selectAnyDay`, every day is selectable (a free date picker, e.g. On This Day)
 *    and the year / month picker shows every year and month as available.
 * `initialMonth` (any mode) sets the month shown on each open.
 *
 * The onSelectDate callback receives either:
 * - A date string "YYYY-MM-DD" (API mode)
 * - A Date object (Messages mode or Dates mode) - more useful for scrolling to month
 */
interface CalendarModalPropsBase extends BaseModalProps {
    /** Title for the modal (default: "Date Search") */
    title?: string;
    /** The month shown each time the modal opens (default: the month it was last on, first this month). */
    initialMonth?: Date;
}

interface CalendarModalPropsAPI extends CalendarModalPropsBase {
    /** Conversation path for fetching dates from API */
    conversationPath: string;
    /** Callback when a date is selected (receives date string "YYYY-MM-DD") */
    onSelectDate: (date: string) => void;
    messages?: never;
}

interface CalendarModalPropsMessages extends CalendarModalPropsBase {
    /** Messages array to compute dates from (for media gallery) */
    messages: Message[];
    /** Callback when a date is selected (receives Date object) */
    onSelectDate: (date: Date) => void;
    conversationPath?: never;
}

interface CalendarModalPropsDates extends CalendarModalPropsBase {
    /** Pre-computed date counts (for blog photo gallery and other non-message sources) */
    dates: DateCount[];
    /** Callback when a date is selected (receives Date object) */
    onSelectDate: (date: Date) => void;
    /** Every day is selectable, not only the dated ones (a free date picker); counts still come from `dates`. */
    selectAnyDay?: boolean;
    conversationPath?: never;
    messages?: never;
}

type CalendarModalProps = CalendarModalPropsAPI | CalendarModalPropsMessages | CalendarModalPropsDates;

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Years the picker offers when there are no dates at all: this year and the nine before it. */
const FALLBACK_PICKER_YEARS = 10;

/** A tone's text colour class, or null (neutral). */
const toneClass = (tone: ReturnType<typeof dayTone>): string | null => (tone ? DAY_TONE_CLASS[tone] : null);

/**
 * Day tooltip placement: edge columns align to their edge so long holiday names stay in the
 * dialog; the first row opens below the cell so the tooltip never covers the weekday header or
 * gets clipped by the body's top edge.
 */
const tooltipAnchor = (index: number): string => {
    const column = index % 7;
    const horizontal = column === 0 ? 'left-0' : column === 6 ? 'right-0' : 'left-1/2 -translate-x-1/2';
    return cn(horizontal, index < 7 ? 'top-full mt-1' : 'bottom-full mb-1');
};

// Format a Date to YYYY-MM-DD using LOCAL timezone (not UTC).
// SD-FE-CORE-02: shared with scrollToDate / backend `_local_date` so the
// calendar dots, the jump target, and the message bubbles all agree on the day.
const formatLocalDate = (d: Date): string => toLocalDateStr(d);

export const CalendarModal: React.FC<CalendarModalProps> = (props) => {
    const {
        isOpen,
        onClose,
        title,
        initialMonth,
    } = props;

    const { t } = useTranslation();

    // Use translated title as default
    const modalTitle = title || t('calendar.title');

    const [currentDate, setCurrentDate] = useState(new Date());
    const [apiDates, setApiDates] = useState<DateCount[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const [view, setView] = useState<'days' | 'picker'>('days');
    const titleButtonRef = useRef<HTMLButtonElement>(null);
    const previousView = useRef(view);
    const tooltipIdBase = useId();

    // Determine mode
    const isMessagesMode = 'messages' in props && props.messages !== undefined;
    const isDatesMode = 'dates' in props && props.dates !== undefined;
    const conversationPath = !isMessagesMode && !isDatesMode ? (props as CalendarModalPropsAPI).conversationPath : undefined;
    const messages = isMessagesMode ? (props as CalendarModalPropsMessages).messages : undefined;
    const directDates = isDatesMode ? (props as CalendarModalPropsDates).dates : undefined;
    const anyDay = isDatesMode && (props as CalendarModalPropsDates).selectAnyDay === true;

    // Compute dates from messages (Messages mode)
    const messageDates = useMemo(() => {
        if (!messages) return [];

        const dateCounts = new Map<string, number>();
        messages.forEach(msg => {
            if (msg.media_file) {
                const date = new Date(msg.timestamp);
                const dateStr = formatLocalDate(date);
                dateCounts.set(dateStr, (dateCounts.get(dateStr) || 0) + 1);
            }
        });

        return Array.from(dateCounts.entries()).map(([date, count]) => ({ date, count }));
    }, [messages]);

    // Use either API dates, computed message dates, or direct date counts
    const activeDates = isDatesMode ? directDates! : isMessagesMode ? messageDates : apiDates;

    // Fetch message dates (API mode only)
    const fetchDates = useCallback(async () => {
        if (!conversationPath) return;

        setLoading(true);
        setLoadFailed(false);

        try {
            const res = await fetch(`/api/chat/message_dates/${encodeURIComponent(conversationPath)}`);
            if (!res.ok) throw new Error('message_dates');
            const data = await res.json();
            setApiDates(data.dates || []);
            logDialogLoad('calendar', 'ok', (data.dates || []).length);
        } catch {
            setLoadFailed(true);
            logDialogLoad('calendar', 'error');
        } finally {
            setLoading(false);
        }
    }, [conversationPath]);

    useEffect(() => {
        if (isOpen && !isMessagesMode && !isDatesMode) {
            fetchDates();
        }
    }, [isOpen, isMessagesMode, isDatesMode, fetchDates]);

    // Create a set of dates with messages for quick lookup
    const datesWithMessages = useMemo(() => {
        return new Set(activeDates.map(d => d.date));
    }, [activeDates]);

    // "YYYY-MM" months and years that have dates, for the picker.
    const monthsWithMessages = useMemo(() => new Set(activeDates.map(d => d.date.slice(0, 7))), [activeDates]);
    const yearsWithMessages = useMemo(
        () => new Set(activeDates.map(d => Number(d.date.slice(0, 4))).filter(Number.isFinite)),
        [activeDates],
    );

    // Picker years: the first dated year (or the fallback window) up to this year, always
    // including the year on screen.
    const pickerYears = useMemo(() => {
        const thisYear = new Date().getFullYear();
        const shownYear = currentDate.getFullYear();
        const dated = [...yearsWithMessages];
        const first = Math.min(dated.length ? Math.min(...dated) : thisYear - FALLBACK_PICKER_YEARS + 1, shownYear);
        const last = Math.max(thisYear, shownYear, ...dated);
        return Array.from({ length: last - first + 1 }, (_, i) => first + i);
    }, [currentDate, yearsWithMessages]);

    // Every open starts on the day grid (on `initialMonth` when given).
    const initialMonthTime = initialMonth && !Number.isNaN(initialMonth.getTime()) ? initialMonth.getTime() : null;
    useEffect(() => {
        if (!isOpen) setView('days');
        else if (initialMonthTime !== null) {
            const start = new Date(initialMonthTime);
            setCurrentDate(new Date(start.getFullYear(), start.getMonth(), 1));
        }
    }, [isOpen, initialMonthTime]);

    // Focus goes back to the title button when the picker closes. Moving focus into the picker
    // is the picker's own (on mount, from the title button or from nowhere): a picker opened while
    // the dates are loading takes focus once it renders, unless the user has moved it meanwhile.
    useEffect(() => {
        const viewChanged = previousView.current !== view;
        previousView.current = view;
        // closing resets the view; the dialog layer restores focus itself
        if (isOpen && viewChanged && view === 'days') titleButtonRef.current?.focus();
    }, [view, isOpen]);

    // Get message count for a date
    const getMessageCount = (dateStr: string): number => {
        const item = activeDates.find(d => d.date === dateStr);
        return item?.count || 0;
    };

    // The 42 cells of the month on screen (Sunday first).
    const calendarDays = useMemo(
        () => buildMonthGrid(currentDate.getFullYear(), currentDate.getMonth()),
        [currentDate],
    );

    const goToPrevMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    };

    const goToNextMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    };

    const goToToday = () => {
        setCurrentDate(new Date());
    };

    const openPicker = () => {
        setView('picker');
        monthYearPickerLog.open(pickerYears.length);
    };

    const closePicker = (reason: 'escape' | 'button') => {
        setView('days');
        monthYearPickerLog.back(reason);
    };

    const selectMonth = (year: number, month: number) => {
        setCurrentDate(new Date(year, month, 1));
        setView('days');
    };

    // Escape in the picker view goes back to the day grid (the picker claims it when focus is
    // inside it); claiming the key keeps the dialog open.
    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (view !== 'picker' || e.key !== 'Escape' || e.defaultPrevented || e.nativeEvent.isComposing) return;
        e.preventDefault();
        closePicker('escape');
    };

    const monthLabel = (month: number) => t(`calendar.months.${MONTH_KEYS[month]}`);
    const monthTitle = t('calendar.monthYear', { month: monthLabel(currentDate.getMonth()), year: currentDate.getFullYear() });
    const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

    const handleDateClick = (dateStr: string, date: Date) => {
        if (anyDay || datesWithMessages.has(dateStr)) {
            if (isMessagesMode || isDatesMode) {
                (props as CalendarModalPropsMessages | CalendarModalPropsDates).onSelectDate(date);
            } else {
                (props as CalendarModalPropsAPI).onSelectDate(dateStr);
            }
            onClose();
        }
    };

    const isToday = (dateStr: string) => {
        return dateStr === formatLocalDate(new Date());
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={modalTitle}
            icon={<CalendarIcon />}
            closeLabel={t('common.close')}
            logId="calendar"
            onKeyDown={handleKeyDown}
            className="max-w-md"
            bodyClassName="px-6 pb-4"
            footer={
                <p className="w-full text-center text-small text-muted">
                    {activeDates.length > 0
                        ? t('calendar.availableOnDays', { count: activeDates.length })
                        : t('calendar.tapToJump')}
                </p>
            }
        >
            <div className="flex items-center justify-between pb-2">
                {view === 'picker' ? (
                    <IconButton size="sm" aria-label={t('calendar.backToDays')} icon={<ArrowLeft />} onClick={() => closePicker('button')} />
                ) : (
                    <IconButton size="sm" aria-label={t('calendar.prevMonth')} icon={<ChevronLeft />} onClick={goToPrevMonth} />
                )}
                <div className="flex items-center gap-2">
                    <button
                        ref={titleButtonRef}
                        type="button"
                        aria-expanded={view === 'picker'}
                        onClick={() => (view === 'picker' ? closePicker('button') : openPicker())}
                        className={cn(
                            'flex items-center gap-1 rounded-lg px-2 py-1 text-title font-semibold text-primary',
                            'transition-colors duration-fast ease-standard hover:bg-sunken',
                            focusRing,
                        )}
                    >
                        <span>{monthTitle}</span>
                        <span className="sr-only">, {t('calendar.pickMonth')}</span>
                        <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center text-secondary">
                            {view === 'picker' ? <ChevronUp /> : <ChevronDown />}
                        </span>
                    </button>
                    {view === 'days' && <Button variant="ghost" size="sm" onClick={goToToday}>{t('calendar.today')}</Button>}
                </div>
                {view === 'picker' ? (
                    <span aria-hidden="true" className="h-8 w-8" />
                ) : (
                    <IconButton size="sm" aria-label={t('calendar.nextMonth')} icon={<ChevronRight />} onClick={goToNextMonth} />
                )}
            </div>

            {loading ? (
                <DialogStatus kind="loading" />
            ) : loadFailed ? (
                <DialogStatus kind="error" title={t('calendar.loadFailed')} onRetry={fetchDates} retryLabel={t('common.retry')} />
            ) : view === 'picker' ? (
                <MonthYearPicker
                    years={pickerYears}
                    year={currentDate.getFullYear()}
                    month={currentDate.getMonth()}
                    hasData={(ym) => monthsWithMessages.has(ym)}
                    allAvailable={anyDay}
                    onPick={selectMonth}
                    onBack={() => setView('days')}
                    anchorRef={titleButtonRef}
                />
            ) : (
                <>
                    <div className="mb-2 grid grid-cols-7">
                        {WEEKDAY_KEYS.map((dayKey, i) => (
                            <div
                                key={dayKey}
                                data-testid="calendar-weekday"
                                className={cn('py-2 text-center text-caption font-semibold', toneClass(weekdayTone(i)) ?? 'text-muted')}
                            >
                                {t(`calendar.weekdays.${dayKey}`)}
                            </div>
                        ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                        {calendarDays.map(({ date, inMonth: isCurrentMonth, dateStr }, index) => {
                            const hasMessages = datesWithMessages.has(dateStr);
                            const selectable = anyDay || hasMessages;
                            const today = isToday(dateStr);
                            // Out-of-month days stay uniformly muted: text-muted at 80 % is 3.3:1 on white.
                            const holiday = isCurrentMonth ? holidayName(dateStr) : null;
                            const countText = hasMessages ? t('calendar.itemCount', { count: getMessageCount(dateStr) }) : null;
                            const tone = !isCurrentMonth
                                ? 'text-muted opacity-80'
                                : toneClass(dayTone(date)) ?? (selectable ? 'text-primary' : 'text-muted');
                            const tooltipId = `${tooltipIdBase}-day-${index}`;
                            return (
                                <button
                                    key={index}
                                    type="button"
                                    data-day={date.getDate()}
                                    data-outside={isCurrentMonth ? undefined : ''}
                                    onClick={() => handleDateClick(dateStr, date)}
                                    disabled={!selectable}
                                    aria-describedby={countText ? `${tooltipId}-count` : undefined}
                                    className={cn(
                                        'group/day relative flex aspect-square flex-col items-center justify-center rounded-pill text-small',
                                        'transition-colors duration-fast ease-standard',
                                        focusRing,
                                        selectable && 'cursor-pointer hover:bg-accent-subtle',
                                        tone,
                                        today ? 'font-semibold border-2 border-accent' : 'border-2 border-transparent',
                                    )}
                                >
                                    <span>{date.getDate()}</span>
                                    {holiday && <span className="sr-only">, <span lang="ja">{holiday}</span></span>}
                                    {hasMessages && <span aria-hidden="true" className="absolute bottom-1 h-1.5 w-1.5 rounded-pill bg-accent" />}
                                    {(holiday || countText) && (
                                        <span
                                            role="tooltip"
                                            aria-hidden="true"
                                            className={cn(
                                                'pointer-events-none absolute z-10 flex flex-col items-center whitespace-nowrap rounded-md px-2 py-1',
                                                tooltipAnchor(index),
                                                'bg-toast text-caption font-normal text-viewer shadow-card',
                                                'opacity-0 transition-opacity delay-300 duration-fast ease-standard',
                                                'group-hover/day:opacity-100 group-focus-visible/day:opacity-100',
                                                'motion-reduce:transition-none motion-reduce:delay-0',
                                            )}
                                        >
                                            {holiday && <span lang="ja">{holiday}</span>}
                                            {countText && <span id={`${tooltipId}-count`}>{countText}</span>}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </>
            )}
        </Modal>
    );
};
