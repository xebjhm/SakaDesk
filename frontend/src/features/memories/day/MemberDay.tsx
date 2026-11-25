import React, { useMemo } from 'react';
import { MessageCircle } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Button, Modal } from '../../../design/primitives';
import { fetchDay } from '../api';
import type { MemoriesView } from '../memoriesLog';
import { formatJstDate } from '../shared/jst';
import { jumpToChat } from '../shared/jumpToChat';
import type { MemoryMessage } from '../types';
import { formatDayHeading } from './format';
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
 * `MergedTimeline` with the `focus` message tinted and scrolled to inside the column's own
 * scroller (`data-focus-scroller`: bounded by its flex parent from `md`, `max-h-96` below). Loading, slow, error and
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
        <section data-testid={testId} aria-labelledby={headingId} className="flex min-h-0 min-w-0 flex-1 flex-col">
            <h3 id={headingId} data-testid={headingId} className="mb-2 shrink-0 text-small text-muted">
                {label}
            </h3>
            {/* The column is its own scroller at every width, so focusing a message never moves
                the dialog body (and the card face with it). */}
            <div data-testid={`${testId}-scroller`} data-focus-scroller="" className="max-h-96 min-h-0 flex-1 overflow-y-auto md:max-h-none">
                {day.status === 'ready' && data
                    ? <MergedTimeline messages={data.messages} people={people} service={service} focus={focus} />
                    : day.status !== 'ready' && <MemoriesStatus query={day} view="day" />}
            </div>
        </section>
    );
};

interface MemberDayDialogProps {
    service: string;
    memberPath: string;
    /** Her display name: the dialog title (`lang="ja"`) and the chat the jump opens. */
    name: string;
    /** The message that was clicked: its JST day is shown, with it focused. */
    message: MemoryMessage;
    /** The view the dialog was opened from (the jump's `memories_jump` target). */
    from: MemoriesView;
    onClose: () => void;
}

/**
 * Her messages of one JST day over the current view (the 24h tab's slots): a `Modal` (inherits
 * the opener's scope) titled with her name, holding `MemberDayColumn` with the clicked message
 * focused, and a jump to her chat at it. Closing only closes the dialog: the view underneath keeps
 * its state (no navigation).
 */
export const MemberDayDialog: React.FC<MemberDayDialogProps> = ({ service, memberPath, name, message, from, onClose }) => {
    const { t, i18n } = useTranslation();
    const date = formatJstDate(message.ts);
    return (
        <Modal
            isOpen
            onClose={onClose}
            title={<span lang="ja">{name}</span>}
            header="plain"
            closeLabel={t('common.close')}
            className="max-w-2xl"
            bodyClassName="md:flex md:flex-col md:overflow-hidden"
            footer={(
                <Button variant="secondary" size="sm" onClick={() => { jumpToChat(message, name, from); onClose(); }}>
                    <MessageCircle aria-hidden="true" className="h-4 w-4" />
                    {t('memories.common.jumpToChat')}
                </Button>
            )}
        >
            <MemberDayColumn
                service={service}
                memberPath={memberPath}
                date={date}
                label={t('memories.cardDetail.dayOf', { date: formatDayHeading(date, i18n.language) })}
                focus={{ room: message.room, id: message.id }}
                testId={`${from}-day`}
            />
        </Modal>
    );
};
