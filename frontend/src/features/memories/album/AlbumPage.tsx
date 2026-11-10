import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ImageIcon, Star } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { EmptyState, Pill } from '../../../design/primitives';
import type { CorePageProps, MemoriesRoute } from '../MemoriesFeature';
import {
    deleteAlbumCover, fetchAlbumColors, fetchAlbumMembers, fetchAlbumMonths, MemoriesFetchError, MemoriesTimeoutError, putAlbumCover,
} from '../api';
import { logMemoriesToggle, type MemoriesToggleReason } from '../memoriesLog';
import { LoadState } from '../shared/LoadState';
import { MEMBER_PANE_WIDTH, MemberPane, type MemberPaneItem } from '../shared/MemberPane';
import { cn } from '../../../utils/classnames';
import { messageName } from '../shared/nameFromRoom';
import { PageHeader } from '../shared/PageHeader';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import type { AlbumKind, AlbumMonthSummary, AlbumMonthsPayload, MemoriesCountedMember, MemoryMessage } from '../types';
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
    colors: Record<string, string | null>;
    nameOf: (m: MemoryMessage) => string;
    onSetCover: (month: string, item: MemoryMessage) => void;
    onResetCover: (month: string) => void;
}

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
 * and a ribbon jump scrolls instantly and loads only where it lands.
 */
const AlbumGrid: React.FC<AlbumGridProps> = ({ service, member, kind, months, colors, nameOf, onSetCover, onResetCover }) => {
    const scroller = useRef<HTMLDivElement>(null);
    const monthKeys = useMemo(() => months.map((m) => m.month), [months]);
    const win = useAlbumWindow(monthKeys, scroller);

    const ribbon: RibbonMonth[] = useMemo(
        () => months.map((m) => ({ month: m.month, color: colors[m.month] ?? null })),
        [months, colors],
    );

    return (
        <div className="flex min-h-0 flex-1 gap-2 pb-2 pr-2">
            <div ref={scroller} data-testid="album-scroller" className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden px-4 pb-4">
                {months.map((m, i) => (
                    <MonthSection
                        key={m.month}
                        service={service}
                        summary={m}
                        member={member}
                        kind={kind}
                        data={win.cache.get(m.month)}
                        requested={win.isRequested(m.month, i)}
                        live={win.isLive(m.month)}
                        nameOf={nameOf}
                        registerRef={win.registerRef}
                        onLoaded={win.onLoaded}
                        onSettled={win.onSettled}
                        onSetCover={onSetCover}
                        onResetCover={onResetCover}
                    />
                ))}
            </div>
            <ColorRibbon months={ribbon} onSelect={win.jump} />
        </div>
    );
};

/**
 * The album (spec 8). Left: 「全員」 and each person with her photo count (people without any are
 * not listed; a zero total shows no number). Right: the 全部 / 照片 / 影片 / ★ filters (the ★ pill
 * is the neutral `star` tone with the yellow star, never the accent; a change logs
 * `memories_toggle` `album_filter`), the month bands newest first in the pane's own scroll
 * container (each grid loads lazily) and the colour ribbon. Picking a person moves the route
 * (`go`), which refetches the months and the ribbon.
 * Cover choice (spec 8): a tile's context menu sets the month cover (`putAlbumCover`, for the
 * person on screen or 全員), an override cover's menu clears it (`deleteAlbumCover`). Either
 * way the months refetch (`coverVersion`; the bands stay on screen meanwhile), also after a
 * failure, since a timed-out write may have landed: never retried. Success logs
 * `memories_toggle` `album_cover` (`on` = set, `off` = cleared); a failure logs `off` with its
 * `reason` (`not_in_month`, `timeout`, `request_failed`) and `error_code` (HTTP status, when the
 * backend answered) and shows the inline toast.
 */
export const AlbumPage: React.FC<AlbumPageProps> = ({ service, route, go }) => {
    const { t } = useTranslation();
    const member = route.memberPath;
    const [kind, setKind] = useState<AlbumKind>('all');
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
    });
    const months = useMemoriesQuery('album', (signal) => fetchAlbumMonths(service, { member, kind }, signal), [service, member, kind, coverVersion], {
        count: (d) => d.months.length,
    });
    // The last months of this person and filter, kept while a cover change refetches them.
    const monthsKey = `${member ?? ''}|${kind}`;
    const [kept, setKept] = useState<{ key: string; data: AlbumMonthsPayload } | null>(null);
    if (months.data && kept?.data !== months.data) setKept({ key: monthsKey, data: months.data });
    const shownMonths = months.data ?? (months.status === 'loading' && kept?.key === monthsKey ? kept.data : null);

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
    });

    const people = members.data?.members;
    const byPath = useMemo(
        () => new Map<string, MemoriesCountedMember>((people ?? []).map((m) => [m.member_path, m])),
        [people],
    );
    const selectedName = member !== undefined ? byPath.get(member)?.name : undefined;
    const nameOf = useCallback(
        (m: MemoryMessage) => messageName(m, byPath.get(m.member_path)?.name ?? selectedName),
        [byPath, selectedName],
    );
    const items: MemberPaneItem[] = useMemo(() => (people ?? []).map((m) => ({
        key: m.member_path, memberPath: m.member_path, name: m.name, avatarUrl: m.avatar_url, oshi: m.oshi, trailing: m.count,
    })), [people]);
    const total = members.data?.total ?? 0;

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
        body = <LoadState status={months.status === 'error' ? 'error' : 'loading'} onRetry={months.retry} />;
    } else if (!shownMonths.months.length) {
        body = (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState icon={<ImageIcon />} title={t('memories.album.title')} description={t('memories.album.empty')} />
            </div>
        );
    } else {
        body = (
            <AlbumGrid
                key={`${member ?? ''}|${kind}`}
                service={service}
                member={member}
                kind={kind}
                months={shownMonths.months}
                colors={colors.data?.colors ?? {}}
                nameOf={nameOf}
                onSetCover={onSetCover}
                onResetCover={onResetCover}
            />
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
                    </div>
                    {body}
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
