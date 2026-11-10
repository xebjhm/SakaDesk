import { useCallback, useEffect, useRef, useState } from 'react';
import { logMemoriesRadio } from '../memoriesLog';
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
 * `idle` nothing loaded (or stopped from outside), `playing`, `paused`, `fading` the sleep
 * timer's fade-out (the lamp is already off), `ended` the queue ran out.
 */
export type RadioStatus = 'idle' | 'playing' | 'paused' | 'fading' | 'ended';

export interface RadioPlayer {
    status: RadioStatus;
    program: RadioProgram | null;
    /** Index into {@link RadioPlayer.tracks} of the current track, or -1. */
    index: number;
    track: RadioTrack | null;
    /** The playable tracks of the current program (voices with a media URL). */
    tracks: RadioTrack[];
    /** The current track's playhead (seconds into the media). */
    currentTime: number;
    /** Start `program` with its tracks on a fresh sequencer (the old one stops). */
    play: (program: RadioProgram, tracks: RadioTrack[]) => void;
    /** Pause / resume. */
    toggle: () => void;
    next: () => void;
    prev: () => void;
    /** Stop playback (`end` reason `user`). */
    stop: () => void;
}

export interface RadioPlayerOptions {
    /** Makes each audio element (tests pass a fake; the station routes it into the waveform). */
    createElement?: () => HTMLAudioElement;
}

interface Session {
    seq: ClipSequencer;
    program: RadioProgram;
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
 * The voice radio's player: one `ClipSequencer` per program start (a finished sequence ignores
 * skips, so every start builds a new one). It joins the Memories voice coordinator as `radio`:
 * starting stops any other Memories voice, and another voice starting stops the radio (`end`
 * `preempted`); the page's `stopMemoriesVoices()` (leaving, switching member) ends it with
 * `user`; the sleep timer's `fadeOutMemoriesVoices` fades it (`fading`, then `end`
 * `sleep_timer`). A failing track is logged (`track_error`) and the sequence moves on; the end of
 * the queue is `ended` (`end` `queue_end`). Logs codes and counts only.
 */
export function useRadioPlayer({ createElement = createAudioElement }: RadioPlayerOptions = {}): RadioPlayer {
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
    const claim = useVoicePlayback((st) => st.play);
    const release = useVoicePlayback((st) => st.stop);

    /** Drop the session `s` if it is still the current one; true when it was. */
    const drop = useCallback((s: Session): boolean => {
        if (session.current !== s) return false;
        session.current = null;
        return true;
    }, []);

    const play = useCallback((code: RadioProgram, list: RadioTrack[]) => {
        const old = session.current;
        if (old) {
            session.current = null;
            old.seq.stop();
            logMemoriesRadio('end', { kind: old.program, reason: 'user' });
        }
        const playable = list.filter((t) => Boolean(t.message.media_url));
        setProgram(code);
        setTracks(playable);
        setIndex(-1);
        setCurrentTime(0);
        if (playable.length === 0) {
            logMemoriesRadio('play', { kind: code, count: 0, outcome: 'failed' });
            release(RADIO_VOICE_KEY);
            setStatus('ended');
            return;
        }
        const clips = playable.map((t) => toClip(code, t, t.message.media_url as string));
        // Filled in below; the events only fire once the sequencer runs.
        let s: Session | null = null;
        const seq = new ClipSequencer(clips, {
            onClip: (i) => {
                if (!s || session.current !== s) return;
                setIndex(i);
                setCurrentTime(clips[i].start);
                logMemoriesRadio('track', { kind: code, index: i });
            },
            onSubtitle: () => {},
            onClipError: (i, reason) => logMemoriesRadio('track_error', { kind: code, index: i, reason }),
            onProgress: (_i, t) => {
                if (s && session.current === s) setCurrentTime(t);
            },
            onEnd: () => {
                if (!s || !drop(s)) return;
                logMemoriesRadio('end', { kind: code, reason: 'queue_end' });
                setStatus('ended');
                release(RADIO_VOICE_KEY);
            },
        }, () => createRef.current(), sequencerOptions(code));
        const current: Session = { seq, program: code };
        s = current;
        session.current = current;
        claim(RADIO_VOICE_KEY, {
            stop: () => {
                if (!drop(current)) return;
                current.seq.stop();
                // Another voice took the key (preempted), or the page silenced every voice (user).
                const reason = useVoicePlayback.getState().playing === null ? 'user' : 'preempted';
                logMemoriesRadio('end', { kind: code, reason });
                // The page silenced it (left, or switched member): no track stays on air.
                if (reason === 'user') setIndex(-1);
                setStatus('idle');
            },
            fadeOut: async (ms) => {
                if (session.current !== current) return;
                setStatus('fading');
                await current.seq.fadeOut(ms);
                if (!drop(current)) return;
                logMemoriesRadio('end', { kind: code, reason: 'sleep_timer' });
                setStatus('idle');
            },
        });
        setStatus('playing');
        logMemoriesRadio('play', { kind: code, count: clips.length, outcome: 'ok' });
        seq.start();
    }, [claim, release, drop]);

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
        if (!s) return;
        session.current = null;
        s.seq.stop();
        logMemoriesRadio('end', { kind: s.program, reason: 'user' });
        release(RADIO_VOICE_KEY);
        setIndex(-1);
        setStatus('idle');
    }, [release]);

    // Unmount: silence the sequence first (so the coordinator's stop finds it gone), then release.
    useEffect(() => () => {
        const s = session.current;
        if (!s) return;
        session.current = null;
        s.seq.stop();
        logMemoriesRadio('end', { kind: s.program, reason: 'user' });
        release(RADIO_VOICE_KEY);
    }, [release]);

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
    };
}
