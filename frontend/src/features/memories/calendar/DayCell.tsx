import React from 'react';
import { Play } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import { holidayName } from '../../../utils/jpHolidays';
import { dayTone, DAY_TONE_CLASS, type MonthCell } from '../../../core/calendar/monthGrid';
import { formatDayHeading } from '../day/format';
import { MemoryThumb } from '../shared/MemoryThumb';
import type { CalendarDay } from '../types';
import { DEFAULT_CELL_PX } from './cellSize';

/** Member dots drawn at most; the count itself is only in the accessible name. */
export const MAX_DOTS = 5;

interface DayCellProps {
    cell: MonthCell;
    /** The day's payload when it has messages (in-month days only); undefined = an empty, grey day. */
    data: CalendarDay | undefined;
    /** The cell's drawn longest side in CSS px (`cellThumbPx` of the measured grid): the thumbnail width. */
    px?: number;
    onOpen: (date: string) => void;
}

/**
 * One calendar album day (spec 13). A day with messages is a button over the day's best photo
 * (from the thumbnail route at the cell's drawn size; a video-only day shows the clip's first
 * frame as a still, with the play mark) with the date in a frosted chip, the holiday name (Japanese,
 * truncated) and up to five member dots (never a digit: the people count is only in the
 * accessible name, with the date and the holiday). A day without messages is a grey, inert
 * cell; days of the neighbouring months are faded and carry no weekend colour.
 */
export const DayCell: React.FC<DayCellProps> = ({ cell, data, px = DEFAULT_CELL_PX, onOpen }) => {
    const { t, i18n } = useTranslation();
    const { date, dateStr, inMonth } = cell;
    const day = inMonth ? data : undefined;
    const holiday = inMonth ? holidayName(dateStr) : null;
    const tone = inMonth ? dayTone(date) : null;
    const photo = day?.photo ?? null;
    const dots = day ? Math.min(day.members, MAX_DOTS) : 0;

    const number = (
        <span
            className={cn(
                'rounded-pill px-1.5 text-caption font-semibold tabular-nums',
                photo && 'bg-frost backdrop-blur-frost',
                tone ? DAY_TONE_CLASS[tone] : day ? 'text-primary' : 'text-muted',
            )}
        >
            {date.getDate()}
        </span>
    );
    const holidayLabel = holiday && (
        <span lang="ja" className={cn('min-w-0 truncate text-caption text-calendar-holiday', photo && 'rounded-pill bg-frost px-1.5 backdrop-blur-frost')}>
            {holiday}
        </span>
    );
    const corner = <span className="relative flex min-w-0 items-center gap-1 p-1">{number}{holidayLabel}</span>;

    if (!day) {
        return (
            <div
                data-testid={`calendar-cell-${dateStr}`}
                data-outside={inMonth ? undefined : ''}
                className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md bg-sunken', !inMonth && 'opacity-60')}
            >
                {corner}
            </div>
        );
    }

    const label = [
        formatDayHeading(dateStr, i18n.language),
        holiday,
        day.members > 0 ? t('memories.calendar.members', { count: day.members }) : null,
    ].filter(Boolean).join(', ');

    return (
        <div data-testid={`calendar-cell-${dateStr}`} className="relative min-h-0 min-w-0 overflow-hidden rounded-md bg-card shadow-card">
            <button
                type="button"
                aria-label={label}
                onClick={() => onOpen(dateStr)}
                className={cn(
                    'absolute inset-0 flex flex-col items-start text-left',
                    'transition-shadow duration-fast ease-standard hover:ring-2 hover:ring-inset hover:ring-strong',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                )}
            >
                {photo && <MemoryThumb message={photo} px={px} className="absolute inset-0 h-full w-full" />}
                {corner}
                {photo?.type === 'video' && (
                    <Play
                        data-testid="calendar-video-mark"
                        aria-hidden="true"
                        className="absolute bottom-1 left-1 h-3.5 w-3.5 fill-current text-inverse drop-shadow-sm"
                    />
                )}
                {dots > 0 && (
                    <span aria-hidden="true" className="absolute bottom-1 right-1 flex gap-0.5">
                        {Array.from({ length: dots }, (_, i) => (
                            <span key={i} data-testid="calendar-dot" className="h-1.5 w-1.5 rounded-pill bg-card ring-1 ring-strong" />
                        ))}
                    </span>
                )}
            </button>
        </div>
    );
};
