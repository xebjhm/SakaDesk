import React, { useMemo, useState } from 'react';
import { Image as ImageIcon, Video, Volume2 } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import { Avatar, Button, Card } from '../../../design/primitives';
import { MessageBubble } from '../../messages/components/MessageBubble';
import { resizedAvatarUrl } from '../../messages/mediaUrl';
import { useAvatarWidth } from '../../messages/hooks/useAvatarWidth';
import { MemoryText } from '../shared/MemoryText';
import { toChatMessage } from '../shared/toMessage';
import { jumpToChat } from '../shared/jumpToChat';
import { dayPeople, type DayPerson } from './people';
import { laneLayout } from './laneLayout';
import { formatClock } from './format';
import type { DayMember, MemoryMessage } from '../types';

interface SwimlanesProps {
    members: DayMember[];
    /** The day's messages in time order (already filtered). */
    messages: MemoryMessage[];
}

const HOUR_MS = 60 * 60 * 1000;
const PX_PER_MINUTE = 1.2;
/** A collapsed card is `h-16` (64 px); keep these two in step. */
const CARD_HEIGHT = 64;
const GAP = 4;
const AVATAR_PX = 32;

const msgKey = (m: MemoryMessage) => `${m.service}|${m.room}|${m.id}`;

/** The ruler's span: the floor of the first message's hour to the ceiling of the last one's (local clock). */
function rulerSpan(messages: MemoryMessage[]): { start: number; hours: number[] } {
    const times = messages.map((m) => Date.parse(m.ts)).filter((n) => !Number.isNaN(n));
    if (!times.length) return { start: 0, hours: [] };
    const first = new Date(Math.min(...times));
    first.setMinutes(0, 0, 0);
    const last = new Date(Math.max(...times));
    if (last.getMinutes() || last.getSeconds() || last.getMilliseconds()) last.setHours(last.getHours() + 1);
    last.setMinutes(0, 0, 0);
    const start = first.getTime();
    const end = Math.max(last.getTime(), start + HOUR_MS);
    const hours: number[] = [];
    for (let t = start; t <= end; t += HOUR_MS) hours.push(t);
    return { start, hours };
}

const hourLabel = (t: number) => `${String(new Date(t).getHours()).padStart(2, '0')}:00`;

const MEDIA_ICON = { picture: ImageIcon, video: Video, voice: Volume2 } as const;

interface LaneCardProps {
    message: MemoryMessage;
    person: DayPerson;
    top: number;
    expanded: boolean;
    onToggle: () => void;
}

const LaneCard: React.FC<LaneCardProps> = ({ message: m, person, top, expanded, onToggle }) => {
    const { t } = useTranslation();
    const words = m.text ?? m.caption;
    const Icon = m.type === 'text' ? null : MEDIA_ICON[m.type];
    return (
        <Card
            data-testid="day-lane-card"
            style={{ top }}
            className={cn(
                'absolute inset-x-1 overflow-hidden transition-shadow duration-fast ease-standard motion-reduce:transition-none',
                expanded ? 'z-10 shadow-sheet' : 'h-16',
            )}
        >
            <button
                type="button"
                aria-expanded={expanded}
                title={expanded ? undefined : t('memories.day.expand')}
                onClick={onToggle}
                className="flex w-full items-start gap-2 p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
                <span className="shrink-0 text-caption tabular-nums text-muted">{formatClock(m.ts)}</span>
                {!expanded && (
                    m.type === 'picture' && m.media_url ? (
                        <img src={m.media_url} alt="" draggable={false} className="h-11 w-16 rounded-sm object-cover" />
                    ) : words ? (
                        <MemoryText as="span" text={words} className="line-clamp-2 min-w-0 text-small text-primary" />
                    ) : Icon ? (
                        <Icon aria-hidden="true" className="h-4 w-4 text-secondary" />
                    ) : null
                )}
            </button>
            {expanded && (
                <div className="flex flex-col gap-2 px-2 pb-2">
                    {m.type !== 'text' && (
                        <MessageBubble message={{ ...toChatMessage(m), content: null }} member_name={person.name} service={m.service} runStart={false} />
                    )}
                    {words && <MemoryText text={words} className="text-small text-primary" />}
                    <Button variant="ghost" size="sm" className="self-start" onClick={() => jumpToChat(m, person.name, 'day')}>
                        {t('memories.common.jumpToChat')}
                    </Button>
                </div>
            )}
        </Card>
    );
};

/**
 * 那一天 B: one column per person (avatar and name on top), time running down on an hour ruler
 * from the floor of the first message's hour to the ceiling of the last one's. Cards sit at
 * their time (`laneLayout` pushes overlapping ones down); a click expands one with her full
 * words and the jump to her chat. Columns keep a minimum width, so past five people the lanes
 * scroll sideways inside the pane.
 */
export const Swimlanes: React.FC<SwimlanesProps> = ({ members, messages }) => {
    const avatarWidth = useAvatarWidth(AVATAR_PX);
    const [expanded, setExpanded] = useState<string | null>(null);
    const people = useMemo(() => dayPeople(members, messages), [members, messages]);
    const { start, hours } = useMemo(() => rulerSpan(messages), [messages]);

    const lanes = people.map((person) => {
        const placed = laneLayout(
            person.messages.map((m) => ({ key: msgKey(m), minutes: (Date.parse(m.ts) - start) / 60000 })),
            { pxPerMinute: PX_PER_MINUTE, cardHeight: CARD_HEIGHT, gap: GAP },
        );
        return { person, placed };
    });
    const rulerHeight = hours.length ? ((hours[hours.length - 1] - start) / 60000) * PX_PER_MINUTE : 0;
    const lastBottom = Math.max(0, ...lanes.flatMap(({ placed }) => placed.map((p) => p.top + CARD_HEIGHT)));
    const height = Math.max(rulerHeight, lastBottom) + CARD_HEIGHT;

    return (
        <div data-testid="day-lanes" className="flex min-w-0">
            <div aria-hidden="true" className="sticky left-0 z-10 w-12 shrink-0 bg-sheet">
                <div className="h-16" />
                <div className="relative" style={{ height }}>
                    {hours.map((h) => (
                        <span
                            key={h}
                            data-testid="day-ruler-hour"
                            className="absolute right-2 -translate-y-1/2 text-caption tabular-nums text-muted"
                            style={{ top: ((h - start) / 60000) * PX_PER_MINUTE }}
                        >
                            {hourLabel(h)}
                        </span>
                    ))}
                </div>
            </div>
            {lanes.map(({ person, placed }) => (
                <section key={person.key} data-testid="day-lane" className="min-w-40 flex-1 px-1">
                    <header className="sticky top-0 z-10 flex h-16 flex-col items-center justify-center gap-1 bg-sheet">
                        <Avatar src={resizedAvatarUrl(person.avatarUrl, avatarWidth)} name={person.name} size="sm" decorative />
                        <span lang="ja" className="max-w-full truncate text-small font-semibold text-primary">{person.name}</span>
                    </header>
                    <div className="relative rounded-md bg-sunken" style={{ height }}>
                        {placed.map(({ key, top }, i) => (
                            <LaneCard
                                key={key}
                                message={person.messages[i]}
                                person={person}
                                top={top}
                                expanded={expanded === key}
                                onToggle={() => setExpanded((cur) => (cur === key ? null : key))}
                            />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
};
