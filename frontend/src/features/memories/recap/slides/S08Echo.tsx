import React from 'react';
import { useTranslation } from '../../../../i18n';
import { cn } from '../../../../utils/classnames';
import type { RecapMessage, S08EchoData } from '../api';
import { formatMessageDate, s08Copy, withNickname, type CopyLine } from '../recapCopy';
import { Headline, Narration, type SlideProps } from './common';
import { QUOTE_CLASS, heldReveal } from './style';

/** Her text split around every occurrence of the shared keyword, which is marked. */
function highlight(text: string, keyword: string | null): React.ReactNode {
    if (!keyword || !text.includes(keyword)) return text;
    const parts = text.split(keyword);
    return parts.flatMap((part, i) => (i === 0 ? [part] : [
        <mark key={i} data-testid="s08-keyword" className="rounded-xs bg-mark-exact px-0.5 text-primary">{keyword}</mark>,
        part,
    ]));
}

interface CardProps {
    message: RecapMessage;
    label: CopyLine | null;
    older: boolean;
    keyword: string | null;
    nickname: string;
    reveal: { className: string; style?: React.CSSProperties };
}

const EchoCard: React.FC<CardProps> = ({ message, label, older, keyword, nickname, reveal }) => {
    const { t, i18n } = useTranslation();
    const date = formatMessageDate(message.ts, i18n.language, true);
    const words = message.text ?? message.caption;
    const picture = message.type === 'picture' && message.media_url;
    return (
        <div
            data-testid="s08-card"
            className={cn(
                'flex w-full flex-col gap-2 rounded-md bg-card px-4 py-3 shadow-card',
                // The older card is an old photograph: a sepia filter and a slight fade, no colour literal.
                older && 'opacity-90 sepia',
                reveal.className,
            )}
            style={reveal.style}
        >
            <div className="flex items-baseline justify-center gap-2">
                {label && <Narration className="text-muted">{t(label.key, label.params)}</Narration>}
                {date && <time data-testid="s08-date" dateTime={message.ts} className="text-caption tabular-nums text-muted">{date}</time>}
            </div>
            {picture && <img src={message.media_url ?? undefined} alt="" className="mx-auto max-h-28 rounded-sm object-cover" />}
            {words && (
                <p lang="ja" data-voice="quote" className={cn(QUOTE_CLASS, 'line-clamp-4 whitespace-pre-line text-title text-primary')}>
                    {highlight(withNickname(words, nickname), keyword)}
                </p>
            )}
        </div>
    );
};

/**
 * Slide 8, 去年の、同じ日: an earlier message beside one of this year, the older card sepia,
 * the shared keyword lit in both. "The same day" only when they share the JST day; otherwise
 * "then and now". `first_week`: the fan's first subscription week beside now (初見 vs 今).
 */
export const S08Echo: React.FC<SlideProps<S08EchoData>> = ({ data, nickname, reducedMotion, paused }) => {
    const { t } = useTranslation();
    const copy = s08Copy(data);
    const keyword = data.mode === 'echo' ? data.shared_keyword : null;
    const line = heldReveal(reducedMotion, paused, 1400);
    return (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <Headline>{t(copy.title.key, copy.title.params)}</Headline>
            {data.then && (
                <EchoCard message={data.then} label={copy.thenLabel} older keyword={keyword} nickname={nickname} reveal={heldReveal(reducedMotion, paused, 300)} />
            )}
            {data.now && (
                <EchoCard message={data.now} label={copy.nowLabel} older={false} keyword={keyword} nickname={nickname} reveal={heldReveal(reducedMotion, paused, 900)} />
            )}
            {copy.line && (
                <Narration className={line.className} style={line.style}>{t(copy.line.key, copy.line.params)}</Narration>
            )}
        </div>
    );
};
