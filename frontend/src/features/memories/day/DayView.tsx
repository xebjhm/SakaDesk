import React, { useMemo, useState } from 'react';
import { Heart } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import { Avatar, BusyContent, Pill, Switch } from '../../../design/primitives';
import { holidayName } from '../../../utils/jpHolidays';
import { getServicePrimaryColor } from '../../../data/services';
import { groupMarkerStyle } from '../../search/groupMarker';
import { resizedAvatarUrl } from '../../messages/mediaUrl';
import { useAvatarWidth } from '../../messages/hooks/useAvatarWidth';
import { fetchDay, fetchDayYears } from '../api';
import { CapsuleStrip } from '../capsule/CapsuleStrip';
import { logMemoriesToggle } from '../memoriesLog';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import { MemoriesStatus } from '../shared/memoriesStatus';
import { MergedTimeline } from './MergedTimeline';
import { Swimlanes } from './Swimlanes';
import { YearLanes } from './YearLanes';
import { dayPeople } from './people';
import { formatDayHeading, formatMonthDayLabel } from './format';

interface DayViewProps {
    service: string;
    /** JST date `YYYY-MM-DD`. */
    date: string;
    /** One person only (any of her rooms' chat paths); hides the chips and the cross-group switch. */
    memberPath?: string;
    /** The day's 時光膠囊 strip under the header (default true); the film strip and card contexts pass false. */
    showCapsule?: boolean;
}

type DayMode = 'merged' | 'lanes' | 'years';
const CHIP_AVATAR_PX = 20;

/**
 * 那一天 (spec 7), shared by On This Day and the calendar: the date with its weekday, the
 * holiday name and one number (the messages shown), member chips, the 「包含其他團體」 switch
 * (refetches with `others`, logs `memories_toggle` `other_services`; another group's chip carries
 * its group marker; a chip pick logs `member_filter`) and the A / B toggle
 * (merged timeline / swimlanes, A by default, kept for as long as the view is mounted; logs
 * `memories_toggle` `day_mode`), and a third mode, 歷年同一天 (B1, `YearLanes`): the same
 * month-day in every year with messages (`fetchDayYears`, asked for only while the mode is on;
 * logs `memories_toggle` `day_years`), its heading the month-day alone, its chips the people of
 * every year, without the cross-group switch (it reads the active group only). Under the header sits the day's 時光膠囊 strip (the fan's notes on
 * that date, also on a one-person day), left out only when the host passes `showCapsule={false}`.
 * While another day (or the switch) loads, the previous day stays on screen (`keepPrevious`,
 * `BusyContent`: `aria-busy` and inert, dimmed after the reveal delay) unless it was empty; the
 * first load, a step from an empty day and an error show the Memories load state.
 */
export const DayView: React.FC<DayViewProps> = ({ service, date, memberPath, showCapsule = true }) => {
    const { t, i18n } = useTranslation();
    const chipAvatar = useAvatarWidth(CHIP_AVATAR_PX);
    const [mode, setMode] = useState<DayMode>('merged');
    const [others, setOthers] = useState(false);
    const [filter, setFilter] = useState<string | null>(null);
    // The body's scroller, which windows a long merged timeline (a state ref, so the list re-renders with it).
    const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
    const withOthers = memberPath === undefined && others;
    const monthDay = date.slice(5);
    const yearsMode = mode === 'years';

    const query = useMemoriesQuery(
        'day',
        (signal) => fetchDay(service, { date, member: memberPath, others: withOthers }, signal),
        [service, date, memberPath, withOthers],
        // A day step (or the switch) keeps the previous day on screen, dimmed, until the next arrives.
        // An empty day is never kept: its empty line would read as the next day's answer.
        { count: (d) => d.messages.length, keepPrevious: { scope: service, isEmpty: (d) => d.messages.length === 0 } },
    );
    const years = useMemoriesQuery(
        'day_years',
        (signal) => fetchDayYears(service, { monthDay, member: memberPath }, signal),
        [service, monthDay, memberPath],
        {
            count: (d) => d.years.length,
            enabled: yearsMode,
            keepPrevious: { scope: service, isEmpty: (d) => d.years.length === 0 },
        },
    );
    const data = query.data;
    const yearsData = yearsMode ? years.data : null;
    const people = useMemo(() => {
        if (yearsData) return dayPeople(yearsData.members, yearsData.years.flatMap((y) => y.messages));
        return data && !yearsMode ? dayPeople(data.members, data.messages) : [];
    }, [data, yearsData, yearsMode]);
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
    const yearColumns = useMemo(() => {
        if (!yearsData) return [];
        if (active === null) return yearsData.years;
        return yearsData.years
            .map((y) => ({ ...y, messages: y.messages.filter((m) => m.person_key === active) }))
            .filter((y) => y.messages.length > 0);
    }, [yearsData, active]);

    const holiday = holidayName(date);
    const switchMode = (next: DayMode) => {
        if (next === mode) return;
        setMode(next);
        if (next === 'years' || mode === 'years') logMemoriesToggle('day_years', next === 'years');
        else logMemoriesToggle('day_mode', next === 'lanes');
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
    if (yearsMode) {
        if (!yearsData) body = <MemoriesStatus query={years} view="day_years" />;
        else if (!yearColumns.length) body = <p className="p-6 text-center text-small text-secondary">{t('memories.onThisDay.empty')}</p>;
        else body = <YearLanes members={yearsData.members} years={yearColumns} />;
    } else if (!data) {
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
                <h2 className="font-display text-heading text-primary">
                    {yearsMode ? formatMonthDayLabel(monthDay, i18n.language) : formatDayHeading(date, i18n.language)}
                </h2>
                {holiday && !yearsMode && <span lang="ja" className="text-small text-calendar-holiday">{holiday}</span>}
                {!yearsMode && messages.length > 0 && (
                    <span className="text-small tabular-nums text-muted">{t('memories.day.count', { count: messages.length })}</span>
                )}
                <div className="ml-auto flex items-center gap-2">
                    <Pill selected={mode === 'merged'} onClick={() => switchMode('merged')}>{t('memories.day.modeMerged')}</Pill>
                    <Pill selected={mode === 'lanes'} onClick={() => switchMode('lanes')}>{t('memories.day.modeLanes')}</Pill>
                    <Pill selected={mode === 'years'} onClick={() => switchMode('years')}>{t('memories.day.modeYears')}</Pill>
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
                    {!yearsMode && (
                        <label className="ml-auto flex items-center gap-2 text-small text-secondary">
                            <span aria-hidden="true">{t('memories.day.otherGroups')}</span>
                            <Switch checked={others} onCheckedChange={toggleOthers} aria-label={t('memories.day.otherGroups')} />
                        </label>
                    )}
                </div>
            )}
            <BusyContent busy={yearsMode ? years.stale : query.stale} inertWhileBusy className="flex min-h-0 flex-1 flex-col" contentClassName="flex min-h-0 flex-1 flex-col">
                {/* 歷年同一天 has no side padding: its sticky axis must sit flush with the scroller's left
                    edge, or the lanes would show through a strip beside it when scrolled sideways. */}
                <div ref={setScroller} className={cn('min-h-0 flex-1 overflow-auto overscroll-contain pb-4', !yearsMode && 'px-4')}>{body}</div>
            </BusyContent>
        </section>
    );
};
