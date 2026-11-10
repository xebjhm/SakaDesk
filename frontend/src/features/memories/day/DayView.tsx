import React, { useMemo, useState } from 'react';
import { Heart } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Avatar, Pill, Switch } from '../../../design/primitives';
import { holidayName } from '../../../utils/jpHolidays';
import { getServicePrimaryColor } from '../../../data/services';
import { groupMarkerStyle } from '../../search/groupMarker';
import { resizedAvatarUrl } from '../../messages/mediaUrl';
import { useAvatarWidth } from '../../messages/hooks/useAvatarWidth';
import { fetchDay } from '../api';
import { logMemoriesToggle } from '../memoriesLog';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import { LoadState } from '../shared/LoadState';
import { MergedTimeline } from './MergedTimeline';
import { Swimlanes } from './Swimlanes';
import { dayPeople } from './people';
import { formatDayHeading } from './format';

interface DayViewProps {
    service: string;
    /** JST date `YYYY-MM-DD`. */
    date: string;
    /** One person only (any of her rooms' chat paths); hides the chips and the cross-group switch. */
    memberPath?: string;
    /** Header controls of the host (wave 4 puts the ⇆ あの日と今日 toggle here). */
    headerSlot?: React.ReactNode;
}

type DayMode = 'merged' | 'lanes';
const CHIP_AVATAR_PX = 20;

/**
 * 那一天 (spec 7), shared by On This Day and the calendar: the date with its weekday, the
 * holiday name and one number (the messages shown), member chips, the 「包含其他團體」 switch
 * (refetches with `others`, logs `memories_toggle` `other_services`; another group's chip carries
 * its group marker; a chip pick logs `member_filter`) and the A / B toggle
 * (merged timeline / swimlanes, A by default, kept for as long as the view is mounted; logs
 * `memories_toggle` `day_mode`).
 */
export const DayView: React.FC<DayViewProps> = ({ service, date, memberPath, headerSlot }) => {
    const { t, i18n } = useTranslation();
    const chipAvatar = useAvatarWidth(CHIP_AVATAR_PX);
    const [mode, setMode] = useState<DayMode>('merged');
    const [others, setOthers] = useState(false);
    const [filter, setFilter] = useState<string | null>(null);
    // The body's scroller, which windows a long merged timeline (a state ref, so the list re-renders with it).
    const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
    const withOthers = memberPath === undefined && others;

    const query = useMemoriesQuery(
        'day',
        (signal) => fetchDay(service, { date, member: memberPath, others: withOthers }, signal),
        [service, date, memberPath, withOthers],
        { count: (d) => d.messages.length },
    );
    const data = query.data;
    const people = useMemo(() => (data ? dayPeople(data.members, data.messages) : []), [data]);
    const peopleByKey = useMemo(() => new Map(people.map((p) => [p.key, p])), [people]);
    // A chip of a person who is not in this payload (another date, the switch) reads as everyone.
    const active = filter !== null && peopleByKey.has(filter) ? filter : null;
    const messages = useMemo(
        () => (data ? (active === null ? data.messages : data.messages.filter((m) => m.person_key === active)) : []),
        [data, active],
    );
    const members = useMemo(
        () => (data ? (active === null ? data.members : data.members.filter((m) => m.person_key === active)) : []),
        [data, active],
    );

    const holiday = holidayName(date);
    const switchMode = (next: DayMode) => {
        if (next === mode) return;
        setMode(next);
        logMemoriesToggle('day_mode', next === 'lanes');
    };
    const pickMember = (key: string | null) => {
        if (key === active) return;
        setFilter(key);
        logMemoriesToggle('member_filter', key !== null);
    };
    const toggleOthers = (next: boolean) => {
        setOthers(next);
        logMemoriesToggle('other_services', next);
    };

    let body: React.ReactNode;
    if (query.status !== 'ready' || !data) {
        body = <LoadState status={query.status === 'error' ? 'error' : 'loading'} onRetry={query.retry} />;
    } else if (!messages.length) {
        body = <p className="p-6 text-center text-small text-secondary">{t('memories.onThisDay.empty')}</p>;
    } else if (mode === 'merged') {
        body = <MergedTimeline messages={messages} people={peopleByKey} service={service} scrollParent={scroller} />;
    } else {
        body = <Swimlanes members={members} messages={messages} />;
    }

    return (
        <section data-testid="day-view" className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3">
                <h2 className="font-display text-heading text-primary">{formatDayHeading(date, i18n.language)}</h2>
                {holiday && <span lang="ja" className="text-small text-calendar-holiday">{holiday}</span>}
                {messages.length > 0 && (
                    <span className="text-small tabular-nums text-muted">{t('memories.day.count', { count: messages.length })}</span>
                )}
                <div className="ml-auto flex items-center gap-2">
                    {headerSlot}
                    <Pill selected={mode === 'merged'} onClick={() => switchMode('merged')}>{t('memories.day.modeMerged')}</Pill>
                    <Pill selected={mode === 'lanes'} onClick={() => switchMode('lanes')}>{t('memories.day.modeLanes')}</Pill>
                </div>
            </header>
            {memberPath === undefined && (
                <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                    {people.length > 1 && (
                        <>
                            <Pill selected={active === null} onClick={() => pickMember(null)}>{t('memories.common.all')}</Pill>
                            {people.map((p) => (
                                <Pill key={p.key} selected={active === p.key} onClick={() => pickMember(p.key)}>
                                    <Avatar src={resizedAvatarUrl(p.avatarUrl, chipAvatar)} name={p.name} size="sm" className="h-5 w-5 text-caption" decorative />
                                    <span lang="ja">{p.name}</span>
                                    {p.service !== service && (
                                        <span
                                            data-testid="day-chip-group-marker"
                                            aria-hidden="true"
                                            className="h-2 w-2 shrink-0 rounded-pill bg-group-marker"
                                            style={groupMarkerStyle(getServicePrimaryColor(p.service))}
                                        />
                                    )}
                                    {p.oshi && <Heart aria-hidden="true" className="h-3 w-3 fill-semantic-oshi text-semantic-oshi-solid" />}
                                </Pill>
                            ))}
                        </>
                    )}
                    <label className="ml-auto flex items-center gap-2 text-small text-secondary">
                        <span aria-hidden="true">{t('memories.day.otherGroups')}</span>
                        <Switch checked={others} onCheckedChange={toggleOthers} aria-label={t('memories.day.otherGroups')} />
                    </label>
                </div>
            )}
            <div ref={setScroller} className="min-h-0 flex-1 overflow-auto px-4 pb-4">{body}</div>
        </section>
    );
};
