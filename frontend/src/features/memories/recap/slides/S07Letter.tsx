import React from 'react';
import { useTranslation } from '../../../../i18n';
import { cn } from '../../../../utils/classnames';
import type { S07LetterData } from '../api';
import { formatMessageDate } from '../../shared/jst';
import { letterExcerpt, s07Copy, withNickname } from '../recapCopy';
import { Headline, type SlideProps } from './common';
import { Narration } from '../../shared/typeRoles';
import { QUOTE_CLASS } from '../../shared/typeRoles';
import { heldReveal } from './style';

/** Ruled letter paper: a faint line under every text line (`leading-8`, 2rem), drawn with the border token. */
const RULED: React.CSSProperties = {
    backgroundImage:
        'repeating-linear-gradient(to bottom, transparent 0, transparent calc(2rem - 1px), var(--ds-border-subtle) calc(2rem - 1px), var(--ds-border-subtle) 2rem)',
};

/**
 * Slide 7, いちばん長い手紙: the longest of her highest-scored messages on ruled letter paper under a soft
 * spotlight. A long letter shows its opening (`letterExcerpt`: from its first word to a sentence
 * end, with 「…」), clamped to the paper's lines, so no line is ever cut at the paper's edge, nor
 * frozen mid-scroll by a pause. With reduced motion the whole letter can be scrolled by hand.
 * Then "{n} 文字の想い", counted on the whole letter as shown (after the nickname replacement).
 */
export const S07Letter: React.FC<SlideProps<S07LetterData>> = ({ data, nickname, reducedMotion, paused }) => {
    const { t, i18n } = useTranslation();
    const copy = s07Copy(data, nickname, i18n.language);
    const text = data.message?.text ? withNickname(data.message.text, nickname) : null;
    const date = data.message ? formatMessageDate(data.message.ts, i18n.language) : null;
    const shown = text && !reducedMotion ? letterExcerpt(text) : text;
    const paperIn = heldReveal(reducedMotion, paused, 300);
    const countIn = heldReveal(reducedMotion, paused, 1200);
    return (
        <div className="relative flex h-full flex-col items-center justify-center gap-5 overflow-hidden px-8 py-12 text-center">
            {data.photo_url && (
                <img
                    data-testid="s07-photo"
                    src={data.photo_url}
                    alt=""
                    className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-10 blur-sm"
                />
            )}
            <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-expressive-orb-1 opacity-60 blur-2xl" />
            <Headline className="relative">{t(copy.title.key, copy.title.params)}</Headline>
            {shown && (
                <div className={cn('relative flex w-full flex-col gap-2 rounded-sm bg-card px-5 py-4 shadow-sheet', paperIn.className)} style={paperIn.style}>
                    {date && (
                        <time data-testid="s07-date" dateTime={data.message?.ts} className="self-end text-caption tabular-nums text-muted">{date}</time>
                    )}
                    <div
                        data-testid="s07-paper"
                        className={cn('max-h-64 text-left', reducedMotion ? 'pointer-events-auto overflow-y-auto' : 'overflow-hidden')}
                    >
                        <p
                            lang="ja"
                            data-voice="quote"
                            data-testid="s07-text"
                            className={cn(
                                QUOTE_CLASS,
                                'whitespace-pre-line text-title leading-8 text-primary',
                                // Safety net for narrow papers: whole lines only, the last one ends in 「…」.
                                !reducedMotion && 'line-clamp-[8]',
                            )}
                            style={RULED}
                        >
                            {shown}
                        </p>
                    </div>
                </div>
            )}
            {copy.count && (
                <Narration className={cn('relative tabular-nums', countIn.className)} style={countIn.style}>
                    {t(copy.count.key, copy.count.params)}
                </Narration>
            )}
        </div>
    );
};
