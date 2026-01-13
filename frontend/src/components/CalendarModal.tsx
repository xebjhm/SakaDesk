import React, { useState, useEffect, useMemo } from 'react';
import { X, ChevronLeft, ChevronRight, RefreshCw, Calendar } from 'lucide-react';
import { cn } from '../lib/utils';

interface DateCount {
    date: string;
    count: number;
}

interface CalendarModalProps {
    isOpen: boolean;
    onClose: () => void;
    conversationPath: string;
    onSelectDate: (date: string) => void;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

export const CalendarModal: React.FC<CalendarModalProps> = ({
    isOpen,
    onClose,
    conversationPath,
    onSelectDate,
}) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [messageDates, setMessageDates] = useState<DateCount[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch message dates
    const fetchDates = async () => {
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
            setMessageDates(data.dates || []);
        } catch (err: any) {
            setError(err.message || 'Failed to load dates');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchDates();
        }
    }, [isOpen, conversationPath]);

    // Create a set of dates with messages for quick lookup
    const datesWithMessages = useMemo(() => {
        return new Set(messageDates.map(d => d.date));
    }, [messageDates]);

    // Get message count for a date
    const getMessageCount = (dateStr: string): number => {
        const item = messageDates.find(d => d.date === dateStr);
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
                dateStr: d.toISOString().slice(0, 10),
            });
        }

        // Current month days
        for (let i = 1; i <= daysInMonth; i++) {
            const d = new Date(year, month, i);
            days.push({
                date: d,
                isCurrentMonth: true,
                dateStr: d.toISOString().slice(0, 10),
            });
        }

        // Next month days to fill (to complete 6 rows)
        const remaining = 42 - days.length;
        for (let i = 1; i <= remaining; i++) {
            const d = new Date(year, month + 1, i);
            days.push({
                date: d,
                isCurrentMonth: false,
                dateStr: d.toISOString().slice(0, 10),
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

    const handleDateClick = (dateStr: string) => {
        if (datesWithMessages.has(dateStr)) {
            onSelectDate(dateStr);
            onClose();
        }
    };

    const isToday = (dateStr: string) => {
        return dateStr === new Date().toISOString().slice(0, 10);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl max-w-md w-full shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-[#a8c4e8] via-[#a0a9d8] to-[#9181c4] px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Calendar className="w-5 h-5 text-white" />
                        <h3 className="text-lg font-bold text-white">日期搜索</h3>
                    </div>
                    <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

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
                            {currentDate.getFullYear()}年 {MONTHS[currentDate.getMonth()]}
                        </span>
                        <button
                            onClick={goToToday}
                            className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                        >
                            今日
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
                        <div className="flex items-center justify-center py-12">
                            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                        </div>
                    ) : error ? (
                        <div className="text-center py-8 text-red-600">
                            {error}
                            <button
                                onClick={fetchDates}
                                className="block mx-auto mt-2 text-blue-600 hover:underline"
                            >
                                Retry
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* Weekday headers */}
                            <div className="grid grid-cols-7 mb-2">
                                {WEEKDAYS.map((day, i) => (
                                    <div
                                        key={day}
                                        className={cn(
                                            "text-center text-xs font-medium py-2",
                                            i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-gray-500"
                                        )}
                                    >
                                        {day}
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
                                            onClick={() => handleDateClick(dateStr)}
                                            disabled={!hasMessages}
                                            title={hasMessages ? `${getMessageCount(dateStr)} messages` : undefined}
                                            className={cn(
                                                "aspect-square flex flex-col items-center justify-center rounded-lg text-sm transition-all relative",
                                                !isCurrentMonth && "opacity-30",
                                                isCurrentMonth && !hasMessages && "text-gray-400",
                                                hasMessages && "text-gray-900 hover:bg-blue-50 cursor-pointer",
                                                today && "ring-2 ring-blue-500 ring-offset-1",
                                                dayOfWeek === 0 && isCurrentMonth && "text-red-500",
                                                dayOfWeek === 6 && isCurrentMonth && "text-blue-500",
                                            )}
                                        >
                                            <span className="font-medium">{date.getDate()}</span>
                                            {/* Message indicator dot */}
                                            {hasMessages && (
                                                <div className="absolute bottom-1 flex items-center justify-center">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </div>

                {/* Footer with stats */}
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 text-center text-sm text-gray-500">
                    {messageDates.length > 0 ? (
                        <span>
                            {messageDates.length} 日間にメッセージがあります
                        </span>
                    ) : (
                        <span>日付をタップしてジャンプ</span>
                    )}
                </div>
            </div>
        </div>
    );
};
