import React from 'react';
import { Mail, Star } from 'lucide-react';
import { useTranslation } from '../../../../i18n';
import { cn } from '../../../../utils/classnames';
import type { S10YouData } from '../api';
import { formatMessageDate, formatMonthDay, s10Copy } from '../recapCopy';
import { Headline, Narration, type SlideProps } from './common';
import { heldReveal } from './style';

/** At most this many bookmarks stand in the book, so it stays inside the 9:16 stage. */
const MAX_BOOKMARKS = 12;
/** At most this many envelopes hang on the line. */
const MAX_ENVELOPES = 6;

/**
 * Slide 10, あなたも、ここにいた: the fan's own traces only. Their ★ as bookmarks standing in a
 * book and their letters as envelopes on a line. None of her messages appear here: nothing from a
 * message object is rendered, only the day the first star was logged. Without stars or letters, a
 * gentle forward-looking invitation that never claims she saw anything.
 */
export const S10You: React.FC<SlideProps<S10YouData>> = ({ data, recap, reducedMotion, paused }) => {
    const { t, i18n } = useTranslation();
    const copy = s10Copy(data, recap.year);
    const lines = heldReveal(reducedMotion, paused, 1200);
    if (data.invite) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
                <Headline>{t(copy.title.key, copy.title.params)}</Headline>
                <div className={cn('flex flex-col gap-2', lines.className)} style={lines.style}>
                    {copy.invite.map((line) => <Narration key={line.key}>{t(line.key, line.params)}</Narration>)}
                </div>
            </div>
        );
    }
    const bookmarks = copy.stat?.key === 'recap.s10.favorites' ? Math.min(data.favorites_count ?? 0, MAX_BOOKMARKS) : 0;
    const firstDay = copy.firstFavorite && data.first_favorite?.favorited_at
        ? formatMessageDate(data.first_favorite.favorited_at, i18n.language)
        : null;
    const letters = data.letters.slice(0, MAX_ENVELOPES);
    const showLetters = copy.stat?.key === 'recap.s10.letters' || copy.lettersLabel !== null;
    const book = heldReveal(reducedMotion, paused, 300);
    const line = heldReveal(reducedMotion, paused, 800);
    return (
        <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
            <Headline>{t(copy.title.key, copy.title.params)}</Headline>
            {bookmarks > 0 && (
                <div
                    data-testid="s10-book"
                    role="img"
                    aria-label={t('recap.s10.bookLabel')}
                    className={cn('flex h-28 w-full items-end justify-center gap-1 rounded-sm border-b-4 border-strong px-4', book.className)}
                    style={book.style}
                >
                    {Array.from({ length: bookmarks }, (_, i) => (
                        <span
                            key={i}
                            data-testid="s10-bookmark"
                            className="flex w-4 flex-col items-center gap-1 rounded-t-xs bg-card pt-1 shadow-pill"
                            style={{ height: `${60 + ((i * 37) % 40)}%` }}
                        >
                            <Star aria-hidden="true" className="h-3 w-3 fill-current text-semantic-star" />
                        </span>
                    ))}
                </div>
            )}
            {(copy.stat || firstDay) && (
                <div className={cn('flex flex-col gap-1', lines.className)} style={lines.style}>
                    {copy.stat && <Narration className="tabular-nums text-primary">{t(copy.stat.key, copy.stat.params)}</Narration>}
                    {firstDay && <Narration>{t('recap.s10.firstFavorite', { date: firstDay })}</Narration>}
                </div>
            )}
            {showLetters && letters.length > 0 && (
                <div className={cn('flex w-full flex-col gap-2', line.className)} style={line.style}>
                    {copy.lettersLabel && <Narration className="text-muted">{t(copy.lettersLabel.key, copy.lettersLabel.params)}</Narration>}
                    <ul className="flex w-full flex-wrap justify-center gap-2 border-t border-subtle pt-3">
                        {letters.map((letter, i) => (
                            <li
                                key={`${letter.date}:${i}`}
                                data-testid="s10-envelope"
                                className="flex w-24 flex-col items-center gap-1 rounded-xs bg-card px-2 py-2 shadow-pill"
                            >
                                <Mail aria-hidden="true" className="h-4 w-4 text-muted" />
                                <span className="text-caption tabular-nums text-muted">{formatMonthDay(letter.date, i18n.language) ?? ''}</span>
                                {/* The fan's own words: their language is unknown, so no lang="ja" (that marks her words). */}
                                {letter.first_line && <span data-testid="s10-letter-line" className="line-clamp-1 w-full text-caption text-secondary">{letter.first_line}</span>}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};
