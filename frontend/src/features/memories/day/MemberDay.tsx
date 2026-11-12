import React, { useMemo } from 'react';
import { fetchDay } from '../api';
import { MemoriesStatus } from '../shared/memoriesStatus';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import { MergedTimeline } from './MergedTimeline';
import { dayPeople, type DayPerson } from './people';

interface MemberDayColumnProps {
    service: string;
    /** Her chat path (any of her rooms): only her messages are fetched. */
    memberPath: string;
    /** The JST day, `YYYY-MM-DD`. */
    date: string;
    /** The heading above the list (「{{date}} のメッセージ」 and friends). */
    label: string;
    /** Her message to bring forward: tinted and scrolled into view. */
    focus?: { room: string; id: number } | null;
    /** `data-testid` of the section; the heading is `<testId>-label`. */
    testId: string;
}

/**
 * One member's messages of one JST day: `fetchDay` with `member`, drawn by the day view's
 * `MergedTimeline` with the `focus` message tinted and scrolled to. Loading, slow, error and
 * empty go through `MemoriesStatus` (`view="day"`, the loading-UX contract). Shared by the card
 * detail's day column and the 24h tab's member-day dialog, so both read the same way.
 */
export const MemberDayColumn: React.FC<MemberDayColumnProps> = ({ service, memberPath, date, label, focus, testId }) => {
    const day = useMemoriesQuery(
        'day',
        (signal) => fetchDay(service, { date, member: memberPath }, signal),
        [service, memberPath, date],
        { count: (d) => d.messages.length },
    );
    const data = day.data;
    const people = useMemo(
        () => new Map<string, DayPerson>((data ? dayPeople(data.members, data.messages) : []).map((p) => [p.key, p])),
        [data],
    );
    const headingId = `${testId}-label`;
    return (
        <section data-testid={testId} aria-labelledby={headingId} className="min-w-0 flex-1">
            <h3 id={headingId} data-testid={headingId} className="mb-2 text-small text-muted">
                {label}
            </h3>
            {day.status === 'ready' && data
                ? <MergedTimeline messages={data.messages} people={people} service={service} focus={focus} />
                : day.status !== 'ready' && <MemoriesStatus query={day} view="day" />}
        </section>
    );
};
