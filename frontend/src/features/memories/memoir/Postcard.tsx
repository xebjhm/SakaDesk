import React, { useId, useRef } from 'react';
import { Cake, Flower2, Gift, Heart, Mic, Sunrise, TreePine, type LucideIcon } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import { formatJstClock } from '../shared/jst';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import { sepiaClass } from '../shared/sepia';
import type { BinderCard, MemoryMessage } from '../types';
import {
    STACK_LAYERS, postcardTheme, postcardYears, postmarkDay, stackYears,
    type PostcardTheme, type PostcardYear,
} from './postcardModel';

/** The fan's view of who sent the postcards: her display name, and whether she is the fan's 推し (the ♥). */
export interface PostcardSender {
    name: string;
    oshi: boolean;
}

interface ThemeLook {
    /** The printed greeting (i18n key). */
    greeting: string;
    Stamp: LucideIcon;
    /** The greeting's ink: 元旦 is a holiday (the calendar's 祝日 red); every other card the primary ink. */
    greetingTone: string;
    /** A thin band along the card's top edge, or null: the birthday's foil, the fan's days in the group pastel. */
    band: string | null;
}

// Literal classes and keys, so Tailwind and the i18n scanner see every one of them.
const THEME: Record<PostcardTheme, ThemeLook> = {
    newyear: { greeting: 'memories.postcard.greeting.newyear', Stamp: Sunrise, greetingTone: 'text-calendar-holiday', band: null },
    birthday: { greeting: 'memories.postcard.greeting.birthday', Stamp: Cake, greetingTone: 'text-primary', band: 'bg-memories-foil' },
    anniversary: { greeting: 'memories.postcard.greeting.anniversary', Stamp: Flower2, greetingTone: 'text-primary', band: 'bg-accent-subtle' },
    valentine: { greeting: 'memories.postcard.greeting.valentine', Stamp: Gift, greetingTone: 'text-primary', band: null },
    christmas: { greeting: 'memories.postcard.greeting.christmas', Stamp: TreePine, greetingTone: 'text-primary', band: null },
};

/** Her words on a postcard front: three `text-small` lines, ellipsis, hard-capped at three lines. */
export const POSTCARD_CLAMP = 'line-clamp-3 max-h-small-3 overflow-hidden text-small text-primary';

const PAPER = 'rounded-sm border border-memories-paper bg-memories-paper shadow-memories-polaroid';

/**
 * A stack's layers from the front (index 0) back: where each rests, and how far it fans out when
 * the stack is hovered or focused. The fan is `motion-safe:` only: under reduced motion the
 * layers stay where they rest and nothing moves.
 */
/** Front on top (literal classes for Tailwind). */
const LAYER_Z = ['z-30', 'z-20', 'z-10'] as const;
const LAYER_REST = ['rotate-1', '-rotate-3 -translate-x-1 translate-y-1', '-rotate-6 -translate-x-2 translate-y-2'] as const;
export const LAYER_FAN = [
    'motion-safe:group-hover:rotate-3 motion-safe:group-hover:translate-x-3 motion-safe:group-focus-visible:rotate-3 motion-safe:group-focus-visible:translate-x-3',
    'motion-safe:group-hover:-rotate-6 motion-safe:group-hover:-translate-x-6 motion-safe:group-focus-visible:-rotate-6 motion-safe:group-focus-visible:-translate-x-6',
    'motion-safe:group-hover:-rotate-12 motion-safe:group-hover:-translate-x-10 motion-safe:group-focus-visible:-rotate-12 motion-safe:group-focus-visible:-translate-x-10',
] as const;

/** Her words of a message (a photo's paired words), or null. */
const wordsOf = (m: MemoryMessage) => (m.type === 'text' ? m.text : (m.caption ?? m.text));

const Stamp: React.FC<{ theme: PostcardTheme }> = ({ theme }) => {
    const { Stamp: Icon } = THEME[theme];
    return (
        <span
            data-testid="postcard-stamp"
            aria-hidden="true"
            className="flex h-11 w-9 shrink-0 items-center justify-center rounded-xs border-2 border-dotted border-memories-silhouette bg-memories-washi text-secondary"
        >
            <Icon className="h-4 w-4" />
        </span>
    );
};

/**
 * The postmark: a round ink stamp with the year, the month-day and, on a back, the JST clock (five
 * characters fit the circle; the shelf's postmark has no third line, the day's name sits in the
 * caption under the stack instead, so nothing is cut inside the circle).
 */
const Postmark: React.FC<{ year: number; day: string; last?: string; className?: string }> = ({ year, day, last, className }) => (
    <span
        data-testid="postcard-postmark"
        className={cn(
            'pointer-events-none flex h-14 w-14 -rotate-12 flex-col items-center justify-center rounded-pill border border-current text-caption tabular-nums text-muted',
            className,
        )}
    >
        <span>{year}</span>
        <span className="font-display font-semibold">{postmarkDay(day)}</span>
        {last && <span className="max-w-full px-1">{last}</span>}
    </span>
);

/** 「{{name}}より」 and, when she is the fan's 推し, the ♥ (the oshi pink, its only use here). */
const From: React.FC<{ sender?: PostcardSender }> = ({ sender }) => {
    const { t } = useTranslation();
    if (!sender?.name) return null;
    return (
        <span className="flex min-w-0 items-center gap-1 text-caption text-muted">
            <span lang="ja" className="truncate">{t('memories.postcard.from', { name: sender.name })}</span>
            {sender.oshi && <Heart data-testid="postcard-oshi" aria-hidden="true" className="h-3 w-3 shrink-0 fill-semantic-oshi text-semantic-oshi-solid" />}
        </span>
    );
};

/** The front of the newest postcard: the themed greeting, stamp and postmark, her words and who sent it. */
const PostcardFront: React.FC<{ theme: PostcardTheme; postcard: PostcardYear; sender?: PostcardSender }> = ({
    theme, postcard, sender,
}) => {
    const { t } = useTranslation();
    const look = THEME[theme];
    const face = postcard.face;
    const words = face ? wordsOf(face) : null;
    return (
        <>
            {look.band && <span data-testid="postcard-band" aria-hidden="true" className={cn('absolute inset-x-0 top-0 h-1.5 rounded-t-sm', look.band)} />}
            <span className="relative flex h-full flex-col p-3 pt-3.5 text-left">
                {/* The top zone (h-14) holds the greeting, the postmark and the stamp side by side:
                    her words start below it, so the postmark never covers them. */}
                <span data-testid="postcard-head" className="flex h-14 shrink-0 items-start gap-1">
                    <span lang="ja" className={cn('line-clamp-2 min-w-0 flex-1 font-display text-small font-semibold', look.greetingTone)}>
                        {t(look.greeting)}
                    </span>
                    <Postmark year={postcard.year} day={postcard.date} className="shrink-0" />
                    <Stamp theme={theme} />
                </span>
                {/* Three 20 px lines (text-small): the area is taller than the clamp, so the last line
                    ends in an ellipsis on a line boundary, never cut through the glyphs. */}
                <span data-testid="postcard-words" className="mt-1 flex min-h-0 flex-1 gap-2 overflow-hidden">
                    {face && !words && (face.type === 'picture' || face.type === 'video') && face.media_url && (
                        <MemoryThumb message={face} px={64} className={cn('h-12 w-16 shrink-0 rounded-xs', sepiaClass(postcard.year))} />
                    )}
                    {/* The clamp sits in a plain block, not as a flex item: a flex item is blockified and
                        WebView2 then computed `flow-root` instead of the `-webkit-box` line-clamp needs.
                        `max-h-small-3` caps it at exactly three lines either way. */}
                    {words && (
                        <span data-testid="postcard-words-clamp" className="block min-w-0 flex-1">
                            <MemoryText as="span" text={words} className={POSTCARD_CLAMP} />
                        </span>
                    )}
                    {face?.type === 'voice' && !words && (
                        <span className="flex items-center gap-1 text-small text-secondary">
                            <Mic aria-hidden="true" className="h-3.5 w-3.5" />
                            {t('memories.favorites.voice')}
                        </span>
                    )}
                </span>
                <From sender={sender} />
            </span>
        </>
    );
};

interface PostcardStackProps {
    card: BinderCard;
    /** The card's title (元旦, 誕生日 …): the button's name and the caption's first part. */
    title: string;
    sender?: PostcardSender;
    onOpen: (card: BinderCard) => void;
}

/**
 * A 特別な日 card on the shelf (A3): each year is a postcard she sent, postmarked with that year.
 * Several years make a stack (at most {@link STACK_LAYERS} drawn, the newest on top) that fans out
 * while the stack is hovered or focused (`motion-safe:` only, so it stays still under reduced
 * motion). The stack and its caption (the title, 「はがき N 枚」 and the years) fill the shelf
 * tiles' `h-52`, so the bottom edges line up. One focusable button named by the title, described by
 * the count and the years; a click opens the card's postcard backs.
 */
export const PostcardStack: React.FC<PostcardStackProps> = ({ card, title, sender, onOpen }) => {
    const { t } = useTranslation();
    const descId = useId();
    const theme = postcardTheme(card.key);
    const years = postcardYears(card);
    const newest = years[years.length - 1];
    // front first: the newest year, then the ones behind it
    const layers = years.slice(-STACK_LAYERS).reverse();
    const fan = years.length > 1;
    return (
        <div data-testid="card-tile" data-earned="true" data-card-key={card.key} data-postcard={theme} className="relative flex h-52 w-56 shrink-0 flex-col">
            <button
                type="button"
                data-testid="postcard-stack"
                aria-label={title}
                aria-describedby={descId}
                onClick={() => onOpen(card)}
                className="group relative block min-h-0 w-full flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                {layers.map((postcard, i) => {
                    const back = i > 0;
                    return (
                        <span
                            key={postcard.year}
                            data-testid="postcard-layer"
                            data-year={postcard.year}
                            className={cn(
                                PAPER,
                                'absolute inset-0 overflow-hidden transition-transform duration-base ease-standard motion-reduce:transition-none',
                                LAYER_Z[i],
                                LAYER_REST[i],
                                fan && LAYER_FAN[i],
                            )}
                        >
                            {back ? (
                                <span className="absolute right-3 top-3.5 flex items-start gap-1">
                                    <Postmark year={postcard.year} day={postcard.date} />
                                    <Stamp theme={theme} />
                                </span>
                            ) : (
                                <PostcardFront theme={theme} postcard={newest} sender={sender} />
                            )}
                        </span>
                    );
                })}
            </button>
            <p data-testid="postcard-stack-caption" className="relative z-40 mt-2 truncate text-center text-caption tabular-nums text-muted">
                <span aria-hidden="true">{title} ・ </span>
                <span id={descId}>
                    {t('memories.postcard.stack', { count: years.length })}
                    {' ・ '}
                    {stackYears(years.map((y) => y.year))}
                </span>
            </p>
        </div>
    );
};

interface PostcardBackProps {
    theme: PostcardTheme;
    postcard: PostcardYear;
    sender?: PostcardSender;
    selected: boolean;
    tilt: string;
    onSelect: () => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
    buttonRef: (el: HTMLButtonElement | null) => void;
}

/** One postcard back: her words on ruled lines; the stamp, the postmark (date and JST time), that day's photo and who sent it. */
const PostcardBack: React.FC<PostcardBackProps> = ({ theme, postcard, sender, selected, tilt, onSelect, onKeyDown, buttonRef }) => {
    const { t } = useTranslation();
    const face = postcard.face;
    const words = face ? wordsOf(face) : null;
    const photo = postcard.photo ?? (face && (face.type === 'picture' || face.type === 'video') && face.media_url ? face : null);
    const clock = face ? formatJstClock(face.ts) : '';
    return (
        <button
            ref={buttonRef}
            type="button"
            data-testid="postcard-back"
            data-year={postcard.year}
            aria-pressed={selected}
            aria-label={t('memories.postcard.year', { year: postcard.year })}
            tabIndex={selected ? 0 : -1}
            onClick={onSelect}
            onKeyDown={onKeyDown}
            className={cn(
                PAPER,
                'flex w-full gap-3 p-3 text-left',
                tilt,
                'transition-shadow duration-fast ease-standard motion-reduce:transition-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                selected && 'ring-2 ring-accent-border',
            )}
        >
            <span className="flex min-h-24 min-w-0 flex-1 flex-col">
                {words ? (
                    <MemoryText
                        as="span"
                        text={words}
                        className="block max-h-40 overflow-y-auto bg-memories-ruled bg-local text-small text-primary"
                    />
                ) : face?.type === 'voice' ? (
                    <span className="flex items-center gap-1 text-small text-secondary">
                        <Mic aria-hidden="true" className="h-3.5 w-3.5" />
                        {t('memories.favorites.voice')}
                    </span>
                ) : (
                    <span aria-hidden="true" className="block h-20 bg-memories-ruled" />
                )}
            </span>
            <span className="relative flex w-24 shrink-0 flex-col items-end gap-2 border-l border-dashed border-memories-paper pl-2">
                <Stamp theme={theme} />
                <Postmark year={postcard.year} day={postcard.date} last={clock} className="absolute -left-2 top-6" />
                <span className="h-8" aria-hidden="true" />
                {photo && <MemoryThumb message={photo} px={96} className={cn('h-14 w-full rounded-xs', sepiaClass(postcard.year))} />}
                <From sender={sender} />
            </span>
        </button>
    );
};

interface PostcardRackProps {
    card: BinderCard;
    sender?: PostcardSender;
    /** The year whose message drives the day column and the jump. */
    selected: number;
    onSelect: (year: number) => void;
}

/**
 * A special day opened (A3): its postcard backs, one per year, newest first. Each back is a
 * pressable button (`aria-pressed`; the selected one wears the state ring and drives the card
 * detail's day column and jump). One Tab stop (roving `tabIndex`): ↑ / ← and ↓ / → move to the
 * newer / older year, Home / End to the newest / oldest, selecting it. The backs lean slightly
 * left and right (a still tilt, not motion).
 */
export const PostcardRack: React.FC<PostcardRackProps> = ({ card, sender, selected, onSelect }) => {
    const { t } = useTranslation();
    const theme = postcardTheme(card.key);
    const backs = postcardYears(card).reverse();
    const refs = useRef(new Map<number, HTMLButtonElement>());
    const move = (index: number) => {
        const target = backs[Math.max(0, Math.min(backs.length - 1, index))];
        if (!target) return;
        onSelect(target.year);
        refs.current.get(target.year)?.focus();
    };
    const keyDown = (index: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
        let next: number | null = null;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = index + 1;
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = index - 1;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = backs.length - 1;
        if (next === null) return;
        e.preventDefault();
        move(next);
    };
    return (
        <div role="group" aria-label={t('memories.postcard.rack')} data-testid="postcard-rack" className="flex w-80 flex-col gap-4 p-1">
            {backs.map((postcard, i) => (
                <PostcardBack
                    key={postcard.year}
                    theme={theme}
                    postcard={postcard}
                    sender={sender}
                    selected={postcard.year === selected}
                    tilt={i % 2 === 0 ? '-rotate-1' : 'rotate-1'}
                    onSelect={() => onSelect(postcard.year)}
                    onKeyDown={keyDown(i)}
                    buttonRef={(el) => {
                        if (el) refs.current.set(postcard.year, el);
                        else refs.current.delete(postcard.year);
                    }}
                />
            ))}
        </div>
    );
};
