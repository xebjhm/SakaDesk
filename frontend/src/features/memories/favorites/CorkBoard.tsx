import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Mic, Play } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import { JST_TIME_ZONE } from '../recap/availability';
import { logMemoriesSkip } from '../memoriesLog';
import { LazyVoice } from '../shared/LazyVoice';
import { memoryMediaSrc } from '../shared/mediaSrc';
import { messageName } from '../shared/nameFromRoom';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import type { FavoriteItem } from '../types';
import { BOARD_CHUNK, ESTIMATED_ITEM_PX, LIVE_MARGIN, PRINT_PX, tiltClass } from './board';

const itemKey = (m: FavoriteItem) => `${m.room}|${m.id}`;

interface ItemProps {
    item: FavoriteItem;
    name: string;
    date: string;
    onOpen: (item: FavoriteItem) => void;
}

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const PAPER = 'border border-memories-paper bg-memories-paper shadow-memories-polaroid';

/** Her name and the message's JST date. */
const Meta: React.FC<{ name: string; date: string; className?: string }> = ({ name, date, className }) => (
    <span className={cn('flex items-baseline justify-between gap-2 text-caption text-muted', className)}>
        <span lang="ja" className="min-w-0 truncate text-secondary">{name}</span>
        <span className="shrink-0 tabular-nums">{date}</span>
    </span>
);

/** A voice card: her name, date and 「ボイス」 (opens the strip), then the lazy one-at-a-time player. */
const VoiceCard: React.FC<ItemProps> = ({ item, name, date, onOpen }) => {
    const { t } = useTranslation();
    const src = memoryMediaSrc(item);
    return (
        <div data-testid={`cork-voice-${item.id}`} className={cn('rounded-md p-3', PAPER)}>
            <button
                type="button"
                data-testid={`cork-open-${item.id}`}
                onClick={() => onOpen(item)}
                className={cn('flex w-full flex-col gap-1 rounded-sm text-left', FOCUS)}
            >
                <Meta name={name} date={date} />
                <span className="flex items-center gap-1 font-display text-small text-primary">
                    <Mic aria-hidden="true" className="h-3.5 w-3.5" />
                    {t('memories.favorites.voice')}
                </span>
            </button>
            {src && <LazyVoice playKey={`board|${itemKey(item)}`} src={src} durationS={item.duration_s} ts={item.ts} className="mt-2" />}
        </div>
    );
};

/** One pinned favourite: a paper note, a print with its caption, or a voice card, under washi tape. */
const BoardItem = React.memo<ItemProps>(({ item, name, date, onOpen }) => {
    let body: React.ReactNode;
    if (item.type === 'voice') {
        body = <VoiceCard item={item} name={name} date={date} onOpen={onOpen} />;
    } else if (item.type === 'picture' || item.type === 'video') {
        const words = item.caption ?? item.text;
        body = (
            <button
                type="button"
                data-testid={`cork-print-${item.id}`}
                onClick={() => onOpen(item)}
                className={cn('block w-full p-2 pb-3 text-left', PAPER, FOCUS)}
            >
                <span className="relative block aspect-square w-full overflow-hidden bg-sunken">
                    <MemoryThumb message={item} px={PRINT_PX} className="h-full w-full" />
                    {item.type === 'video' && (
                        <Play aria-hidden="true" className="absolute left-2 top-2 h-4 w-4 fill-current text-inverse drop-shadow-sm" />
                    )}
                </span>
                {words && <MemoryText as="span" text={words} className="mt-2 block font-display text-small text-primary line-clamp-2" />}
                <Meta name={name} date={date} className="mt-1" />
            </button>
        );
    } else {
        body = (
            <button
                type="button"
                data-testid={`cork-note-${item.id}`}
                onClick={() => onOpen(item)}
                className={cn('block w-full rounded-md p-3 text-left', PAPER, FOCUS)}
            >
                <Meta name={name} date={date} />
                <MemoryText as="span" text={item.text ?? ''} className="mt-2 block text-body text-primary line-clamp-6" />
            </button>
        );
    }
    return (
        <article
            data-testid={`cork-item-${item.id}`}
            className={cn('relative mb-6 break-inside-avoid pt-2', tiltClass(item.id), 'motion-reduce:rotate-0')}
        >
            <span
                data-testid="cork-washi"
                aria-hidden="true"
                className="absolute left-1/2 top-0 z-10 h-4 w-16 -translate-x-1/2 -rotate-3 bg-memories-washi motion-reduce:rotate-0"
            />
            {body}
        </article>
    );
});
BoardItem.displayName = 'BoardItem';

/**
 * Which board chunks are live (mounted) inside the scroll container `root`: the first from the
 * start, then every chunk within {@link LIVE_MARGIN} of the viewport. Without
 * `IntersectionObserver` every chunk is live.
 */
function useChunkWindow(count: number, root: RefObject<HTMLElement>) {
    const lazy = typeof IntersectionObserver !== 'undefined';
    const [live, setLive] = useState<ReadonlySet<number>>(() => new Set([0]));
    const elements = useRef(new Map<number, HTMLElement>());
    const observer = useRef<IntersectionObserver | null>(null);

    useEffect(() => {
        if (!lazy) return undefined;
        const io = new IntersectionObserver((entries) => {
            setLive((prev) => {
                let next: Set<number> | null = null;
                for (const e of entries) {
                    const index = Number(e.target.getAttribute('data-chunk'));
                    if (prev.has(index) === e.isIntersecting) continue;
                    next ??= new Set(prev);
                    if (e.isIntersecting) next.add(index); else next.delete(index);
                }
                return next ?? prev;
            });
        }, { root: root.current, rootMargin: LIVE_MARGIN });
        observer.current = io;
        elements.current.forEach((el) => io.observe(el));
        return () => { io.disconnect(); observer.current = null; };
    }, [lazy, root, count]);

    const registerRef = useCallback((index: number, el: HTMLElement | null) => {
        const prev = elements.current.get(index);
        if (prev && prev !== el) observer.current?.unobserve(prev);
        if (el) {
            elements.current.set(index, el);
            observer.current?.observe(el);
        } else elements.current.delete(index);
    }, []);

    const isLive = useCallback((index: number) => !lazy || live.has(index), [lazy, live]);
    return { registerRef, isLive };
}

/** The board's column count at the current width (`md:columns-2 xl:columns-3`), tracked on resize. */
function useBoardColumns(): number {
    const read = () => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 1;
        if (window.matchMedia('(min-width: 1280px)').matches) return 3;
        return window.matchMedia('(min-width: 768px)').matches ? 2 : 1;
    };
    const [cols, setCols] = useState(read);
    useEffect(() => {
        const onResize = () => setCols(read());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    return cols;
}

interface ChunkProps {
    index: number;
    items: FavoriteItem[];
    live: boolean;
    cols: number;
    dateOf: (m: FavoriteItem) => string;
    onOpen: (item: FavoriteItem) => void;
    registerRef: (index: number, el: HTMLElement | null) => void;
}

/**
 * A chunk of the board: its items while live, else a placeholder as tall as it last measured at
 * this column count (an estimate from its item count before that, or after the columns change),
 * so the scrollbar and the scroll position stay close to the real board.
 */
const Chunk: React.FC<ChunkProps> = ({ index, items, live, cols, dateOf, onOpen, registerRef }) => {
    const own = useRef<HTMLDivElement | null>(null);
    const measured = useRef<{ cols: number; height: number } | null>(null);
    const ref = useCallback((el: HTMLDivElement | null) => {
        own.current = el;
        registerRef(index, el);
    }, [registerRef, index]);
    useLayoutEffect(() => {
        if (live && own.current) measured.current = { cols, height: own.current.getBoundingClientRect().height };
    });
    const known = measured.current?.cols === cols ? measured.current.height : 0;
    const height = known || Math.ceil(items.length / cols) * ESTIMATED_ITEM_PX;
    return (
        <div
            ref={ref}
            data-chunk={index}
            style={live ? undefined : { minHeight: height }}
            className="columns-1 gap-6 md:columns-2 xl:columns-3"
        >
            {live
                ? items.map((m) => <BoardItem key={itemKey(m)} item={m} name={messageName(m)} date={dateOf(m)} onOpen={onOpen} />)
                : <div aria-hidden="true" data-testid="cork-chunk-placeholder" />}
        </div>
    );
};

interface CorkBoardProps {
    /** Newest first (the backend's order); each item names her. */
    items: FavoriteItem[];
    onOpen: (item: FavoriteItem) => void;
}

/** A note needs her words: a text favourite without any is left off the board. */
const pinnable = (m: FavoriteItem) => m.type !== 'text' || Boolean(m.text);

/**
 * The favorites cork board (spec 10) on `bg-memories-cork`, scrolling inside the pane. Text
 * favourites are paper notes (her words through `MemoryText`, six lines), photos and videos are
 * pinned prints (a lazy thumbnail and her words as the caption), voices are mini player cards
 * whose player (and audio) mounts only on ▶ (`LazyVoice`: one voice at a time). Every item names
 * her (the payload's `name`) and the JST date, is held by a washi strip and leans by a tilt
 * derived from its id (`tiltClass`; upright under reduced motion). The board is windowed in
 * chunks of {@link BOARD_CHUNK}: far chunks release their items, and a voice playing in a chunk
 * that is released stops. A text favourite without text is skipped (`memories_skip`
 * `empty_note` with the count).
 */
export const CorkBoard: React.FC<CorkBoardProps> = ({ items, onOpen }) => {
    const { i18n } = useTranslation();
    const scroller = useRef<HTMLDivElement>(null);
    const cols = useBoardColumns();
    const kept = useMemo(() => items.filter(pinnable), [items]);
    const dropped = items.length - kept.length;
    useEffect(() => {
        if (dropped > 0) logMemoriesSkip('favorites', 'empty_note', { count: dropped });
    }, [items, dropped]);
    const chunks = useMemo(() => {
        const out: FavoriteItem[][] = [];
        for (let i = 0; i < kept.length; i += BOARD_CHUNK) out.push(kept.slice(i, i + BOARD_CHUNK));
        return out;
    }, [kept]);
    const win = useChunkWindow(chunks.length, scroller);
    const dateFormat = useMemo(
        () => new Intl.DateTimeFormat(i18n.language, { timeZone: JST_TIME_ZONE, year: 'numeric', month: 'short', day: 'numeric' }),
        [i18n.language],
    );
    const dateOf = useCallback((m: FavoriteItem) => dateFormat.format(new Date(m.ts)), [dateFormat]);

    return (
        <div ref={scroller} data-testid="cork-board" className="min-h-0 flex-1 overflow-y-auto bg-memories-cork p-6">
            {chunks.map((chunk, i) => (
                <Chunk
                    key={i}
                    index={i}
                    items={chunk}
                    live={win.isLive(i)}
                    cols={cols}
                    dateOf={dateOf}
                    onOpen={onOpen}
                    registerRef={win.registerRef}
                />
            ))}
        </div>
    );
};
