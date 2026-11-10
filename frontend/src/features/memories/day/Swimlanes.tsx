import React, { useMemo, useState } from 'react';
import { Image as ImageIcon, Video, Volume2 } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import { Avatar, Button, Card } from '../../../design/primitives';
import { MessageBubble } from '../../messages/components/MessageBubble';
import { resizedAvatarUrl } from '../../messages/mediaUrl';
import { useAvatarWidth } from '../../messages/hooks/useAvatarWidth';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import { contextCaption, shownTexts } from '../shared/captions';
import { useNickname } from '../shared/useNickname';
import { toChatMessage } from '../shared/toMessage';
import { jumpToChat } from '../shared/jumpToChat';
import { logMemoriesToggle } from '../memoriesLog';
import { JST_TIME_ZONE, formatJstClock } from '../shared/jst';
import { hourLabel, rulerSpan } from './ruler';
import { dayPeople, type DayPerson } from './people';
import { laneLayout } from './laneLayout';
import type { DayMember, DayMessage } from '../types';

interface SwimlanesProps {
    members: DayMember[];
    /** The day's messages in time order (already filtered). */
    messages: DayMessage[];
}

const PX_PER_MINUTE = 1.2;
/** A collapsed card is `h-16` (64 px); keep these two in step. */
const CARD_HEIGHT = 64;
const GAP = 4;
const AVATAR_PX = 32;
/** An expanded card's bubble draws its picture from the thumbnail route, lazily (the viewer keeps the full file). */
const LANE_THUMB = 640;

const msgKey = (m: DayMessage) => `${m.service}|${m.room}|${m.id}`;

const MEDIA_ICON = { picture: ImageIcon, video: Video, voice: Volume2 } as const;

interface LaneCardProps {
    message: DayMessage;
    person: DayPerson;
    top: number;
    expanded: boolean;
    onToggle: () => void;
    /** The day's text messages in view (`shownTexts`): a caption already shown as its own card is not repeated. */
    shown: ReadonlySet<string>;
}

const LaneCard: React.FC<LaneCardProps> = ({ message: m, person, top, expanded, onToggle, shown }) => {
    const { t } = useTranslation();
    const nickname = useNickname();
    const words = m.text ?? contextCaption(m, shown);
    const Icon = m.type === 'text' ? null : MEDIA_ICON[m.type];
    const hasThumb = (m.type === 'picture' || m.type === 'video') && Boolean(m.media_url);
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
                <span className="shrink-0 text-caption tabular-nums text-muted">{formatJstClock(m.ts)}</span>
                {!expanded && (
                    hasThumb ? (
                        <MemoryThumb message={m} px={64} className="h-11 w-16 rounded-sm" />
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
                        <MessageBubble
                            message={{ ...toChatMessage(m), content: null }}
                            member_name={person.name}
                            service={m.service}
                            memberPath={m.member_path}
                            userNickname={nickname}
                            timeZone={JST_TIME_ZONE}
                            readOnly
                            mediaLoading="lazy"
                            mediaThumbWidth={LANE_THUMB}
                            runStart={false}
                        />
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
 * 那一天 B: one column per person (avatar and name on top), time running down on a JST hour
 * ruler from the floor of the first message's hour to the ceiling of the last one's. Cards sit
 * at their time (`laneLayout` pushes overlapping ones down); a click expands one with her full
 * words (a caption whose own message is a card of the day is not repeated), a read-only bubble for media and the jump to her chat (`memories_toggle` `lane_card`).
 * Columns keep a minimum width, so past five people the lanes scroll sideways inside the pane.
 */
export const Swimlanes: React.FC<SwimlanesProps> = ({ members, messages }) => {
    const avatarWidth = useAvatarWidth(AVATAR_PX);
    const [expanded, setExpanded] = useState<string | null>(null);
    const people = useMemo(() => dayPeople(members, messages), [members, messages]);
    const { start, hours } = useMemo(() => rulerSpan(messages), [messages]);
    const shown = useMemo(() => shownTexts(messages), [messages]);

    const toggle = (key: string) => {
        const next = expanded === key ? null : key;
        setExpanded(next);
        logMemoriesToggle('lane_card', next !== null);
    };

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
            <div aria-hidden="true" className="sticky left-0 z-20 w-12 shrink-0 bg-sheet">
                <div className="h-16" />
                <div className="relative" style={{ height }}>
                    {hours.map((h) => (
                        <span
                            key={h}
                            data-testid="day-ruler-hour"
                            className="absolute right-2 -translate-y-1/2 text-caption tabular-nums text-muted"
                            style={{ top: ((h - start) / 60000) * PX_PER_MINUTE }}
                        >
                            {hourLabel(h, start)}
                        </span>
                    ))}
                </div>
            </div>
            {lanes.map(({ person, placed }) => (
                <section key={person.key} data-testid="day-lane" className="min-w-40 flex-1 px-1">
                    {/* Above an expanded card (z-10) while the lanes scroll under it. */}
                    <header className="sticky top-0 z-20 flex h-16 flex-col items-center justify-center gap-1 bg-sheet">
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
                                onToggle={() => toggle(key)}
                                shown={shown}
                            />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
};
