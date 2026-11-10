import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../../utils/classnames';
import { clientLog } from '../../utils/clientLog';
import { useTranslation } from '../../i18n';
import { MONTH_KEYS, monthKey } from './monthGrid';
import { monthYearPickerLog } from './pickerLog';

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

interface MonthYearPickerProps {
    /** The years offered, oldest first. */
    years: number[];
    /** The year and 0-based month on screen (the picker opens on this year, this month selected). */
    year: number;
    month: number;
    /** A `YYYY-MM` month has dates (the accent dot; its year reads as dated). */
    hasData: (ym: string) => boolean;
    /** Every year and month reads as available (a free date picker); dots still follow `hasData`. */
    allAvailable?: boolean;
    onPick: (year: number, month0: number) => void;
    /** Escape inside the picker (claimed, logged `back` / `escape`): return to the days. */
    onBack: () => void;
    /**
     * The control that opened the picker (the month title). On mount focus moves to the month on
     * screen when it is on this control or nowhere, so a picker that renders late (the dates were
     * loading) never takes focus the user has moved elsewhere.
     */
    anchorRef?: React.RefObject<HTMLElement>;
}

/**
 * The year / month picker behind a calendar's month title (DESIGN_SYSTEM.md "Date-search
 * calendar"): a year list (the selected year scrolled into view) beside a 12-month grid. Dated
 * years and months are `text-primary` (months with the accent dot), the others `text-muted` but
 * still selectable (with a 「no messages」 note for screen readers); the selected year and the
 * month on screen carry the state colour. Shared by `CalendarModal` and the Memories calendar album.
 */
export const MonthYearPicker: React.FC<MonthYearPickerProps> = ({
    years, year, month, hasData, allAvailable = false, onPick, onBack, anchorRef,
}) => {
    const { t } = useTranslation();
    const [pickerYear, setPickerYear] = useState(year);
    const yearRef = useRef<HTMLButtonElement>(null);
    const monthRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        yearRef.current?.scrollIntoView?.({ block: 'nearest' });
        const active = document.activeElement;
        if (active === null || active === document.body || (anchorRef?.current != null && active === anchorRef.current)) {
            monthRef.current?.focus();
            monthRef.current?.scrollIntoView?.({ block: 'nearest' });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- on mount only
    }, []);

    const yearHasData = (y: number) => MONTH_KEYS.some((_, m) => hasData(monthKey(y, m)));

    const pick = (m: number) => {
        clientLog('calendar_picker', { phase: 'select', has_target: hasData(monthKey(pickerYear, m)) });
        onPick(pickerYear, m);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'Escape' || e.defaultPrevented || e.nativeEvent.isComposing) return;
        e.preventDefault();
        monthYearPickerLog.back('escape');
        onBack();
    };

    return (
        <div className="flex gap-4" onKeyDown={onKeyDown}>
            <div role="group" aria-label={t('calendar.yearList')} className="flex max-h-72 w-24 shrink-0 flex-col gap-1 overflow-y-auto p-1">
                {years.map((y) => {
                    const selected = y === pickerYear;
                    return (
                        <button
                            key={y}
                            ref={selected ? yearRef : undefined}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setPickerYear(y)}
                            className={cn(
                                'rounded-lg px-3 py-2 text-left text-small transition-colors duration-fast ease-standard',
                                FOCUS_RING,
                                selected
                                    ? 'bg-accent-subtle font-semibold text-accent-strong'
                                    : cn('hover:bg-sunken', allAvailable || yearHasData(y) ? 'text-primary' : 'text-muted'),
                            )}
                        >
                            {t('calendar.yearValue', { year: y })}
                        </button>
                    );
                })}
            </div>
            <div role="group" aria-label={t('calendar.monthGrid')} className="grid flex-1 grid-cols-3 content-start gap-2 p-1">
                {MONTH_KEYS.map((key, m) => {
                    const dated = hasData(monthKey(pickerYear, m));
                    const selected = pickerYear === year && m === month;
                    return (
                        <button
                            key={key}
                            ref={selected ? monthRef : undefined}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => pick(m)}
                            className={cn(
                                'relative flex flex-col items-center justify-center rounded-lg px-2 py-3 text-small',
                                'transition-colors duration-fast ease-standard',
                                FOCUS_RING,
                                selected
                                    ? 'bg-accent-subtle font-semibold text-accent-strong'
                                    : cn('hover:bg-sunken', allAvailable || dated ? 'text-primary' : 'text-muted'),
                            )}
                        >
                            <span>{t(`calendar.months.${key}`)}</span>
                            {!dated && !allAvailable && <span className="sr-only">, {t('calendar.noMessages')}</span>}
                            {dated && <span aria-hidden="true" className="absolute bottom-1 h-1.5 w-1.5 rounded-pill bg-accent" />}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
