import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ImageIcon, Star } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { EmptyState, Pill } from '../../../design/primitives';
import type { CorePageProps, MemoriesRoute } from '../MemoriesFeature';
import { fetchAlbumColors, fetchAlbumMembers, fetchAlbumMonths } from '../api';
import { logMemoriesToggle } from '../memoriesLog';
import { LoadState } from '../shared/LoadState';
import { MemberPane, type MemberPaneItem } from '../shared/MemberPane';
import { messageName } from '../shared/nameFromRoom';
import { PageHeader } from '../shared/PageHeader';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import type { AlbumKind, AlbumMonthSummary, MemoriesCountedMember, MemoryMessage } from '../types';
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
}

/**
 * The month bands in the pane's own scroll container, with the colour ribbon on the right edge.
 * Loading and windowing are `useAlbumWindow`'s: bands far from the viewport release their grids,
 * and a ribbon jump scrolls instantly and loads only where it lands.
 */
const AlbumGrid: React.FC<AlbumGridProps> = ({ service, member, kind, months, colors, nameOf }) => {
    const scroller = useRef<HTMLDivElement>(null);
    const monthKeys = useMemo(() => months.map((m) => m.month), [months]);
    const win = useAlbumWindow(monthKeys, scroller);

    const ribbon: RibbonMonth[] = useMemo(
        () => months.map((m) => ({ month: m.month, color: colors[m.month] ?? null })),
        [months, colors],
    );

    return (
        <div className="flex min-h-0 flex-1 gap-2 pb-2 pr-2">
            <div ref={scroller} data-testid="album-scroller" className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
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
 */
export const AlbumPage: React.FC<AlbumPageProps> = ({ service, route, go }) => {
    const { t } = useTranslation();
    const member = route.memberPath;
    const [kind, setKind] = useState<AlbumKind>('all');

    const members = useMemoriesQuery('album_members', (signal) => fetchAlbumMembers(service, signal), [service], {
        count: (d) => d.members.length,
    });
    const months = useMemoriesQuery('album', (signal) => fetchAlbumMonths(service, { member, kind }, signal), [service, member, kind], {
        count: (d) => d.months.length,
    });
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
    if (months.status !== 'ready' || !months.data) {
        body = <LoadState status={months.status === 'error' ? 'error' : 'loading'} onRetry={months.retry} />;
    } else if (!months.data.months.length) {
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
                months={months.data.months}
                colors={colors.data?.colors ?? {}}
                nameOf={nameOf}
            />
        );
    }

    return (
        <div data-testid="memories-page-album" data-service={service} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <PageHeader title={t('memories.album.title')} onBack={() => go({ page: 'home' })} />
            <div className="flex min-h-0 flex-1">
                <MemberPane
                    className="w-60 shrink-0 border-r border-subtle"
                    items={items}
                    selectedKey={member ?? null}
                    onSelect={pickMember}
                    allLabel={t('memories.common.all')}
                    allTrailing={total > 0 ? total : undefined}
                />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
                </div>
            </div>
        </div>
    );
};
