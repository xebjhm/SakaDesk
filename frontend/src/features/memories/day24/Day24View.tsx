import React, { useEffect, useState } from 'react';
import { Dices, Play, Sunrise } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { EmptyState, IconButton } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';
import type { MemoriesRoute } from '../MemoriesFeature';
import { fetchDay24 } from '../api';
import { logMemoriesSkip } from '../memoriesLog';
import { formatJstClock, formatJstDate, jstNow } from '../shared/jst';
import { LazyVoice } from '../shared/LazyVoice';
import { MemoriesStatus } from '../shared/memoriesStatus';
import { memoryMediaSrc } from '../shared/mediaSrc';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import type { Day24Full, Day24Payload, Day24Slot } from '../types';

const PHOTO_PX = 96;
/** Seeds stay positive 31-bit integers (the backend reads an int). */
const SEED_RANGE = 2 ** 31 - 1;
/** How many shown message ids 🎲 remembers (three days of up to 7 slots; the backend takes 64). */
export const RECENT_MAX = 21;
/** Stands in for her name in the translated title (a private-use character no copy contains). */
const NAME_MARK = '';

interface Day24ViewProps {
    service: string;
    /** Her chat path (any of her rooms). */
    memberPath: string;
    /** Her display name (the title). */
    name: string;
    go: (next: MemoriesRoute) => void;
}

const isFull = (d: Day24Payload): d is Day24Full => d.slots.length > 0;

/** A new random seed, never the one on screen (so 🎲 always asks for another day). */
function nextSeed(current: number | undefined): number {
    let seed = 1 + Math.floor(Math.random() * (SEED_RANGE - 1));
    if (seed === current) seed = (seed % (SEED_RANGE - 1)) + 1;
    return seed;
}

/** One slot on the day line: its JST time and year (metadata), her message; click opens that day (back returns here). */
const Slot: React.FC<{ slot: Day24Slot; memberPath: string; go: (next: MemoriesRoute) => void }> = ({ slot, memberPath, go }) => {
    const { t } = useTranslation();
    const m = slot.message;
    const words = m.type === 'text' ? m.text : (m.caption ?? m.text);
    const src = m.type === 'voice' ? memoryMediaSrc(m) : null;
    const date = formatJstDate(m.ts);
    return (
        <li data-testid="day24-slot" className="flex min-w-0 flex-col gap-2 rounded-md bg-card p-3 shadow-card">
            <button
                type="button"
                onClick={() => go({ page: 'day', date, from: { page: 'memoir', memberPath, tab: 'day24' } })}
                className={cn(
                    'flex min-w-0 items-start gap-3 rounded-sm text-left',
                    'transition-colors duration-fast ease-standard hover:bg-sunken motion-reduce:transition-none',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                )}
            >
                <span className="flex w-14 shrink-0 flex-col">
                    <span data-testid="day24-time" className="font-display text-title tabular-nums text-primary">{formatJstClock(m.ts)}</span>
                    <span data-testid="day24-year" className="text-caption tabular-nums text-muted">
                        {t('memories.day24.year', { year: jstNow(new Date(m.ts)).year })}
                    </span>
                </span>
                {(m.type === 'picture' || m.type === 'video') && (
                    <span className="relative block h-24 w-24 shrink-0 overflow-hidden rounded-sm bg-sunken">
                        <MemoryThumb message={m} px={PHOTO_PX} className="h-full w-full" />
                        {m.type === 'video' && <Play aria-hidden="true" className="absolute left-1 top-1 h-3.5 w-3.5 fill-current text-inverse drop-shadow-sm" />}
                    </span>
                )}
                {words && <MemoryText as="span" text={words} className="line-clamp-3 min-w-0 text-small text-primary" />}
            </button>
            {src && <LazyVoice playKey={`day24|${m.room}|${m.id}`} src={src} durationS={m.duration_s} ts={m.ts} />}
        </li>
    );
};

/**
 * 彼女の24時間 (spec 14.1), the memoir's `day24` tab: one day stitched from different years.
 * The serif title 「{{name}}の一日」 (her name `lang="ja"`), the subtitle 「{{count}}年分のメッセージ
 * から」 (「ある年のメッセージから」 for a day from one year, so the label stays literally true), and a
 * vertical day line on the `bg-memories-sky` gradient (morning at the top, night at the bottom,
 * no text on it) beside 5–7 slots. Each slot shows the message's real JST time and year (metadata,
 * never chosen for the fan) and her words, a still or a voice (`LazyVoice` key `day24|<room>|<id>`);
 * a click opens that JST day (`{page: 'day', date, from: <this memoir day24 tab>}`, so back
 * returns here). 🎲 「ほかの一日をつくる」 refetches with a new
 * random seed and the ids shown in the last re-rolls (`recent`, at most `RECENT_MAX`, so the
 * backend avoids them) (`memories_load` `day24`, as every load); the day on screen stays, dimmed and
 * `aria-busy`, until the next one arrives (a failure shows the retry in its place), so the header
 * and 🎲 keep their place and focus. A thin day (`{slots: []}`) shows the gentle
 * card instead, with no number, and logs `memories_skip` `day24_thin`. No animation.
 */
export const Day24View: React.FC<Day24ViewProps> = ({ service, memberPath, name, go }) => {
    const { t } = useTranslation();
    const [seed, setSeed] = useState<number | undefined>(undefined);
    // Ids shown in the last re-rolls (this member's tab only): sent with 🎲 so the next day is fresh.
    const [recent, setRecent] = useState<number[]>([]);
    const query = useMemoriesQuery(
        'day24',
        (signal) => fetchDay24(service, memberPath, seed, signal, recent),
        [service, memberPath, seed, recent],
        { count: (d) => d.slots.length },
    );
    const data = query.data;
    const thin = data !== null && !isFull(data);
    useEffect(() => {
        if (thin) logMemoriesSkip('day24', 'day24_thin');
    }, [thin, data]);
    // The last full day, kept on screen while 🎲 loads the next one.
    const [shown, setShown] = useState<Day24Full | null>(null);
    if (data && isFull(data) && data !== shown) setShown(data);
    const view = data && isFull(data) ? data : shown;

    if (thin) {
        return (
            <div data-testid="memories-day24" className="flex min-h-0 flex-1 flex-col">
                <EmptyState icon={<Sunrise />} title={t('memories.day24.thin')} />
            </div>
        );
    }
    if (!view) {
        return <MemoriesStatus query={query} view="day24" />;
    }
    const [before, after] = t('memories.day24.title', { name: NAME_MARK }).split(NAME_MARK);
    const subtitle = view.years === 1 ? t('memories.day24.fromOneYear') : t('memories.day24.fromYears', { count: view.years });
    const stale = view !== data;
    return (
        <div data-testid="memories-day24" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
            <header className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                    <h3 className="font-display text-heading text-primary">
                        {before}<span lang="ja">{name}</span>{after}
                    </h3>
                    <p className="text-small text-secondary">{subtitle}</p>
                </div>
                <IconButton
                    aria-label={t('memories.day24.reroll')}
                    title={t('memories.day24.reroll')}
                    icon={<Dices />}
                    variant="secondary"
                    onClick={() => {
                        setRecent((prev) => [...prev, ...view.slots.map((s) => s.message.id)].slice(-RECENT_MAX));
                        setSeed(nextSeed(view.seed));
                    }}
                />
            </header>
            {query.status === 'error' ? (
                <MemoriesStatus query={query} view="day24" />
            ) : (
                <div
                    data-testid="day24-slots"
                    aria-busy={stale ? 'true' : undefined}
                    className={cn(
                        'mt-3 flex gap-3 transition-opacity duration-fast motion-reduce:transition-none',
                        stale ? 'pointer-events-none opacity-60' : 'opacity-100',
                    )}
                >
                    <span data-testid="day24-sky" aria-hidden="true" className="w-1.5 shrink-0 rounded-pill bg-memories-sky" />
                    <ol className="flex min-w-0 flex-1 flex-col gap-3">
                        {view.slots.map((slot) => <Slot key={`${slot.message.room}|${slot.message.id}`} slot={slot} memberPath={memberPath} go={go} />)}
                    </ol>
                </div>
            )}
        </div>
    );
};
