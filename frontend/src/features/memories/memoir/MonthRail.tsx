import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { IconButton } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';
import { fisheyeIndex, fisheyePosition, ZOOM_CONFIG } from '../../blogs/components/fisheye';
import type { TimelineMonthCount } from '../types';

/** Space before the oldest and after the newest month, in px. */
export const RAIL_PADDING = 24;
/** Wheel delta (px) that makes one month step; trackpads add up their small deltas. */
const WHEEL_STEP = 40;
/** Two year labels closer than this (px) would overlap: the later one is skipped. */
const YEAR_GAP = 36;
/** The lowest drawn bar of a month with messages, in % of the bar area (an empty month is a tick). */
const MIN_BAR = 8;

interface MonthRailProps {
    /** Continuous months, oldest first (`count` may be 0). */
    months: TimelineMonthCount[];
    /** The selected month's index. */
    index: number;
    onSelect: (index: number) => void;
    /** A month's label (`aria-valuetext`, the hover caption). */
    label: (month: string) => string;
}

/** `left` along the rail for a normalized position, inside the padding. */
const leftAt = (pos: number) => `calc(${RAIL_PADDING}px + ${pos} * (100% - ${2 * RAIL_PADDING}px))`;

/**
 * The 時光軸 month rail (spec 5.4): one bar per month (height ∝ `count`; an empty month is a
 * baseline tick and never shows a number), oldest on the left, the selected month in the strong
 * accent. Interaction is the blogs `TimelineRail`'s: a hover dwell zooms in (`fisheye.ts`, with
 * the `bg-accent-lens` glow), a pointer drag scrubs, the wheel steps a month, ← / → (and the
 * older / newer buttons) step older / newer, Home / End jump to the ends. Year labels sit under
 * the first month of each year.
 *
 * To stay smooth over 60–100 months, a pointer move only sets state when the hovered index changes
 * and `onSelect` fires only for a new month; the bars are memoised on the months, zoom and selection.
 * Under reduced motion nothing animates.
 */
export const MonthRail: React.FC<MonthRailProps> = ({ months, index, onSelect, label }) => {
    const { t } = useTranslation();
    const railRef = useRef<HTMLDivElement>(null);
    const count = months.length;
    const last = count - 1;

    const [hover, setHover] = useState<number | null>(null);
    const [isZoomed, setIsZoomed] = useState(false);
    const [zoomCenter, setZoomCenter] = useState<number | null>(null);
    // The lens centre outlives the zoom so the glow fades out where it was.
    const [lensCenter, setLensCenter] = useState<number | null>(null);
    const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastHoverIndexRef = useRef<number | null>(null);
    const draggingRef = useRef(false);
    const wheelRef = useRef(0);
    // The month a drag last picked: a drag selects each month once.
    const pickedRef = useRef(index);
    const [width, setWidth] = useState(0);

    const center = isZoomed ? zoomCenter : null;

    useEffect(() => () => {
        if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    }, []);

    useEffect(() => {
        const el = railRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const step = (to: number) => {
        const next = Math.max(0, Math.min(last, to));
        if (next !== index) onSelect(next);
    };

    const indexAt = (clientX: number): number => {
        const rect = railRef.current?.getBoundingClientRect();
        if (!rect) return index;
        const usable = Math.max(rect.width - RAIL_PADDING * 2, 1);
        const pos = Math.max(0, Math.min(1, (clientX - rect.left - RAIL_PADDING) / usable));
        return Math.max(0, Math.min(last, fisheyeIndex(pos, count, center)));
    };

    /** TimelineRail's dwell: zoom after a still pointer, then follow it in big jumps only. */
    const dwell = (at: number) => {
        if (!isZoomed) {
            const prev = lastHoverIndexRef.current;
            if (prev === null || Math.abs(at - prev) > ZOOM_CONFIG.dwellTolerance) {
                if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
                lastHoverIndexRef.current = at;
                dwellTimerRef.current = setTimeout(() => {
                    setZoomCenter(at);
                    setLensCenter(at);
                    setIsZoomed(true);
                }, ZOOM_CONFIG.dwellTime);
            }
        } else if (zoomCenter !== null && Math.abs(at - zoomCenter) > ZOOM_CONFIG.dwellTolerance * 2) {
            setZoomCenter(at);
            setLensCenter(at);
        }
    };

    const pick = (at: number) => {
        if (at !== pickedRef.current) {
            pickedRef.current = at;
            onSelect(at);
        }
    };

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0 || count === 0) return;
        draggingRef.current = true;
        pickedRef.current = index;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        pick(indexAt(e.clientX));
    };
    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (count === 0) return;
        const at = indexAt(e.clientX);
        if (at !== hover) setHover(at);
        dwell(at);
        if (draggingRef.current) pick(at);
    };
    const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
        draggingRef.current = false;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
    };
    const onPointerLeave = () => {
        if (draggingRef.current) return;
        if (dwellTimerRef.current) {
            clearTimeout(dwellTimerRef.current);
            dwellTimerRef.current = null;
        }
        lastHoverIndexRef.current = null;
        setIsZoomed(false);
        setZoomCenter(null);
        setHover(null);
    };

    const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
        const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        wheelRef.current += delta;
        if (Math.abs(wheelRef.current) < WHEEL_STEP) return;
        const dir = wheelRef.current > 0 ? 1 : -1;
        wheelRef.current = 0;
        step(index + dir);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const to = {
            ArrowLeft: index - 1, ArrowDown: index - 1, ArrowRight: index + 1, ArrowUp: index + 1, Home: 0, End: last,
        }[e.key];
        if (to === undefined) return;
        e.preventDefault();
        step(to);
    };

    const max = useMemo(() => months.reduce((m, x) => Math.max(m, x.count), 0), [months]);

    const bars = useMemo(() => months.map((m, i) => {
        const left = leftAt(fisheyePosition(i, count, center));
        const selected = i === index;
        if (m.count === 0) {
            return (
                <span
                    key={m.month}
                    data-testid="month-rail-tick"
                    data-selected={selected ? 'true' : undefined}
                    className={cn(
                        'absolute bottom-0 h-1.5 -translate-x-1/2 border-l transition-[left] duration-lens ease-in-out motion-reduce:transition-none',
                        selected ? 'border-accent-strong' : 'border-strong',
                    )}
                    style={{ left }}
                />
            );
        }
        const height = `${Math.max(MIN_BAR, Math.round((m.count / max) * 100))}%`;
        return (
            <span
                key={m.month}
                data-testid="month-rail-bar"
                data-selected={selected ? 'true' : undefined}
                className={cn(
                    'absolute bottom-0 w-1 -translate-x-1/2 rounded-t-sm transition-[left] duration-lens ease-in-out motion-reduce:transition-none',
                    selected ? 'bg-accent-strong' : 'bg-skeleton',
                )}
                style={{ left, height }}
            />
        );
    }), [months, count, center, index, max]);

    const years = useMemo(() => {
        const out: Array<{ year: string; pos: number }> = [];
        months.forEach((m, i) => {
            if (i !== 0 && !m.month.endsWith('-01')) return;
            const pos = fisheyePosition(i, count, center);
            const prev = out[out.length - 1];
            if (prev && width > 0 && (pos - prev.pos) * (width - 2 * RAIL_PADDING) < YEAR_GAP) return;
            out.push({ year: m.month.slice(0, 4), pos });
        });
        return out;
    }, [months, count, center, width]);

    if (count === 0) return null;

    const selectedMonth = months[Math.max(0, Math.min(last, index))];
    const hovered = hover !== null ? months[hover] : undefined;

    return (
        <div className="flex shrink-0 items-center gap-1 border-t border-subtle px-2 py-2">
            <IconButton variant="ghost" size="sm" aria-label={t('memories.timeline.older')} disabled={index <= 0} onClick={() => step(index - 1)}
                icon={<ChevronLeft className="h-4 w-4" />} />
            <div
                ref={railRef}
                role="slider"
                tabIndex={0}
                aria-label={t('memories.timeline.rail')}
                aria-orientation="horizontal"
                aria-valuemin={0}
                aria-valuemax={last}
                aria-valuenow={index}
                aria-valuetext={label(selectedMonth.month)}
                data-testid="month-rail"
                className="relative h-24 min-w-0 flex-1 cursor-pointer touch-none select-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onPointerLeave={onPointerLeave}
                onWheel={onWheel}
                onKeyDown={onKeyDown}
            >
                {/* Light through a lens (as TimelineRail): a soft strong-accent glow over the magnified zone. */}
                <div
                    data-testid="month-rail-lens"
                    aria-hidden="true"
                    className={cn(
                        'pointer-events-none absolute inset-y-0 w-24 -translate-x-1/2 bg-accent-lens',
                        'transition-opacity duration-lens ease-out motion-reduce:transition-none',
                        center !== null ? 'opacity-100' : 'opacity-0',
                    )}
                    style={lensCenter !== null ? { left: leftAt(fisheyePosition(lensCenter, count, center)) } : undefined}
                />
                <div aria-hidden="true" className="absolute bottom-6 border-t border-subtle" style={{ left: RAIL_PADDING, right: RAIL_PADDING }} />
                <div aria-hidden="true" className="absolute inset-x-0 bottom-6 top-6">{bars}</div>
                <div aria-hidden="true">
                    {years.map((y) => (
                        <span
                            key={y.year}
                            className="absolute bottom-1 -translate-x-1/2 whitespace-nowrap text-caption font-medium tabular-nums text-muted transition-[left] duration-lens ease-in-out motion-reduce:transition-none"
                            style={{ left: leftAt(y.pos) }}
                        >
                            {y.year}
                        </span>
                    ))}
                </div>
                {hovered && hover !== null && (
                    <span
                        aria-hidden="true"
                        className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-sm bg-toast px-2 py-0.5 text-caption text-viewer"
                        style={{ left: leftAt(fisheyePosition(hover, count, center)) }}
                    >
                        {label(hovered.month)}
                    </span>
                )}
            </div>
            <IconButton variant="ghost" size="sm" aria-label={t('memories.timeline.newer')} disabled={index >= last} onClick={() => step(index + 1)}
                icon={<ChevronRight className="h-4 w-4" />} />
        </div>
    );
};
