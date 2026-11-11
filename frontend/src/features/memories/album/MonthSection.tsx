import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../i18n';
import { MediaViewerModal } from '../../../core/media/PhotoDetailModal';
import { MEDIA_GRID_COLS, MEDIA_GRID_GAP, MEDIA_GRID_MIN } from '../../../core/media/tileGrid';
import { MediaGridContext, primeMediaMeta, useGridColumns } from '../../../core/media/grid';
import { cn } from '../../../utils/classnames';
import { fetchAlbumMonth } from '../api';
import { MemoriesStatus } from '../shared/memoriesStatus';
import { sepiaClass } from '../shared/sepia';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import { jstDateFormat } from '../shared/jst';
import type { AlbumKind, AlbumMonthPayload, AlbumMonthSummary, MemoryMessage } from '../types';
import { BurstStack } from './BurstStack';
import { PhotoTile } from './PhotoTile';
import { PolaroidCover } from './PolaroidCover';
import { albumItemKey, albumViewerItems, formatMonth, monthParts, viewerIndexOf } from './albumViewer';
import { gridEntries } from './gridEntries';

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
    /** The month's request finished (ready or error). */
    onSettled: (month: string) => void;
    /** 「この月の表紙にする」 on a picture / video tile of this month. */
    onSetCover?: (month: string, item: MemoryMessage) => void;
    /** 「表紙を自動にもどす」 on this month's cover (offered when its rule is `override`). */
    onResetCover?: (month: string) => void;
}

/** The band tint from the cover photo (the data-driven exception, DESIGN_SYSTEM.md). */
const tintOf = (color: string | null): string | undefined =>
    color ? `color-mix(in srgb, ${color} 18%, transparent)` : undefined;

/** Fetches one month and hands it to the album's cache; shows the Memories load state (or its retry). */
const MonthLoader: React.FC<Pick<MonthSectionProps, 'service' | 'member' | 'kind' | 'onLoaded' | 'onSettled'> & { month: string }> = ({
    service, month, member, kind, onLoaded, onSettled,
}) => {
    const query = useMemoriesQuery(
        'album_month',
        (signal) => fetchAlbumMonth(service, month, { member, kind }, signal),
        [service, month, member, kind],
        // Committed on arrival: the band frees its fetch slot (MAX_IN_FLIGHT, D4) the moment the
        // answer lands, never after a min-visible hold.
        { count: (d) => d.items.length, settle: false },
    );
    useEffect(() => {
        if (query.status === 'ready' && query.data) onLoaded(month, query.data);
        if (query.status !== 'loading') onSettled(month);
    }, [query.status, query.data, month, onLoaded, onSettled]);
    return <MemoriesStatus query={query} view="album_month" />;
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
            <div ref={gridRef} data-testid="album-grid" className={cn('grid w-full min-w-0 grid-flow-row-dense', MEDIA_GRID_GAP, MEDIA_GRID_COLS)}>
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
 * With `onSetCover` / `onResetCover` the tiles and the cover carry the cover-choice context menus
 * (spec 8: a user override comes first).
 * Memoised: bands re-render only when their own props change.
 */
export const MonthSection = React.memo<MonthSectionProps>(({
    service, summary, member, kind, data, requested, live, nameOf, registerRef, onLoaded, onSettled, onSetCover, onResetCover,
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
    const showGrid = live && data !== undefined;
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
    else if (live && requested) {
        body = <MonthLoader service={service} month={month} member={member} kind={kind} onLoaded={onLoaded} onSettled={onSettled} />;
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
