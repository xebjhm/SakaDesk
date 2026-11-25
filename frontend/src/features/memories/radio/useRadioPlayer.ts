import { useCallback, useEffect, useRef, useState } from 'react';
import { logMemoriesRadio, type MemoriesRadioReason } from '../memoriesLog';
import {
    ClipSequencer, createAudioElement, CROSSFADE_MS, type SequencerClip, type SequencerOptions,
} from '../shared/clipSequencer';
import { useVoicePlayback } from '../shared/voicePlayback';
import type { RadioProgram, RadioTrack } from '../types';

/** The radio's key in the Memories voice coordinator. */
export const RADIO_VOICE_KEY = 'radio';
/** The silence between two whole voices of a regular program. */
export const RADIO_GAP_MS = 800;

/**
 * `idle` nothing on air (never started, or stopped), `playing`, `paused`, `fading` the sleep
 * timer's fade-out (the lamp is already off), `ended` the queue ran out.
 */
export type RadioStatus = 'idle' | 'playing' | 'paused' | 'fading' | 'ended';

export interface RadioPlayer {
    status: RadioStatus;
    /** The program of the current (or last) session, or null. */
    program: RadioProgram | null;
    /** Index into {@link RadioPlayer.tracks} of the track on air, or -1 (none on air). */
    index: number;
    /** The track on air, or null once the program ended or was stopped. */
    track: RadioTrack | null;
    /** The playable tracks of the session on air (voices with a media URL); empty when none. */
    tracks: RadioTrack[];
    /** The current track's playhead (seconds into the media). */
    currentTime: number;
    /**
     * Start `program` with its (already loaded) tracks on a fresh sequencer, from track
     * `startIndex` (default the first); a session on air stops first (`end` `user`).
     */
    play: (program: RadioProgram, tracks: RadioTrack[], startIndex?: number) => void;
    /** Pause / resume. */
    toggle: () => void;
    next: () => void;
    prev: () => void;
    /** Stop playback (`end` `user` when something was on air) and clear the track. */
    stop: () => void;
    /** The sounding element of the track on air (for the waveform), or null. */
    currentElement: () => HTMLAudioElement | null;
}

export interface RadioPlayerOptions {
    /** Makes each audio element (tests pass a fake; the station routes it into the waveform). */
    createElement?: () => HTMLAudioElement;
    /** Called for every element of a session once it is over (the station unroutes it). */
    releaseElement?: (el: HTMLAudioElement) => void;
}

interface Session {
    seq: ClipSequencer;
    program: RadioProgram;
    /** The elements this session's sequencer made (released when it is over). */
    made: HTMLAudioElement[];
}

/** Regular programs play whole voices back to back with a gap; 精選 crossfades its clip windows. */
function sequencerOptions(program: RadioProgram): SequencerOptions {
    return program === 'oyasumi_clips' ? { crossfadeMs: CROSSFADE_MS } : { crossfadeMs: 0, gapMs: RADIO_GAP_MS };
}

function toClip(program: RadioProgram, track: RadioTrack, url: string): SequencerClip {
    // A whole voice plays to its own `ended` (a rounded `duration_s` must not cut its tail).
    const clip = program === 'oyasumi_clips';
    return { url, start: track.start, end: clip && track.end !== null ? track.end : Infinity, segments: track.segments };
}

/**
 * The voice radio's player. `play(program, tracks)` takes tracks the caller has loaded (the
 * station owns the fetch through `useMemoriesQuery`); the hook only plays. One `ClipSequencer`
 * per program start (a finished sequence ignores skips, so every start builds a new one).
 *
 * It joins the Memories voice coordinator as `radio`: starting stops any other Memories voice,
 * and another voice starting stops the radio (`end` `preempted`); the page's
 * `stopMemoriesVoices()` (leaving, switching member) ends it with `user`; the sleep timer's
 * `fadeOutMemoriesVoices` fades it (`fading`, then `end` `sleep_timer`). A failing track is
 * logged (`track_error`) and the sequence moves on; the end of the queue is `ended` (`end`
 * `queue_end`).
 *
 * Whenever a session is over (ended, stopped, preempted, faded, replaced, unmounted) the track
 * and index are cleared, so no finished track stays on screen, and its elements are emptied and
 * handed to `releaseElement`. Logs codes and counts only.
 */
export function useRadioPlayer({ createElement = createAudioElement, releaseElement }: RadioPlayerOptions = {}): RadioPlayer {
    const [status, setStatus] = useState<RadioStatus>('idle');
    const [program, setProgram] = useState<RadioProgram | null>(null);
    const [tracks, setTracks] = useState<RadioTrack[]>([]);
    const [index, setIndex] = useState(-1);
    const [currentTime, setCurrentTime] = useState(0);
    const session = useRef<Session | null>(null);
    const statusRef = useRef(status);
    statusRef.current = status;
    const createRef = useRef(createElement);
    createRef.current = createElement;
    const releaseRef = useRef(releaseElement);
    releaseRef.current = releaseElement;
    const claim = useVoicePlayback((st) => st.play);
    const release = useVoicePlayback((st) => st.stop);

    /** Empty a finished session's elements and hand them back (the graph unroutes them). */
    const retire = useCallback((s: Session) => {
        for (const el of s.made) {
            el.pause();
            el.removeAttribute('src');
            el.load();
            releaseRef.current?.(el);
        }
        s.made.length = 0;
    }, []);

    /** Nothing on air: no track, no index. */
    const clearTrack = useCallback(() => {
        setIndex(-1);
        setTracks((t) => (t.length ? [] : t));
        setCurrentTime(0);
    }, []);

    /**
     * End session `s` if it is still the current one: stop it, log `end` with `reason`, clear the
     * track and set `next` (true when it was current).
     */
    const finish = useCallback((s: Session, reason: MemoriesRadioReason, next: RadioStatus): boolean => {
        if (session.current !== s) return false;
        session.current = null;
        s.seq.stop();
        retire(s);
        logMemoriesRadio('end', { kind: s.program, reason });
        clearTrack();
        setStatus(next);
        return true;
    }, [retire, clearTrack]);

    const play = useCallback((code: RadioProgram, list: RadioTrack[], startIndex = 0) => {
        const old = session.current;
        if (old) finish(old, 'user', 'idle');
        const playable = list.filter((t) => Boolean(t.message.media_url));
        setProgram(code);
        if (playable.length === 0) {
            logMemoriesRadio('play', { kind: code, count: 0, outcome: 'failed' });
            release(RADIO_VOICE_KEY);
            clearTrack();
            setStatus('ended');
            return;
        }
        setTracks(playable);
        setIndex(-1);
        setCurrentTime(0);
        const clips = playable.map((t) => toClip(code, t, t.message.media_url as string));
        const made: HTMLAudioElement[] = [];
        // Filled in below; the events only fire once the sequencer runs.
        let s: Session | null = null;
        const live = () => s !== null && session.current === s;
        const seq = new ClipSequencer(clips, {
            onClip: (i) => {
                if (!live()) return;
                setIndex(i);
                setCurrentTime(clips[i].start);
                logMemoriesRadio('track', { kind: code, index: i });
            },
            onSubtitle: () => {},
            onClipError: (i, reason) => logMemoriesRadio('track_error', { kind: code, index: i, reason }),
            onProgress: (_i, t) => {
                if (live()) setCurrentTime(t);
            },
            onEnd: () => {
                if (!s || !finish(s, 'queue_end', 'ended')) return;
                release(RADIO_VOICE_KEY);
            },
        }, () => {
            const el = createRef.current();
            made.push(el);
            return el;
        }, sequencerOptions(code));
        const current: Session = { seq, program: code, made };
        s = current;
        session.current = current;
        claim(RADIO_VOICE_KEY, {
            stop: () => {
                // Another voice took the key (preempted), or the page silenced every voice (user).
                const reason = useVoicePlayback.getState().playing === null ? 'user' : 'preempted';
                finish(current, reason, 'idle');
            },
            fadeOut: async (ms) => {
                if (session.current !== current) return;
                setStatus('fading');
                await current.seq.fadeOut(ms);
                finish(current, 'sleep_timer', 'idle');
            },
        });
        setStatus('playing');
        logMemoriesRadio('play', { kind: code, count: clips.length, outcome: 'ok' });
        seq.start(startIndex);
    }, [claim, release, finish, clearTrack]);

    const toggle = useCallback(() => {
        const s = session.current;
        if (!s) return;
        if (statusRef.current === 'playing') {
            s.seq.pause();
            logMemoriesRadio('pause', { kind: s.program });
            setStatus('paused');
        } else if (statusRef.current === 'paused') {
            s.seq.resume();
            logMemoriesRadio('resume', { kind: s.program, outcome: 'ok' });
            setStatus('playing');
        }
    }, []);

    const next = useCallback(() => session.current?.seq.next(), []);
    const prev = useCallback(() => session.current?.seq.prev(), []);

    const stop = useCallback(() => {
        const s = session.current;
        if (s && finish(s, 'user', 'idle')) {
            release(RADIO_VOICE_KEY);
            return;
        }
        // Nothing on air (an ended program): still clear what is shown.
        clearTrack();
        setStatus((st) => (st === 'ended' ? 'idle' : st));
    }, [finish, release, clearTrack]);

    const currentElement = useCallback(() => session.current?.seq.analyser() ?? null, []);

    // Unmount: silence the sequence first (so the coordinator's stop finds it gone), then release.
    useEffect(() => () => {
        const s = session.current;
        if (!s) return;
        session.current = null;
        s.seq.stop();
        retire(s);
        logMemoriesRadio('end', { kind: s.program, reason: 'user' });
        release(RADIO_VOICE_KEY);
    }, [release, retire]);

    return {
        status,
        program,
        index,
        track: index >= 0 ? tracks[index] ?? null : null,
        tracks,
        currentTime,
        play,
        toggle,
        next,
        prev,
        stop,
        currentElement,
    };
}
