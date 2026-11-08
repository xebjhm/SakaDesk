import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { clientLog } from '../../utils/clientLog';
import { errorCode } from './mediaElement';

/** What the player shows over its controls. */
export type PlaybackStatus = 'ready' | 'buffering' | 'error';

/** Which player the breadcrumb comes from. */
export type PlaybackSurface = 'video' | 'voice';

type Phase = 'waiting' | 'stalled' | 'error' | 'play_rejected' | 'recovered' | 'retry' | 'summary';

/** Waiting / stalled episodes logged per source; later ones are only counted. */
const MAX_LOGGED_EPISODES = 3;

/**
 * Buffering / error state for an `<audio>` or `<video>` element, with
 * structured `media_playback` breadcrumbs (phase, surface, `readyState`,
 * `networkState`, `MediaError.code`; never the URL).
 *
 * - `waiting` → `buffering`; `stalled` → `buffering` only while playing with
 *   less than `HAVE_FUTURE_DATA` buffered (a stall with data in hand, or on a
 *   paused element, is not something to spin for). `progress` / `timeupdate`
 *   with `HAVE_FUTURE_DATA` end the spinner and the episode.
 * - `error` → `error` (the player shows a Retry).
 * - `canplay` / `playing` → `ready`; after a waiting / stalled / error episode
 *   this logs `recovered` with the episode as `reason`. Each episode logs its
 *   first event only, and only the first 3 waiting / stalled episodes per
 *   source are logged; a `summary` with the total `count` follows when the
 *   source changes or the player unmounts.
 * - `emptied` (source released or reloaded) → `ready` unless an error is
 *   showing; `pause` ends the
 *   spinner (but not the episode).
 * - `retry()` logs `retry`; a repeat failure logs `error` again.
 *
 * `play()` starts playback and logs a rejected promise as `play_rejected`
 * (with the exception name as `error_type`) instead of swallowing it; an
 * `AbortError` (the play was superseded by a release or navigation) is not a
 * failure and is only reported to `console.debug`.
 * `retry()` reloads the element at the same position and plays.
 */
export function useMediaPlayback(
    ref: RefObject<HTMLMediaElement | null>,
    surface: PlaybackSurface,
    src: string | undefined,
    /** Change this when the element behind `ref` is replaced, so listeners rebind. */
    elementKey?: unknown,
) {
    const [status, setStatus] = useState<PlaybackStatus>('ready');
    // The open trouble episode: what started it, or `retry` after the user retried.
    const episodeRef = useRef<'waiting' | 'stalled' | 'error' | 'retry' | null>(null);
    // Waiting / stalled episodes seen for this source, and whether the open one is over the log cap.
    const episodeCountRef = useRef(0);
    const suppressedRef = useRef(false);

    const log = useCallback((phase: Phase, extra: Record<string, string | number> = {}) => {
        const el = ref.current;
        clientLog('media_playback', {
            phase,
            surface,
            ready_state: el?.readyState ?? 0,
            network_state: el?.networkState ?? 0,
            error_code: el?.error?.code ?? 0,
            ...extra,
        });
    }, [ref, surface]);

    // A new source starts clean; the old one's suppressed episodes get one summary.
    useEffect(() => {
        episodeRef.current = null;
        suppressedRef.current = false;
        setStatus('ready');
        return () => {
            if (episodeCountRef.current > MAX_LOGGED_EPISODES) {
                log('summary', { count: episodeCountRef.current });
            }
            episodeCountRef.current = 0;
        };
    }, [src, log]);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const startEpisode = (kind: 'waiting' | 'stalled' | 'error', extra?: Record<string, string | number>) => {
            if (episodeRef.current === null) {
                episodeRef.current = kind;
                episodeCountRef.current += 1;
                suppressedRef.current = episodeCountRef.current > MAX_LOGGED_EPISODES;
                if (!suppressedRef.current) log(kind, extra);
            }
        };
        const onWaiting = () => {
            startEpisode('waiting');
            setStatus((s) => (s === 'error' ? s : 'buffering'));
        };
        const onStalled = () => {
            const starved = !el.paused && el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
            startEpisode('stalled', { outcome: el.paused ? 'paused' : starved ? 'buffering' : 'buffered' });
            if (starved) setStatus((s) => (s === 'error' ? s : 'buffering'));
        };
        const onError = () => {
            // An error always logs, even inside a buffering episode: it ends it.
            if (episodeRef.current !== 'error') {
                episodeRef.current = 'error';
                log('error');
            }
            setStatus('error');
        };
        const onReady = () => {
            if (episodeRef.current !== null) {
                if (!suppressedRef.current) log('recovered', { reason: episodeRef.current });
                episodeRef.current = null;
                suppressedRef.current = false;
            }
            setStatus('ready');
        };
        // `stalled` / `waiting` with data in hand may recover without canplay / playing.
        const onProgress = () => {
            if (el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
            const kind = episodeRef.current;
            if (kind === 'waiting' || kind === 'stalled') {
                if (!suppressedRef.current) log('recovered', { reason: kind });
                episodeRef.current = null;
                suppressedRef.current = false;
            }
            setStatus((s) => (s === 'buffering' ? 'ready' : s));
        };
        const onEmptied = () => setStatus((s) => (s === 'error' ? s : 'ready'));
        // Paused while buffering: nothing to wait for any more (the episode stays open).
        const onPause = () => setStatus((s) => (s === 'buffering' ? 'ready' : s));
        el.addEventListener('waiting', onWaiting);
        el.addEventListener('stalled', onStalled);
        el.addEventListener('error', onError);
        el.addEventListener('canplay', onReady);
        el.addEventListener('playing', onReady);
        el.addEventListener('emptied', onEmptied);
        el.addEventListener('pause', onPause);
        el.addEventListener('progress', onProgress);
        el.addEventListener('timeupdate', onProgress);
        return () => {
            el.removeEventListener('waiting', onWaiting);
            el.removeEventListener('stalled', onStalled);
            el.removeEventListener('error', onError);
            el.removeEventListener('canplay', onReady);
            el.removeEventListener('playing', onReady);
            el.removeEventListener('emptied', onEmptied);
            el.removeEventListener('pause', onPause);
            el.removeEventListener('progress', onProgress);
            el.removeEventListener('timeupdate', onProgress);
        };
    }, [ref, log, elementKey]);

    const play = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        const report = (err: unknown) => {
            if ((err as { name?: unknown } | null)?.name === 'AbortError') {
                // Superseded by a release / navigation: expected, not a failure.
                console.debug('[media] play superseded');
                return;
            }
            log('play_rejected', { error_type: errorCode(err) });
        };
        try {
            Promise.resolve(el.play()).catch(report);
        } catch (err) {
            report(err);
        }
    }, [ref, log]);

    const retry = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        log('retry');
        // A repeat error logs again; a success logs `recovered` with reason `retry`.
        episodeRef.current = 'retry';
        const position = el.currentTime;
        setStatus('ready');
        el.load();
        if (position > 0) el.currentTime = position;
        play();
    }, [ref, log, play]);

    return { status, play, retry };
}
