import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Radio, SkipBack, SkipForward } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Button, EmptyState, IconButton } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';
import { fetchRadioProgram } from '../api';
import { logMemoriesToggle } from '../memoriesLog';
import { createAudioElement } from '../shared/clipSequencer';
import { MemoriesStatus } from '../shared/memoriesStatus';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import type { RadioProgram } from '../types';
import { CassetteShelf } from './CassetteShelf';
import { Lyrics } from './Lyrics';
import { NowPlaying } from './NowPlaying';
import { createRadioAudioGraph } from './radioAudio';
import { programCopy } from './radioFormat';
import { SleepTimer } from './SleepTimer';
import { useSleepTimer, type SleepTimerState } from './useSleepTimer';
import { useRadioPlayer } from './useRadioPlayer';

interface StationProps {
    service: string;
    /** The member's chat path, or undefined for 全員. */
    member?: string;
    /** Her display name for the station title, or null / undefined for 全員. */
    memberName?: string | null;
    /**
     * The sleep timer, owned by the page so a member switch (which reloads the station) keeps
     * it; without one the station keeps its own.
     */
    sleep?: SleepTimerState;
}

/** Splits the station title around her name so only the name is marked `lang="ja"`. */
const NAME_SLOT = '\u0000';

/** The program loaded before one is picked: it tells which programs exist in this scope. */
const FIRST_LOAD: RadioProgram = 'oyasumi';

interface Overview {
    scope: string;
    programs: RadioProgram[];
    counts: Partial<Record<RadioProgram, number>>;
    years: number[];
}

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
 * real clips; each card shows its track count from the payload's `counts`), the cassette shelf while
 * あの頃から順番に is picked, the track on air with its waveform and lyrics, the controls and the
 * sleep timer. Picking a program (or a tape) loads its tracks and plays them on a new sequencer.
 * A failed program load shows an inline error with a retry in the now-playing area, and the
 * pressed card falls back to the program on air. A member switch clears the player, and a track
 * is drawn only under the station it was started in. Only the lyrics box and the cassette row
 * scroll. The Web Audio graph for the waveform is made on
 * the first click and closed on unmount.
 */
export const Station: React.FC<StationProps> = ({ service, member, memberName, sleep }) => {
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
    const overviewRef = useRef<Overview | null>(null);
    if (query.data) {
        overviewRef.current = { scope, programs: query.data.programs, counts: query.data.counts ?? {}, years: query.data.years };
    }
    const overview = overviewRef.current?.scope === scope ? overviewRef.current : null;

    const graph = useMemo(() => createRadioAudioGraph(), []);
    useEffect(() => () => graph.close(), [graph]);
    const createElement = useCallback(() => {
        const el = createAudioElement();
        graph.attach(el);
        return el;
    }, [graph]);
    const releaseElement = useCallback((el: HTMLAudioElement) => graph.release(el), [graph]);
    const player = useRadioPlayer({ createElement, releaseElement });
    const playerRef = useRef(player);
    playerRef.current = player;
    const ownSleep = useSleepTimer();
    const timer = sleep ?? ownSleep;

    // The graph gave up on a suspended context: replay the track on air on fresh, unrouted
    // elements so it never goes silent (a paused one is stopped; ▶ starts it again).
    useEffect(() => graph.onUnroute(() => {
        const p = playerRef.current;
        if (p.status === 'playing' && p.program && p.index >= 0) p.play(p.program, p.tracks, p.index);
        else if (p.status === 'paused' || p.status === 'fading') p.stop();
    }), [graph]);

    // The scope (member) the session on air belongs to: a track is drawn only under its own
    // station, and a new scope clears the player (the page has already silenced it).
    const [airScope, setAirScope] = useState<string | null>(null);
    const stopPlayer = player.stop;
    useEffect(() => {
        stopPlayer();
        setAirScope(null);
    }, [scope, stopPlayer]);

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
        setAirScope(scope);
        play(loadProgram, data.tracks);
    }, [data, status, loadKey, loadProgram, play, request, scope]);

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
    const onAir = airScope === scope && (playing || player.status === 'paused' || player.status === 'fading');
    // A failed pick: the card the fan pressed falls back to the program actually on air (or none),
    // and the error with its retry shows in the now-playing area.
    const loadFailed = query.status === 'error';
    const pressed = loadFailed ? (onAir ? player.program : null) : current.program;
    const onMain = () => {
        if (player.status === 'playing' || player.status === 'paused') {
            graph.ensure();
            player.toggle();
            return;
        }
        const program = current.program ?? overview?.programs[0];
        if (program) ask(program, current.year);
    };

    let title: React.ReactNode = t('memories.radio.stationAll');
    if (memberName) {
        const [before, after = ''] = t('memories.radio.station', { name: NAME_SLOT }).split(NAME_SLOT);
        title = <>{before}<span lang="ja">{memberName}</span>{after}</>;
    }
    const element = player.currentElement();
    const analyser = element && graph.isRouted(element) ? graph.analyser() : null;
    const track = airScope === scope ? player.track : null;

    if (!overview) {
        return <MemoriesStatus query={query} view="radio_program" />;
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
                <h2 className="min-w-0 truncate font-display text-heading">{title}</h2>
            </header>

            <div role="group" aria-label={t('memories.radio.programsLabel')} className="grid shrink-0 grid-cols-2 gap-2 px-4 lg:grid-cols-3">
                {overview.programs.map((code) => (
                    <ProgramCard
                        key={code}
                        code={code}
                        selected={pressed === code}
                        count={loadedProgram === code && data ? data.tracks.length : overview.counts[code] ?? null}
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
                {loadFailed && (
                    <div role="alert" data-testid="radio-load-error" className="mx-4 flex items-center gap-3 rounded-card bg-viewer-control p-3 text-small">
                        <span className="min-w-0 flex-1">{t('memories.common.loadError')}</span>
                        <Button variant="secondary" size="sm" onClick={query.retry}>{t('memories.common.retry')}</Button>
                    </div>
                )}
                {track && (
                    <>
                        <NowPlaying track={track} name={memberName ?? null} analyser={analyser} playing={playing} />
                        <Lyrics service={service} track={track} currentTime={player.currentTime} />
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
                    <SleepTimer timer={timer} />
                </div>
            </div>
        </section>
    );
};
