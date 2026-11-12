import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Flower2 } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Pill } from '../../../design/primitives';
import type { CorePageProps, MemoriesRoute } from '../MemoriesFeature';
import { fetchMemoirCards, fetchMemoirHeader, fetchMemoirMembers } from '../api';
import { MemoriesStatus } from '../shared/memoriesStatus';
import { cn } from '../../../utils/classnames';
import { MEMBER_PANE_WIDTH, MemberPane, type MemberPaneItem } from '../shared/MemberPane';
import { memberPaneStatus } from '../shared/memberPaneStatus';
import { PageHeader } from '../shared/PageHeader';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import { logMemoriesSkip } from '../memoriesLog';
import type { BinderCard, MemoirMember } from '../types';
import { Day24View } from '../day24/Day24View';
import { Binder } from './Binder';
import { CardDetail } from './CardDetail';
import { MemoirHeader, MemoirHeaderPlaceholder } from './MemoirHeader';
import { NameMoments } from './NameMoments';
import { Timeline } from './Timeline';

export type MemoirRoute = Extract<MemoriesRoute, { page: 'memoir' }>;
type MemoirTab = NonNullable<MemoirRoute['tab']>;

interface MemoirPageProps extends Omit<CorePageProps, 'route'> {
    route: MemoirRoute;
}

/** A list row's trailing detail: 「earned / total 枚」 (never 「0 / N」) and the graduation marker. */
const Trailing: React.FC<{ member: MemoirMember }> = ({ member }) => {
    const { t } = useTranslation();
    const { earned, total } = member.progress;
    const progress = earned > 0 ? t('memories.memoir.progress', { earned, total }) : null;
    if (!progress && !member.graduated) return null;
    return (
        <span className="flex items-center gap-1">
            {progress}
            {member.graduated && (
                <Flower2
                    data-testid="memoir-graduated"
                    role="img"
                    aria-label={t('memories.shelves.graduation.title')}
                    className="h-3.5 w-3.5 text-muted"
                />
            )}
        </span>
    );
};

/**
 * The binder of the selected person, with its card detail. `cardKey` (a notification deep link)
 * opens that earned card's detail once the binder is loaded, once per link: `link` is the route
 * object the key came with, and every toast click makes a new one, so a repeat click opens the
 * card again while a re-render does not. Each link also reloads the binder first, so a toast for
 * a member whose binder is already on screen still finds a card she earned since it was loaded.
 * A key that is not an earned card of hers logs `memories_skip` `card_missing` (again on a repeat
 * click) and shows the binder.
 */
const BinderPane: React.FC<{ service: string; memberPath: string; name: string; cardKey?: string; link: object }> = ({
    service, memberPath, name, cardKey, link,
}) => {
    // A deep link refetches even when her binder is already loaded: a card earned since then
    // (e.g. an anniversary across midnight) must be found. A re-render keeps the same link object.
    const binder = useMemoriesQuery('binder', (signal) => fetchMemoirCards(service, memberPath, signal), [service, memberPath, cardKey ? link : null], {
        count: (d) => d.progress.earned,
    });
    const [open, setOpen] = useState<{ path: string; card: BinderCard } | null>(null);
    const card = open?.path === memberPath ? open.card : null;

    const focused = useRef<object | null>(null);
    const data = binder.status === 'ready' ? binder.data : null;
    useEffect(() => {
        if (!cardKey || !data) return;
        if (focused.current === link) return;
        focused.current = link;
        const hit = data.shelves.flatMap((s) => s.cards).find((c) => c.key === cardKey && c.date);
        if (hit) setOpen({ path: memberPath, card: hit });
        else logMemoriesSkip('binder', 'card_missing');
    }, [data, memberPath, cardKey, link]);

    if (binder.status !== 'ready' || !binder.data) {
        return <MemoriesStatus query={binder} view="binder" />;
    }
    return (
        <>
            <Binder binder={binder.data} onOpen={(c) => { if (c.date) setOpen({ path: memberPath, card: c }); }} />
            {card && <CardDetail service={service} memberPath={memberPath} name={name} card={card} onClose={() => setOpen(null)} />}
        </>
    );
};

/**
 * The member memoir (spec 5). Left: every person, oshi first (`MemberPane`), each with her binder
 * progress and, for a graduated member, a small memorial marker in neutral ink (skeleton rows while
 * the list loads; with a routed person its error / timeout line and Retry too). Without a
 * `memberPath` the first person is shown. Right: her header (`MemoirHeader`) over the 生写真帳 /
 * タイムライン tabs (`route.tab`, default the binder): the `Binder` or the `Timeline` with its month
 * rail. The names chip routes to the `names` tab (`NameMoments`) and the 「彼女の24時間」 chip to the
 * `day24` tab (`Day24View`), neither pill selected on either; the names tab's back link returns to
 * the binder. A person picked on the left keeps the timeline or day24 tab. The binder, the names
 * list and her 24 hours scroll inside the pane; the timeline keeps its rail fixed at the bottom and
 * scrolls the month above it.
 */
export const MemoirPage: React.FC<MemoirPageProps> = ({ service, route, go }) => {
    const { t } = useTranslation();
    const list = useMemoriesQuery('memoir_members', (signal) => fetchMemoirMembers(service, signal), [service], {
        count: (d) => d.members.length,
    });
    const members = list.data?.members;
    const memberPath = route.memberPath ?? members?.[0]?.member_path;
    const tab: MemoirTab = route.tab ?? 'binder';
    const selected = members?.find((m) => m.member_path === memberPath);

    const items: MemberPaneItem[] = useMemo(() => (members ?? []).map((m) => ({
        key: m.member_path, memberPath: m.member_path, name: m.name, avatarUrl: m.avatar_url, oshi: m.oshi,
        trailing: <Trailing member={m} />,
    })), [members]);

    const header = useMemoriesQuery(
        'memoir',
        (signal) => (memberPath ? fetchMemoirHeader(service, memberPath, signal) : Promise.resolve(null)),
        [service, memberPath],
        { count: (d) => (d ? Object.values(d.chips).filter((v) => v !== null).length : 0) },
    );

    const pickMember = (key: string | null) => {
        if (!key || key === memberPath) return;
        go({ page: 'memoir', memberPath: key, ...(tab === 'timeline' || tab === 'day24' ? { tab } : {}) });
    };
    const pickTab = (next: MemoirTab) => {
        if (next !== tab) go({ page: 'memoir', memberPath, tab: next });
    };

    // A routed person loads at once; without one the pane waits for the list's first person.
    let pane: React.ReactNode = null;
    if (!memberPath && list.status !== 'ready') {
        pane = <MemoriesStatus query={list} view="memoir_members" />;
    } else if (memberPath) {
        const name = header.data?.name ?? selected?.name ?? '';
        pane = (
            <>
                {header.status === 'ready' && header.data
                    ? (
                        <MemoirHeader
                            header={header.data}
                            onNames={() => go({ page: 'memoir', memberPath, tab: 'names' })}
                            onDay24={() => go({ page: 'memoir', memberPath, tab: 'day24' })}
                        />
                    )
                    : header.status === 'error'
                        ? <MemoriesStatus query={header} view="memoir" />
                        : <MemoirHeaderPlaceholder />}
                <div role="group" className="flex shrink-0 gap-2 px-4 pb-2">
                    <Pill selected={tab === 'binder'} onClick={() => pickTab('binder')}>{t('memories.memoir.tabBinder')}</Pill>
                    <Pill selected={tab === 'timeline'} onClick={() => pickTab('timeline')}>{t('memories.memoir.tabTimeline')}</Pill>
                </div>
                {tab === 'binder' && (
                    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                        <BinderPane service={service} memberPath={memberPath} name={name} cardKey={route.cardKey} link={route} />
                    </div>
                )}
                {tab === 'timeline' && <Timeline key={memberPath} service={service} memberPath={memberPath} name={name} />}
                {tab === 'day24' && <Day24View key={memberPath} service={service} memberPath={memberPath} name={name} />}
                {tab === 'names' && (
                    <NameMoments
                        key={memberPath}
                        service={service}
                        memberPath={memberPath}
                        name={name}
                        onBack={() => go({ page: 'memoir', memberPath, tab: 'binder' })}
                    />
                )}
            </>
        );
    }

    return (
        <div data-testid="memories-page-memoir" data-service={service} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <PageHeader title={t('memories.memoir.title')} onBack={() => go({ page: 'home' })} />
            <div className="flex min-h-0 flex-1">
                <MemberPane
                    className={cn(MEMBER_PANE_WIDTH, 'shrink-0 border-r border-subtle')}
                    items={items}
                    selectedKey={memberPath ?? null}
                    onSelect={pickMember}
                    // Without a routed person the pane's body already shows the list's error (and Retry).
                    status={memberPath ? memberPaneStatus(list) : list.status === 'loading' ? 'loading' : 'ready'}
                    onRetry={list.retry}
                />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">{pane}</div>
            </div>
        </div>
    );
};
