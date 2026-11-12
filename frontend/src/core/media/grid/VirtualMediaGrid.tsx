import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { GroupedVirtuoso, type GroupedVirtuosoHandle, type ListRange } from 'react-virtuoso';
import { cn } from '../../../utils/classnames';
import { primeMediaMeta } from './mediaMeta';
import { rootRemPx, useGridColumns } from './useGridColumns';
import { MEDIA_GRID_GAP_REM } from '../tileGrid';
import { MediaGridContext } from './gridContext';
import { useMediaGridReporter, type MediaGridCode } from './useMediaGridReporter';
import { firstVisibleItem, rowOfItem, type GridRowBox } from './gridAnchor';

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
    grid: Exclude<MediaGridCode, 'album'>;
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
/** The stable "no slots" value for `components` (never `undefined`, see below). */
const NO_COMPONENTS = {} as const;

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
    /**
     * React keys in react-virtuoso's flat order, which counts group headers: header of group 0,
     * its rows, header of group 1, ... `GroupedVirtuoso` (4.18) calls `computeItemKey` with this
     * index for headers and rows alike. Headers are `group:<group key>`, rows `row:<first item
     * key>`, so a row keeps its key when rows before it move, and the two never collide.
     */
    keys: string[];
}

function layout<T>(groups: MediaGridGroup<T>[], cols: number, itemKey: (item: T) => string): Layout<T> {
    const rowCounts: number[] = [];
    const rowStarts: number[] = [];
    const itemStarts: number[] = [];
    const rows: Layout<T>['rows'] = [];
    const flat: T[] = [];
    const keys: string[] = [];
    groups.forEach((group, g) => {
        rowStarts.push(rows.length);
        itemStarts.push(flat.length);
        keys.push(`group:${group.key}`);
        const count = Math.ceil(group.items.length / cols);
        rowCounts.push(count);
        for (let r = 0; r < count; r += 1) {
            const rowItems = group.items.slice(r * cols, (r + 1) * cols);
            rows.push({ group: g, first: flat.length + r * cols, items: rowItems });
            keys.push(`row:${itemKey(rowItems[0])}`);
        }
        // A loop, not a spread: one huge group (tens of thousands) must not hit the argument limit.
        for (const item of group.items) flat.push(item);
    });
    return { rowCounts, rowStarts, itemStarts, rows, flat, keys };
}

function VirtualMediaGridInner<T>(props: VirtualMediaGridProps<T>, ref: React.ForwardedRef<VirtualMediaGridHandle>) {
    const { groups, itemKey, mediaUrl, renderTile, scrollParent, grid, minTilePx, maxTilePx, gapPx, footer, className } = props;
    const wrapperRef = useRef<HTMLDivElement>(null);
    const virtuosoRef = useRef<GroupedVirtuosoHandle>(null);
    const { cols, tilePx } = useGridColumns(wrapperRef, { minTilePx, maxTilePx, gapPx });
    const gap = gapPx ?? undefined;
    const rowGapPx = gapPx ?? MEDIA_GRID_GAP_REM * rootRemPx();
    // `itemKey` is read through a ref so an inline callback does not re-chunk every render.
    const itemKeyRef = useRef(itemKey);
    itemKeyRef.current = itemKey;
    const grouped = useMemo(() => layout(groups, cols, (item: T) => itemKeyRef.current(item)), [groups, cols]);
    const latest = useRef({ grouped, mediaUrl, cols });
    latest.current = { grouped, mediaUrl, cols };

    // Resize anchoring (D-M5): a column change reflows every row, so the same pixel scrollTop
    // lands on other items (another month). The anchor is the first visible item's KEY (so a
    // data change can never turn it into another item; a key no longer listed anchors nothing).
    // It is measured while the user scrolls. A programmatic scroll (a re-anchor, a jump) pins it:
    // the item stays the anchor, unmeasured, until a user gesture (wheel, touch, key, pointer),
    // so repeated column changes keep the same item even where the sticky header covers part of
    // its row. A change of `groups` unpins it and re-measures what is on screen.
    const anchorRef = useRef<string | null>(null);
    const pinnedRef = useRef(false);
    const prevColsRef = useRef(cols);

    /** Pins the item at `flatIndex` of the current layout as the anchor. */
    const pinAnchor = useCallback((flatIndex: number) => {
        const item = latest.current.grouped.flat[flatIndex];
        if (item === undefined) return;
        anchorRef.current = itemKeyRef.current(item);
        pinnedRef.current = true;
    }, []);

    const measureAnchor = useCallback(() => {
        // Pinned, or a column change rendered whose effect has not run yet (its rows are reflowed).
        if (pinnedRef.current || latest.current.cols !== prevColsRef.current) return;
        const wrapper = wrapperRef.current;
        if (!wrapper || !scrollParent) return;
        const header = wrapper.querySelector<HTMLElement>('[data-media-grid-header]');
        const viewTop = scrollParent.getBoundingClientRect().top + (header?.getBoundingClientRect().height ?? 0);
        const rows: GridRowBox[] = [];
        wrapper.querySelectorAll<HTMLElement>('[data-media-grid-row]').forEach((el) => {
            const rect = el.getBoundingClientRect();
            rows.push({ top: rect.top, bottom: rect.bottom, first: Number(el.dataset.first) });
        });
        const first = firstVisibleItem(rows, viewTop);
        const item = first === null ? undefined : latest.current.grouped.flat[first];
        anchorRef.current = item === undefined ? null : itemKeyRef.current(item);
    }, [scrollParent]);

    useImperativeHandle(ref, () => ({
        scrollToGroup(key) {
            const groupIndex = groups.findIndex((g) => g.key === key);
            if (groupIndex < 0) return;
            pinAnchor(latest.current.grouped.itemStarts[groupIndex]);
            virtuosoRef.current?.scrollToIndex({ groupIndex, align: 'start' });
        },
        scrollToItem(flatIndex) {
            const { itemStarts, rowStarts, flat } = latest.current.grouped;
            const row = rowOfItem(flatIndex, itemStarts, rowStarts, flat.length, latest.current.cols);
            if (row === null) return;
            pinAnchor(flatIndex);
            virtuosoRef.current?.scrollToIndex({ index: row, align: 'start' });
        },
    }), [groups, pinAnchor]);

    useEffect(() => {
        if (!scrollParent) return undefined;
        let frame = 0;
        const onScroll = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => { frame = 0; measureAnchor(); });
        };
        // Only the user's own scrolling releases a pinned anchor.
        const onGesture = () => { pinnedRef.current = false; };
        const gestures = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
        scrollParent.addEventListener('scroll', onScroll, { passive: true });
        gestures.forEach((type) => scrollParent.addEventListener(type, onGesture, { passive: true }));
        return () => {
            scrollParent.removeEventListener('scroll', onScroll);
            gestures.forEach((type) => scrollParent.removeEventListener(type, onGesture));
            if (frame) cancelAnimationFrame(frame);
        };
    }, [scrollParent, measureAnchor]);

    // New data: re-measure what is on screen (one frame later, once Virtuoso has the new rows).
    const firstGroupsRef = useRef(true);
    useEffect(() => {
        if (firstGroupsRef.current) {
            firstGroupsRef.current = false;
            return undefined;
        }
        pinnedRef.current = false;
        const frame = requestAnimationFrame(() => measureAnchor());
        return () => cancelAnimationFrame(frame);
    }, [groups, measureAnchor]);

    useLayoutEffect(() => {
        const before = prevColsRef.current;
        prevColsRef.current = cols;
        const key = anchorRef.current;
        if (before === cols || key === null) return undefined;
        const index = latest.current.grouped.flat.findIndex((item) => itemKeyRef.current(item) === key);
        // The very first item needs no anchoring (the top stays the top); an unlisted key anchors nothing.
        if (index <= 0) return undefined;
        pinnedRef.current = true;
        // One frame later, so Virtuoso has taken the new group counts before it scrolls.
        const frame = requestAnimationFrame(() => {
            const { itemStarts, rowStarts, flat } = latest.current.grouped;
            const row = rowOfItem(index, itemStarts, rowStarts, flat.length, latest.current.cols);
            if (row !== null) virtuosoRef.current?.scrollToIndex({ index: row, align: 'start' });
        });
        return () => cancelAnimationFrame(frame);
    }, [cols]);

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
        measureAnchor();
    }, [measureAnchor]);

    // The first-paint breadcrumb: mount → the first visible tile's image ready, once per mount.
    const reporter = useMediaGridReporter(grid, scrollParent, grouped.flat.length);

    // Always an object: react-virtuoso 4.18 reads keys off `components` (`u => u[key]`), so
    // `components={undefined}` throws "reading 'EmptyPlaceholder'" on mount (D-M1).
    const components = useMemo(() => (footer ? { Footer: () => <>{footer}</> } : NO_COMPONENTS), [footer]);

    return (
        <div ref={wrapperRef} className={cn('w-full', className)}>
            <MediaGridContext.Provider value={reporter}>
                <GroupedVirtuoso
                    ref={virtuosoRef}
                    customScrollParent={scrollParent ?? undefined}
                    groupCounts={grouped.rowCounts}
                    increaseViewportBy={OVERSCAN}
                    defaultItemHeight={tilePx + rowGapPx}
                    computeItemKey={(index) => grouped.keys[index] ?? `index:${index}`}
                    rangeChanged={onRange}
                    components={components}
                    groupContent={(g) => (
                        <div data-media-grid-header="" className="bg-sheet px-4 py-3 text-small font-semibold text-secondary">{groups[g]?.label}</div>
                    )}
                    itemContent={(index) => {
                        const row = grouped.rows[index];
                        if (!row) return null;
                        return (
                            <div
                                data-media-grid-row=""
                                data-first={row.first}
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
 * `count`), logged once per mount. When a resize changes the column count, the first visible
 * item (by key) is scrolled back to the top of the reflowed rows (resize anchoring); after that
 * or a jump it stays the anchor until the user scrolls.
 */
export const VirtualMediaGrid = forwardRef(VirtualMediaGridInner) as <T>(
    props: VirtualMediaGridProps<T> & { ref?: React.Ref<VirtualMediaGridHandle> },
) => React.ReactElement;
