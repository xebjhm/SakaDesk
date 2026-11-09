/**
 * Shared pieces of the recap slides.
 *
 * Two voices, never mixed up: her words are serif display type marked
 * `lang="ja"` (`Quote`); the app's own copy is the smaller sans UI face
 * (`Headline`, `Narration`). `data-voice` names the voice for tests and later
 * renderers (the share canvas).
 */
import React from 'react';
import { cn } from '../../../../utils/classnames';
import type { RecapMessage, RecapPayload } from '../api';
import { withNickname } from '../recapCopy';
import { HEADLINE_CLASS, NARRATION_CLASS, QUOTE_CLASS } from './style';

export interface SlideProps<D> {
    data: D;
    fallback: string | null;
    recap: RecapPayload;
    /** The fan's nickname, already resolved (never empty). */
    nickname: string;
    reducedMotion: boolean;
    /** A slide that waits for media (the voice slide) calls this when playback ends. */
    onMediaEnd: () => void;
}

interface TextProps {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
}

export const Quote: React.FC<TextProps> = ({ children, className, style }) => (
    <p lang="ja" data-voice="quote" className={cn(QUOTE_CLASS, 'whitespace-pre-line text-primary', className)} style={style}>
        {children}
    </p>
);

export const Headline: React.FC<TextProps> = ({ children, className, style }) => (
    <p data-voice="narration" className={cn(HEADLINE_CLASS, 'text-primary', className)} style={style}>
        {children}
    </p>
);

export const Narration: React.FC<TextProps> = ({ children, className, style }) => (
    <p data-voice="narration" className={cn(NARRATION_CLASS, 'text-secondary', className)} style={style}>
        {children}
    </p>
);

interface MessageBodyProps {
    message: RecapMessage;
    nickname: string;
    className?: string;
    quoteClassName?: string;
}

/**
 * One of her messages: its text as a quote, a picture or video still with its
 * caption. Absent parts are left out (never "null"). Long text is clamped to
 * six lines so it stays inside the 9:16 stage (the long-letter slide scrolls instead).
 */
export const MessageBody: React.FC<MessageBodyProps> = ({ message, nickname, className, quoteClassName }) => {
    const words = message.text ?? message.caption;
    const showMedia = message.type === 'picture' && message.media_url;
    if (!words && !showMedia) return null;
    return (
        <div className={cn('flex flex-col items-center gap-3', className)}>
            {showMedia && (
                <img data-testid="message-media" src={message.media_url ?? undefined} alt="" className="max-h-48 rounded-lg object-cover shadow-card" />
            )}
            {words && <Quote className={cn('line-clamp-6', quoteClassName)}>{withNickname(words, nickname)}</Quote>}
        </div>
    );
};
