import React, { useRef } from 'react';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import { formatMonth } from './albumViewer';

export interface RibbonMonth {
    /** `YYYY-MM`. */
    month: string;
    /** The month's ribbon colour (runtime data from `/album/colors`), or null. */
    color: string | null;
}

interface ColorRibbonProps {
    /** Newest first (drawn top to bottom). */
    months: RibbonMonth[];
    onSelect: (month: string) => void;
    className?: string;
}

/**
 * The album's monthly colour ribbon (spec 8), a scrubber on the right edge: one segment per month
 * in that month's dominant colour, newest at the top. A click, a drag along the ribbon or ↑ / ↓
 * on a focused segment selects a month (↑ newer, ↓ older; stops at the ends). The colours are
 * the data-driven exception (DESIGN_SYSTEM.md "Memories keepsake surfaces"): applied through
 * `style`; a month without one gets the neutral `bg-sunken`.
 */
export const ColorRibbon: React.FC<ColorRibbonProps> = ({ months, onSelect, className }) => {
    const { t, i18n } = useTranslation();
    const segments = useRef<(HTMLButtonElement | null)[]>([]);
    // The month a drag last selected, so moving within one segment selects it once.
    const dragged = useRef<string | null>(null);

    const monthAt = (el: HTMLElement, clientY: number): string | null => {
        const rect = el.getBoundingClientRect();
        if (!months.length || rect.height <= 0) return null;
        const at = Math.floor(((clientY - rect.top) / rect.height) * months.length);
        return months[Math.min(months.length - 1, Math.max(0, at))].month;
    };
    const pick = (month: string | null) => {
        if (month === null || month === dragged.current) return;
        dragged.current = month;
        onSelect(month);
    };

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        dragged.current = null;
        // The pressed segment itself, else the point along the ribbon.
        const hit = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[data-month]') : null;
        pick(hit?.dataset.month ?? monthAt(e.currentTarget, e.clientY));
    };
    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (dragged.current === null) return;
        pick(monthAt(e.currentTarget, e.clientY));
    };
    const endDrag = () => { dragged.current = null; };

    const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
        const next = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : null;
        if (next === null) return;
        e.preventDefault();
        if (next < 0 || next >= months.length) return;
        segments.current[next]?.focus();
        onSelect(months[next].month);
    };

    return (
        <div
            role="group"
            aria-label={t('memories.album.ribbon')}
            data-testid="album-ribbon"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className={cn('flex w-3 shrink-0 touch-none select-none flex-col overflow-hidden rounded-pill', className)}
        >
            {months.map((m, i) => (
                <button
                    key={m.month}
                    ref={(el) => { segments.current[i] = el; }}
                    type="button"
                    data-month={m.month}
                    aria-label={formatMonth(t, 'memories.album.ribbonLabel', m.month, i18n.language)}
                    // Pointer selection happens on the ribbon (drag-aware); keyboard Enter / Space still clicks.
                    onClick={(e) => { if (e.detail === 0) onSelect(m.month); }}
                    onKeyDown={(e) => onKeyDown(e, i)}
                    style={m.color ? { backgroundColor: m.color } : undefined}
                    className={cn(
                        'min-h-1 w-full flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                        !m.color && 'bg-sunken',
                    )}
                />
            ))}
        </div>
    );
};
