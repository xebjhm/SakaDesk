import React, { useMemo } from 'react';
import { MessageCircle } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Avatar, Button, Modal } from '../../../design/primitives';
import { resizedAvatarUrl } from '../../messages/mediaUrl';
import { useAvatarWidth } from '../../messages/hooks/useAvatarWidth';
import { fetchDay } from '../api';
import { formatDayHeading } from '../day/format';
import { MergedTimeline } from '../day/MergedTimeline';
import { dayPeople, type DayPerson } from '../day/people';
import { formatJstClock, formatJstDate } from '../recap/availability';
import { jumpToChat } from '../shared/jumpToChat';
import { LoadState } from '../shared/LoadState';
import { MemoryText } from '../shared/MemoryText';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import type { BinderCard, MemoryMessage } from '../types';
import { cardCopy } from './cardCopy';
import { CardTile } from './CardTile';
import { formatCardDate, useCopy } from './binderModel';

const AVATAR_PX = 80;

/** Her words of a message (a photo's paired words), or null. */
const wordsOf = (m: MemoryMessage) => (m.type === 'text' ? m.text : (m.caption ?? m.text));

/** One of her messages on paper with its JST date and time. */
const PaperMessage: React.FC<{ message: MemoryMessage; label?: string }> = ({ message, label }) => {
    const { i18n } = useTranslation();
    const words = wordsOf(message);
    return (
        <div className="rounded-md border border-memories-paper bg-memories-paper p-3 shadow-memories-polaroid">
            {label && <p className="mb-1 text-caption text-muted">{label}</p>}
            <p className="text-caption tabular-nums text-muted">
                {formatCardDate(formatJstDate(message.ts), i18n.language)} {formatJstClock(message.ts)}
            </p>
            {words && <MemoryText text={words} className="mt-1 max-h-48 overflow-y-auto text-body text-primary" />}
        </div>
    );
};

/** A pair card (the earliest おはよう and latest おやすみ, シンクロ): both messages. */
const PairFace: React.FC<{ card: BinderCard; title: string }> = ({ card, title }) => (
    <div data-testid="card-detail-pair" className="flex w-72 flex-col gap-3">
        <p className="font-display text-title text-primary">{title}</p>
        {card.face && <PaperMessage message={card.face} />}
        {card.refs.pair && <PaperMessage message={card.refs.pair} />}
    </div>
);

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
    /** An earned card (or one year of a stack); its `date` is the day shown. */
    card: BinderCard;
    onClose: () => void;
}

/**
 * A binder card opened (spec 5.3), in a `Modal`: the large card, then her messages of that JST
 * day (`fetchDay` with `member`, drawn by the day view's `MergedTimeline`) and a jump to her chat
 * at the card's message (else the day's first; `memories_jump` from `binder`).
 *
 * - Pair cards show both messages.
 * - Avatar changes show the old and new icon, 「この写真と、N 日」 and the last message with the
 *   old icon and the first with the new (the message count is not shown: one number).
 * - Graduation shows 「最後のメッセージ」, her words and 「ずっと、ここに。」, without a shimmer.
 */
export const CardDetail: React.FC<CardDetailProps> = ({ service, memberPath, name, card, onClose }) => {
    const { t, i18n } = useTranslation();
    const copyText = useCopy();
    const date = card.date;
    const day = useMemoriesQuery(
        'day',
        (signal) => (date ? fetchDay(service, { date, member: memberPath }, signal) : Promise.resolve(null)),
        [service, memberPath, date],
        { count: (d) => d?.messages.length ?? 0 },
    );
    const data = day.data;
    const people = useMemo(
        () => new Map<string, DayPerson>((data ? dayPeople(data.members, data.messages) : []).map((p) => [p.key, p])),
        [data],
    );
    const copy = cardCopy(card.key);
    const title = copy ? copyText(copy.title) : '';
    const target = card.face ?? data?.messages[0] ?? null;

    let face: React.ReactNode;
    if (card.key === 'grad.last') face = <GraduationFace card={card} />;
    else if (card.refs.pair) face = <PairFace card={card} title={title} />;
    else face = <CardTile card={card} large />;

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={title}
            header="plain"
            closeLabel={t('common.close')}
            headerExtra={date ? <span className="text-small text-muted">{formatDayHeading(date, i18n.language)}</span> : undefined}
            className="max-w-4xl"
            footer={target ? (
                <Button variant="secondary" size="sm" onClick={() => { jumpToChat(target, name, 'binder'); onClose(); }}>
                    <MessageCircle aria-hidden="true" className="h-4 w-4" />
                    {t('memories.common.jumpToChat')}
                </Button>
            ) : undefined}
        >
            <div className="flex min-h-0 flex-col gap-6 md:flex-row">
                <div className="flex shrink-0 flex-col items-center gap-4">
                    {face}
                    {card.key.startsWith('change.avatar.') && <ChangeSection card={card} />}
                </div>
                <div className="min-w-0 flex-1">
                    {day.status === 'ready' && data
                        ? <MergedTimeline messages={data.messages} people={people} service={service} />
                        : day.status !== 'ready' && <LoadState status={day.status === 'error' ? 'error' : 'loading'} onRetry={day.retry} />}
                </div>
            </div>
        </Modal>
    );
};
