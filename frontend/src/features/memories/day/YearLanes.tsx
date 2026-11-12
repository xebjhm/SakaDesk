import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../i18n';
import { logMemoriesToggle } from '../memoriesLog';
import { shownTexts } from '../shared/captions';
import { sepiaClass } from '../shared/sepia';
import { useBubbleVoices } from '../shared/useBubbleVoices';
import type { DayMember, DayYearsYear } from '../types';
import { dayPeople, type DayPerson } from './people';
import { formatShortDayWeekday } from './format';
import { LaneCard } from './Swimlanes';
import { axisLabel, clockLayout, clockMs, clockSpan, gapRuns, guidePairs, type LaneEntry } from './yearLanesLayout';

interface YearLanesProps {
    members: DayMember[];
    /** One entry per year, oldest first (already filtered to the picked person). */
    years: DayYearsYear[];
}

/**
 * A busy hour's least height; it grows to hold its cards. Taller than a card (64 + 4 px), so a
 * lone card still sits at its minute inside the hour (07:10 above 07:25).
 */
const PX_PER_HOUR = 96;
/** Hours with no message in any year collapse into one row this tall, labelled with the range. */
const QUIET_PX = 28;
/** A collapsed `LaneCard` is `h-16` (64 px). */
const CARD_HEIGHT = 64;
const GAP = 4;
/**
 * A card sits `inset-x-1` inside a `px-4` lane, so neighbouring years keep a 40 px gutter where
 * the guide lines show: each lane draws its own guides there (`-right-9 w-10` from its body), so
 * they land on the cards whatever width the lanes stretch to.
 */
const GUTTER_W = 40;
/** A quiet stretch shorter than this shows its outline without the words. */
const GAP_LABEL_MIN_PX = 40;

const msgKey = (m: { service: string; room: string; id: number }) => `${m.service}|${m.room}|${m.id}`;

/**
 * 歷年同一天 (B1): the same calendar day in every year, one column per year (oldest on the
 * left, each headed by its year, its date with the weekday (which changes from year to year) and
 * its count), each message placed by its JST time of day on one thin hour axis, so 07:10 in one year
 * sits beside 07:25 in the next. A busy hour grows to hold its cards; hours with no message in
 * any year collapse into one short row labelled with their range (`clockLayout`). Matching kinds in neighbouring years (おはよう, photo, video, voice, おやすみ within
 * 90 minutes, `MATCH_WINDOW_MS`) are joined by faint dotted guide lines; an hour that is quiet in a year
 * while another year has messages shows a faint dashed gap. Cards are the swimlanes' `LaneCard`
 * (a click expands it, with the jump to her chat; `memories_toggle` `lane_card`); an older year's
 * stills are aged with `sepiaClass`. With more than one person each card shows her small avatar.
 * Year columns stretch to fill the pane and keep a `min-w-56`, so many years scroll sideways
 * inside the day view's scroller (the opaque axis stays sticky on the left, from its very edge).
 */
export const YearLanes: React.FC<YearLanesProps> = ({ members, years }) => {
    const { t, i18n } = useTranslation();
    const [expanded, setExpanded] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    useBubbleVoices(rootRef, 'lanes');

    const allMessages = useMemo(() => years.flatMap((y) => y.messages), [years]);
    const people = useMemo(() => new Map<string, DayPerson>(dayPeople(members, allMessages).map((p) => [p.key, p])), [members, allMessages]);
    const shown = useMemo(() => shownTexts(allMessages), [allMessages]);
    const entries: LaneEntry[][] = useMemo(
        () => years.map((y) => y.messages.map((m) => ({ key: msgKey(m), kind: m.kind, clock: clockMs(m.ts) }))),
        [years],
    );
    const { startHour, hourCount } = useMemo(() => clockSpan(entries.flat().map((e) => e.clock)), [entries]);
    const layout = useMemo(() => clockLayout(entries, {
        startHour, hourCount, pxPerHour: PX_PER_HOUR, quietPx: QUIET_PX, cardHeight: CARD_HEIGHT, gap: GAP,
    }), [entries, startHour, hourCount]);
    const pairs = useMemo(() => guidePairs(entries), [entries]);
    const gaps = useMemo(() => gapRuns(entries, startHour, hourCount), [entries, startHour, hourCount]);

    const lastBottom = Math.max(0, ...[...layout.tops.values()].map((top) => top + CARD_HEIGHT));
    const height = Math.max(layout.height, lastBottom) + CARD_HEIGHT;
    const lastBand = layout.bands[layout.bands.length - 1];
    const several = people.size > 1;

    const toggle = (key: string) => {
        const next = expanded === key ? null : key;
        setExpanded(next);
        logMemoriesToggle('lane_card', next !== null);
    };

    return (
        <div ref={rootRef} data-testid="day-years" className="relative flex w-max min-w-full">
            {/* Opaque, above the sticky year headers (z-20) when the lanes scroll sideways under it,
                and flush with the scroller's left edge; its top cell sticks to the top too, so the
                corner stays fixed both ways. */}
            <div aria-hidden="true" data-testid="day-years-axis" className="sticky left-0 z-30 w-12 shrink-0 bg-sheet">
                <div data-testid="day-years-corner" className="sticky top-0 z-10 h-16 bg-sheet" />
                {/* mt-2 (as every lane body) keeps the first hour label clear of the header row */}
                <div className="relative mt-2" style={{ height }}>
                    {layout.bands.map((band) => !band.quiet && (
                        <span
                            key={band.from}
                            data-testid="day-years-hour"
                            className="absolute right-2 -translate-y-1/2 text-caption tabular-nums text-muted"
                            style={{ top: band.top }}
                        >
                            {axisLabel(band.from)}
                        </span>
                    ))}
                    {lastBand && !lastBand.quiet && (
                        <span
                            data-testid="day-years-hour"
                            className="absolute right-2 -translate-y-1/2 text-caption tabular-nums text-muted"
                            style={{ top: layout.height }}
                        >
                            {axisLabel(lastBand.to + 1)}
                        </span>
                    )}
                </div>
            </div>
            {years.map((y, li) => (
                <section
                    key={y.year}
                    data-testid="day-years-lane"
                    data-year={y.year}
                    aria-labelledby={`day-years-${y.year}`}
                    className="min-w-56 flex-1 px-4"
                >
                    <header className="sticky top-0 z-20 flex h-16 flex-col items-center justify-center bg-sheet">
                        <h3 id={`day-years-${y.year}`} className="font-display text-title tabular-nums text-primary">{y.year}</h3>
                        <span data-testid="day-years-meta" className="text-caption tabular-nums text-muted">
                            {formatShortDayWeekday(y.date, i18n.language)} ・ {t('memories.day.count', { count: y.messages.length })}
                        </span>
                    </header>
                    <div className="relative mt-2 rounded-md bg-sunken" style={{ height }}>
                        {layout.bands.map((band) => band.quiet && (
                            <div
                                key={band.from}
                                data-testid="day-years-quiet"
                                className="absolute inset-x-1 flex items-center justify-center border-y border-dashed border-subtle text-caption tabular-nums text-muted"
                                style={{ top: band.top, height: band.height }}
                            >
                                {axisLabel(band.from)}–{axisLabel(band.to + 1)}
                            </div>
                        ))}
                        {gaps[li].map(([from, to]) => {
                            const first = layout.bands[layout.bandOf(startHour + from)];
                            const last = layout.bands[layout.bandOf(startHour + to)];
                            const gapHeight = last.top + last.height - first.top;
                            return (
                                <div
                                    key={from}
                                    data-testid="day-years-gap"
                                    className="absolute inset-x-1 flex items-center justify-center rounded-sm border border-dashed border-strong text-caption text-muted"
                                    style={{ top: first.top + GAP, height: Math.max(0, gapHeight - 2 * GAP) }}
                                >
                                    {gapHeight >= GAP_LABEL_MIN_PX && t('memories.day.yearsGap')}
                                </div>
                            );
                        })}
                        {pairs.some((p) => p.lane === li) && (
                            <svg
                                data-testid="day-years-guides"
                                aria-hidden="true"
                                className="pointer-events-none absolute -right-9 top-0 overflow-visible text-muted opacity-60"
                                width={GUTTER_W}
                                height={height}
                            >
                                {pairs.filter((p) => p.lane === li).map((p) => (
                                    <line
                                        key={`${p.from}>${p.to}`}
                                        data-testid="day-years-guide"
                                        x1={0}
                                        y1={(layout.tops.get(p.from) ?? 0) + CARD_HEIGHT / 2}
                                        x2={GUTTER_W}
                                        y2={(layout.tops.get(p.to) ?? 0) + CARD_HEIGHT / 2}
                                        stroke="currentColor"
                                        strokeWidth={1}
                                        strokeDasharray="2 3"
                                    />
                                ))}
                            </svg>
                        )}
                        {y.messages.map((m) => {
                            const key = msgKey(m);
                            const person = people.get(m.person_key);
                            if (!person) return null;
                            return (
                                <LaneCard
                                    key={key}
                                    message={m}
                                    person={person}
                                    top={layout.tops.get(key) ?? 0}
                                    expanded={expanded === key}
                                    onToggle={() => toggle(key)}
                                    shown={shown}
                                    thumbClassName={sepiaClass(y.year)}
                                    showAvatar={several}
                                />
                            );
                        })}
                    </div>
                </section>
            ))}
        </div>
    );
};
