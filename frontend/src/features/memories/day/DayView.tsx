import React, { useMemo, useState } from 'react';
import { Heart } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Avatar, BusyContent, Pill, Switch } from '../../../design/primitives';
import { holidayName } from '../../../utils/jpHolidays';
import { getServicePrimaryColor } from '../../../data/services';
import { groupMarkerStyle } from '../../search/groupMarker';
import { resizedAvatarUrl } from '../../messages/mediaUrl';
import { useAvatarWidth } from '../../messages/hooks/useAvatarWidth';
import { fetchDay } from '../api';
import { CapsuleStrip } from '../capsule/CapsuleStrip';
import { logMemoriesToggle } from '../memoriesLog';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import { MemoriesStatus } from '../shared/memoriesStatus';
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
    /** The day's 時光膠囊 strip under the header (default true); the film strip and card contexts pass false. */
    showCapsule?: boolean;
}

type DayMode = 'merged' | 'lanes';
const CHIP_AVATAR_PX = 20;

/**
 * 那一天 (spec 7), shared by On This Day and the calendar: the date with its weekday, the
 * holiday name and one number (the messages shown), member chips, the 「包含其他團體」 switch
 * (refetches with `others`, logs `memories_toggle` `other_services`; another group's chip carries
 * its group marker; a chip pick logs `member_filter`) and the A / B toggle
 * (merged timeline / swimlanes, A by default, kept for as long as the view is mounted; logs
 * `memories_toggle` `day_mode`). Under the header sits the day's 時光膠囊 strip (the fan's notes on
 * that date, also on a one-person day), left out only when the host passes `showCapsule={false}`.
 * While another day (or the switch) loads, the previous day stays on screen (`keepPrevious`,
 * `BusyContent`: `aria-busy`, dimmed after the reveal delay); the first load and an error show
 * the Memories load state.
 */
export const DayView: React.FC<DayViewProps> = ({ service, date, memberPath, headerSlot, showCapsule = true }) => {
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
        // A day step (or the switch) keeps the previous day on screen, dimmed, until the next arrives.
        { count: (d) => d.messages.length, keepPrevious: { scope: service } },
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
    if (!data) {
        body = <MemoriesStatus query={query} view="day" />;
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
            {showCapsule && (
                <div className="px-4 pt-3">
                    <CapsuleStrip service={service} anchor={{ kind: 'day', date }} />
                </div>
            )}
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
            <BusyContent busy={query.stale} className="flex min-h-0 flex-1 flex-col" contentClassName="flex min-h-0 flex-1 flex-col">
                <div ref={setScroller} className="min-h-0 flex-1 overflow-auto px-4 pb-4">{body}</div>
            </BusyContent>
        </section>
    );
};
