import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../i18n';
import { useDelayedLoading } from '../../../design/loading';
import { motion } from '../../../design/tokens';
import { Skeleton, SPINNER_LABEL_VISIBILITY, type SkeletonTone } from '../../../design/primitives';
import { MediaViewerModal } from '../../../core/media/PhotoDetailModal';
import { MEDIA_GRID_COLS, MEDIA_GRID_GAP, MEDIA_GRID_GAP_REM, MEDIA_GRID_MIN } from '../../../core/media/tileGrid';
import { rootRemPx } from '../../../core/media/grid/useGridColumns';
import { MediaGridContext, primeMediaMeta, useGridColumns } from '../../../core/media/grid';
import { cn } from '../../../utils/classnames';
import { fetchAlbumMonth } from '../api';
import { MemoriesStatus } from '../shared/memoriesStatus';
import { sepiaClass } from '../shared/sepia';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import { jstDateFormat } from '../shared/jst';
import type { AlbumKind, AlbumMonthPayload, AlbumMonthSummary, MemoryMessage } from '../types';
import { BAND_SKELETON_MAX, bandSkeletonHeight, bandSkeletonRows } from './bandSkeleton';
import type { BandWaits } from './bandWaits';
import { BurstStack } from './BurstStack';
import { PhotoTile } from './PhotoTile';
import { PolaroidCover } from './PolaroidCover';
import { albumItemKey, albumViewerItems, formatMonth, monthParts, viewerIndexOf } from './albumViewer';
import { gridEntries } from './gridEntries';
import { peekPrefetchedMonth, takePrefetchedMonth } from './albumPrefetch';
import { logMemoriesSkip } from '../memoriesLog';

interface MonthSectionProps {
    service: string;
    summary: AlbumMonthSummary;
    member: string | undefined;
    kind: AlbumKind;
    /** The month's payload, once fetched (kept by the album, so a band that comes back does not refetch). */
    data: AlbumMonthPayload | undefined;
    /** Fetch the month's grid now (it neared the viewport, or its turn came). */
    requested: boolean;
    /** Mount the grid (the band is within two screens); otherwise a placeholder of its measured height. */
    live: boolean;
    nameOf: (m: MemoryMessage) => string;
    /** Registers the band for the observers and ribbon jumps (null on unmount). */
    registerRef: (month: string, el: HTMLElement | null) => void;
    onLoaded: (month: string, data: AlbumMonthPayload) => void;
    /**
     * The month's band settled: its error is on screen, or its grid has replaced the skeleton (after
     * the skeleton's min-visible hold), so a ribbon-jump re-align measures the real grid. The fetch
     * slot is freed earlier, by `onLoaded` the moment the answer lands.
     */
    onSettled: (month: string) => void;
    /** The page-level wait line's store: this band waits for its grid (fetching, or holding its skeleton). */
    waits?: BandWaits;
    /** 「この月の表紙にする」 on a picture / video tile of this month. */
    onSetCover?: (month: string, item: MemoryMessage) => void;
    /** 「表紙を自動にもどす」 on this month's cover (offered when its rule is `override`). */
    onResetCover?: (month: string) => void;
}

/**
 * A band that will take the page's prefetch (a warm open, D-M3) reveals its skeleton this long
 * after it mounts instead of after `motion.loading.reveal`, unless the prefetch settles first:
 * the prefetched month usually lands just after the normal reveal, and the skeleton's min-visible
 * hold would then become the open's critical path.
 */
export const PREFETCH_REVEAL_MS = 1000;

/** The band tint from the cover photo (the data-driven exception, DESIGN_SYSTEM.md). */
const tintOf = (color: string | null): string | undefined =>
    color ? `color-mix(in srgb, ${color} 18%, transparent)` : undefined;

/** The month grid's box, shared by `MonthGrid` and its skeleton: the same columns and tile edge. */
const ALBUM_GRID = cn('grid w-full min-w-0 grid-flow-row-dense', MEDIA_GRID_GAP, MEDIA_GRID_COLS);

interface BandSkeletonProps {
    count: number;
    /** The month has a favourite and the filter pins favourites (one 2 × 2 tile is reserved). */
    pinsLikely: boolean;
    revealed: boolean;
    tone: SkeletonTone;
}

/**
 * The band's tile skeleton while its grid loads (F28), in the very grid box of `MonthGrid`
 * (`ALBUM_GRID`). The box is measured with `useGridColumns` (the `tileGrid.ts` columns and tile
 * edge); the wrapper's `minHeight` (the grid box itself stays identical to `MonthGrid`'s, so its
 * rows sit packed at the top) reserves `bandSkeletonRows` rows: one cell per item, plus one pinned ★
 * when likely (`bandSkeleton.ts` lists what stays unknown until the grid lands: bursts and
 * favourites beyond the first). At most `BAND_SKELETON_MAX` tiles pulse; the rest of the reserved
 * height stays empty. Until `revealed` the same box holds empty, invisible cells (nothing flashes,
 * the height is the same). A `role="status"` named `loading.label`: the label is screen-reader
 * only, and under reduced motion (the tiles stand still) it shows as a small pill over the top-left
 * tile, so it never changes the band's height.
 */
const BandSkeleton: React.FC<BandSkeletonProps> = ({ count, pinsLikely, revealed, tone }) => {
    const { t } = useTranslation();
    const labelId = useId();
    const gridRef = useRef<HTMLDivElement>(null);
    const { cols, width } = useGridColumns(gridRef);
    const rows = bandSkeletonRows(count, cols, pinsLikely);
    const minHeight = bandSkeletonHeight(rows, cols, width, MEDIA_GRID_GAP_REM * rootRemPx());
    const tiles = Math.max(1, Math.min(count, BAND_SKELETON_MAX));
    return (
        <div
            role="status"
            data-testid="album-band-skeleton"
            data-rows={rows}
            aria-busy={revealed ? undefined : true}
            aria-labelledby={revealed ? labelId : undefined}
            className="relative w-full min-w-0"
            // On the wrapper, never the grid: a taller grid would stretch its rows apart.
            style={minHeight > 0 ? { minHeight } : undefined}
        >
            <div
                ref={gridRef}
                data-band-grid
                aria-hidden="true"
                className={cn(ALBUM_GRID, !revealed && 'invisible')}
            >
                {Array.from({ length: tiles }, (_, i) => (revealed
                    ? <Skeleton key={i} shape="tile" tone={tone} className="w-full" />
                    : <span key={i} className="block aspect-square w-full" />))}
            </div>
            {revealed && (
                <span
                    id={labelId}
                    // `motion-reduce:absolute` comes after `not-sr-only` in Tailwind's order, so the pill floats.
                    className={cn(
                        'left-2 top-2 rounded-pill bg-sheet px-2 text-small text-secondary shadow-pill',
                        SPINNER_LABEL_VISIBILITY.auto,
                        'motion-reduce:absolute',
                    )}
                >
                    {t('loading.label')}
                </span>
            )}
        </div>
    );
};

/**
 * Fetches one month (or takes the page's prefetch of it, `albumPrefetch.ts`): a ready answer goes
 * to the album's cache at once (`onLoaded`, which frees the fetch slot); an error or timeout renders inside the band (`MemoriesStatus` inline, with Retry)
 * and settles the band. The skeleton is the band's (`BandSkeleton`), so it never restarts when a
 * queued band's fetch begins. `onFailed` tells the band whether its error is showing.
 */
const MonthLoader: React.FC<Pick<MonthSectionProps, 'service' | 'member' | 'kind' | 'onLoaded' | 'onSettled'> & {
    month: string;
    onFailed: (failed: boolean) => void;
}> = ({ service, month, member, kind, onLoaded, onSettled, onFailed }) => {
    const query = useMemoriesQuery(
        'album_month',
        // The page's prefetch of this month, when it made one (the newest month, D-M3); a Retry
        // always asks anew.
        (signal) => takePrefetchedMonth(service, member, kind, month, signal) ?? fetchAlbumMonth(service, month, { member, kind }, signal),
        [service, month, member, kind],
        // Committed on arrival: the band frees its fetch slot (MAX_IN_FLIGHT, D4) the moment the
        // answer lands, never after a min-visible hold (the band holds its skeleton instead).
        { count: (d) => d.items.length, settle: false },
    );
    // Before paint, so the skeleton never shows beside the error.
    useLayoutEffect(() => { onFailed(query.status === 'error'); }, [query.status, onFailed]);
    useEffect(() => {
        if (query.status === 'ready' && query.data) onLoaded(month, query.data);
        else if (query.status === 'error') onSettled(month);
    }, [query.status, query.data, month, onLoaded, onSettled]);
    return query.status === 'error' ? <MemoriesStatus query={query} view="album_month" variant="inline" /> : null;
};

interface MonthGridProps {
    data: AlbumMonthPayload;
    kind: AlbumKind;
    nameOf: (m: MemoryMessage) => string;
    label: string;
    sepia: string;
    onSetCover?: (item: MemoryMessage) => void;
}

const MonthGrid: React.FC<MonthGridProps> = ({ data, kind, nameOf, label, sepia, onSetCover }) => {
    const { t, i18n } = useTranslation();
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);
    const entries = useMemo(() => gridEntries(data), [data]);
    // The month's placeholders and versions in one meta batch as soon as its payload lands
    // (burst frames included, which only draw when their sequence opens).
    useEffect(() => { primeMediaMeta(data.items.map((i) => i.media_url)); }, [data]);
    // The drawn tile edge (the same `tileGrid.ts` maths as the CSS grid) picks each thumbnail width.
    const gridRef = useRef<HTMLDivElement>(null);
    const { tilePx } = useGridColumns(gridRef);
    const viewer = useMemo(
        () => albumViewerItems(data.items, {
            nameOf,
            sourceLabel: t('memories.common.jumpToChat'),
            onBeforeJump: () => setViewerIndex(null),
        }),
        [data, nameOf, t],
    );
    const viewable = viewer.viewable;
    const onOpen = useCallback((item: MemoryMessage) => {
        const index = viewerIndexOf(viewable, item);
        if (index >= 0) setViewerIndex(index);
    }, [viewable]);
    const dateLabel = useMemo(() => jstDateFormat(i18n.language, { time: true }), [i18n.language]);
    // Under the ★ filter every photo is a favourite: pinning them all larger would mean nothing.
    const pinFavorites = kind !== 'favorite';

    return (
        <>
            <div ref={gridRef} data-testid="album-grid" className={ALBUM_GRID}>
                {entries.map((entry) => (entry.kind === 'burst'
                    ? <BurstStack key={entry.key} items={entry.items} title={label} nameOf={nameOf} sepia={sepia} onSetCover={onSetCover} tilePx={tilePx} />
                    : (
                        <PhotoTile
                            key={albumItemKey(entry.item)}
                            item={entry.item}
                            sepia={sepia}
                            pinned={pinFavorites && entry.item.favorited}
                            label={entry.item.caption ?? entry.item.text ?? dateLabel.format(new Date(entry.item.ts))}
                            onOpen={onOpen}
                            onSetCover={onSetCover}
                            tilePx={tilePx}
                        />
                    )))}
            </div>
            {viewerIndex !== null && viewer.items[viewerIndex] && (
                // Portalled out of the album's scroll container: outside its media grid context.
                <MediaGridContext.Provider value={null}>
                    <MediaViewerModal
                        mediaItems={viewer.items}
                        currentIndex={viewerIndex}
                        onClose={() => setViewerIndex(null)}
                        onNavigate={setViewerIndex}
                    />
                </MediaGridContext.Provider>
            )}
        </>
    );
};

/**
 * One month band of the album (spec 8): tinted from its cover photo (`cover_color`, the
 * data-driven exception; neutral `bg-sunken` without one), the polaroid cover beside the grid,
 * photos aged with `sepiaClass` by year. The grid's columns come from its own width
 * (`MEDIA_GRID_COLS`, the shared media tile density); a band too narrow for the polaroid and a
 * two-tile grid side by side wraps the grid below the polaroid (`MEDIA_GRID_MIN`). The month label is the band's heading: above the band
 * when the polaroid carries her words, else the polaroid's own caption (never shown twice).
 * Tiles are the shared media tile, sized from the grid's measured tile edge; a month's media are
 * primed into the meta store in one batch when its payload lands.
 * The grid is fetched once `requested` and mounted only while `live`; a band that is not live
 * keeps its last measured height, so the scroll position holds while its grid is released.
 * A live band without its grid (queued for a fetch slot, or fetching) shows its tile skeleton
 * (`BandSkeleton`, from the reveal delay; a band taking the page's prefetch holds that reveal until
 * the prefetch settles or `PREFETCH_REVEAL_MS` after its mount, logged once as `memories_skip`
 * `album_prefetch` `prefetch_reveal_held` when it outlasts the normal reveal); once shown, the skeleton stays at least `minVisible`
 * (`useDelayedLoading`), a display-only hold: the answer reaches the album's cache on arrival, which
 * frees the fetch slot, and `onSettled` (the ribbon-jump re-align) follows the real grid's commit.
 * An error or timeout shows inside the band with Retry. While it fetches or holds its skeleton the
 * band counts in the page's wait line (`waits`).
 * With `onSetCover` / `onResetCover` the tiles and the cover carry the cover-choice context menus
 * (spec 8: a user override comes first).
 * Memoised: bands re-render only when their own props change.
 */
export const MonthSection = React.memo<MonthSectionProps>(({
    service, summary, member, kind, data, requested, live, nameOf, registerRef, onLoaded, onSettled, waits, onSetCover, onResetCover,
}) => {
    const { t, i18n } = useTranslation();
    const month = summary.month;
    const label = formatMonth(t, 'memories.album.monthLabel', month, i18n.language);
    const sepia = sepiaClass(monthParts(month).year);
    const own = useRef<HTMLElement | null>(null);
    const ref = useCallback((el: HTMLElement | null) => {
        own.current = el;
        registerRef(month, el);
    }, [registerRef, month]);
    const setCover = useMemo(
        () => (onSetCover ? (item: MemoryMessage) => onSetCover(month, item) : undefined),
        [onSetCover, month],
    );
    const resetCover = useMemo(
        () => (onResetCover && summary.cover_rule === 'override' ? () => onResetCover(month) : undefined),
        [onResetCover, summary.cover_rule, month],
    );
    const height = useRef<number | null>(null);
    // The loader's error is on screen (no skeleton then).
    const [failed, setFailed] = useState(false);
    // The page's prefetch of this month, still in flight when the band mounts (a warm open): the
    // skeleton's reveal waits for it until PREFETCH_REVEAL_MS after the mount (D-M3).
    const [prefetch] = useState(() => peekPrefetchedMonth(service, member, kind, month));
    const [prefetchHold, setPrefetchHold] = useState(prefetch !== null);
    const dataRef = useRef(data);
    dataRef.current = data;
    useEffect(() => {
        if (!prefetch) return undefined;
        let holding = true;
        const end = () => {
            if (!holding) return;
            holding = false;
            setPrefetchHold(false);
        };
        prefetch.then(end, end);
        // The normal reveal starts after the hold, so the skeleton shows at PREFETCH_REVEAL_MS.
        const timer = setTimeout(end, PREFETCH_REVEAL_MS - motion.loading.reveal);
        // The normal reveal would have shown the skeleton now: leave a breadcrumb that the hold mattered.
        const logTimer = setTimeout(() => {
            if (holding && dataRef.current === undefined) logMemoriesSkip('album_prefetch', 'prefetch_reveal_held');
        }, motion.loading.reveal);
        return () => {
            holding = false;
            clearTimeout(timer);
            clearTimeout(logTimer);
        };
    }, [prefetch]);
    // A live band without its grid shows the skeleton from the reveal delay, and keeps a shown one
    // `minVisible` after the grid arrives (display only: the answer is already in the cache).
    const held = useDelayedLoading(live && data === undefined && !failed && !prefetchHold);
    const showGrid = live && data !== undefined && !held;
    // The page wait line: fetching, or holding the skeleton over an arrived grid.
    const waiting = live && requested && !failed && !showGrid;
    useLayoutEffect(() => {
        if (!waiting || !waits) return undefined;
        waits.set(month, true);
        return () => waits.set(month, false);
    }, [waiting, waits, month]);
    // The answer landed (slot freed); the band settles once its grid has committed (or it left).
    const settleDue = useRef(false);
    const loaded = useCallback((m: string, payload: AlbumMonthPayload) => {
        settleDue.current = true;
        onLoaded(m, payload);
    }, [onLoaded]);
    useLayoutEffect(() => {
        if (settleDue.current && (showGrid || !live)) {
            settleDue.current = false;
            onSettled(month);
        }
    });
    useLayoutEffect(() => {
        if (showGrid && own.current) height.current = own.current.getBoundingClientRect().height;
    });
    const tint = tintOf(summary.cover_color);
    const hasWords = Boolean(summary.cover.caption ?? summary.cover.text);
    const style: React.CSSProperties = {};
    if (tint) style.backgroundColor = tint;
    if (!showGrid && height.current) style.minHeight = height.current;

    let body: React.ReactNode;
    if (showGrid) body = <MonthGrid data={data} kind={kind} nameOf={nameOf} label={label} sepia={sepia} onSetCover={setCover} />;
    else if (live) {
        body = (
            <>
                {/* Only until the answer lands: a band that leaves and re-enters view during the
                    skeleton's hold never refetches a cached month outside the fetch-slot cap. */}
                {requested && data === undefined && (
                    <MonthLoader service={service} month={month} member={member} kind={kind} onLoaded={loaded} onSettled={onSettled} onFailed={setFailed} />
                )}
                {/* On the neutral sunken band the tiles take the paper skeleton tone, so they show. */}
                {!failed && <BandSkeleton count={summary.count} pinsLikely={summary.has_favorites && kind !== 'favorite'} revealed={held} tone={tint ? 'sunken' : 'paper'} />}
            </>
        );
    } else body = <div aria-hidden="true" data-testid="album-month-placeholder" className="min-h-64 flex-1" />;

    return (
        <section
            ref={ref}
            data-month={month}
            data-testid={`album-month-${month}`}
            aria-label={label}
            style={style}
            className={cn('scroll-mt-2 rounded-lg p-4', !tint && 'bg-sunken')}
        >
            {hasWords && <h2 className="mb-3 font-display text-title text-primary">{label}</h2>}
            <div data-testid="album-band-row" className="flex flex-wrap items-start gap-4">
                <PolaroidCover cover={summary.cover} label={label} sepia={sepia} onResetCover={resetCover} />
                <div data-testid="album-band-body" className={cn('flex min-w-0 flex-1', MEDIA_GRID_MIN)}>{body}</div>
            </div>
        </section>
    );
});
MonthSection.displayName = 'MonthSection';
