import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Play } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Avatar, BusyContent, Button, Card, EmptyState } from '../../../design/primitives';
import { MediaViewerModal } from '../../../core/media/PhotoDetailModal';
import { cn } from '../../../utils/classnames';
import { fetchTimelineMonth, fetchTimelineMonths } from '../api';
import { albumViewerItems, formatMonth, viewerIndexOf } from '../album/albumViewer';
import { logMemoriesSkip } from '../memoriesLog';
import { formatJstDate, jstNow } from '../shared/jst';
import { jumpToChat } from '../shared/jumpToChat';
import { LazyVoice } from '../shared/LazyVoice';
import { MemoriesStatus } from '../shared/memoriesStatus';
import { memoryMediaSrc } from '../shared/mediaSrc';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import { ThenNowPanel } from '../thenNow/ThenNowPanel';
import { ThenNowToggle } from '../thenNow/ThenNowToggle';
import type { MemoryMessage, TimelineMilestone, TimelineMonthPayload } from '../types';
import { formatCardDate, useCopy } from './binderModel';
import { cardCopy } from './cardCopy';
import { MonthRail } from './MonthRail';
import { resizedAvatarUrl } from '../../messages/mediaUrl';
import { useAvatarWidth } from '../../messages/hooks/useAvatarWidth';

/** The header avatar is `md` (40 CSS px): it is loaded resized for that size. */
const HEADER_AVATAR_PX = 40;

/** A month held this long on the rail is fetched; quicker steps (a drag, a wheel run) are not. */
const FETCH_DELAY_MS = 150;
const PHOTO_PX = 96;
/**
 * The hero tile spans the two rows of small tiles: 2 × 96 px (`h-24`) + the 16 px row gap
 * (`gap-y-4`) = 208 px (`sm:w-52 sm:h-52`). An explicit size: `w-auto` with a stretched height and
 * `aspect-square` computed to 0 px wide.
 */
const HERO_PX = 208;
const SLOT_PX = 160;

type Slot = keyof TimelineMonthPayload['messages'];
/** The word slots in display order, each with its label. */
const SLOTS: Array<{ slot: Slot; label: string }> = [
    { slot: 'top', label: 'memories.timeline.top' },
    { slot: 'late', label: 'memories.timeline.late' },
    { slot: 'nickname', label: 'memories.timeline.nickname' },
];

/** One labelled word slot: her words (or still / voice), the JST date and the jump to her chat. */
const SlotCard: React.FC<{ slot: Slot; label: string; message: MemoryMessage; name: string }> = ({ slot, label, message: m, name }) => {
    const { t, i18n } = useTranslation();
    const words = m.type === 'text' ? m.text : (m.caption ?? m.text);
    const src = memoryMediaSrc(m);
    return (
        <Card data-testid={`timeline-slot-${slot}`} className="flex min-w-0 flex-col gap-2 p-3">
            <p className="text-caption font-medium text-muted">{t(label)}</p>
            {(m.type === 'picture' || m.type === 'video') && (
                <span className="relative block aspect-square w-40 overflow-hidden rounded-sm bg-sunken">
                    <MemoryThumb message={m} px={SLOT_PX} className="h-full w-full" />
                    {m.type === 'video' && <Play aria-hidden="true" className="absolute left-2 top-2 h-4 w-4 fill-current text-inverse drop-shadow-sm" />}
                </span>
            )}
            {m.type === 'voice' && src && <LazyVoice playKey={`timeline|${m.room}|${m.id}`} src={src} durationS={m.duration_s} ts={m.ts} />}
            {words && <MemoryText text={words} className="line-clamp-6 text-small text-primary" />}
            <div className="mt-auto flex items-center justify-between gap-2">
                <span className="text-caption tabular-nums text-muted">{formatCardDate(formatJstDate(m.ts), i18n.language)}</span>
                <Button variant="ghost" size="sm" onClick={() => jumpToChat(m, name, 'timeline')}>{t('memories.common.jumpToChat')}</Button>
            </div>
        </Card>
    );
};

/** The month's milestones (`cardCopy` titles); a foil card's chip wears the foil sheen. */
const Milestones: React.FC<{ milestones: TimelineMilestone[]; month: string }> = ({ milestones, month }) => {
    const { t } = useTranslation();
    const copyText = useCopy();
    const known = milestones.flatMap((m) => {
        const copy = cardCopy(m.key);
        return copy ? [{ ...m, title: copyText(copy.title) }] : [];
    });
    const unknown = milestones.length - known.length;
    useEffect(() => {
        if (unknown > 0) logMemoriesSkip('timeline_month', 'unknown_card', { count: unknown });
    }, [unknown, month]);
    if (known.length === 0) return null;
    const headingId = `timeline-milestones-${month}`;
    return (
        <section className="flex flex-col gap-2">
            <h4 id={headingId} className="font-display text-small text-secondary">{t('memories.timeline.milestones')}</h4>
            <ul aria-labelledby={headingId} className="flex flex-wrap gap-2">
                {known.map((m) => (
                    <li
                        key={`${m.key}|${m.date}`}
                        className={cn(
                            'rounded-pill border border-subtle px-3 py-1 font-display text-small text-primary',
                            m.foil ? 'bg-memories-foil' : 'bg-card',
                        )}
                    >
                        {m.title}
                    </li>
                ))}
            </ul>
        </section>
    );
};

interface MonthViewProps {
    service: string;
    memberPath: string;
    name: string;
    /** The month selected on the rail (shown at once). */
    month: string;
    /** The month to fetch (the selection once it has settled). */
    fetchMonth: string;
    /** Header controls of the host (the ⇆ あの日と今日 toggle). */
    headerSlot?: React.ReactNode;
    /** Show あの日と今日 (`ThenNowPanel`) instead of the month's photos, words and milestones. */
    thenNow?: boolean;
}

/** `YYYY-MM` of the current JST month. */
function currentJstMonth(): string {
    const { year, month } = jstNow();
    return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * The month's あの日と今日 anchor: the JST date of its top message, else of its first photo.
 * None for the current month (its "now" is not a later year yet), so only 初見と今 can show.
 */
function anchorDate(view: TimelineMonthPayload): string | undefined {
    if (view.month === currentJstMonth()) return undefined;
    const source = view.messages.top ?? view.photos[0];
    return source ? formatJstDate(source.ts) || undefined : undefined;
}

/**
 * The selected month: her avatar then, the serif month label and the month's one number (never 0),
 * then up to thirteen photos: the month's hero (`hero`, the best photo score) large beside two rows
 * of small tiles, stacked above them at narrow widths (each opens the media viewer, jump logged as
 * `timeline`), the labelled word slots
 * (empty ones left out) and the milestones. A month change aborts the fetch in flight; until the
 * new month arrives the last loaded one of hers stays (`keepPrevious`, `BusyContent`: `aria-busy`,
 * dimmed after the reveal delay, inert: its photos would open the viewer at the new month's
 * index; its number is not shown under the new month's label). The header holds the host's `headerSlot`; with `thenNow` the body
 * is `ThenNowPanel` instead: the day mode for the month's anchor date ({@link anchorDate}) and
 * 初見と今 for her.
 */
const MonthView: React.FC<MonthViewProps> = ({ service, memberPath, name, month, fetchMonth, headerSlot, thenNow = false }) => {
    const { t, i18n } = useTranslation();
    const headerAvatar = useAvatarWidth(HEADER_AVATAR_PX);
    const query = useMemoriesQuery(
        'timeline_month',
        (signal) => fetchTimelineMonth(service, memberPath, fetchMonth, signal),
        [service, memberPath, fetchMonth],
        // While a new month loads (a scrub, a wheel run) the last loaded month of hers stays, dimmed.
        { count: (d) => d.count, keepPrevious: { scope: [service, memberPath] } },
    );
    const data = query.status === 'ready' && query.data?.month === month ? query.data : null;
    const failed = query.status === 'error' && fetchMonth === month;
    const view = failed ? null : query.data;
    const stale = view !== null && view !== data;
    const [viewer, setViewer] = useState<{ month: string; index: number } | null>(null);
    const viewerItems = useMemo(() => albumViewerItems(view?.photos ?? [], {
        nameOf: () => name,
        sourceLabel: t('memories.common.jumpToChat'),
        onBeforeJump: () => setViewer(null),
        from: 'timeline',
    }), [view, name, t]);
    const viewerIndex = viewer?.month === month ? viewer.index : null;

    let body: React.ReactNode;
    if (thenNow) {
        body = data
            ? <ThenNowPanel key={data.month} service={service} date={anchorDate(data)} member={memberPath} />
            : <MemoriesStatus query={failed ? query : { ...query, status: 'loading' }} view="timeline_month" />;
    } else if (!view) {
        body = <MemoriesStatus query={failed ? query : { ...query, status: 'loading' }} view="timeline_month" />;
    } else {
        const slots = SLOTS.flatMap(({ slot, label }) => {
            const m = view.messages[slot];
            return m ? [{ slot, label, m }] : [];
        });
        body = (
            <BusyContent busy={stale} inertWhileBusy>
                <div
                    data-testid="timeline-month-body"
                    aria-busy={stale ? 'true' : undefined}
                    className="flex flex-col gap-4"
                >
                    {viewerItems.viewable.length > 0 && (() => {
                        const heroMsg = view.hero !== null ? view.photos[view.hero] : undefined;
                        const hero = heroMsg && viewerItems.viewable.includes(heroMsg) ? heroMsg : undefined;
                        const rest = viewerItems.viewable.filter((p) => p !== hero);
                        const open = (p: MemoryMessage) => setViewer({ month, index: viewerIndexOf(viewerItems.viewable, p) });
                        const label = (p: MemoryMessage) => formatCardDate(formatJstDate(p.ts), i18n.language);
                        return (
                            <div data-testid="timeline-photos" className="flex flex-col gap-2 sm:flex-row sm:items-start">
                                {hero && (
                                    <button
                                        type="button"
                                        data-testid="timeline-hero"
                                        aria-label={label(hero)}
                                        onClick={() => open(hero)}
                                        className="relative block aspect-square w-full max-w-xs shrink-0 overflow-hidden rounded-md bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:aspect-auto sm:h-52 sm:w-52 sm:max-w-none"
                                    >
                                        <MemoryThumb message={hero} px={HERO_PX} large className="h-full w-full" />
                                        {hero.type === 'video' && <Play aria-hidden="true" className="absolute left-2 top-2 h-4 w-4 fill-current text-inverse drop-shadow-sm" />}
                                    </button>
                                )}
                                {rest.length > 0 && (
                                    <ul data-testid="timeline-photo-grid" className="grid min-w-0 auto-cols-max grid-flow-col grid-rows-2 gap-x-2 gap-y-4 overflow-x-auto pb-1">
                                        {rest.map((p) => (
                                            <li key={`${p.room}|${p.id}`}>
                                                <button
                                                    type="button"
                                                    aria-label={label(p)}
                                                    onClick={() => open(p)}
                                                    className="relative block h-24 w-24 overflow-hidden rounded-sm bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                                >
                                                    <MemoryThumb message={p} px={PHOTO_PX} className="h-full w-full" />
                                                    {p.type === 'video' && <Play aria-hidden="true" className="absolute left-1 top-1 h-3.5 w-3.5 fill-current text-inverse drop-shadow-sm" />}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        );
                    })()}
                    {slots.length > 0 && (
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            {slots.map(({ slot, label, m }) => <SlotCard key={slot} slot={slot} label={label} message={m} name={name} />)}
                        </div>
                    )}
                    <Milestones milestones={view.milestones} month={view.month} />
                </div>
            </BusyContent>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-3">
            <header className="flex items-center gap-3">
                <Avatar src={resizedAvatarUrl(view?.avatar_url, headerAvatar)} name={name} size="md" />
                <h3 className="font-display text-heading text-primary">{formatMonth(t, 'memories.album.monthLabel', month, i18n.language)}</h3>
                {data && data.count > 0 && (
                    <span className="text-small tabular-nums text-secondary">{t('memories.timeline.count', { count: data.count })}</span>
                )}
                {headerSlot && <div className="ml-auto flex items-center gap-2">{headerSlot}</div>}
            </header>
            {body}
            {data && viewerIndex !== null && viewerItems.items[viewerIndex] && (
                <MediaViewerModal
                    mediaItems={viewerItems.items}
                    currentIndex={viewerIndex}
                    onClose={() => setViewer(null)}
                    onNavigate={(index) => setViewer({ month, index })}
                />
            )}
        </div>
    );
};

interface TimelineProps {
    service: string;
    /** Her chat path (any of her rooms). */
    memberPath: string;
    /** Her display name (avatar alt text, the viewer's and the chat jump's name). */
    name: string;
}

/**
 * The 時光軸 tab (spec 5.4): the selected month above, the `MonthRail` at the bottom. It starts
 * at her newest month. The rail answers at once; the month is fetched once the selection holds
 * for {@link FETCH_DELAY_MS} (the first one at once), and a newer selection aborts the old fetch.
 * Without any month a gentle `EmptyState` (no number) replaces the tab. The month header carries
 * the ⇆ あの日と今日 toggle (`ThenNowToggle`); it resets when another month is picked.
 */
export const Timeline: React.FC<TimelineProps> = ({ service, memberPath, name }) => {
    const { t, i18n } = useTranslation();
    const months = useMemoriesQuery('timeline', (signal) => fetchTimelineMonths(service, memberPath, signal), [service, memberPath], {
        count: (d) => d.months.length,
    });
    const list = months.data?.months;
    const [picked, setPicked] = useState<{ path: string; month: string } | null>(null);
    const pickedIndex = list && picked?.path === memberPath ? list.findIndex((m) => m.month === picked.month) : -1;
    const index = list ? (pickedIndex >= 0 ? pickedIndex : list.length - 1) : -1;
    const month = list && index >= 0 ? list[index].month : undefined;

    const [fetchMonth, setFetchMonth] = useState<string | undefined>(undefined);
    // Any change of month resets the comparison (adjusted during render); coming back to a month
    // starts untoggled too.
    const [thenNow, setThenNow] = useState(false);
    const [shownMonth, setShownMonth] = useState(month);
    if (shownMonth !== month) {
        setShownMonth(month);
        setThenNow(false);
    }
    useEffect(() => {
        if (month === fetchMonth) return undefined;
        if (month === undefined || fetchMonth === undefined) {
            setFetchMonth(month);
            return undefined;
        }
        const id = setTimeout(() => setFetchMonth(month), FETCH_DELAY_MS);
        return () => clearTimeout(id);
    }, [month, fetchMonth]);

    const label = useMemo(
        () => (m: string) => formatMonth(t, 'memories.album.monthLabel', m, i18n.language),
        [t, i18n.language],
    );

    if (months.status !== 'ready' || !list) {
        return <MemoriesStatus query={months} view="timeline" />;
    }
    if (!month) {
        return <EmptyState icon={<CalendarDays />} title={t('memories.timeline.empty')} />;
    }
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {fetchMonth
                ? (
                    <MonthView
                        service={service}
                        memberPath={memberPath}
                        name={name}
                        month={month}
                        fetchMonth={fetchMonth}
                        thenNow={thenNow}
                        headerSlot={<ThenNowToggle on={thenNow} available onChange={setThenNow} />}
                    />
                )
                : <MemoriesStatus query={{ status: 'loading', failure: null, retry: months.retry }} view="timeline_month" />}
            <MonthRail
                months={list}
                index={index}
                onSelect={(i) => setPicked({ path: memberPath, month: list[i].month })}
                label={label}
            />
        </div>
    );
};
