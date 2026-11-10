import React from 'react';
import { ArrowRight, Play } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Avatar } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';
import { buildMediaUrl, resizedAvatarUrl } from '../../messages/mediaUrl';
import { useAvatarWidth } from '../../messages/hooks/useAvatarWidth';
import { formatMessageDate } from '../recap/recapCopy';
import { Narration } from '../recap/slides/common';
import { QUOTE_CLASS } from '../recap/slides/style';
import { LazyVoice } from '../shared/LazyVoice';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import { sepiaClass } from '../shared/sepia';
import type { MemoryMessageType } from '../types';

const AVATAR_PX = 32;
const PHOTO_PX = 160;
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
    room?: string;
    service?: string;
    media_file?: string | null;
    duration_s?: number | null;
}

export interface ThenNowSideView {
    /** The side's real JST year: the serif label and, with the other side's, the gap. */
    year: number | null;
    /** 初見 vs 今: the JST `[first, last]` dates, shown instead of the year (the gap is an arrow). */
    range?: [string, string] | null;
    /** A caption over the side (「はじめの一週間」, a recap label). */
    label?: string | null;
    /** Her display name; shown only when the two sides are different people. */
    name?: string | null;
    /** Her avatar at the time (pane only). */
    avatarUrl?: string | null;
    items: ThenNowItem[];
}

export interface ThenNowReveal {
    className: string;
    style?: React.CSSProperties;
}

interface ThenNowPairProps {
    then: ThenNowSideView | null;
    now: ThenNowSideView | null;
    /** Marked in both sides' words through `MemoryText`'s `highlight`. */
    sharedKeyword?: string | null;
    /** `pane`: side by side in a Memories pane; `slide`: the year recap's stacked cards (S08). */
    variant: 'pane' | 'slide';
    /** Overrides the Memories nickname (the recap passes its resolved one). */
    nickname?: string;
    /** The slide's held reveal per side (the recap's timing); unused by the pane. */
    reveal?: { then?: ThenNowReveal; now?: ThenNowReveal };
}

const wordsOf = (m: ThenNowItem) => (m.type === 'text' ? m.text : (m.caption ?? m.text));

function voiceSrc(m: ThenNowItem): string | null {
    return m.media_url ?? (m.service && m.media_file ? buildMediaUrl(m.service, m.media_file) : null);
}

/** `YYYY-MM-DD` (a JST calendar day) as a short localized date, or the raw value. */
function formatDay(day: string, lang: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!m) return day;
    const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

const PaneItem: React.FC<{ item: ThenNowItem; keyword?: string; nickname?: string }> = ({ item: m, keyword, nickname }) => {
    const words = wordsOf(m);
    const src = m.type === 'voice' ? voiceSrc(m) : null;
    return (
        <li className="flex flex-col gap-2">
            {(m.type === 'picture' || m.type === 'video') && (
                <span className="relative block aspect-square w-40 max-w-full overflow-hidden rounded-sm bg-sunken">
                    <MemoryThumb message={m} px={PHOTO_PX} className="h-full w-full" />
                    {m.type === 'video' && <Play aria-hidden="true" className="absolute left-2 top-2 h-4 w-4 fill-current text-inverse drop-shadow-sm" />}
                </span>
            )}
            {src && <LazyVoice playKey={`then_now|${m.room ?? ''}|${m.id}`} src={src} durationS={m.duration_s ?? null} ts={m.ts} />}
            {words && <MemoryText text={words} nickname={nickname} highlight={keyword} className="line-clamp-6 text-small text-primary" />}
        </li>
    );
};

const PaneSide: React.FC<{
    side: ThenNowSideView; which: 'then' | 'now'; older: boolean; showName: boolean; keyword?: string; nickname?: string;
}> = ({ side, which, older, showName, keyword, nickname }) => {
    const { t, i18n } = useTranslation();
    const avatar = useAvatarWidth(AVATAR_PX);
    return (
        <div
            data-testid="then-now-side"
            data-side={which}
            className={cn('flex min-w-0 flex-1 flex-col gap-3 rounded-md bg-card p-3 shadow-card', older && side.year !== null && sepiaClass(side.year))}
        >
            <div className="flex items-center gap-2">
                {side.avatarUrl !== undefined && (
                    <Avatar src={resizedAvatarUrl(side.avatarUrl, avatar)} name={side.name ?? ''} size="sm" decorative />
                )}
                <div className="flex min-w-0 flex-col">
                    {side.label && <span className="text-caption text-muted">{side.label}</span>}
                    {side.range ? (
                        <span className="text-small tabular-nums text-secondary">
                            {formatDay(side.range[0], i18n.language)} – {formatDay(side.range[1], i18n.language)}
                        </span>
                    ) : side.year !== null && (
                        <span className="font-display text-heading text-primary">{t('memories.thenNow.year', { year: side.year })}</span>
                    )}
                    {showName && side.name && <span lang="ja" className="truncate text-small text-secondary">{side.name}</span>}
                </div>
            </div>
            <ul className="flex flex-col gap-3">
                {side.items.map((m) => <PaneItem key={`${m.room ?? ''}|${m.id}`} item={m} keyword={keyword} nickname={nickname} />)}
            </ul>
        </div>
    );
};

/** The marker between the sides: the years apart (never 0), an arrow for 初見 vs 今, else nothing. */
const Gap: React.FC<{ then: ThenNowSideView; now: ThenNowSideView }> = ({ then, now }) => {
    const { t } = useTranslation();
    let body: React.ReactNode = null;
    if (then.range || now.range) {
        body = <ArrowRight aria-hidden="true" className="h-4 w-4" />;
    } else if (then.year !== null && now.year !== null && now.year - then.year >= 1) {
        body = <span className="font-display text-small">{t('memories.thenNow.gap', { count: now.year - then.year })}</span>;
    }
    if (!body) return null;
    return (
        <div data-testid="then-now-gap" className="flex shrink-0 items-center justify-center self-center text-muted">
            {body}
        </div>
    );
};

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
                    className={cn(QUOTE_CLASS, 'line-clamp-4 whitespace-pre-line text-title text-primary')}
                />
            )}
        </div>
    );
};

/**
 * あの日と今日 (spec 14.2), shared by On This Day, the memoir timeline and the recap's S08: an
 * older side and a newer one, the older aged with sepia, the shared keyword marked in both.
 *
 * - `pane`: two cards side by side, each with her avatar at the time, the serif year (or the
 *   first-week date range) and up to three items (`MemoryThumb`, `LazyVoice` key
 *   `then_now|<room>|<id>`, her words through `MemoryText`). The older side wears
 *   `sepiaClass(year)`. Between them sits the gap: 「{{count}}年」 (the pair's one number, never
 *   0) when both years are known, an arrow for 初見 vs 今. Each side names its person only when
 *   the two sides are different people, so every label stays literally true.
 * - `slide`: the recap's stacked cards in its type roles (narration label, JST date, serif quote,
 *   the keyword as a `<mark>`); the older card always wears the full `sepia-memories-3` (the
 *   approved S08 look, never age-graded), there is no gap marker (S08's copy holds its number),
 *   and each side keeps the slide's held reveal.
 *
 * No animation of its own: the only motion is the slide's reveal, which honours reduced motion.
 */
export const ThenNowPair: React.FC<ThenNowPairProps> = ({ then, now, sharedKeyword, variant, nickname, reveal }) => {
    const keyword = sharedKeyword ?? undefined;
    if (variant === 'slide') {
        return (
            <div className="flex w-full flex-col items-center gap-4">
                {then && <SlideSide side={then} which="then" older keyword={keyword} nickname={nickname} reveal={reveal?.then} />}
                {now && <SlideSide side={now} which="now" older={false} keyword={keyword} nickname={nickname} reveal={reveal?.now} />}
            </div>
        );
    }
    const showName = Boolean(then?.name && now?.name && then.name !== now.name);
    return (
        <div className="flex w-full flex-col gap-3 md:flex-row md:items-stretch">
            {then && <PaneSide side={then} which="then" older showName={showName} keyword={keyword} nickname={nickname} />}
            {then && now && <Gap then={then} now={now} />}
            {now && <PaneSide side={now} which="now" older={false} showName={showName} keyword={keyword} nickname={nickname} />}
        </div>
    );
};
