import React, { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Avatar, Button, Modal } from '../../../design/primitives';
import { resizedAvatarUrl } from '../../messages/mediaUrl';
import { useAvatarWidth } from '../../messages/hooks/useAvatarWidth';
import { CapsuleStrip } from '../capsule/CapsuleStrip';
import { formatDayHeading } from '../day/format';
import { MemberDayColumn } from '../day/MemberDay';
import { formatJstClock, formatJstDate } from '../shared/jst';
import { jumpToChat } from '../shared/jumpToChat';
import { MemoryText } from '../shared/MemoryText';
import { cn } from '../../../utils/classnames';
import type { BinderCard, MemoryMessage } from '../types';
import { cardCopy } from './cardCopy';
import { CardTile } from './CardTile';
import { formatCardDate, useCopy } from './binderModel';

const AVATAR_PX = 80;

/** Her words of a message (a photo's paired words), or null. */
const wordsOf = (m: MemoryMessage) => (m.type === 'text' ? m.text : (m.caption ?? m.text));

const PAPER = 'rounded-md border border-memories-paper bg-memories-paper p-3 shadow-memories-polaroid';

/** The paper's content: an optional label, the JST date and time, her words. */
const PaperBody: React.FC<{ message: MemoryMessage; label?: string }> = ({ message, label }) => {
    const { i18n } = useTranslation();
    const words = wordsOf(message);
    return (
        <>
            {label && <span className="mb-1 block text-caption text-muted">{label}</span>}
            <span className="block text-caption tabular-nums text-muted">
                {formatCardDate(formatJstDate(message.ts), i18n.language)} {formatJstClock(message.ts)}
            </span>
            {words && <MemoryText as="span" text={words} className="mt-1 block max-h-48 overflow-y-auto text-body text-primary" />}
        </>
    );
};

/** One of her messages on paper with its JST date and time. */
const PaperMessage: React.FC<{ message: MemoryMessage; label?: string }> = ({ message, label }) => (
    <div className={PAPER}><PaperBody message={message} label={label} /></div>
);

type PairSide = 'face' | 'pair';

/**
 * A pair card (the earliest おはよう and latest おやすみ, シンクロ): both messages as pressable papers
 * (`aria-pressed`); the selected one (`ring-accent-border`, state) drives the day column and the
 * jump. The greeting pair labels them 「いちばん早いおはよう」 / 「いちばん遅いおやすみ」; シンクロ's
 * papers are told apart by their dates.
 */
const PairFace: React.FC<{ card: BinderCard; title: string; selected: PairSide; onSelect: (side: PairSide) => void }> = ({
    card, title, selected, onSelect,
}) => {
    const { t } = useTranslation();
    const greeting = card.key === 'record.greeting_pair';
    const sides: Array<[PairSide, MemoryMessage | null | undefined, string | undefined]> = [
        ['face', card.face, greeting ? t('memories.cardDetail.earliestOhayo') : undefined],
        ['pair', card.refs.pair, greeting ? t('memories.cardDetail.latestOyasumi') : undefined],
    ];
    return (
        <div data-testid="card-detail-pair" className="flex w-72 flex-col gap-3">
            <p className="font-display text-title text-primary">{title}</p>
            {sides.map(([side, message, label]) => message && (
                <button
                    key={side}
                    type="button"
                    aria-pressed={selected === side}
                    onClick={() => onSelect(side)}
                    className={cn(
                        PAPER,
                        'block w-full text-left',
                        'transition-shadow duration-fast ease-standard motion-reduce:transition-none',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        selected === side && 'ring-2 ring-accent-border',
                    )}
                >
                    <PaperBody message={message} label={label} />
                </button>
            ))}
        </div>
    );
};

/** An avatar change: the old and new icon, her days with the new one, the last and first messages. */
const ChangeSection: React.FC<{ card: BinderCard }> = ({ card }) => {
    const { t } = useTranslation();
    const width = useAvatarWidth(AVATAR_PX);
    const url = (v: number | string | undefined) => (typeof v === 'string' ? v : null);
    const oldUrl = url(card.detail.old_url);
    const days = card.detail.days;
    return (
        <div data-testid="card-detail-change" className="flex w-72 flex-col gap-3">
            <div className="flex items-center justify-center gap-4">
                {oldUrl && <Avatar src={resizedAvatarUrl(oldUrl, width)} name={t('memories.cardDetail.oldAvatar')} size="xl" />}
                <Avatar src={resizedAvatarUrl(url(card.detail.new_url), width)} name={t('memories.cardDetail.newAvatar')} size="xl" />
            </div>
            {/* one number: the message count stays in the payload */}
            {typeof days === 'number' && days > 0 && (
                <p className="text-center font-display text-title text-primary">{t('memories.cards.avatarDays', { days })}</p>
            )}
            {card.refs.old_last && <PaperMessage message={card.refs.old_last} label={t('memories.cardDetail.oldLast')} />}
            {card.refs.new_first && <PaperMessage message={card.refs.new_first} label={t('memories.cardDetail.newFirst')} />}
        </div>
    );
};

/** A graduated member's last message: still memorial foil, no shimmer. */
const GraduationFace: React.FC<{ card: BinderCard }> = ({ card }) => {
    const { t } = useTranslation();
    const words = card.face ? wordsOf(card.face) : null;
    return (
        <div data-testid="card-detail-graduation" className="relative flex w-72 flex-col gap-3 overflow-hidden rounded-md border border-memories-paper bg-memories-paper p-4 shadow-memories-polaroid">
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-memories-foil opacity-40" />
            <p className="relative font-display text-title text-primary">{t('memories.cardDetail.lastMessage')}</p>
            {words && <MemoryText text={words} className="relative max-h-64 overflow-y-auto text-body text-primary" />}
            <p className="relative font-display text-small text-secondary">{t('memories.cardDetail.forever')}</p>
        </div>
    );
};

export interface CardDetailProps {
    service: string;
    /** Her chat path (any of her rooms): the day shows her messages only. */
    memberPath: string;
    /** Her display name, for the chat the jump opens. */
    name: string;
    /**
     * An earned card (or one year of a stack). Its `date` is the unlock date, shown in the header;
     * the day column shows the JST day of its message (`face`), which can be another day.
     */
    card: BinderCard;
    onClose: () => void;
}

/**
 * A binder card opened (spec 5.3), in a `Modal`: the large card, then her messages of the JST day
 * of the card's message (`fetchDay` with `member`, drawn by the day view's `MergedTimeline`) and a
 * jump to her chat at that message (`memories_jump` from `binder`).
 *
 * - The day is the message's own day, which differs from the unlock date on the fallback paths
 *   (an anniversary's `nearest` message, a change's `first_after`): the column is labelled with
 *   the real date, and an anniversary's other-day message as 「いちばん近い日のメッセージ」.
 * - A card without a message has no day column and no jump.
 * - Pair cards show both messages as pressable papers; the selected one (the first by default)
 *   drives the day column and the jump, and is tinted and scrolled to in the day.
 * - The day column is `MemberDayColumn` (shared with the 24h tab's member-day dialog).
 * - Avatar changes show the old and new icon, 「この写真と、N 日」 and the last message with the
 *   old icon and the first with the new, instead of the large card (the message count is not
 *   shown: one number).
 * - Graduation shows 「最後のメッセージ」, her words and 「ずっと、ここに。」, without a shimmer.
 * - An earned card with a date carries the fan's 時光膠囊 notes on it (`CapsuleStrip`, card anchor).
 */
export const CardDetail: React.FC<CardDetailProps> = ({ service, memberPath, name, card, onClose }) => {
    const { t, i18n } = useTranslation();
    const copyText = useCopy();
    const [side, setSide] = useState<PairSide>('face');
    const message = side === 'pair' && card.refs.pair ? card.refs.pair : card.face;
    const messageDay = message ? formatJstDate(message.ts) : null;
    const copy = cardCopy(card.key);
    const title = copy ? copyText(copy.title) : '';
    const isChangeCard = card.key.startsWith('change.avatar.');

    let face: React.ReactNode;
    if (card.key === 'grad.last') face = <GraduationFace card={card} />;
    else if (card.refs.pair) face = <PairFace card={card} title={title} selected={side} onSelect={setSide} />;
    else if (isChangeCard) face = <ChangeSection card={card} />;
    else face = <CardTile card={card} large />;

    let dayLabel: string | null = null;
    if (messageDay) {
        const heading = formatDayHeading(messageDay, i18n.language);
        const nearest = card.key.startsWith('anniv.') && card.date !== null && messageDay !== card.date;
        dayLabel = nearest ? t('memories.cardDetail.nearestDay', { date: heading }) : t('memories.cardDetail.dayOf', { date: heading });
    }

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={title}
            header="plain"
            closeLabel={t('common.close')}
            headerExtra={card.date ? <span className="text-small text-muted">{formatDayHeading(card.date, i18n.language)}</span> : undefined}
            className="max-w-4xl"
            // from md the body does not scroll: the face column and the day column scroll on
            // their own, so focusing the day's message never moves the card face
            bodyClassName="md:flex md:flex-col md:overflow-hidden"
            footer={message ? (
                <Button variant="secondary" size="sm" onClick={() => { jumpToChat(message, name, 'binder'); onClose(); }}>
                    <MessageCircle aria-hidden="true" className="h-4 w-4" />
                    {t('memories.common.jumpToChat')}
                </Button>
            ) : undefined}
        >
            <div data-testid="card-detail-columns" className="flex min-h-0 flex-col gap-6 md:flex-1 md:flex-row">
                <div className="flex shrink-0 flex-col items-center gap-4 md:min-h-0 md:overflow-y-auto">
                    {face}
                    {/* The fan's notes on this card (earned only: a silhouette has no date). */}
                    {card.earned && card.date && (
                        <div className="w-72">
                            <CapsuleStrip service={service} anchor={{ kind: 'card', memberPath, cardKey: card.key, date: card.date }} />
                        </div>
                    )}
                </div>
                {dayLabel && messageDay && message && (
                    <MemberDayColumn
                        service={service}
                        memberPath={memberPath}
                        date={messageDay}
                        label={dayLabel}
                        focus={{ room: message.room, id: message.id }}
                        testId="card-detail-day"
                    />
                )}
            </div>
        </Modal>
    );
};
