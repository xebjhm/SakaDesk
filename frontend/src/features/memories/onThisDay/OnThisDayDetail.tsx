import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import { DayView } from '../day/DayView';
import { sepiaClass } from '../shared/sepia';
import { MemoryThumb } from '../shared/MemoryThumb';
import { ThenNowPanel } from '../thenNow/ThenNowPanel';
import { ThenNowToggle } from '../thenNow/ThenNowToggle';
import type { OnThisDayPayload } from '../types';

interface OnThisDayDetailProps {
    service: string;
    /** `MM-DD`. */
    monthDay: string;
    year: number;
    /** The payload's years, oldest first. */
    years: OnThisDayPayload['years'];
    onSelectYear: (year: number) => void;
}

const ROW = 'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left';

/**
 * On This Day A: the year list on the left (newest first; a year with messages shows its one
 * number and photo, a year without is dimmed with 「この日はメッセージがありません」 and cannot be
 * picked) and the 那一天 view of `YYYY-MM-DD` on the right. The day view's header carries the ⇆
 * あの日と今日 toggle when a later year has messages on this month-day (so there is a pair to show;
 * that needs at least two years with messages): toggled, the pane shows `ThenNowPanel` (day mode
 * for the selected date) instead of the day view, with the toggle in its header to go back.
 * Picking another year resets the toggle.
 */
export const OnThisDayDetail: React.FC<OnThisDayDetailProps> = ({ service, monthDay, year, years, onSelectYear }) => {
    const { t } = useTranslation();
    const newestFirst = [...years].reverse();
    // Any change of year resets the comparison (adjusted during render, so the new year never
    // flashes the panel); coming back to a year starts untoggled too.
    const [thenNow, setThenNow] = useState(false);
    const [shownYear, setShownYear] = useState(year);
    if (shownYear !== year) {
        setShownYear(year);
        setThenNow(false);
    }
    const comparable = years.some((y) => y.has_messages && y.year > year);
    const toggle = <ThenNowToggle on={thenNow} available={comparable} onChange={setThenNow} />;
    const selectedRef = useRef<HTMLButtonElement>(null);
    // Entering from the strip unmounts the clicked column and drops focus to the body: put it on
    // the selected year so ← / → work at once (unless focus is already somewhere on purpose).
    useEffect(() => {
        const active = document.activeElement;
        if (!active || active === document.body) selectedRef.current?.focus({ preventScroll: true });
    }, []);
    return (
        <div className="flex min-h-0 flex-1">
            <nav className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto p-2">
                {newestFirst.map((y) => {
                    if (!y.has_messages) {
                        return (
                            <div
                                key={y.year}
                                data-testid="otd-year-row"
                                data-year={y.year}
                                aria-disabled="true"
                                className={cn(ROW, 'opacity-60')}
                            >
                                <span aria-hidden="true" className="h-10 w-10 shrink-0 rounded-md bg-sunken" />
                                <span className="flex min-w-0 flex-col">
                                    <span className="font-display text-title text-secondary">{y.year}</span>
                                    <span className="text-caption text-muted">{t('memories.onThisDay.noMessages')}</span>
                                </span>
                            </div>
                        );
                    }
                    const selected = y.year === year;
                    return (
                        <button
                            key={y.year}
                            type="button"
                            data-testid="otd-year-row"
                            data-year={y.year}
                            ref={selected ? selectedRef : undefined}
                            aria-current={selected ? 'true' : undefined}
                            onClick={() => onSelectYear(y.year)}
                            className={cn(
                                ROW,
                                'transition-colors duration-fast ease-standard hover:bg-sunken',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                                selected && 'bg-accent-subtle hover:bg-accent-subtle',
                            )}
                        >
                            {y.thumb?.media_url ? (
                                <MemoryThumb message={y.thumb} px={40} className={cn('h-10 w-10 shrink-0 rounded-md', sepiaClass(y.year))} />
                            ) : (
                                <span aria-hidden="true" className="h-10 w-10 shrink-0 rounded-md bg-sunken" />
                            )}
                            <span className="flex min-w-0 flex-col">
                                <span className={cn('font-display text-title', selected ? 'text-accent-strong' : 'text-primary')}>{y.year}</span>
                                <span className="text-caption tabular-nums text-muted">{t('memories.day.count', { count: y.message_count })}</span>
                            </span>
                        </button>
                    );
                })}
            </nav>
            {thenNow && comparable
                ? <ThenNowPanel service={service} date={`${year}-${monthDay}`} headerSlot={toggle} />
                : <DayView service={service} date={`${year}-${monthDay}`} headerSlot={toggle} />}
        </div>
    );
};
