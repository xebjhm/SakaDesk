import React, { useEffect, useMemo } from 'react';
import { Radio } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { EmptyState } from '../../../design/primitives';
import type { MemoriesRoute } from '../MemoriesFeature';
import { fetchRadioMembers } from '../api';
import { logMemoriesToggle } from '../memoriesLog';
import { LoadState } from '../shared/LoadState';
import { MemberPane, type MemberPaneItem } from '../shared/MemberPane';
import { PageHeader } from '../shared/PageHeader';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import { stopMemoriesVoices } from '../shared/voicePlayback';
import { formatVoiceLength } from './radioFormat';
import { useSleepTimer } from './useSleepTimer';
import { Station } from './Station';

export type RadioRoute = Extract<MemoriesRoute, { page: 'radio' }>;

interface RadioPageProps {
    service: string;
    route: RadioRoute;
    go: (next: MemoriesRoute) => void;
}

/**
 * The voice radio (spec 11). Left: 「全員」 and every person with a voice, each with her total
 * voice length only (one number per row; unknown lengths draw nothing), the oshi heart as in the
 * core. Right: the station. Picking a person moves the route (`go`, logged `member_filter`);
 * switching person or leaving the page stops every Memories voice (`stopMemoriesVoices`). The
 * sleep timer belongs to the page, so it survives both program and member switches.
 * Nobody with a voice: the gentle empty copy, never a 0.
 */
export const RadioPage: React.FC<RadioPageProps> = ({ service, route, go }) => {
    const { t } = useTranslation();
    const member = route.memberPath;
    // The sleep timer lives here: a member switch reloads the station but keeps it running.
    const sleep = useSleepTimer();
    const list = useMemoriesQuery('radio_members', (signal) => fetchRadioMembers(service, signal), [service], {
        count: (d) => d.members.length,
    });

    // Switching person or leaving the page silences the radio.
    useEffect(() => () => stopMemoriesVoices(), [member]);

    const people = list.data?.members;
    const items: MemberPaneItem[] = useMemo(() => (people ?? []).map((m) => ({
        key: m.member_path,
        memberPath: m.member_path,
        name: m.name,
        avatarUrl: m.avatar_url,
        oshi: m.oshi,
        trailing: formatVoiceLength(t, m.seconds) ?? undefined,
    })), [people, t]);
    const memberName = people?.find((m) => m.member_path === member)?.name ?? null;

    const pickMember = (key: string | null) => {
        if ((key ?? undefined) === member) return;
        logMemoriesToggle('member_filter', key !== null);
        go({ page: 'radio', memberPath: key ?? undefined });
    };

    let body: React.ReactNode;
    if (list.status !== 'ready' || !list.data) {
        body = <LoadState status={list.status === 'error' ? 'error' : 'loading'} onRetry={list.retry} />;
    } else if (list.data.members.length === 0) {
        body = (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState icon={<Radio />} title={t('memories.radio.title')} description={t('memories.radio.empty')} />
            </div>
        );
    } else {
        body = <Station service={service} member={member} memberName={memberName} sleep={sleep} />;
    }

    return (
        <div data-testid="memories-page-radio" data-service={service} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <PageHeader title={t('memories.radio.title')} onBack={() => go({ page: 'home' })} />
            <div className="flex min-h-0 flex-1">
                <MemberPane
                    className="w-60 shrink-0 border-r border-subtle"
                    items={items}
                    selectedKey={member ?? null}
                    onSelect={pickMember}
                    allLabel={t('memories.radio.all')}
                    allTrailing={formatVoiceLength(t, list.data?.total_seconds) ?? undefined}
                />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">{body}</div>
            </div>
        </div>
    );
};
