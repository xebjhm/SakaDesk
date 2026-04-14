import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { cn, MONTH_NAMES } from '../../utils/classnames';
import { BaseModal, ModalLoadingState, ModalErrorState } from '../common';
import type { BaseModalProps } from '../../types/modal';
import type { Message } from '../../types';
import { useAppStore } from '../../store/appStore';
import { getServiceTheme } from '../../config/serviceThemes';
import { useTranslation } from '../../i18n';

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

// Format date to YYYY-MM-DD using LOCAL timezone (not UTC)
const formatLocalDate = (d: Date): string => {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const CalendarModal: React.FC<CalendarModalProps> = (props) => {
    const {
        isOpen,
        onClose,
        title,
    } = props;

    const { t } = useTranslation();

    // Get per-service theme colors
    const activeService = useAppStore((state) => state.activeService);
    const theme = getServiceTheme(activeService);

    // Use translated title as default
    const modalTitle = title || t('calendar.title');

    const [currentDate, setCurrentDate] = useState(new Date());
    const [apiDates, setApiDates] = useState<DateCount[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
        setError(null);

        try {
            const res = await fetch(`/api/chat/message_dates/${encodeURIComponent(conversationPath)}`);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || 'Failed to fetch dates');
            }
            const data = await res.json();
            setApiDates(data.dates || []);
        } catch (err: any) {
            setError(err.message || 'Failed to load dates');
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
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title={modalTitle}
            icon={Calendar}
            maxWidth="max-w-md"
            footer={
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 text-center text-sm text-gray-500">
                    {activeDates.length > 0 ? (
                        <span>{t('calendar.availableOnDays', { count: activeDates.length })}</span>
                    ) : (
                        <span>{t('calendar.tapToJump')}</span>
                    )}
                </div>
            }
        >
            {/* Month Navigation */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <button
                    onClick={goToPrevMonth}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                    <ChevronLeft className="w-5 h-5 text-gray-600" />
                </button>
                <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-gray-800">
                        {MONTH_NAMES[currentDate.getMonth()]} {currentDate.getFullYear()}
                    </span>
                    <button
                        onClick={goToToday}
                        className="text-xs px-2 py-1 rounded transition-colors"
                        style={{
                            color: theme.modals.accentColor,
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = theme.modals.accentColorLight;
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                    >
                        {t('calendar.today')}
                    </button>
                </div>
                <button
                    onClick={goToNextMonth}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                    <ChevronRight className="w-5 h-5 text-gray-600" />
                </button>
            </div>

            {/* Calendar Grid */}
            <div className="p-4">
                {loading ? (
                    <ModalLoadingState />
                ) : error ? (
                    <ModalErrorState error={error} onRetry={fetchDates} />
                ) : (
                    <>
                        {/* Weekday headers */}
                        <div className="grid grid-cols-7 mb-2">
                            {WEEKDAY_KEYS.map((dayKey, i) => (
                                <div
                                    key={dayKey}
                                    className={cn(
                                        "text-center text-xs font-medium py-2",
                                        i === 0 ? "text-red-500" : i === 6 ? "text-gray-600" : "text-gray-500"
                                    )}
                                >
                                    {t(`calendar.weekdays.${dayKey}`)}
                                </div>
                            ))}
                        </div>

                        {/* Days grid */}
                        <div className="grid grid-cols-7 gap-1">
                            {calendarDays.map(({ date, isCurrentMonth, dateStr }, index) => {
                                const hasMessages = datesWithMessages.has(dateStr);
                                const dayOfWeek = date.getDay();
                                const today = isToday(dateStr);

                                return (
                                    <button
                                        key={index}
                                        onClick={() => handleDateClick(dateStr, date)}
                                        disabled={!hasMessages}
                                        title={hasMessages ? `${getMessageCount(dateStr)} items` : undefined}
                                        className={cn(
                                            "aspect-square flex flex-col items-center justify-center rounded-lg text-sm transition-all relative",
                                            !isCurrentMonth && "opacity-30",
                                            isCurrentMonth && !hasMessages && "text-gray-400",
                                            hasMessages && "text-gray-900 cursor-pointer",
                                            dayOfWeek === 0 && isCurrentMonth && "text-red-500",
                                            dayOfWeek === 6 && isCurrentMonth && !today && "text-gray-600",
                                        )}
                                        style={{
                                            ...(today && {
                                                boxShadow: `0 0 0 2px ${theme.modals.accentColor}`,
                                                borderRadius: '0.5rem',
                                            }),
                                        }}
                                        onMouseEnter={(e) => {
                                            if (hasMessages) {
                                                e.currentTarget.style.backgroundColor = theme.modals.accentColorLight;
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = 'transparent';
                                        }}
                                    >
                                        <span className="font-medium">{date.getDate()}</span>
                                        {/* Message indicator dot */}
                                        {hasMessages && (
                                            <div className="absolute bottom-1 flex items-center justify-center">
                                                <div
                                                    className="w-1.5 h-1.5 rounded-full"
                                                    style={{ backgroundColor: theme.modals.accentColor }}
                                                />
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </BaseModal>
    );
};
