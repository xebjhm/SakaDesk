import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { EmptyState } from '../../../design/primitives';
import type { CorePageProps, MemoriesRoute } from '../MemoriesFeature';
import { fetchFavorites } from '../api';
import { logMemoriesToggle } from '../memoriesLog';
import { formatJstDate } from '../shared/jst';
import { LoadState } from '../shared/LoadState';
import { cn } from '../../../utils/classnames';
import { MEMBER_PANE_WIDTH, MemberPane, type MemberPaneItem } from '../shared/MemberPane';
import { PageHeader } from '../shared/PageHeader';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import { stopMemoriesVoices } from '../shared/voicePlayback';
import type { FavoriteItem, FavoritesPayload } from '../types';
import { CorkBoard } from './CorkBoard';
import { FilmStrip } from './FilmStrip';

export type FavoritesRoute = Extract<MemoriesRoute, { page: 'favorites' }>;

interface FavoritesPageProps extends Omit<CorePageProps, 'route'> {
    route: FavoritesRoute;
}

type ListPart = Pick<FavoritesPayload, 'total' | 'members'>;

/**
 * The favorites overview (spec 10). Left: 「すべてのお気に入り」 with the ★ total and each person
 * with her ★ count (people without one are not listed; a zero total shows no number). Picking a
 * person moves the route (`go`, logged `member_filter`), which refetches the board; the list
 * (always over everyone) stays from the last load meanwhile. Right: the cork board, or the
 * invitation copy when nothing is starred. Opening an item shows the film strip of her messages
 * that JST day around it (`memories_toggle` `film_strip` on / off) and stops a playing board
 * voice; leaving the page stops every voice (`stopMemoriesVoices`).
 */
export const FavoritesPage: React.FC<FavoritesPageProps> = ({ service, route, go }) => {
    const { t } = useTranslation();
    const member = route.memberPath;
    const [open, setOpen] = useState<FavoriteItem | null>(null);

    const board = useMemoriesQuery('favorites', (signal) => fetchFavorites(service, member, signal), [service, member], {
        count: (d) => d.items.length,
    });

    // The list is the same over every filter: keep the last one while a new board loads.
    const lastList = useRef<{ service: string; list: ListPart } | null>(null);
    if (board.data) lastList.current = { service, list: { total: board.data.total, members: board.data.members } };
    const list = lastList.current?.service === service ? lastList.current.list : null;

    const people = list?.members;
    // Leaving the page silences any voice it started.
    useEffect(() => () => stopMemoriesVoices(), []);
    const items: MemberPaneItem[] = useMemo(() => (people ?? []).map((m) => ({
        key: m.member_path, memberPath: m.member_path, name: m.name, avatarUrl: m.avatar_url, oshi: m.oshi, trailing: m.count,
    })), [people]);
    const total = list?.total ?? 0;

    const pickMember = (key: string | null) => {
        if ((key ?? undefined) === member) return;
        logMemoriesToggle('member_filter', key !== null);
        go({ page: 'favorites', memberPath: key ?? undefined });
    };
    const openItem = useCallback((item: FavoriteItem) => {
        // The strip is the fan's focus now: a board voice must not play on under it.
        stopMemoriesVoices();
        setOpen(item);
        logMemoriesToggle('film_strip', true);
    }, []);
    const closeItem = () => {
        setOpen(null);
        logMemoriesToggle('film_strip', false);
    };

    let body: React.ReactNode;
    if (board.status !== 'ready' || !board.data) {
        body = <LoadState status={board.status === 'error' ? 'error' : 'loading'} onRetry={board.retry} />;
    } else if (!board.data.items.length) {
        body = (
            <div className="flex flex-1 items-center justify-center bg-memories-cork">
                <EmptyState
                    icon={<Star className="fill-current text-semantic-star" />}
                    title={t('memories.favorites.title')}
                    description={t('memories.favorites.empty')}
                />
            </div>
        );
    } else {
        body = <CorkBoard key={member ?? ''} items={board.data.items} onOpen={openItem} />;
    }

    return (
        <div data-testid="memories-page-favorites" data-service={service} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <PageHeader title={t('memories.favorites.title')} onBack={() => go({ page: 'home' })} />
            <div className="flex min-h-0 flex-1">
                <MemberPane
                    className={cn(MEMBER_PANE_WIDTH, 'shrink-0 border-r border-subtle')}
                    items={items}
                    selectedKey={member ?? null}
                    onSelect={pickMember}
                    allLabel={t('memories.favorites.all')}
                    allTrailing={total > 0 ? total : undefined}
                />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">{body}</div>
            </div>
            {open && (
                <FilmStrip
                    service={service}
                    memberPath={open.member_path}
                    date={formatJstDate(open.ts)}
                    focusId={open.id}
                    onClose={closeItem}
                />
            )}
        </div>
    );
};
