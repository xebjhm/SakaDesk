import React from 'react';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import { formatMessageDate } from '../shared/jst';
import { MemoryText } from '../shared/MemoryText';
import { Narration, QUOTE_CLASS } from '../shared/typeRoles';
import type { MemoryMessageType } from '../types';
/**
 * The recap's older card: the strongest keepsake sepia whatever the year (the approved S08 look,
 * DESIGN_SYSTEM.md "Memories keepsake surfaces") and a slight fade.
 */
const SLIDE_OLDER = 'opacity-90 sepia-memories-3';

/** One of her messages on a side: the shared message object, or the recap's slimmer one. */
export interface ThenNowItem {
    id: number;
    ts: string;
    type: MemoryMessageType;
    text: string | null;
    caption: string | null;
    media_url: string | null;
}

export interface ThenNowSideView {
    /** A caption over the side (the recap's label). */
    label?: string | null;
    /** The side's message (the slide shows the first). */
    items: ThenNowItem[];
}

export interface ThenNowReveal {
    className: string;
    style?: React.CSSProperties;
}

interface ThenNowPairProps {
    then: ThenNowSideView | null;
    now: ThenNowSideView | null;
    /** Marked in both sides' words (a `<mark>` through `MemoryText`'s `highlight`). */
    sharedKeyword?: string | null;
    /** Overrides the Memories nickname (the recap passes its resolved one). */
    nickname?: string;
    /** The slide's held reveal per side (the recap's timing). */
    reveal?: { then?: ThenNowReveal; now?: ThenNowReveal };
}

const SlideSide: React.FC<{
    side: ThenNowSideView; which: 'then' | 'now'; older: boolean; keyword?: string; nickname?: string; reveal?: ThenNowReveal;
}> = ({ side, which, older, keyword, nickname, reveal }) => {
    const { i18n } = useTranslation();
    const message = side.items[0];
    if (!message) return null;
    const date = formatMessageDate(message.ts, i18n.language, true);
    const words = message.text ?? message.caption;
    const picture = message.type === 'picture' && message.media_url;
    return (
        <div
            data-testid="then-now-side"
            data-side={which}
            className={cn('flex w-full flex-col gap-2 rounded-md bg-card px-4 py-3 shadow-card', older && SLIDE_OLDER, reveal?.className)}
            style={reveal?.style}
        >
            <div className="flex items-baseline justify-center gap-2">
                {side.label && <Narration className="text-muted">{side.label}</Narration>}
                {date && <time data-testid="then-now-date" dateTime={message.ts} className="text-caption tabular-nums text-muted">{date}</time>}
            </div>
            {picture && <img src={message.media_url ?? undefined} alt="" className="mx-auto max-h-28 rounded-sm object-cover" />}
            {words && (
                <MemoryText
                    text={words}
                    nickname={nickname}
                    highlight={keyword}
                    highlightTone="mark"
                    data-voice="quote"
                    className={cn(QUOTE_CLASS, 'line-clamp-4 whitespace-pre-line break-words text-title text-primary')}
                />
            )}
        </div>
    );
};

/**
 * The year recap's 去年の、同じ日 pair (S08, spec 9.2): an older card and a newer one stacked in the
 * recap's type roles (narration label, JST date, serif quote, the shared keyword as a `<mark>`).
 * The older card always wears the full `sepia-memories-3` (the approved S08 look, never
 * age-graded); there is no gap marker (S08's copy holds its number), and each side keeps the
 * slide's held reveal. No animation of its own: the only motion is the reveal, which honours
 * reduced motion.
 */
export const ThenNowPair: React.FC<ThenNowPairProps> = ({ then, now, sharedKeyword, nickname, reveal }) => {
    const keyword = sharedKeyword ?? undefined;
    return (
        <div className="flex w-full flex-col items-center gap-4">
            {then && <SlideSide side={then} which="then" older keyword={keyword} nickname={nickname} reveal={reveal?.then} />}
            {now && <SlideSide side={now} which="now" older={false} keyword={keyword} nickname={nickname} reveal={reveal?.now} />}
        </div>
    );
};
