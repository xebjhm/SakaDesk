import React, { useRef, useState } from 'react';
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
 * in that month's dominant colour, newest at the top. Segments share the ribbon's height equally
 * (however many months there are, none is clipped, and a drag maps 1:1 onto them). A click, a
 * drag along the ribbon or ↑ / ↓ / Home / End on the focused segment selects a month (↑ newer,
 * ↓ older; stops at the ends); the ribbon is one Tab stop (a roving `tabIndex`). The colours are
 * the data-driven exception (DESIGN_SYSTEM.md "Memories keepsake surfaces"): applied through
 * `style`; a month without one gets the neutral `bg-sunken`.
 */
export const ColorRibbon: React.FC<ColorRibbonProps> = ({ months, onSelect, className }) => {
    const { t, i18n } = useTranslation();
    const segments = useRef<(HTMLButtonElement | null)[]>([]);
    // The month a drag last selected, so moving within one segment selects it once.
    const dragged = useRef<string | null>(null);
    // Roving tab stop: only the last selected segment (else the newest) is in the Tab order.
    const [current, setCurrent] = useState(0);
    const focusIndex = Math.min(current, Math.max(0, months.length - 1));
    const select = (index: number) => {
        setCurrent(index);
        onSelect(months[index].month);
    };

    const monthAt = (el: HTMLElement, clientY: number): string | null => {
        const rect = el.getBoundingClientRect();
        if (!months.length || rect.height <= 0) return null;
        const at = Math.floor(((clientY - rect.top) / rect.height) * months.length);
        return months[Math.min(months.length - 1, Math.max(0, at))].month;
    };
    const pick = (month: string | null) => {
        if (month === null || month === dragged.current) return;
        dragged.current = month;
        const index = months.findIndex((m) => m.month === month);
        if (index >= 0) setCurrent(index);
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
        const keys: Record<string, number> = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: months.length - 1 };
        if (!(e.key in keys)) return;
        e.preventDefault();
        const next = keys[e.key];
        if (next < 0 || next >= months.length || next === index) return;
        segments.current[next]?.focus();
        select(next);
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
                    tabIndex={i === focusIndex ? 0 : -1}
                    onClick={(e) => { if (e.detail === 0) select(i); }}
                    onKeyDown={(e) => onKeyDown(e, i)}
                    style={m.color ? { backgroundColor: m.color } : undefined}
                    className={cn(
                        'min-h-0 w-full flex-1 basis-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                        !m.color && 'bg-sunken',
                    )}
                />
            ))}
        </div>
    );
};
