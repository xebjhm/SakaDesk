import React, { useLayoutEffect } from 'react';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import { Card } from '../../../design/primitives';
import { MemoryText } from '../shared/MemoryText';
import { sepiaClass } from '../shared/sepia';
import { formatJstClock } from '../shared/jst';
import { MemoryThumb } from '../shared/MemoryThumb';
import { prefersReducedMotion } from '../shared/useReducedMotion';
import { useDragScroll } from './useDragScroll';
import type { OnThisDayYear } from '../types';

interface YearStripProps {
    /** Years with messages, oldest first. */
    years: OnThisDayYear[];
    /** The strip scrolls to the newest year when this changes (the month-day), never on a plain re-render. */
    resetKey: string;
    onOpen: (year: number) => void;
}

/**
 * On This Day B: one column per year with messages, oldest on the left, starting scrolled to
 * the newest. Each column shows the year (serif), that year's best photo aged by
 * `sepiaClass` (only the photo: the words stay at full contrast), up to three messages (her display name from the payload, her time and words)
 * and 「ほか N 件」 when there are more. The strip scrolls sideways only: pointer drag, the
 * wheel, and ← / → one column to the next column edge (older / newer); a column click opens that year.
 */
export const YearStrip: React.FC<YearStripProps> = ({ years, resetKey, onOpen }) => {
    const { t } = useTranslation();
    const { ref, handlers } = useDragScroll<HTMLDivElement>();

    useLayoutEffect(() => {
        const el = ref.current;
        if (el) el.scrollLeft = el.scrollWidth;
    }, [resetKey, ref]);

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const el = ref.current;
        const columns = el ? (Array.from(el.children) as HTMLElement[]) : [];
        if (!el || !columns.length) return;
        e.preventDefault();
        // Snap to column edges: the first column at least partly in view is the current one.
        const pad = columns[0].offsetLeft;
        const current = Math.max(0, columns.findIndex((c) => c.offsetLeft + c.offsetWidth - pad > el.scrollLeft + 1));
        const target = Math.min(columns.length - 1, Math.max(0, current + (e.key === 'ArrowLeft' ? -1 : 1)));
        el.scrollTo?.({ left: columns[target].offsetLeft - pad, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    };

    return (
        <div
            ref={ref}
            {...handlers}
            onKeyDown={onKeyDown}
            tabIndex={0}
            data-testid="otd-strip"
            className="flex min-h-0 flex-1 cursor-grab select-none gap-4 overflow-x-auto overflow-y-hidden px-4 pb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent active:cursor-grabbing"
        >
            {years.map((y) => (
                <Card
                    key={y.year}
                    role="button"
                    tabIndex={0}
                    data-testid="otd-column"
                    onClick={() => onOpen(y.year)}
                    onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        onOpen(y.year);
                    }}
                    className="flex w-64 shrink-0 cursor-pointer flex-col gap-3 overflow-hidden p-4 transition-shadow duration-fast ease-standard hover:shadow-sheet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
                >
                    <span data-testid="otd-year" className="font-display text-heading text-primary">{y.year}</span>
                    {y.thumb && (
                        <MemoryThumb message={y.thumb} px={160} className={cn('h-28 w-full shrink-0 rounded-md', sepiaClass(y.year))} />
                    )}
                    <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
                        {y.preview.map((m) => {
                            const words = m.text ?? m.caption;
                            if (!words) return null;
                            return (
                                <div key={`${m.room}|${m.id}`} className="rounded-md bg-sunken px-3 py-2">
                                    <div className="flex items-baseline gap-2 text-caption text-muted">
                                        <span lang="ja" className="min-w-0 truncate">{m.name}</span>
                                        <span className="tabular-nums">{formatJstClock(m.ts)}</span>
                                    </div>
                                    <MemoryText text={words} className="line-clamp-3 text-small text-primary" />
                                </div>
                            );
                        })}
                    </div>
                    {y.more !== null && y.more > 0 && (
                        <span className="mt-auto text-small text-muted">{t('memories.onThisDay.more', { count: y.more })}</span>
                    )}
                </Card>
            ))}
        </div>
    );
};
