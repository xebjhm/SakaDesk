import React, { useMemo, useState } from 'react';
import { Flower2 } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Pill } from '../../../design/primitives';
import type { CorePageProps, MemoriesRoute } from '../MemoriesFeature';
import { fetchMemoirCards, fetchMemoirHeader, fetchMemoirMembers } from '../api';
import { LoadState } from '../shared/LoadState';
import { MemberPane, type MemberPaneItem } from '../shared/MemberPane';
import { PageHeader } from '../shared/PageHeader';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import type { BinderCard, MemoirMember } from '../types';
import { Binder } from './Binder';
import { CardDetail } from './CardDetail';
import { MemoirHeader, MemoirHeaderPlaceholder } from './MemoirHeader';

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

/** The binder of the selected person, with its card detail. */
const BinderPane: React.FC<{ service: string; memberPath: string; name: string }> = ({ service, memberPath, name }) => {
    const binder = useMemoriesQuery('binder', (signal) => fetchMemoirCards(service, memberPath, signal), [service, memberPath], {
        count: (d) => d.progress.earned,
    });
    const [open, setOpen] = useState<{ path: string; card: BinderCard } | null>(null);
    const card = open?.path === memberPath ? open.card : null;
    if (binder.status !== 'ready' || !binder.data) {
        return <LoadState status={binder.status === 'error' ? 'error' : 'loading'} onRetry={binder.retry} />;
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
 * progress and, for a graduated member, a small memorial marker in neutral ink. Without a
 * `memberPath` the first person is shown. Right: her header (`MemoirHeader`) over the 生写真帳 /
 * タイムライン tabs (`route.tab`, default the binder). The names chip routes to the `names` tab.
 * The timeline and names tabs are drawn by Task C12.
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
        go({ page: 'memoir', memberPath: key, ...(tab === 'timeline' ? { tab } : {}) });
    };
    const pickTab = (next: MemoirTab) => {
        if (next !== tab) go({ page: 'memoir', memberPath, tab: next });
    };

    // A routed person loads at once; without one the pane waits for the list's first person.
    let pane: React.ReactNode = null;
    if (!memberPath && list.status !== 'ready') {
        pane = <LoadState status={list.status === 'error' ? 'error' : 'loading'} onRetry={list.retry} />;
    } else if (memberPath) {
        const name = header.data?.name ?? selected?.name ?? '';
        pane = (
            <>
                {header.status === 'ready' && header.data
                    ? <MemoirHeader header={header.data} onNames={() => go({ page: 'memoir', memberPath, tab: 'names' })} />
                    : header.status === 'error'
                        ? <LoadState status="error" onRetry={header.retry} />
                        : <MemoirHeaderPlaceholder />}
                <div role="group" className="flex shrink-0 gap-2 px-4 pb-2">
                    <Pill selected={tab === 'binder'} onClick={() => pickTab('binder')}>{t('memories.memoir.tabBinder')}</Pill>
                    <Pill selected={tab === 'timeline'} onClick={() => pickTab('timeline')}>{t('memories.memoir.tabTimeline')}</Pill>
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    {tab === 'binder' && <BinderPane service={service} memberPath={memberPath} name={name} />}
                </div>
            </>
        );
    }

    return (
        <div data-testid="memories-page-memoir" data-service={service} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <PageHeader title={t('memories.memoir.title')} onBack={() => go({ page: 'home' })} />
            <div className="flex min-h-0 flex-1">
                <MemberPane
                    className="w-64 shrink-0 border-r border-subtle"
                    items={items}
                    selectedKey={memberPath ?? null}
                    onSelect={pickMember}
                />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">{pane}</div>
            </div>
        </div>
    );
};
