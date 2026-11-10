import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MessageCircle, Mic, Play, Star } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Button, IconButton, Modal } from '../../../design/primitives';
import { cn, formatDuration } from '../../../utils/classnames';
import { fetchDay } from '../api';
import { logMemoriesSkip, type MemoriesView } from '../memoriesLog';
import { formatJstClock } from '../recap/availability';
import { formatDayHeading } from '../day/format';
import { isEditable } from '../shared/keys';
import { LazyVoice } from '../shared/LazyVoice';
import { LoadState } from '../shared/LoadState';
import { memoryMediaSrc } from '../shared/mediaSrc';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import { contextCaption, shownTexts } from '../shared/captions';
import { jumpToChat } from '../shared/jumpToChat';
import { messageName } from '../shared/nameFromRoom';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import type { DayMessage, DayPayload } from '../types';

/** Neighbours shown on each side of the focus. */
const SIDE = 2;
const FOCUS_PX = 256;
const SIDE_PX = 160;

const frameKey = (m: DayMessage) => `${m.room}|${m.id}`;

export interface FilmStripProps {
    service: string;
    /** Her chat path (any of her rooms): the strip shows her messages only. */
    memberPath: string;
    /** The focused message's JST date `YYYY-MM-DD`. */
    date: string;
    focusId: number;
    onClose: () => void;
    /** The view logged by the jump (`memories_jump` `target`); the names list passes `names`. */
    from?: MemoriesView;
}

/**
 * One frame's content, a compact film frame rather than a chat bubble: the JST time
 * (`formatJstClock`), then the still (`MemoryThumb`), the voice (the one-at-a-time `LazyVoice` on
 * the focused frame, a label with the duration on the others) and her words (`MemoryText`). A
 * paired caption whose own message is a frame of the same day (`shown`) is left to that frame.
 */
const FrameBody: React.FC<{ m: DayMessage; focused: boolean; shown: ReadonlySet<string> }> = ({ m, focused, shown }) => {
    const { t } = useTranslation();
    const words = m.type === 'text' ? m.text : (contextCaption(m, shown) ?? m.text);
    const src = memoryMediaSrc(m);
    return (
        <>
            <span className="block text-caption tabular-nums text-muted">{formatJstClock(m.ts)}</span>
            {(m.type === 'picture' || m.type === 'video') && (
                <span className="relative mt-1 block aspect-square w-full overflow-hidden rounded-sm bg-sunken">
                    <MemoryThumb message={m} px={focused ? FOCUS_PX : SIDE_PX} className="h-full w-full" />
                    {m.type === 'video' && (
                        <Play aria-hidden="true" className="absolute left-2 top-2 h-4 w-4 fill-current text-inverse drop-shadow-sm" />
                    )}
                </span>
            )}
            {m.type === 'voice' && (focused && src
                ? <LazyVoice playKey={`strip|${frameKey(m)}`} src={src} durationS={m.duration_s} ts={m.ts} className="mt-1" />
                : (
                    <span className="mt-1 flex items-center gap-1 text-small text-secondary">
                        <Mic aria-hidden="true" className="h-3.5 w-3.5" />
                        {t('memories.favorites.voice')}
                        {m.duration_s ? <span className="tabular-nums">{formatDuration(m.duration_s)}</span> : null}
                    </span>
                ))}
            {words && (
                <MemoryText
                    as="span"
                    text={words}
                    className={cn('mt-1 block text-primary', focused ? 'max-h-64 overflow-y-auto text-body' : 'text-small line-clamp-4')}
                />
            )}
        </>
    );
};

interface StripProps {
    day: DayPayload;
    /** The focused message's index in `day.messages`. */
    index: number;
    setIndex: (i: number) => void;
    from: MemoriesView;
    onClose: () => void;
}

/**
 * The loaded strip around `index`, in a focusable container. After every focus change, if the
 * keyboard focus left the dialog (a clicked neighbour frame became the focus and was replaced) or
 * sits on a button the edge just disabled, it moves to the container; after any other change in
 * the strip (▶ swapped for the voice player), a focus dropped to <body> comes back to it too, so
 * ← / → keep working.
 */
const Strip: React.FC<StripProps> = ({ day, index, setIndex, from, onClose }) => {
    const { t } = useTranslation();
    const root = useRef<HTMLDivElement>(null);
    const messages = day.messages;
    const last = messages.length - 1;
    const focus = messages[index];
    const shownWords = useMemo(() => shownTexts(messages), [messages]);

    useEffect(() => {
        const el = root.current;
        if (!el) return;
        const active = document.activeElement;
        const lost = !active || !el.contains(active);
        const stranded = active instanceof HTMLButtonElement && active.disabled;
        if (lost || stranded) el.focus({ preventScroll: true });
    }, [index]);

    // Any swap inside the strip (▶ replaced by the player, a frame remounting) can remove the
    // focused element; browsers then drop focus to <body> without an event we could catch. After
    // every change in the strip, a focus left on <body> (or nowhere) comes back to the container.
    useEffect(() => {
        const el = root.current;
        if (!el || typeof MutationObserver === 'undefined') return undefined;
        const observer = new MutationObserver(() => {
            const active = document.activeElement;
            if ((!active || active === document.body) && el.isConnected) el.focus({ preventScroll: true });
        });
        observer.observe(el, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, []);

    if (!focus) return null;
    const nameOf = (m: DayMessage) => messageName(m, day.members.find((p) => p.person_key === m.person_key)?.name);
    const start = Math.max(0, index - SIDE);
    const shown = messages.slice(start, index + SIDE + 1);

    return (
        <div ref={root} tabIndex={-1} data-testid="film-strip" className="flex flex-col gap-4 focus:outline-none">
            <div className="flex items-center justify-center gap-3 overflow-x-auto rounded-lg bg-sunken p-4">
                {shown.map((m, i) => {
                    const at = start + i;
                    return (
                        <div key={frameKey(m)} data-testid="film-frame" className={cn('shrink-0', at === index ? 'w-64' : 'w-40')}>
                            {at === index ? (
                                <div
                                    data-testid="film-focus"
                                    aria-current="true"
                                    className="relative rounded-md border border-memories-paper bg-memories-paper p-3 shadow-memories-polaroid"
                                >
                                    {m.favorited && (
                                        <Star
                                            data-testid="film-star"
                                            aria-hidden="true"
                                            className="absolute right-2 top-2 h-4 w-4 fill-current text-semantic-star drop-shadow-sm"
                                        />
                                    )}
                                    <FrameBody m={m} focused shown={shownWords} />
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setIndex(at)}
                                    className={cn(
                                        'w-full rounded-md border border-memories-paper bg-memories-paper p-2 text-left opacity-70',
                                        'transition-opacity duration-fast ease-standard hover:opacity-100 motion-reduce:transition-none',
                                        'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                                    )}
                                >
                                    <FrameBody m={m} focused={false} shown={shownWords} />
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
            <div className="flex items-center gap-2">
                <IconButton
                    aria-label={t('memories.filmStrip.older')}
                    icon={<ChevronLeft className="h-5 w-5" />}
                    disabled={index <= 0}
                    onClick={() => setIndex(index - 1)}
                />
                <IconButton
                    aria-label={t('memories.filmStrip.newer')}
                    icon={<ChevronRight className="h-5 w-5" />}
                    disabled={index >= last}
                    onClick={() => setIndex(index + 1)}
                />
                <span className="flex-1" />
                <Button variant="secondary" size="sm" onClick={() => { jumpToChat(focus, nameOf(focus), from); onClose(); }}>
                    <MessageCircle aria-hidden="true" className="h-4 w-4" />
                    {t('memories.common.jumpToChat')}
                </Button>
            </div>
        </div>
    );
};

/**
 * The film strip (spec 10; also the names list's day context): her messages of one JST day
 * (`fetchDay` with `member`) in a `Modal`, the focused one in the centre, larger, with the ★
 * for a favourite, up to two earlier and later ones either side as frames with their JST times
 * (click one to focus it). ‹ / › and ← / → (anywhere in the dialog, except in a field, a slider
 * or a focused voice player, which keep their own keys) move the focus older / newer and stop at
 * the day's edges; the footer jumps to her chat at the focused message (`memories_jump` with
 * `from`). A focus id missing from the day opens on its first message and logs `memories_skip`
 * `focus_missing` once per load. A new `date` / `focusId` starts again on the new focus.
 */
export const FilmStrip: React.FC<FilmStripProps> = ({ service, memberPath, date, focusId, onClose, from = 'favorites' }) => {
    const { t, i18n } = useTranslation();
    const day = useMemoriesQuery(
        'film_strip',
        (signal) => fetchDay(service, { date, member: memberPath }, signal),
        [service, memberPath, date],
        { count: (d) => d.messages.length },
    );
    // The index the fan moved to, tagged with the strip it belongs to; otherwise on `focusId`.
    const stripKey = `${service}|${memberPath}|${date}|${focusId}`;
    const [moved, setMoved] = useState<{ key: string; index: number } | null>(null);
    const messages = day.data?.messages ?? [];
    const found = messages.findIndex((m) => m.id === focusId);
    const index = moved?.key === stripKey ? moved.index : Math.max(0, found);
    const setIndex = (i: number) => setMoved({ key: stripKey, index: Math.min(Math.max(i, 0), Math.max(messages.length - 1, 0)) });

    const missing = day.data !== null && found < 0;
    useEffect(() => {
        if (missing) logMemoriesSkip('film_strip', 'focus_missing', { message_id: focusId });
    }, [day.data, missing, focusId]);

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (!messages.length || e.defaultPrevented || isEditable(e.target)) return;
        // Keys from a portaled dialog bubble through React but are not ours.
        if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
        // A focused voice player skips with ← / → itself.
        if (e.target instanceof Element && e.target.closest('[data-memories-voice]')) return;
        const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        if (!step) return;
        e.preventDefault();
        setIndex(index + step);
    };

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={t('memories.filmStrip.title')}
            header="plain"
            closeLabel={t('common.close')}
            headerExtra={<span className="text-small text-muted">{formatDayHeading(date, i18n.language)}</span>}
            className="max-w-4xl"
            onKeyDown={onKeyDown}
        >
            {day.status === 'ready' && day.data
                ? <Strip day={day.data} index={index} setIndex={setIndex} from={from} onClose={onClose} />
                : <LoadState status={day.status === 'error' ? 'error' : 'loading'} onRetry={day.retry} />}
        </Modal>
    );
};
