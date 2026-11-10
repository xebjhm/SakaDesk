import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../../i18n';
import { MediaViewerModal } from '../../../core/media/PhotoDetailModal';
import { cn } from '../../../utils/classnames';
import { fetchAlbumMonth } from '../api';
import { LoadState } from '../shared/LoadState';
import { sepiaClass } from '../shared/sepia';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import { JST_TIME_ZONE } from '../recap/availability';
import type { AlbumKind, AlbumMonthPayload, AlbumMonthSummary, MemoryMessage } from '../types';
import { BurstStack } from './BurstStack';
import { PhotoTile } from './PhotoTile';
import { PolaroidCover } from './PolaroidCover';
import { albumItemKey, albumViewerItems, formatMonth, monthParts, viewerIndexOf } from './albumViewer';

interface MonthSectionProps {
    service: string;
    summary: AlbumMonthSummary;
    member: string | undefined;
    kind: AlbumKind;
    /** Load the month's grid now (it neared the viewport, or its turn came). */
    requested: boolean;
    nameOf: (m: MemoryMessage) => string;
    /** Registers the band for lazy loading and ribbon jumps (null on unmount). */
    registerRef: (month: string, el: HTMLElement | null) => void;
    /** The grid's request finished (ready or error): the in-order fallback loads the next one. */
    onSettled: (month: string) => void;
}

/** The band tint from the cover photo (the data-driven exception, DESIGN_SYSTEM.md). */
const tintOf = (color: string | null): React.CSSProperties | undefined =>
    color ? { backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)` } : undefined;

type GridEntry =
    | { kind: 'tile'; item: MemoryMessage }
    | { kind: 'burst'; key: string; items: MemoryMessage[] };

/** The month's items in time order, each burst collapsed into one entry at its first item. */
function gridEntries(data: AlbumMonthPayload): GridEntry[] {
    const burstOf = new Map<string, string>();
    for (const b of data.bursts) for (const id of b.ids) burstOf.set(albumItemKey({ room: b.room, id }), `${b.room}|b${b.burst_id}`);
    const bursts = new Map<string, MemoryMessage[]>();
    const entries: GridEntry[] = [];
    for (const item of data.items) {
        const burst = burstOf.get(albumItemKey(item));
        if (burst === undefined) {
            entries.push({ kind: 'tile', item });
            continue;
        }
        const members = bursts.get(burst);
        if (members) {
            members.push(item);
        } else {
            const first = [item];
            bursts.set(burst, first);
            entries.push({ kind: 'burst', key: burst, items: first });
        }
    }
    return entries;
}

const MonthGrid: React.FC<Omit<MonthSectionProps, 'requested' | 'registerRef'> & { label: string; sepia: string }> = ({
    service, summary, member, kind, nameOf, onSettled, label, sepia,
}) => {
    const { t, i18n } = useTranslation();
    const month = summary.month;
    const query = useMemoriesQuery(
        'album_month',
        (signal) => fetchAlbumMonth(service, month, { member, kind }, signal),
        [service, month, member, kind],
        { count: (d) => d.items.length },
    );
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);
    const data = query.data;

    useEffect(() => {
        if (query.status !== 'loading') onSettled(month);
    }, [query.status, month, onSettled]);

    const entries = useMemo(() => (data ? gridEntries(data) : []), [data]);
    const viewer = useMemo(
        () => albumViewerItems(data?.items ?? [], {
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
    const dateLabel = useMemo(() => new Intl.DateTimeFormat(i18n.language, {
        timeZone: JST_TIME_ZONE, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }), [i18n.language]);

    if (query.status !== 'ready' || !data) {
        return <LoadState status={query.status === 'error' ? 'error' : 'loading'} onRetry={query.retry} />;
    }
    return (
        <>
            <div data-testid="album-grid" className="grid min-w-0 flex-1 grid-flow-row-dense grid-cols-3 gap-2 md:grid-cols-4 xl:grid-cols-6">
                {entries.map((entry) => (entry.kind === 'burst'
                    ? <BurstStack key={entry.key} items={entry.items} title={label} nameOf={nameOf} sepia={sepia} />
                    : (
                        <PhotoTile
                            key={albumItemKey(entry.item)}
                            item={entry.item}
                            sepia={sepia}
                            label={entry.item.caption ?? entry.item.text ?? dateLabel.format(new Date(entry.item.ts))}
                            onOpen={onOpen}
                        />
                    )))}
            </div>
            {viewerIndex !== null && viewer.items[viewerIndex] && (
                <MediaViewerModal
                    mediaItems={viewer.items}
                    currentIndex={viewerIndex}
                    onClose={() => setViewerIndex(null)}
                    onNavigate={setViewerIndex}
                />
            )}
        </>
    );
};

/**
 * One month band of the album (spec 8): tinted from its cover photo (`cover_color`, the
 * data-driven exception; neutral `bg-sunken` without one), the polaroid cover beside the grid,
 * photos aged with `sepiaClass` by year. The grid loads only once `requested`; until then a
 * placeholder holds some height. Memoised so a scroll that requests other months leaves it be.
 */
export const MonthSection = React.memo<MonthSectionProps>((props) => {
    const { summary, requested, registerRef } = props;
    const { t, i18n } = useTranslation();
    const month = summary.month;
    const label = formatMonth(t, 'memories.album.monthLabel', month, i18n.language);
    const sepia = sepiaClass(monthParts(month).year);
    const ref = useCallback((el: HTMLElement | null) => registerRef(month, el), [registerRef, month]);
    const tint = tintOf(summary.cover_color);

    return (
        <section
            ref={ref}
            data-month={month}
            data-testid={`album-month-${month}`}
            aria-label={label}
            style={tint}
            className={cn('scroll-mt-2 rounded-lg p-4', !tint && 'bg-sunken')}
        >
            <h2 className="mb-3 font-display text-title text-primary">{label}</h2>
            <div className="flex items-start gap-4">
                <PolaroidCover cover={summary.cover} label={label} sepia={sepia} />
                {requested
                    ? <MonthGrid {...props} label={label} sepia={sepia} />
                    : <div aria-hidden="true" className="min-h-64 flex-1" />}
            </div>
        </section>
    );
});
MonthSection.displayName = 'MonthSection';
