import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { GroupedVirtuoso, type GroupedVirtuosoHandle, type ListRange } from 'react-virtuoso';
import { clientLog } from '../../../utils/clientLog';
import { cn } from '../../../utils/classnames';
import { primeMediaMeta } from './mediaMeta';
import { rootRemPx, useGridColumns } from './useGridColumns';
import { MEDIA_GRID_GAP_REM } from '../tileGrid';
import { MediaGridContext, type MediaGridTileReporter } from './gridContext';

export interface MediaGridGroup<T> {
    key: string;
    /** The sticky header text (translated / formatted by the caller). */
    label: string;
    items: T[];
}

export interface VirtualMediaGridHandle {
    /** Scroll a group's header to the top. Unknown keys are ignored. */
    scrollToGroup(key: string): void;
    /** Scroll the row of the item at `flatIndex` (across all groups, in order) to the top. */
    scrollToItem(flatIndex: number): void;
}

export interface VirtualMediaGridProps<T> {
    groups: MediaGridGroup<T>[];
    itemKey(item: T): string;
    /** The item's media-route URL (primed into the meta store ahead of scrolling). */
    mediaUrl(item: T): string | null | undefined;
    /** One tile; `tilePx` is its edge in CSS px (pass it to `MediaTile cssPx`). */
    renderTile(item: T, flatIndex: number, tilePx: number): React.ReactNode;
    /** The scrolling element (the Modal body); the grid scrolls with it. */
    scrollParent: HTMLElement | null;
    /** The `media_grid` breadcrumb's grid code. */
    grid: 'messages' | 'blogs';
    /** Narrowest tile in px (default `tileGrid.ts`, 9rem). */
    minTilePx?: number;
    /** Widest tile in px (default: none, `tileGrid.ts`'s at most 6 per row). */
    maxTilePx?: number;
    /** Gap in px (default `tileGrid.ts`, 0.5rem). */
    gapPx?: number;
    /** Rendered after the last row, e.g. a "more pages" `StatusBlock variant="inline"`. */
    footer?: React.ReactNode;
    className?: string;
}

/** Rows rendered beyond the screen (px): far rows unmount, so DOM and image memory stay bounded. */
const OVERSCAN = { top: 400, bottom: 1200 } as const;
/** Screens of items primed ahead of the rendered rows. */
const PRIME_SCREENS_AHEAD = 2;

interface Layout<T> {
    /** Rows per group. */
    rowCounts: number[];
    /** First row (Virtuoso item index) of each group. */
    rowStarts: number[];
    /** First flat item index of each group. */
    itemStarts: number[];
    /** Each row: its group and the flat index of its first item. */
    rows: { group: number; first: number; items: T[] }[];
    flat: T[];
}

function layout<T>(groups: MediaGridGroup<T>[], cols: number): Layout<T> {
    const rowCounts: number[] = [];
    const rowStarts: number[] = [];
    const itemStarts: number[] = [];
    const rows: Layout<T>['rows'] = [];
    const flat: T[] = [];
    groups.forEach((group, g) => {
        rowStarts.push(rows.length);
        itemStarts.push(flat.length);
        const count = Math.ceil(group.items.length / cols);
        rowCounts.push(count);
        for (let r = 0; r < count; r += 1) {
            rows.push({ group: g, first: flat.length + r * cols, items: group.items.slice(r * cols, (r + 1) * cols) });
        }
        // A loop, not a spread: one huge group (tens of thousands) must not hit the argument limit.
        for (const item of group.items) flat.push(item);
    });
    return { rowCounts, rowStarts, itemStarts, rows, flat };
}

function VirtualMediaGridInner<T>(props: VirtualMediaGridProps<T>, ref: React.ForwardedRef<VirtualMediaGridHandle>) {
    const { groups, itemKey, mediaUrl, renderTile, scrollParent, grid, minTilePx, maxTilePx, gapPx, footer, className } = props;
    const wrapperRef = useRef<HTMLDivElement>(null);
    const virtuosoRef = useRef<GroupedVirtuosoHandle>(null);
    const { cols, tilePx } = useGridColumns(wrapperRef, { minTilePx, maxTilePx, gapPx });
    const gap = gapPx ?? undefined;
    const rowGapPx = gapPx ?? MEDIA_GRID_GAP_REM * rootRemPx();
    const grouped = useMemo(() => layout(groups, cols), [groups, cols]);
    const latest = useRef({ grouped, mediaUrl, cols });
    latest.current = { grouped, mediaUrl, cols };

    useImperativeHandle(ref, () => ({
        scrollToGroup(key) {
            const groupIndex = groups.findIndex((g) => g.key === key);
            if (groupIndex < 0) return;
            virtuosoRef.current?.scrollToIndex({ groupIndex, align: 'start' });
        },
        scrollToItem(flatIndex) {
            const { itemStarts, rowStarts, flat } = latest.current.grouped;
            if (flatIndex < 0 || flatIndex >= flat.length) return;
            let g = itemStarts.length - 1;
            while (g > 0 && itemStarts[g] > flatIndex) g -= 1;
            const row = rowStarts[g] + Math.floor((flatIndex - itemStarts[g]) / latest.current.cols);
            virtuosoRef.current?.scrollToIndex({ index: row, align: 'start' });
        },
    }), [groups]);

    const onRange = useCallback((range: ListRange) => {
        const { grouped: current, mediaUrl: urlOf } = latest.current;
        const start = Math.max(0, range.startIndex);
        const end = Math.min(current.rows.length - 1, range.endIndex);
        if (end < start) return;
        const screen = end - start + 1;
        const last = Math.min(current.rows.length - 1, end + screen * PRIME_SCREENS_AHEAD);
        const urls: (string | null | undefined)[] = [];
        for (let r = start; r <= last; r += 1) current.rows[r].items.forEach((item) => urls.push(urlOf(item)));
        primeMediaMeta(urls);
    }, []);

    // The first-paint breadcrumb: mount → the first visible tile's image ready, once per mount.
    const mountedAt = useRef(performance.now());
    const visibleCount = useRef(0);
    const logged = useRef(false);
    const total = grouped.flat.length;
    const totalRef = useRef(total);
    totalRef.current = total;
    const reporter = useMemo<MediaGridTileReporter>(() => ({
        root: scrollParent,
        tileVisible(delta) {
            visibleCount.current = Math.max(0, visibleCount.current + delta);
        },
        tileReady() {
            if (logged.current) return;
            logged.current = true;
            clientLog('media_grid', {
                grid,
                first_tile_ms: Math.max(0, Math.round(performance.now() - mountedAt.current)),
                visible: visibleCount.current,
                count: totalRef.current,
            });
        },
    }), [grid, scrollParent]);

    useEffect(() => {
        mountedAt.current = performance.now();
    }, []);

    const Footer = useMemo(() => (footer ? () => <>{footer}</> : undefined), [footer]);

    return (
        <div ref={wrapperRef} className={cn('w-full', className)}>
            <MediaGridContext.Provider value={reporter}>
                <GroupedVirtuoso
                    ref={virtuosoRef}
                    customScrollParent={scrollParent ?? undefined}
                    groupCounts={grouped.rowCounts}
                    increaseViewportBy={OVERSCAN}
                    defaultItemHeight={tilePx + rowGapPx}
                    computeItemKey={(index) => {
                        const row = grouped.rows[index];
                        return row && row.items.length > 0 ? `row-${itemKey(row.items[0])}` : `row-${index}`;
                    }}
                    rangeChanged={onRange}
                    components={Footer ? { Footer } : undefined}
                    groupContent={(g) => (
                        <div className="bg-sheet px-4 py-3 text-small font-semibold text-secondary">{groups[g]?.label}</div>
                    )}
                    itemContent={(index) => {
                        const row = grouped.rows[index];
                        if (!row) return null;
                        return (
                            <div
                                data-media-grid-row=""
                                className={cn('grid pb-2', gap === undefined && 'gap-2')}
                                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, ...(gap === undefined ? {} : { gap, paddingBottom: gap }) }}
                            >
                                {row.items.map((item, i) => (
                                    <React.Fragment key={itemKey(item)}>{renderTile(item, row.first + i, tilePx)}</React.Fragment>
                                ))}
                            </div>
                        );
                    }}
                />
            </MediaGridContext.Provider>
        </div>
    );
}

/**
 * The shared virtualised media grid (message and blog galleries): `GroupedVirtuoso` rows inside
 * the caller's scroll parent, one sticky header per group (e.g. a month), each row a CSS grid of
 * the computed columns (`useGridColumns`, `tileGrid.ts` density). Rows beyond the overscan
 * unmount. Visible rows plus two screens ahead are primed into the meta store; tiles report the
 * first visible ready image for the `media_grid` breadcrumb (`grid`, `first_tile_ms`, `visible`,
 * `count`), logged once per mount.
 */
export const VirtualMediaGrid = forwardRef(VirtualMediaGridInner) as <T>(
    props: VirtualMediaGridProps<T> & { ref?: React.Ref<VirtualMediaGridHandle> },
) => React.ReactElement;
