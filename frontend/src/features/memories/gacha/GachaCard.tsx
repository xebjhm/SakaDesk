import React, { useMemo } from 'react';
import { motion as fm } from 'framer-motion';
import { CalendarDays, Play, Star } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Button, IconButton } from '../../../design/primitives';
import { motion } from '../../../design/tokens/motion';
import { cn } from '../../../utils/classnames';
import { formatJstIsoDate, jstDateFormat } from '../shared/jst';
import { LazyVoice } from '../shared/LazyVoice';
import { memoryMediaSrc } from '../shared/mediaSrc';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import { nameFromRoom } from '../shared/nameFromRoom';
import type { GachaPull } from '../types';
import { RARITY_FILL, rarityKey, reasonKey } from './rarityCopy';

const THUMB_PX = 320;

export interface GachaCardProps {
    pull: GachaPull;
    /** The ★ as the fan sees it now (the page's optimistic state). */
    favorited: boolean;
    onToggleFavorite: () => void;
    /** Open the film strip of her day around this message. */
    onContext: () => void;
    reducedMotion: boolean;
}

/** Her words, photo or voice. A picture / video shows its paired caption (else its own text). */
const Content: React.FC<{ pull: GachaPull }> = ({ pull }) => {
    const m = pull.message;
    const words = m.type === 'picture' || m.type === 'video' ? (m.caption ?? m.text) : m.text;
    const src = m.type === 'voice' ? memoryMediaSrc(m) : null;
    return (
        <>
            {(m.type === 'picture' || m.type === 'video') && (
                <span className="relative block aspect-square w-full overflow-hidden rounded-md bg-sunken">
                    <MemoryThumb message={{ type: m.type, media_url: m.media_url }} px={THUMB_PX} className="h-full w-full" />
                    {m.type === 'video' && (
                        <Play aria-hidden="true" className="absolute left-2 top-2 h-4 w-4 fill-current text-inverse drop-shadow-sm" />
                    )}
                </span>
            )}
            {src && m.ts && <LazyVoice playKey={`gacha|${m.room}|${m.id}`} src={src} durationS={m.duration_s} ts={m.ts} />}
            {words && <MemoryText text={words} className="max-h-48 overflow-y-auto font-display text-body text-primary" />}
        </>
    );
};

/**
 * A revealed gacha card (spec 12) on paper: the rarity label (`ノーマル` / `R` / `SR`, in its
 * semantic rarity fill) with its reason line, her words (`MemoryText`), photo (`MemoryThumb`)
 * or voice (`LazyVoice`, the one voice coordinator), her name and the message's real JST date and
 * time (metadata, never framed as chosen for the fan), the context link (her day in the film
 * strip) and the ★ (yellow `text-semantic-star` when set). SR wears the still foil sheen with one
 * shimmer sweep; under reduced motion only the still sheen stays and the card fades in instead of
 * opening. A pull whose message left the archive is a date-only card: the missing line and the
 * pull's JST date, with no name, ★ or context.
 */
export const GachaCard: React.FC<GachaCardProps> = ({ pull, favorited, onToggleFavorite, onContext, reducedMotion }) => {
    const { t, i18n } = useTranslation();
    const m = pull.message;
    const missing = m.type === null || m.ts === null;
    const stamp = useMemo(() => jstDateFormat(i18n.language, { time: true }), [i18n.language]);
    const dateOnly = useMemo(() => jstDateFormat(i18n.language), [i18n.language]);
    const sr = pull.rarity === 'sr';
    const transition = { duration: motion.duration.base / 1000, ease: motion.easing.standard };

    return (
        <fm.article
            data-testid="gacha-card"
            data-rarity={pull.rarity}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
            animate={reducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            transition={transition}
            className="relative w-full max-w-sm overflow-hidden rounded-lg border border-memories-paper bg-memories-paper p-4 shadow-memories-polaroid"
        >
            {sr && <span data-testid="gacha-foil" aria-hidden="true" className="pointer-events-none absolute inset-0 bg-memories-foil opacity-30" />}
            <div className="relative z-10 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    <span className={cn('shrink-0 rounded-full px-2 text-caption font-semibold text-primary', RARITY_FILL[pull.rarity])}>
                        {t(rarityKey(pull.rarity))}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-small text-secondary">{t(reasonKey(pull.reason))}</span>
                    {!missing && (
                        <IconButton
                            aria-label={t(favorited ? 'memories.gacha.unfavorite' : 'memories.gacha.favorite')}
                            aria-pressed={favorited}
                            size="sm"
                            onClick={onToggleFavorite}
                            icon={<Star className={cn('h-5 w-5', favorited ? 'fill-current text-semantic-star' : 'text-muted')} />}
                        />
                    )}
                </div>
                {missing ? (
                    <>
                        <p className="text-body text-secondary">{t('memories.gacha.missing')}</p>
                        <p className="text-caption tabular-nums text-muted">{formatJstIsoDate(dateOnly, pull.jst_date)}</p>
                    </>
                ) : (
                    <>
                        <Content pull={pull} />
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span lang="ja" className="text-small text-primary">{nameFromRoom(m.room)}</span>
                            <span className="text-caption tabular-nums text-muted">{m.ts ? stamp.format(new Date(m.ts)) : null}</span>
                            <span className="flex-1" />
                            <Button variant="ghost" size="sm" onClick={onContext}>
                                <CalendarDays aria-hidden="true" className="h-4 w-4" />
                                {t('memories.gacha.context')}
                            </Button>
                        </div>
                    </>
                )}
            </div>
            {sr && !reducedMotion && (
                <span
                    data-testid="gacha-foil-sweep"
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 z-20 bg-memories-foil opacity-30 animate-shimmer motion-reduce:hidden"
                />
            )}
        </fm.article>
    );
};
