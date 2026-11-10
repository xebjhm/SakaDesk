import React, { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MessageCircle, Mic, Play, Star } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Button, IconButton, Modal } from '../../../design/primitives';
import { cn, formatDuration } from '../../../utils/classnames';
import { VoicePlayer } from '../../../core/media/VoicePlayer';
import { buildMediaUrl } from '../../messages/mediaUrl';
import { fetchDay } from '../api';
import type { MemoriesView } from '../memoriesLog';
import { formatJstClock } from '../recap/availability';
import { formatDayHeading } from '../day/format';
import { LoadState } from '../shared/LoadState';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import { jumpToChat } from '../shared/jumpToChat';
import { nameFromRoom } from '../shared/nameFromRoom';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import type { DayMessage, DayPayload } from '../types';

/** Neighbours shown on each side of the focus. */
const SIDE = 2;
const FOCUS_PX = 256;
const SIDE_PX = 160;

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

/** One frame's content: the JST time, then her words, the still or the voice. */
const FrameBody: React.FC<{ m: DayMessage; focused: boolean }> = ({ m, focused }) => {
    const { t } = useTranslation();
    const words = m.type === 'text' ? m.text : (m.caption ?? m.text);
    const src = m.media_url ?? (m.media_file ? buildMediaUrl(m.service, m.media_file) : null);
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
                ? <span className="mt-1 block"><VoicePlayer key={src} src={src} variant="compact" messageTimestamp={m.ts} /></span>
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

/** The loaded strip around `index`. */
const Strip: React.FC<StripProps> = ({ day, index, setIndex, from, onClose }) => {
    const { t } = useTranslation();
    const olderRef = useRef<HTMLButtonElement>(null);
    const newerRef = useRef<HTMLButtonElement>(null);
    const messages = day.messages;
    const last = messages.length - 1;
    const focus = messages[index];
    if (!focus) return null;
    const nameOf = (m: DayMessage) => day.members.find((p) => p.person_key === m.person_key)?.name ?? nameFromRoom(m.room);
    const start = Math.max(0, index - SIDE);
    const shown = messages.slice(start, index + SIDE + 1);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-center gap-3 overflow-x-auto rounded-lg bg-sunken p-4">
                {shown.map((m, i) => {
                    const at = start + i;
                    if (at === index) {
                        return (
                            <div key={`${m.room}|${m.id}`} data-testid="film-frame" className="w-64 shrink-0">
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
                                    <FrameBody m={m} focused />
                                </div>
                            </div>
                        );
                    }
                    return (
                        <button
                            key={`${m.room}|${m.id}`}
                            type="button"
                            data-testid="film-frame"
                            onClick={() => setIndex(at)}
                            className={cn(
                                'w-40 shrink-0 rounded-md border border-memories-paper bg-memories-paper p-2 text-left opacity-70',
                                'transition-opacity duration-fast ease-standard hover:opacity-100 motion-reduce:transition-none',
                                'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                            )}
                        >
                            <FrameBody m={m} focused={false} />
                        </button>
                    );
                })}
            </div>
            <div className="flex items-center gap-2">
                {/* A button that reaches the day's edge is disabled: focus moves to the other one, so it stays in the dialog. */}
                <IconButton
                    ref={olderRef}
                    aria-label={t('memories.filmStrip.older')}
                    icon={<ChevronLeft className="h-5 w-5" />}
                    disabled={index <= 0}
                    onClick={() => { setIndex(index - 1); if (index - 1 <= 0) newerRef.current?.focus(); }}
                />
                <IconButton
                    ref={newerRef}
                    aria-label={t('memories.filmStrip.newer')}
                    icon={<ChevronRight className="h-5 w-5" />}
                    disabled={index >= last}
                    onClick={() => { setIndex(index + 1); if (index + 1 >= last) olderRef.current?.focus(); }}
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
 * (click one to focus it). ‹ / › and ← / → move the focus older / newer and stop at the day's
 * edges; the footer jumps to her chat at the focused message (`memories_jump` with `from`).
 */
export const FilmStrip: React.FC<FilmStripProps> = ({ service, memberPath, date, focusId, onClose, from = 'favorites' }) => {
    const { t, i18n } = useTranslation();
    const day = useMemoriesQuery(
        'film_strip',
        (signal) => fetchDay(service, { date, member: memberPath }, signal),
        [service, memberPath, date],
        { count: (d) => d.messages.length },
    );
    // The index the fan moved to; null = still on `focusId` (the day's first message if it is missing).
    const [moved, setMoved] = useState<number | null>(null);
    const messages = day.data?.messages ?? [];
    const index = moved ?? Math.max(0, messages.findIndex((m) => m.id === focusId));
    const setIndex = (i: number) => setMoved(Math.min(Math.max(i, 0), Math.max(messages.length - 1, 0)));

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (!messages.length) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); setIndex(index - 1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); setIndex(index + 1); }
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
