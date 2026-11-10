import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ImageIcon, Star } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { EmptyState, Pill } from '../../../design/primitives';
import type { CorePageProps, MemoriesRoute } from '../MemoriesFeature';
import { fetchAlbumColors, fetchAlbumMembers, fetchAlbumMonths } from '../api';
import { logMemoriesToggle } from '../memoriesLog';
import { LoadState } from '../shared/LoadState';
import { MemberPane, type MemberPaneItem } from '../shared/MemberPane';
import { PageHeader } from '../shared/PageHeader';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import type { AlbumKind, AlbumMonthSummary, MemoriesCountedMember, MemoryMessage } from '../types';
import { ColorRibbon, type RibbonMonth } from './ColorRibbon';
import { MonthSection } from './MonthSection';

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

/** Start loading a month's grid this far before it scrolls into view. */
const NEAR_VIEWPORT = '600px 0px';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Her name from a room dir's last segment (`58 金村 美玖` → `金村 美玖`), when the list does not know the room. */
const nameFromRoom = (room: string) => (room.split('/').pop() ?? '').replace(/^\d+\s+/, '');

/**
 * Which month grids may load. With `IntersectionObserver`, a month loads once its band nears the
 * scroll container's viewport (`NEAR_VIEWPORT`); without it, the months load one after another
 * in list order (each waits for the previous one to settle). State changes only when a month is
 * newly requested or settled, so scrolling does not re-render the album.
 */
function useMonthLoading(months: string[], root: React.RefObject<HTMLElement>) {
    const lazy = typeof IntersectionObserver !== 'undefined';
    const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
    const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());
    const elements = useRef(new Map<string, HTMLElement>());
    const observer = useRef<IntersectionObserver | null>(null);

    const request = useCallback((add: string[]) => {
        setSeen((prev) => (add.every((m) => prev.has(m)) ? prev : new Set([...prev, ...add])));
    }, []);

    useEffect(() => {
        if (!lazy) return undefined;
        const io = new IntersectionObserver((entries) => {
            const near = entries
                .filter((e) => e.isIntersecting)
                .map((e) => e.target.getAttribute('data-month'))
                .filter((m): m is string => m !== null);
            if (near.length) request(near);
        }, { root: root.current, rootMargin: NEAR_VIEWPORT });
        observer.current = io;
        elements.current.forEach((el) => io.observe(el));
        return () => { io.disconnect(); observer.current = null; };
    }, [lazy, root, request]);

    const registerRef = useCallback((month: string, el: HTMLElement | null) => {
        const old = elements.current.get(month);
        if (old && old !== el) observer.current?.unobserve(old);
        if (el) {
            elements.current.set(month, el);
            observer.current?.observe(el);
        } else {
            elements.current.delete(month);
        }
    }, []);

    const onSettled = useCallback((month: string) => {
        setSettled((prev) => (prev.has(month) ? prev : new Set([...prev, month])));
    }, []);

    /** Scroll a month's band to the top of the scroll container. */
    const scrollTo = useCallback((month: string, behavior: ScrollBehavior) => {
        elements.current.get(month)?.scrollIntoView({ block: 'start', behavior });
    }, []);

    // In-order fallback: every month up to (and including) the first unsettled one.
    const firstOpen = lazy ? -1 : months.findIndex((m) => !settled.has(m));
    const isRequested = (month: string, index: number) =>
        seen.has(month) || (!lazy && (firstOpen === -1 || index <= firstOpen));

    return { isRequested, registerRef, onSettled, request, scrollTo };
}

interface AlbumGridProps {
    service: string;
    member: string | undefined;
    kind: AlbumKind;
    months: AlbumMonthSummary[];
    colors: Record<string, string | null>;
    nameOf: (m: MemoryMessage) => string;
}

/** The month bands in the pane's own scroll container, with the colour ribbon on the right edge. */
const AlbumGrid: React.FC<AlbumGridProps> = ({ service, member, kind, months, colors, nameOf }) => {
    const scroller = useRef<HTMLDivElement>(null);
    const monthKeys = useMemo(() => months.map((m) => m.month), [months]);
    const loading = useMonthLoading(monthKeys, scroller);
    // A ribbon jump re-aligns once the target's grid has loaded (its height changes then).
    const pendingJump = useRef<string | null>(null);
    const { onSettled: markSettled, request, scrollTo } = loading;

    const onSettled = useCallback((month: string) => {
        markSettled(month);
        if (pendingJump.current === month) {
            pendingJump.current = null;
            scrollTo(month, 'auto');
        }
    }, [markSettled, scrollTo]);

    const jump = useCallback((month: string) => {
        pendingJump.current = month;
        request([month]);
        scrollTo(month, reducedMotion() ? 'auto' : 'smooth');
    }, [request, scrollTo]);

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
                        requested={loading.isRequested(m.month, i)}
                        nameOf={nameOf}
                        registerRef={loading.registerRef}
                        onSettled={onSettled}
                    />
                ))}
            </div>
            <ColorRibbon months={ribbon} onSelect={jump} />
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
        (m: MemoryMessage) => byPath.get(m.member_path)?.name ?? selectedName ?? nameFromRoom(m.room),
        [byPath, selectedName],
    );
    const items: MemberPaneItem[] = useMemo(() => (people ?? []).map((m) => ({
        key: m.member_path, memberPath: m.member_path, name: m.name, avatarUrl: m.avatar_url, trailing: m.count,
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
