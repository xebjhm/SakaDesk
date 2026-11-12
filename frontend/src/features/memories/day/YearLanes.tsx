import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../i18n';
import { logMemoriesToggle } from '../memoriesLog';
import { shownTexts } from '../shared/captions';
import { sepiaClass } from '../shared/sepia';
import { useBubbleVoices } from '../shared/useBubbleVoices';
import type { DayMember, DayYearsYear } from '../types';
import { hourBands } from './laneLayout';
import { dayPeople, type DayPerson } from './people';
import { LaneCard } from './Swimlanes';
import { axisLabel, clockMs, clockSpan, gapRuns, guidePairs, type LaneEntry } from './yearLanes';

interface YearLanesProps {
    members: DayMember[];
    /** One entry per year, oldest first (already filtered to the picked person). */
    years: DayYearsYear[];
}

const HOUR_MS = 60 * 60 * 1000;
/**
 * A quiet hour's height; a busy hour grows to hold its cards (`hourBands`). Taller than a card
 * (64 + 4 px), so a lone card still sits at its minute inside the hour (07:10 above 07:25).
 */
const PX_PER_HOUR = 96;
/** A collapsed `LaneCard` is `h-16` (64 px). */
const CARD_HEIGHT = 64;
const GAP = 4;
/** The axis column is `w-12` (48 px), each year column `w-56` (224 px), the year header `h-16`. */
const AXIS_W = 48;
const LANE_W = 224;
/**
 * A card sits `inset-x-1` inside a `px-4` lane: 20 px from each lane edge, so neighbouring years
 * keep a 40 px gutter where the guide lines show.
 */
const CARD_INSET = 20;
/** A quiet stretch shorter than this shows its outline without the words. */
const GAP_LABEL_MIN_PX = 40;

const msgKey = (m: { service: string; room: string; id: number }) => `${m.service}|${m.room}|${m.id}`;

/**
 * 歷年同一天 (B1): the same calendar day in every year, one column per year (oldest on the
 * left), each message placed by its JST time of day on one thin hour axis, so 07:10 in one year
 * sits beside 07:25 in the next. A busy hour grows to hold its cards (`hourBands`, shared with the
 * swimlanes). Matching kinds in neighbouring years (おはよう, photo, voice, おやすみ within
 * 90 minutes, `MATCH_WINDOW_MS`) are joined by faint dotted guide lines; an hour that is quiet in a year
 * while another year has messages shows a faint dashed gap. Cards are the swimlanes' `LaneCard`
 * (a click expands it, with the jump to her chat; `memories_toggle` `lane_card`); an older year's
 * stills are aged with `sepiaClass`. With more than one person each card shows her small avatar.
 * Year columns keep a fixed width, so many years scroll sideways inside the day view's scroller
 * (the axis stays sticky on the left).
 */
export const YearLanes: React.FC<YearLanesProps> = ({ members, years }) => {
    const { t } = useTranslation();
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
    const layout = useMemo(() => hourBands(
        entries.map((lane) => lane.map((e) => ({ key: e.key, ts: e.clock }))),
        { start: startHour * HOUR_MS, hourCount, pxPerHour: PX_PER_HOUR, cardHeight: CARD_HEIGHT, gap: GAP },
    ), [entries, startHour, hourCount]);
    const pairs = useMemo(() => guidePairs(entries), [entries]);
    const gaps = useMemo(() => gapRuns(entries, startHour, hourCount), [entries, startHour, hourCount]);

    const tops = useMemo(() => {
        const out = new Map<string, number>();
        layout.lanes.forEach((lane) => lane.forEach(({ key, top }) => out.set(key, top)));
        return out;
    }, [layout]);
    const axisHeight = layout.edges[layout.edges.length - 1];
    const lastBottom = Math.max(0, ...layout.lanes.flatMap((lane) => lane.map((p) => p.top + CARD_HEIGHT)));
    const height = Math.max(axisHeight, lastBottom) + CARD_HEIGHT;
    const width = AXIS_W + years.length * LANE_W;
    const several = people.size > 1;

    const toggle = (key: string) => {
        const next = expanded === key ? null : key;
        setExpanded(next);
        logMemoriesToggle('lane_card', next !== null);
    };

    return (
        <div ref={rootRef} data-testid="day-years" className="relative flex w-max min-w-full">
            <div aria-hidden="true" className="sticky left-0 z-20 w-12 shrink-0 bg-sheet">
                <div className="h-16" />
                <div className="relative" style={{ height }}>
                    {layout.edges.map((edge, i) => (
                        <span
                            key={edge}
                            data-testid="day-years-hour"
                            className="absolute right-2 -translate-y-1/2 text-caption tabular-nums text-muted"
                            style={{ top: edge }}
                        >
                            {axisLabel(startHour + i)}
                        </span>
                    ))}
                </div>
            </div>
            {years.map((y, li) => (
                <section key={y.year} data-testid="day-years-lane" data-year={y.year} aria-labelledby={`day-years-${y.year}`} className="w-56 shrink-0 px-4">
                    <header className="sticky top-0 z-20 flex h-16 flex-col items-center justify-center bg-sheet">
                        <h3 id={`day-years-${y.year}`} className="font-display text-title tabular-nums text-primary">{y.year}</h3>
                        <span className="text-caption tabular-nums text-muted">{t('memories.day.count', { count: y.messages.length })}</span>
                    </header>
                    <div className="relative rounded-md bg-sunken" style={{ height }}>
                        {gaps[li].map(([from, to]) => {
                            const top = layout.edges[from];
                            const gapHeight = layout.edges[to + 1] - top;
                            return (
                                <div
                                    key={from}
                                    data-testid="day-years-gap"
                                    className="absolute inset-x-1 flex items-center justify-center rounded-sm border border-dashed border-strong text-caption text-muted"
                                    style={{ top: top + GAP, height: Math.max(0, gapHeight - 2 * GAP) }}
                                >
                                    {gapHeight >= GAP_LABEL_MIN_PX && t('memories.day.yearsGap')}
                                </div>
                            );
                        })}
                        {y.messages.map((m) => {
                            const key = msgKey(m);
                            const person = people.get(m.person_key);
                            if (!person) return null;
                            return (
                                <LaneCard
                                    key={key}
                                    message={m}
                                    person={person}
                                    top={tops.get(key) ?? 0}
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
            {pairs.length > 0 && (
                <svg
                    data-testid="day-years-guides"
                    aria-hidden="true"
                    className="pointer-events-none absolute left-0 top-16 text-muted opacity-60"
                    width={width}
                    height={height}
                >
                    {pairs.map((p) => {
                        const y1 = (tops.get(p.from) ?? 0) + CARD_HEIGHT / 2;
                        const y2 = (tops.get(p.to) ?? 0) + CARD_HEIGHT / 2;
                        const x1 = AXIS_W + (p.lane + 1) * LANE_W - CARD_INSET;
                        const x2 = AXIS_W + (p.lane + 1) * LANE_W + CARD_INSET;
                        return (
                            <line
                                key={`${p.from}>${p.to}`}
                                data-testid="day-years-guide"
                                x1={x1}
                                y1={y1}
                                x2={x2}
                                y2={y2}
                                stroke="currentColor"
                                strokeWidth={1}
                                strokeDasharray="2 3"
                            />
                        );
                    })}
                </svg>
            )}
        </div>
    );
};
