import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { clientLog } from '../../utils/clientLog';
import { breadcrumbCode } from '../../utils/breadcrumbCode';

/** What the player shows over its controls. */
export type PlaybackStatus = 'ready' | 'buffering' | 'error';

/** Which player the breadcrumb comes from. */
export type PlaybackSurface = 'video' | 'voice';

type Phase = 'waiting' | 'stalled' | 'error' | 'play_rejected' | 'recovered' | 'retry' | 'summary';

/** Waiting / stalled episodes logged per source; later ones are only counted. */
const MAX_LOGGED_EPISODES = 3;

/** Per-source counters behind the `summary` breadcrumb. */
interface SourceStats {
    /** Waiting / stalled episodes seen. */
    episodes: number;
    /** `play()` calls superseded (`AbortError`). */
    aborted: number;
    /** `play()` promises not yet settled. */
    pending: number;
    /** The source has changed or the player unmounted. */
    closed: boolean;
}

const newStats = (): SourceStats => ({ episodes: 0, aborted: 0, pending: 0, closed: false });

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
 *   source are logged.
 * - `pause` ends the spinner and closes an open waiting / stalled episode (a
 *   stall on a paused element is logged with `outcome: paused` and closed at
 *   once), so a later real `waiting` while playing is logged as a new episode.
 * - `emptied` (source released or reloaded) → `ready` unless an error is
 *   showing.
 * - `retry()` logs `retry`; a repeat failure logs `error` again.
 *
 * `play()` starts playback and logs a rejected promise as `play_rejected`
 * (with the exception name as `error_type`) instead of swallowing it; an
 * `AbortError` (the play was superseded by a release or navigation) is not a
 * failure and is only counted.
 * `retry()` reloads the element at the same position and plays.
 *
 * When the source changes or the player unmounts, one `summary` logs the
 * source's waiting / stalled episode `count` and its superseded plays
 * (`aborted`), if more episodes happened than were logged or any play was
 * superseded. It waits for the source's pending `play()` promises to settle,
 * so a play aborted by the release itself is counted.
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
    // This source's counters, and whether the open episode is over the log cap.
    const statsRef = useRef<SourceStats>(newStats());
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

    const flushSummary = useCallback((stats: SourceStats) => {
        if (stats.episodes > MAX_LOGGED_EPISODES || stats.aborted > 0) {
            log('summary', { count: stats.episodes, aborted: stats.aborted });
        }
    }, [log]);

    // A new source starts clean; the old one gets one summary once its plays have settled.
    useEffect(() => {
        const stats = newStats();
        statsRef.current = stats;
        episodeRef.current = null;
        suppressedRef.current = false;
        setStatus('ready');
        return () => {
            stats.closed = true;
            if (stats.pending === 0) flushSummary(stats);
        };
    }, [src, flushSummary]);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const startEpisode = (kind: 'waiting' | 'stalled' | 'error', extra?: Record<string, string | number>) => {
            if (episodeRef.current === null) {
                const stats = statsRef.current;
                episodeRef.current = kind;
                stats.episodes += 1;
                suppressedRef.current = stats.episodes > MAX_LOGGED_EPISODES;
                if (!suppressedRef.current) log(kind, extra);
            }
        };
        const closeBufferingEpisode = () => {
            if (episodeRef.current === 'waiting' || episodeRef.current === 'stalled') {
                episodeRef.current = null;
                suppressedRef.current = false;
            }
        };
        const onWaiting = () => {
            startEpisode('waiting');
            setStatus((s) => (s === 'error' ? s : 'buffering'));
        };
        const onStalled = () => {
            const starved = !el.paused && el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
            startEpisode('stalled', { outcome: el.paused ? 'paused' : starved ? 'buffering' : 'buffered' });
            // Nothing is waiting on a paused element: logged, but not left open to hide a later `waiting`.
            if (el.paused) closeBufferingEpisode();
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
        // Paused while buffering: nothing to wait for any more, so the episode ends too.
        const onPause = () => {
            closeBufferingEpisode();
            setStatus((s) => (s === 'buffering' ? 'ready' : s));
        };
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
        // The source this play belongs to, even if the promise settles after a switch.
        const stats = statsRef.current;
        const report = (err: unknown) => {
            if ((err as { name?: unknown } | null)?.name === 'AbortError') {
                // Superseded by a release / navigation: expected, counted in the summary.
                stats.aborted += 1;
                return;
            }
            log('play_rejected', { error_type: breadcrumbCode(err) });
        };
        let pending: Promise<void>;
        try {
            pending = Promise.resolve(el.play());
        } catch (err) {
            report(err);
            return;
        }
        stats.pending += 1;
        pending.catch(report).finally(() => {
            stats.pending -= 1;
            if (stats.closed && stats.pending === 0) flushSummary(stats);
        });
    }, [ref, log, flushSummary]);

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
