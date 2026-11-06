import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { cn, MONTH_NAMES } from '../../utils/classnames';
import { IconButton, Button, Modal } from '../../design/primitives';
import { DialogStatus } from '../common/DialogStatus';
import { logDialogLoad } from '../../design/dialog/dialogLog';
import type { BaseModalProps } from '../../types/modal';
import type { Message } from '../../types';
import { useTranslation } from '../../i18n';
import { toLocalDateStr } from '../../utils/dateFormatters';

export interface DateCount {
    date: string;
    count: number;
}

/**
 * CalendarModal supports three modes:
 * 1. API mode: Pass `conversationPath` to fetch dates from the server
 * 2. Messages mode: Pass `messages` array to compute dates locally (for media gallery)
 * 3. Dates mode: Pass `dates` array of pre-computed DateCount objects (for blog photo gallery)
 *
 * The onSelectDate callback receives either:
 * - A date string "YYYY-MM-DD" (API mode)
 * - A Date object (Messages mode or Dates mode) - more useful for scrolling to month
 */
interface CalendarModalPropsBase extends BaseModalProps {
    /** Title for the modal (default: "Date Search") */
    title?: string;
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
    conversationPath?: never;
    messages?: never;
}

type CalendarModalProps = CalendarModalPropsAPI | CalendarModalPropsMessages | CalendarModalPropsDates;

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

// Format a Date to YYYY-MM-DD using LOCAL timezone (not UTC).
// SD-FE-CORE-02: shared with scrollToDate / backend `_local_date` so the
// calendar dots, the jump target, and the message bubbles all agree on the day.
const formatLocalDate = (d: Date): string => toLocalDateStr(d);

export const CalendarModal: React.FC<CalendarModalProps> = (props) => {
    const {
        isOpen,
        onClose,
        title,
    } = props;

    const { t } = useTranslation();

    // Use translated title as default
    const modalTitle = title || t('calendar.title');

    const [currentDate, setCurrentDate] = useState(new Date());
    const [apiDates, setApiDates] = useState<DateCount[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);

    // Determine mode
    const isMessagesMode = 'messages' in props && props.messages !== undefined;
    const isDatesMode = 'dates' in props && props.dates !== undefined;
    const conversationPath = !isMessagesMode && !isDatesMode ? (props as CalendarModalPropsAPI).conversationPath : undefined;
    const messages = isMessagesMode ? (props as CalendarModalPropsMessages).messages : undefined;
    const directDates = isDatesMode ? (props as CalendarModalPropsDates).dates : undefined;

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

    // Get message count for a date
    const getMessageCount = (dateStr: string): number => {
        const item = activeDates.find(d => d.date === dateStr);
        return item?.count || 0;
    };

    // Generate calendar days for current month
    const calendarDays = useMemo(() => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        // First day of month
        const firstDay = new Date(year, month, 1);
        const startDayOfWeek = firstDay.getDay();

        // Last day of month
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();

        // Previous month days to fill
        const prevMonthLastDay = new Date(year, month, 0).getDate();

        const days: Array<{ date: Date; isCurrentMonth: boolean; dateStr: string }> = [];

        // Previous month days
        for (let i = startDayOfWeek - 1; i >= 0; i--) {
            const d = new Date(year, month - 1, prevMonthLastDay - i);
            days.push({
                date: d,
                isCurrentMonth: false,
                dateStr: formatLocalDate(d),
            });
        }

        // Current month days
        for (let i = 1; i <= daysInMonth; i++) {
            const d = new Date(year, month, i);
            days.push({
                date: d,
                isCurrentMonth: true,
                dateStr: formatLocalDate(d),
            });
        }

        // Next month days to fill (to complete 6 rows)
        const remaining = 42 - days.length;
        for (let i = 1; i <= remaining; i++) {
            const d = new Date(year, month + 1, i);
            days.push({
                date: d,
                isCurrentMonth: false,
                dateStr: formatLocalDate(d),
            });
        }

        return days;
    }, [currentDate]);

    const goToPrevMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    };

    const goToNextMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    };

    const goToToday = () => {
        setCurrentDate(new Date());
    };

    const handleDateClick = (dateStr: string, date: Date) => {
        if (datesWithMessages.has(dateStr)) {
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
                <IconButton size="sm" aria-label={t('calendar.prevMonth')} icon={<ChevronLeft />} onClick={goToPrevMonth} />
                <div className="flex items-center gap-2">
                    <span className="text-title font-semibold text-primary">
                        {MONTH_NAMES[currentDate.getMonth()]} {currentDate.getFullYear()}
                    </span>
                    <Button variant="ghost" size="sm" onClick={goToToday}>{t('calendar.today')}</Button>
                </div>
                <IconButton size="sm" aria-label={t('calendar.nextMonth')} icon={<ChevronRight />} onClick={goToNextMonth} />
            </div>

            {loading ? (
                <DialogStatus kind="loading" />
            ) : loadFailed ? (
                <DialogStatus kind="error" title={t('calendar.loadFailed')} onRetry={fetchDates} retryLabel={t('common.retry')} />
            ) : (
                <>
                    <div className="mb-2 grid grid-cols-7">
                        {WEEKDAY_KEYS.map((dayKey, i) => (
                            <div key={dayKey} className={cn('py-2 text-center text-caption font-semibold', i === 0 ? 'text-sunday' : 'text-muted')}>
                                {t(`calendar.weekdays.${dayKey}`)}
                            </div>
                        ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                        {calendarDays.map(({ date, isCurrentMonth, dateStr }, index) => {
                            const hasMessages = datesWithMessages.has(dateStr);
                            const today = isToday(dateStr);
                            return (
                                <button
                                    key={index}
                                    type="button"
                                    onClick={() => handleDateClick(dateStr, date)}
                                    disabled={!hasMessages}
                                    title={hasMessages ? t('calendar.itemCount', { count: getMessageCount(dateStr) }) : undefined}
                                    className={cn(
                                        'relative flex aspect-square flex-col items-center justify-center rounded-pill text-small',
                                        'transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                                        !isCurrentMonth && 'opacity-30',
                                        hasMessages ? 'cursor-pointer text-primary hover:bg-accent-subtle' : 'text-muted',
                                        isCurrentMonth && date.getDay() === 0 && 'text-sunday',
                                        today && 'font-semibold ring-2 ring-inset ring-accent',
                                    )}
                                >
                                    <span>{date.getDate()}</span>
                                    {hasMessages && <span aria-hidden="true" className="absolute bottom-1 h-1.5 w-1.5 rounded-pill bg-accent" />}
                                </button>
                            );
                        })}
                    </div>
                </>
            )}
        </Modal>
    );
};
