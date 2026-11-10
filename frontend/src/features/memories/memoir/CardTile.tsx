import React, { useId, useState } from 'react';
import { Mail, Mic, Play } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Avatar } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';
import { resizedAvatarUrl } from '../../messages/mediaUrl';
import { useAvatarWidth } from '../../messages/hooks/useAvatarWidth';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import type { BinderCard, MemoryMessage } from '../types';
import { cardCopy } from './cardCopy';
import { formatCardDate, useCopy, yearCard } from './binderModel';

/** The あなた shelf: the fan's own letters, never shown with her words (spec 1.5). */
const isYouCard = (card: BinderCard) => card.key.startsWith('you.');
/** The graduation card's foil is a memorial: it stays still. */
const isMemorial = (card: BinderCard) => card.key === 'grad.last';
const isChange = (card: BinderCard) => card.key.startsWith('change.avatar.');

const TILE_PX = 144;
const LARGE_PX = 288;
const AVATAR_PX = 40;

/** The face of an earned card: her photo, her voice or her words (Japanese original). */
const Face: React.FC<{ face: MemoryMessage; large: boolean }> = ({ face, large }) => {
    const { t } = useTranslation();
    if ((face.type === 'picture' || face.type === 'video') && face.media_url) {
        return (
            <span className="relative block w-full overflow-hidden rounded-sm bg-sunken">
                <MemoryThumb message={face} px={large ? LARGE_PX : TILE_PX} className={cn('w-full', large ? 'h-72' : 'h-28')} />
                {face.type === 'video' && (
                    <Play aria-hidden="true" className="absolute left-2 top-2 h-4 w-4 fill-current text-inverse drop-shadow-sm" />
                )}
            </span>
        );
    }
    const words = face.type === 'text' ? face.text : (face.caption ?? face.text);
    return (
        <>
            {face.type === 'voice' && (
                <span className="flex items-center gap-1 text-small text-secondary">
                    <Mic aria-hidden="true" className="h-3.5 w-3.5" />
                    {t('memories.favorites.voice')}
                </span>
            )}
            {words && (
                <MemoryText
                    text={words}
                    className={cn('text-primary', large ? 'max-h-64 overflow-y-auto text-body' : 'line-clamp-4 text-small')}
                />
            )}
        </>
    );
};

/** The new icon of a change card (spec 5.3: the new avatar with her message that day). */
const NewAvatar: React.FC<{ card: BinderCard }> = ({ card }) => {
    const { t } = useTranslation();
    const width = useAvatarWidth(AVATAR_PX);
    const url = card.detail.new_url;
    return (
        <Avatar
            src={resizedAvatarUrl(typeof url === 'string' ? url : null, width)}
            name={t('memories.cardDetail.newAvatar')}
            size="md"
        />
    );
};

interface CardTileProps {
    card: BinderCard;
    /** Opens an earned card (or one year of a stack). Without it the card is a still face (the detail's large card). */
    onOpen?: (card: BinderCard) => void;
    /** The detail's large card: no clamp, a larger photo. */
    large?: boolean;
}

/**
 * One binder card (spec 5.3).
 *
 * - Earned: face up on paper: her photo or her words (`MemoryText`, four lines), the date and
 *   the serif title; a change card adds her new icon. Clicking opens the card.
 * - Unearned: a dashed `border-memories-silhouette` outline with the condition and, when the
 *   payload has `progress` (never at 0), a thin neutral bar without digits.
 * - Foil (earned only): a still `bg-memories-foil` sheen under the face and one
 *   `animate-shimmer` sweep over it, removed under reduced motion (only the still sheen stays);
 *   the graduation card's memorial foil never sweeps.
 * - A yearly stack (more than one year) shows 「×N」 and fans out into one tile per year; while
 *   open, its top shows only the title and 「×N」, so the newest year is not drawn twice.
 * - The あなた shelf shows an envelope and the fan's date only: never her words, never a detail.
 * - A card button is named by its title alone; the date and 「×N」 are its description.
 */
export const CardTile: React.FC<CardTileProps> = ({ card, onOpen, large = false }) => {
    const { t, i18n } = useTranslation();
    const copyText = useCopy();
    const [open, setOpen] = useState(false);
    const descId = useId();
    const copy = cardCopy(card.key);
    if (!copy) return null;
    const title = copyText(copy.title);
    const size = large ? 'w-72' : 'h-52 w-36';

    if (!card.earned) {
        const p = card.progress;
        const pct = p && p.target > 0 ? Math.min(100, Math.max(0, (p.current / p.target) * 100)) : 0;
        return (
            <div
                data-testid="card-tile"
                data-earned="false"
                data-card-key={card.key}
                className={cn(size, 'flex shrink-0 flex-col justify-end gap-2 rounded-md border-2 border-dashed border-memories-silhouette p-3')}
            >
                <span className="sr-only">{t('memories.cards.notYet')}</span>
                <p className="font-display text-small text-secondary">{copyText(copy.condition)}</p>
                {p && (
                    <div
                        role="progressbar"
                        aria-label={title}
                        aria-valuemin={0}
                        aria-valuemax={p.target}
                        aria-valuenow={p.current}
                        className="h-1 w-full overflow-hidden rounded-pill bg-sunken"
                    >
                        {/* runtime progress: the width is data, not a design value */}
                        <div data-testid="card-progress-fill" className="h-full rounded-pill bg-skeleton" style={{ width: `${pct}%` }} />
                    </div>
                )}
            </div>
        );
    }

    const you = isYouCard(card);
    const stacked = !large && onOpen !== undefined && card.years.length > 1;
    const sweep = card.foil && !isMemorial(card);
    // an open stack's top is only its title and count: its years follow it
    const folded = stacked && open;
    const date = card.date && !folded ? formatCardDate(card.date, i18n.language) : null;
    const stackLabel = stacked ? t('memories.cards.stack', { count: card.years.length }) : null;
    const body = (
        <>
            {card.foil && (
                <span data-testid="card-foil" aria-hidden="true" className="pointer-events-none absolute inset-0 bg-memories-foil opacity-40" />
            )}
            <span className="relative z-10 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                {you ? (
                    <Mail data-testid="card-envelope" aria-hidden="true" className="mx-auto my-auto h-10 w-10 text-secondary" />
                ) : !folded && (
                    <>
                        {isChange(card) && <NewAvatar card={card} />}
                        {card.face && <Face face={card.face} large={large} />}
                    </>
                )}
            </span>
            <span className="relative z-10 mt-2 flex items-end justify-between gap-2">
                <span className="min-w-0">
                    {date && <span id={`${descId}-date`} className="block text-caption tabular-nums text-muted">{date}</span>}
                    <span className="block font-display text-small text-primary">{title}</span>
                </span>
                {stackLabel && (
                    <span id={`${descId}-stack`} className="shrink-0 rounded-pill bg-sunken px-2 text-caption tabular-nums text-secondary">
                        {stackLabel}
                    </span>
                )}
            </span>
            {sweep && (
                <span
                    data-testid="card-foil-shimmer"
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 z-20 bg-memories-foil opacity-30 animate-shimmer motion-reduce:hidden"
                />
            )}
        </>
    );
    const face = cn(
        'relative flex h-full w-full flex-col overflow-hidden rounded-md border border-memories-paper bg-memories-paper p-3 text-left shadow-memories-polaroid',
    );
    const interactive = !you && !large && onOpen !== undefined;
    const described = [date && `${descId}-date`, stackLabel && `${descId}-stack`].filter(Boolean).join(' ') || undefined;

    return (
        <>
            <div data-testid="card-tile" data-earned="true" data-card-key={card.key} className={cn(size, 'shrink-0')}>
                {interactive ? (
                    <button
                        type="button"
                        onClick={() => (stacked ? setOpen((v) => !v) : onOpen(card))}
                        aria-expanded={stacked ? open : undefined}
                        aria-label={title}
                        aria-describedby={described}
                        className={cn(
                            face,
                            'transition-transform duration-fast ease-standard hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        )}
                    >
                        {body}
                    </button>
                ) : (
                    <div className={face}>{body}</div>
                )}
            </div>
            {stacked && open && card.years.map((y) => (
                <div key={y.year} data-testid="card-year" className="shrink-0">
                    <CardTile card={yearCard(card, y)} onOpen={onOpen} />
                </div>
            ))}
        </>
    );
};
