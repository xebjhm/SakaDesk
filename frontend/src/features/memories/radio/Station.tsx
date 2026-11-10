import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Radio, SkipBack, SkipForward } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { EmptyState, IconButton } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';
import { fetchRadioProgram } from '../api';
import { logMemoriesToggle } from '../memoriesLog';
import { createAudioElement } from '../shared/clipSequencer';
import { LoadState } from '../shared/LoadState';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import type { RadioProgram } from '../types';
import { CassetteShelf } from './CassetteShelf';
import { Lyrics } from './Lyrics';
import { NowPlaying } from './NowPlaying';
import { createRadioAudioGraph } from './radioAudio';
import { programCopy } from './radioFormat';
import { SleepTimer } from './SleepTimer';
import { useRadioPlayer } from './useRadioPlayer';

interface StationProps {
    service: string;
    /** The member's chat path, or undefined for 全員. */
    member?: string;
    /** Her display name for the station title, or null / undefined for 全員. */
    memberName?: string | null;
}

/** The program loaded before one is picked: it tells which programs exist in this scope. */
const FIRST_LOAD: RadioProgram = 'oyasumi';

interface Selection {
    scope: string;
    program: RadioProgram | null;
    /** The cassette year for あの頃から順番に; null = the server's default (the scope's first year). */
    year: number | null;
}

interface ProgramCardProps {
    code: RadioProgram;
    selected: boolean;
    /** The program's track count when its tracks are loaded (never 0). */
    count: number | null;
    onPick: (code: RadioProgram) => void;
}

const ProgramCard: React.FC<ProgramCardProps> = ({ code, selected, count, onPick }) => {
    const { t } = useTranslation();
    const copy = programCopy(code);
    return (
        <button
            type="button"
            aria-pressed={selected}
            onClick={() => onPick(code)}
            className={cn(
                'flex flex-col items-start gap-0.5 rounded-card bg-viewer-control p-3 text-left',
                'transition-colors duration-fast ease-standard hover:bg-viewer-control-hover',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                selected && 'ring-2 ring-accent',
            )}
        >
            <span className="text-small font-semibold">{t(copy.title)}</span>
            <span className="text-caption">{t(copy.subtitle)}</span>
            {count !== null && count > 0 && (
                <span className="text-caption tabular-nums">{t('memories.radio.trackCount', { count })}</span>
            )}
        </button>
    );
};

/**
 * The 深夜放送局 (spec 11 A): the radio's night surface, the station's brand moment at any hour.
 * The ON AIR lamp (lit only while sound plays, announced politely) beside the serif station
 * title, a row of program cards (only the programs the payload lists, so 精選 appears only with
 * real clips; a card shows its track count once its tracks are loaded), the cassette shelf while
 * あの頃から順番に is picked, the track on air with its waveform and lyrics, the controls and the
 * sleep timer. Picking a program (or a tape) loads its tracks and plays them on a new sequencer.
 * Only the lyrics box and the cassette row scroll. The Web Audio graph for the waveform is made on
 * the first click and closed on unmount.
 */
export const Station: React.FC<StationProps> = ({ service, member, memberName }) => {
    const { t } = useTranslation();
    const scope = `${service}|${member ?? ''}`;
    const [selection, setSelection] = useState<Selection>({ scope, program: null, year: null });
    // A new scope (member switch) starts with nothing picked (set-state-during-render pattern).
    if (selection.scope !== scope) setSelection({ scope, program: null, year: null });
    const current = selection.scope === scope ? selection : { scope, program: null, year: null };

    const loadProgram = current.program ?? FIRST_LOAD;
    const loadYear = loadProgram === 'chrono' && current.year !== null ? current.year : undefined;
    const query = useMemoriesQuery(
        'radio_program',
        (signal) => fetchRadioProgram(service, { program: loadProgram, member, year: loadYear }, signal),
        [service, member, loadProgram, loadYear],
        { count: (d) => d.tracks.length },
    );

    // The program list and years stay from the last load of this scope while a program loads.
    const overviewRef = useRef<{ scope: string; programs: RadioProgram[]; years: number[] } | null>(null);
    if (query.data) overviewRef.current = { scope, programs: query.data.programs, years: query.data.years };
    const overview = overviewRef.current?.scope === scope ? overviewRef.current : null;

    const graph = useMemo(() => createRadioAudioGraph(), []);
    useEffect(() => () => graph.close(), [graph]);
    const createElement = useCallback(() => {
        const el = createAudioElement();
        graph.attach(el);
        return el;
    }, [graph]);
    const player = useRadioPlayer({ createElement });

    // A pick asks to play once its tracks are in: the request key, and a counter so a pick of the
    // program already loaded still runs the effect.
    const wanted = useRef<string | null>(null);
    const [request, setRequest] = useState(0);
    const loadKey = `${scope}|${loadProgram}|${loadYear ?? ''}`;
    const { data, status } = query;
    const play = player.play;
    useEffect(() => {
        if (wanted.current !== loadKey || status !== 'ready' || !data) return;
        wanted.current = null;
        play(loadProgram, data.tracks);
    }, [data, status, loadKey, loadProgram, play, request]);

    const ask = (program: RadioProgram, year: number | null) => {
        graph.ensure();
        setSelection({ scope, program, year });
        wanted.current = `${scope}|${program}|${program === 'chrono' && year !== null ? year : ''}`;
        setRequest((n) => n + 1);
    };
    const pickProgram = (code: RadioProgram) => {
        logMemoriesToggle('radio_program', true, { kind: code });
        ask(code, current.year);
    };
    const loadCassette = (year: number) => ask('chrono', year);

    const playing = player.status === 'playing';
    const onMain = () => {
        if (player.status === 'playing' || player.status === 'paused') {
            graph.ensure();
            player.toggle();
            return;
        }
        const program = current.program ?? overview?.programs[0];
        if (program) ask(program, current.year);
    };

    const title = memberName ? t('memories.radio.station', { name: memberName }) : t('memories.radio.stationAll');

    if (!overview) {
        return <LoadState status={query.status === 'error' ? 'error' : 'loading'} onRetry={query.retry} />;
    }
    if (overview.programs.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState icon={<Radio />} title={t('memories.radio.title')} description={t('memories.radio.empty')} />
            </div>
        );
    }

    const loadedProgram = data?.program ?? null;
    const shownYear = current.year ?? overview.years[0] ?? null;
    return (
        <section
            data-testid="radio-station"
            className="flex min-h-0 flex-1 flex-col overflow-hidden bg-memories-night text-memories-night-ink"
        >
            <header className="flex shrink-0 items-center gap-3 px-4 pb-3 pt-4">
                <span
                    data-testid="onair"
                    aria-live="polite"
                    className="inline-flex shrink-0 items-center gap-2 rounded-sm border border-current px-2 py-0.5 text-caption tracking-widest"
                >
                    <span
                        data-testid="onair-dot"
                        aria-hidden="true"
                        className={cn('h-2 w-2 rounded-full', playing ? 'bg-memories-onair' : 'bg-current opacity-40')}
                    />
                    {playing ? t('memories.radio.onAir') : t('memories.radio.offAir')}
                </span>
                <h2 lang={memberName ? 'ja' : undefined} className="min-w-0 truncate font-display text-heading">{title}</h2>
            </header>

            <div role="group" aria-label={t('memories.radio.programsLabel')} className="grid shrink-0 grid-cols-2 gap-2 px-4 lg:grid-cols-3">
                {overview.programs.map((code) => (
                    <ProgramCard
                        key={code}
                        code={code}
                        selected={current.program === code}
                        count={loadedProgram === code && data ? data.tracks.length : null}
                        onPick={pickProgram}
                    />
                ))}
            </div>

            {current.program === 'chrono' && (
                <div className="mt-3">
                    <CassetteShelf service={service} member={member} selectedYear={shownYear} onLoad={loadCassette} />
                </div>
            )}

            <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2">
                {player.track && (
                    <>
                        <NowPlaying track={player.track} name={memberName ?? null} analyser={graph.analyser()} playing={playing} />
                        <Lyrics service={service} track={player.track} currentTime={player.currentTime} />
                    </>
                )}
            </div>

            <div className="flex shrink-0 items-center gap-3 px-4 py-3">
                <IconButton variant="overlay" aria-label={t('memories.radio.prev')} icon={<SkipBack />} onClick={player.prev} />
                <IconButton
                    variant="accent"
                    aria-label={playing ? t('memories.radio.pause') : t('memories.radio.play')}
                    icon={playing ? <Pause /> : <Play />}
                    onClick={onMain}
                />
                <IconButton variant="overlay" aria-label={t('memories.radio.next')} icon={<SkipForward />} onClick={player.next} />
                <div className="ml-auto">
                    <SleepTimer />
                </div>
            </div>
        </section>
    );
};
