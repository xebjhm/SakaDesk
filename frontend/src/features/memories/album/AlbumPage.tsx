import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ImageIcon, Star } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { BusyContent, EmptyState, Pill } from '../../../design/primitives';
import { MediaGridContext, PregenProgressBar, useMediaGridReporter, usePregenProgress } from '../../../core/media/grid';
import type { CorePageProps, MemoriesRoute } from '../MemoriesFeature';
import {
    deleteAlbumCover, fetchAlbumColors, fetchAlbumMembers, fetchAlbumMonths, MemoriesFetchError, MemoriesTimeoutError, putAlbumCover,
} from '../api';
import { logMemoriesLoad, logMemoriesToggle, type MemoriesToggleReason } from '../memoriesLog';
import { MemoriesStatus } from '../shared/memoriesStatus';
import { MEMBER_PANE_WIDTH, MemberPane, type MemberPaneItem } from '../shared/MemberPane';
import { memberPaneStatus } from '../shared/memberPaneStatus';
import { cn } from '../../../utils/classnames';
import { messageName } from '../shared/nameFromRoom';
import { PageHeader } from '../shared/PageHeader';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import type { AlbumKind, AlbumMonthSummary, MemoriesCountedMember, MemoryMessage } from '../types';
import {
    peekPrefetchedMonth, prefetchNewestMonth, prefetchSettled, rememberedNewestMonth, rememberNewestMonth,
} from './albumPrefetch';
import { AlbumWaitLine } from './AlbumWaitLine';
import { createBandWaits } from './bandWaits';
import { ColorRibbon, type RibbonMonth } from './ColorRibbon';
import { MonthSection } from './MonthSection';
import { useAlbumWindow } from './useAlbumWindow';

export type AlbumRoute = Extract<MemoriesRoute, { page: 'album' }>;

interface AlbumPageProps extends Omit<CorePageProps, 'route'> {
    route: AlbumRoute;
}

const FILTERS: { kind: AlbumKind; key: string }[] = [
    { kind: 'all', key: 'memories.album.filterAll' },
    { kind: 'picture', key: 'memories.album.filterPhotos' },
    { kind: 'video', key: 'memories.album.filterVideos' },
    { kind: 'favorite', key: 'memories.album.filterFavorites' },
];

interface AlbumGridProps {
    service: string;
    member: string | undefined;
    kind: AlbumKind;
    months: AlbumMonthSummary[];
    /** The ribbon colours; null until loaded (each month's cover tint stands in meanwhile). */
    colors: Record<string, string | null> | null;
    nameOf: (m: MemoryMessage) => string;
    /** Absent while the grid is kept for another person or filter (no cover menu). */
    onSetCover?: (month: string, item: MemoryMessage) => void;
    onResetCover?: (month: string) => void;
    /** Receives the scroll container (the tiles measure their visibility against it). */
    onScroller?: (el: HTMLDivElement | null) => void;
    /** Kept on screen while another person or filter loads: no band starts (or keeps) a fetch. */
    frozen?: boolean;
}

/** The album's pre-generation breadcrumb: `memories_load` `album_pregen` (not a dialog load). */
const logAlbumPregen = (outcome: 'ok' | 'error') => logMemoriesLoad('album_pregen', outcome);

/**
 * The quiet "Preparing thumbnails… done / total" line (or its paused form) while the background
 * worker prepares this service. Its own component, so a status poll re-renders only the line.
 */
const AlbumPregenBar: React.FC<{ service: string; active: boolean }> = ({ service, active }) => {
    const pregen = usePregenProgress(active, service, logAlbumPregen);
    return pregen ? <PregenProgressBar progress={pregen} className="ml-auto min-w-0 flex-1" /> : null;
};

/** A warm open defers the requests its first band does not need at most this long (ms). */
export const OPEN_DEFER_MAX_MS = 1500;

/** How long the cover-failure toast stays (ms). */
const TOAST_MS = 4000;

/** The `reason` / `error_code` of a failed cover write (codes and the HTTP status only). */
function failureOf(err: unknown): { reason: MemoriesToggleReason; error_code?: number } {
    if (err instanceof MemoriesTimeoutError) return { reason: 'timeout' };
    if (err instanceof MemoriesFetchError) {
        return { reason: err.code === 'not_in_month' ? 'not_in_month' : 'request_failed', error_code: err.httpStatus };
    }
    return { reason: 'request_failed' };
}

/**
 * The month bands in the pane's own scroll container, with the colour ribbon on the right edge.
 * Loading and windowing are `useAlbumWindow`'s: bands far from the viewport release their grids,
 * and a ribbon jump scrolls instantly and loads only where it lands. `frozen` (kept months of the
 * previous person or filter) stops every band's fetch; loaded grids stay. Over the top of the
 * bands, one page-level wait line (`AlbumWaitLine`) follows the bands still waiting for their grids.
 */
const AlbumGrid: React.FC<AlbumGridProps> = ({ service, member, kind, months, colors, nameOf, onSetCover, onResetCover, onScroller, frozen = false }) => {
    const scroller = useRef<HTMLDivElement | null>(null);
    const setScroller = useCallback((el: HTMLDivElement | null) => {
        scroller.current = el;
        onScroller?.(el);
    }, [onScroller]);
    const monthKeys = useMemo(() => months.map((m) => m.month), [months]);
    // A warm open: the top band takes the page's prefetch, so its fetch runs alone (D-M3).
    const [firstAlone] = useState(() => months[0] !== undefined && peekPrefetchedMonth(service, member, kind, months[0].month) !== null);
    const win = useAlbumWindow(monthKeys, scroller, { firstAlone });
    // The bands waiting for their grids, for the wait line only (a band never re-renders the grid).
    const [waits] = useState(createBandWaits);

    const ribbon: RibbonMonth[] = useMemo(
        () => months.map((m) => ({ month: m.month, color: colors ? colors[m.month] ?? null : m.cover_color })),
        [months, colors],
    );

    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            <AlbumWaitLine waits={waits} />
            <div className="flex min-h-0 flex-1 gap-2 pb-2 pr-2">
                <div ref={setScroller} data-testid="album-scroller" className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden px-4 pb-4">
                    {months.map((m, i) => (
                        <MonthSection
                            key={m.month}
                            service={service}
                            summary={m}
                            member={member}
                            kind={kind}
                            data={win.cache.get(m.month)}
                            requested={!frozen && win.isRequested(m.month, i)}
                            live={win.isLive(m.month)}
                            nameOf={nameOf}
                            registerRef={win.registerRef}
                            onLoaded={win.onLoaded}
                            onSettled={win.onSettled}
                            waits={waits}
                            onSetCover={onSetCover}
                            onResetCover={onResetCover}
                        />
                    ))}
                </div>
                <ColorRibbon months={ribbon} onSelect={win.jump} />
            </div>
        </div>
    );
};

/**
 * The album (spec 8). Left: 「全員」 and each person with her photo count (people without any are
 * not listed; a zero total shows no number). Right: the 全部 / 照片 / 影片 / ★ filters (the ★ pill
 * is the neutral `star` tone with the yellow star, never the accent; a change logs
 * `memories_toggle` `album_filter`), the month bands newest first in the pane's own scroll
 * container (each grid loads lazily) and the colour ribbon. Picking a person moves the route
 * (`go`), which refetches the months and the ribbon; the row selects at once and, until her
 * months arrive, the previous months stay on screen (`keepPrevious` within the service,
 * `BusyContent`: `aria-busy`, dimmed after the reveal delay; their bands fetch nothing and offer
 * no cover menu). A filter switch does the same. The member list shows its loading rows, or its
 * error / timeout line with Retry, in the `MemberPane`.
 * Cover choice (spec 8): a tile's context menu sets the month cover (`putAlbumCover`, for the
 * person on screen or 全員), an override cover's menu clears it (`deleteAlbumCover`). Either
 * way the months refetch (`coverVersion`; the bands stay on screen, dimmed, meanwhile), also after a
 * failure, since a timed-out write may have landed: never retried. Success logs
 * `memories_toggle` `album_cover` (`on` = set, `off` = cleared); a failure logs `off` with its
 * `reason` (`not_in_month`, `timeout`, `request_failed`) and `error_code` (HTTP status, when the
 * backend answered) and shows the inline toast.
 * Tiles are the shared media tile (media pipeline): the page provides their grid reporter, which
 * logs the `media_grid` first-paint breadcrumb (`grid: 'album'`, `first_tile_ms` from the page's
 * mount) once per page mount, and shows the quiet "Preparing thumbnails… done / total" line (or
 * its paused form) in the filter row while the background worker prepares this service (logged as
 * `memories_load` `album_pregen`).
 * The newest month's grid is prefetched beside the months list (`albumPrefetch.ts`: the month this
 * scope showed last this session), and the top band takes that answer when the list names the same
 * month, so a reopen makes one round trip to its first grid instead of two. On such a warm open the
 * members (and so their avatars), the ribbon colours and the thumbnail status wait until the
 * prefetch lands, fails or is dropped (at most `OPEN_DEFER_MAX_MS`): the member pane shows its
 * loading rows and the ribbon each month's cover tint meanwhile. The months list still goes beside
 * the prefetch: the bands (and the newer-month check) need it.
 */
export const AlbumPage: React.FC<AlbumPageProps> = ({ service, route, go }) => {
    const { t } = useTranslation();
    const member = route.memberPath;
    const [kind, setKind] = useState<AlbumKind>('all');
    // A warm open (the newest month is prefetched): the requests the first band does not need
    // (members and their avatars, the ribbon colours, the thumbnail status) wait until that month
    // has landed or failed, at most OPEN_DEFER_MAX_MS, so it does not queue behind them (D-M3).
    const [deferring, setDeferring] = useState(() => rememberedNewestMonth(service, member, kind) !== undefined);
    const [coverVersion, setCoverVersion] = useState(0);
    // The id of the latest cover failure (0 = none): the toast shows while it is set.
    const [coverFailure, setCoverFailure] = useState(0);
    const write = useRef<AbortController | null>(null);
    useEffect(() => () => write.current?.abort(), []);
    useEffect(() => {
        if (!coverFailure) return undefined;
        const timer = setTimeout(() => setCoverFailure(0), TOAST_MS);
        return () => clearTimeout(timer);
    }, [coverFailure]);

    const members = useMemoriesQuery('album_members', (signal) => fetchAlbumMembers(service, signal), [service], {
        count: (d) => d.members.length,
        enabled: !deferring,
    });
    // Tagged with the person and filter they were loaded for: on a switch the previous months stay
    // on screen (dimmed) until hers arrive, and their bands keep drawing the previous grids.
    const months = useMemoriesQuery(
        'album',
        async (signal) => ({ payload: await fetchAlbumMonths(service, { member, kind }, signal), member, kind }),
        [service, member, kind, coverVersion],
        // Committed on arrival (no min-visible hold): the first band's fetch waits for these months
        // (D4 first / second open). An empty payload is never kept (its empty state would answer
        // for the next selection).
        {
            count: (d) => d.payload.months.length,
            keepPrevious: { scope: service, isEmpty: (d) => d.payload.months.length === 0 },
            settle: false,
        },
    );
    // The top band's grid is asked for beside the months list (the newest month this scope showed
    // last), so the open no longer waits for the list before its first grid request (D-M3). Not on
    // a cover change: the window cache keeps the month payloads, so no band would take it (m3).
    useEffect(() => prefetchNewestMonth(service, member, kind), [service, member, kind]);
    // After the prefetch effect above (effects run in order), on the page's first open only.
    useEffect(() => {
        if (!deferring) return undefined;
        let open = true;
        const release = () => { if (open) { open = false; setDeferring(false); } };
        const settled = prefetchSettled(service, member, kind);
        if (settled === null) release();
        else void settled.then(release);
        const timer = setTimeout(release, OPEN_DEFER_MAX_MS);
        return () => {
            open = false;
            clearTimeout(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the first open's scope only
    }, []);
    const shownMonths = months.data?.payload ?? null;
    const arrived = months.stale ? null : months.data;
    useEffect(() => {
        if (arrived) rememberNewestMonth(service, arrived.member, arrived.kind, arrived.payload.months[0]?.month);
    }, [service, arrived]);
    // A kept payload of another person or filter: its bands draw what they have and fetch nothing.
    const switching = months.stale && (months.data?.member !== member || months.data?.kind !== kind);

    const changeCover = useCallback(async (on: boolean, run: (signal: AbortSignal) => Promise<void>) => {
        write.current?.abort();
        const controller = new AbortController();
        write.current = controller;
        try {
            await run(controller.signal);
            if (controller.signal.aborted) return;
            logMemoriesToggle('album_cover', on);
            setCoverFailure(0);
        } catch (err) {
            if (controller.signal.aborted) return;
            logMemoriesToggle('album_cover', false, failureOf(err));
            setCoverFailure((n) => n + 1);
        }
        setCoverVersion((n) => n + 1);
    }, []);
    const onSetCover = useCallback((month: string, item: MemoryMessage) => {
        void changeCover(true, (signal) => putAlbumCover(service, { member: member ?? null, month, room: item.room, id: item.id }, signal));
    }, [changeCover, service, member]);
    const onResetCover = useCallback((month: string) => {
        void changeCover(false, (signal) => deleteAlbumCover(service, { month, member }, signal));
    }, [changeCover, service, member]);
    const colors = useMemoriesQuery('album_colors', (signal) => fetchAlbumColors(service, member, signal), [service, member], {
        count: (d) => Object.keys(d.colors).length,
        keepPrevious: { scope: service },
        enabled: !deferring,
    });

    const people = members.data?.members;
    const byPath = useMemo(
        () => new Map<string, MemoriesCountedMember>((people ?? []).map((m) => [m.member_path, m])),
        [people],
    );
    const selectedName = member !== undefined ? byPath.get(member)?.name : undefined;
    // Stable (W4): the names are read through a ref when a viewer or a jump asks for them, so the
    // members landing after the first grid paint (a warm open defers them) never re-render the bands.
    const names = useRef({ byPath, selectedName });
    names.current = { byPath, selectedName };
    const nameOf = useCallback((m: MemoryMessage) => {
        const { byPath: known, selectedName: fallback } = names.current;
        return messageName(m, known.get(m.member_path)?.name ?? fallback);
    }, []);
    const items: MemberPaneItem[] = useMemo(() => (people ?? []).map((m) => ({
        key: m.member_path, memberPath: m.member_path, name: m.name, avatarUrl: m.avatar_url, oshi: m.oshi, trailing: m.count,
    })), [people]);
    const total = members.data?.total ?? 0;

    // The tiles' grid reporter (visibility root: the album's scroll container) and the background
    // thumbnail preparation, shown while there are bands on screen.
    const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
    // The kept months of another person or filter are not this grid's: they count nothing.
    const itemCount = useMemo(
        () => (switching ? 0 : (shownMonths?.months ?? []).reduce((n, m) => n + m.count, 0)),
        [shownMonths, switching],
    );
    const reporter = useMediaGridReporter('album', scrollRoot, itemCount);

    const pickMember = (key: string | null) => {
        if ((key ?? undefined) === member) return;
        logMemoriesToggle('member_filter', key !== null);
        go({ page: 'album', memberPath: key ?? undefined });
    };
    const pickKind = (next: AlbumKind) => {
        if (next === kind) return;
        setKind(next);
        logMemoriesToggle('album_filter', next !== 'all', { kind: next });
    };

    let body: React.ReactNode;
    if (!shownMonths) {
        body = <MemoriesStatus query={months} view="album" />;
    } else if (!shownMonths.months.length) {
        body = (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState icon={<ImageIcon />} title={t('memories.album.title')} description={t('memories.album.empty')} />
            </div>
        );
    } else {
        const shownFor = months.data!;
        body = (
            <BusyContent busy={months.stale} className="flex min-h-0 flex-1 flex-col" contentClassName="flex min-h-0 flex-1 flex-col">
                <AlbumGrid
                    key={`${shownFor.member ?? ''}|${shownFor.kind}`}
                    service={service}
                    member={shownFor.member}
                    kind={shownFor.kind}
                    months={shownMonths.months}
                    colors={colors.data?.colors ?? null}
                    nameOf={nameOf}
                    // A cover is chosen for the person and filter on screen, not for the kept ones.
                    onSetCover={switching ? undefined : onSetCover}
                    onResetCover={switching ? undefined : onResetCover}
                    onScroller={setScrollRoot}
                    frozen={switching}
                />
            </BusyContent>
        );
    }

    return (
        <div data-testid="memories-page-album" data-service={service} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <PageHeader title={t('memories.album.title')} onBack={() => go({ page: 'home' })} />
            <div className="flex min-h-0 min-w-0 flex-1">
                <MemberPane
                    className={cn(MEMBER_PANE_WIDTH, 'shrink-0 border-r border-subtle')}
                    items={items}
                    selectedKey={member ?? null}
                    onSelect={pickMember}
                    allLabel={t('memories.common.all')}
                    allTrailing={total > 0 ? total : undefined}
                    status={deferring ? 'loading' : memberPaneStatus(members)}
                    onRetry={members.retry}
                />
                <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                    <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2">
                        {FILTERS.map((f) => (
                            <Pill
                                key={f.kind}
                                selected={kind === f.kind}
                                tone={f.kind === 'favorite' ? 'star' : 'accent'}
                                onClick={() => pickKind(f.kind)}
                            >
                                {f.kind === 'favorite' && (
                                    <Star aria-hidden="true" className="h-3.5 w-3.5 fill-current text-semantic-star drop-shadow-sm" />
                                )}
                                {t(f.key)}
                            </Pill>
                        ))}
                        {/* Quiet background progress: thumbnails still being prepared (or paused). */}
                        <AlbumPregenBar service={service} active={itemCount > 0 && !deferring} />
                    </div>
                    <MediaGridContext.Provider value={reporter}>{body}</MediaGridContext.Provider>
                    {coverFailure > 0 && (
                        <div
                            role="status"
                            className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-pill bg-toast px-4 py-2 text-small text-viewer animate-reveal motion-reduce:animate-none"
                        >
                            {t('memories.album.coverFailed')}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
