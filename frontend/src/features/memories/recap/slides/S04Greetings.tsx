import React from 'react';
import { useTranslation } from '../../../../i18n';
import { cn } from '../../../../utils/classnames';
import type { RecapMessage, S04GreetingsData } from '../api';
import { formatTimeOfDay, s04Copy, type CopyLine } from '../recapCopy';
import { Headline, MessageBody, Narration, type SlideProps } from './common';
import { reveal } from './style';

interface CardProps {
    label: CopyLine;
    message: RecapMessage;
    nickname: string;
    reducedMotion: boolean;
    delayMs: number;
}

const GreetingCard: React.FC<CardProps> = ({ label, message, nickname, reducedMotion, delayMs }) => {
    const { t, i18n } = useTranslation();
    const r = reveal(reducedMotion, delayMs);
    const time = formatTimeOfDay(message.ts, i18n.language);
    return (
        <div data-testid="s04-card" className={cn('flex w-full flex-col gap-2 rounded-lg bg-card px-4 py-3 shadow-card', r.className)} style={r.style}>
            <div className="flex items-baseline justify-center gap-2">
                <Narration className="text-muted">{t(label.key, label.params)}</Narration>
                {time && (
                    <time data-testid="s04-time" dateTime={message.ts} className="text-caption tabular-nums text-muted">{time}</time>
                )}
            </div>
            <MessageBody message={message} nickname={nickname} quoteClassName="line-clamp-3 text-title" />
        </div>
    );
};

/**
 * Slide 4, おはようと、おやすみ: her first おはよう of the year and the おやすみ
 * she sent latest in the night, each with its JST clock time (HH:MM, metadata,
 * not the slide's number), then the おやすみ count. Fallbacks: her first
 * morning words, the ありがとう / おつかれさま variants, or only one side.
 */
export const S04Greetings: React.FC<SlideProps<S04GreetingsData>> = ({ data, fallback, nickname, reducedMotion }) => {
    const { t } = useTranslation();
    const copy = s04Copy(data, fallback);
    const count = reveal(reducedMotion, 1400);
    return (
        <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
            <Headline>{t(copy.title.key, copy.title.params)}</Headline>
            {copy.morning && data.first_ohayo && (
                <GreetingCard label={copy.morning} message={data.first_ohayo} nickname={nickname} reducedMotion={reducedMotion} delayMs={300} />
            )}
            {copy.evening && data.latest_oyasumi && (
                <GreetingCard label={copy.evening} message={data.latest_oyasumi} nickname={nickname} reducedMotion={reducedMotion} delayMs={800} />
            )}
            {copy.count && (
                <Narration className={cn('tabular-nums', count.className)} style={count.style}>{t(copy.count.key, copy.count.params)}</Narration>
            )}
        </div>
    );
};
