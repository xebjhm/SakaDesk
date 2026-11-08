import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { clientLog } from '../../utils/clientLog';

/** What the player shows over its controls. */
export type PlaybackStatus = 'ready' | 'buffering' | 'error';

/** Which player the breadcrumb comes from. */
export type PlaybackSurface = 'video' | 'voice';

type Phase = 'waiting' | 'stalled' | 'error' | 'play_rejected' | 'recovered' | 'retry';

/** A DOMException name as a log code: `NotAllowedError` → `notallowederror`. */
function errorCode(err: unknown): string {
    const name = err instanceof Error || err instanceof DOMException ? err.name : 'unknown';
    return name.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'unknown';
}

/**
 * Buffering / error state for an `<audio>` or `<video>` element, with
 * structured `media_playback` breadcrumbs (phase, surface, `readyState`,
 * `networkState`, `MediaError.code`; never the URL).
 *
 * - `waiting` → `buffering`; `stalled` → `buffering` only while playing (a
 *   paused element that stops fetching is not something to spin for).
 * - `error` → `error` (the player shows a Retry).
 * - `canplay` / `playing` → `ready`; after a waiting / stalled / error episode
 *   this logs `recovered` with the episode as `reason`. Each episode logs its
 *   first event only, so a long stall does not flood the log.
 * - `emptied` (source released or reloaded) → `ready`; `pause` ends the
 *   spinner (but not the episode).
 * - `retry()` logs `retry`; a repeat failure logs `error` again.
 *
 * `play()` starts playback and logs a rejected promise as `play_rejected`
 * (with the exception name as `error_type`) instead of swallowing it.
 * `retry()` reloads the element at the same position and plays.
 */
export function useMediaPlayback(
    ref: RefObject<HTMLMediaElement | null>,
    surface: PlaybackSurface,
    src: string | undefined,
) {
    const [status, setStatus] = useState<PlaybackStatus>('ready');
    // The open trouble episode: what started it, or `retry` after the user retried.
    const episodeRef = useRef<'waiting' | 'stalled' | 'error' | 'retry' | null>(null);

    const log = useCallback((phase: Phase, extra: Record<string, string> = {}) => {
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

    // A new source starts clean.
    useEffect(() => {
        episodeRef.current = null;
        setStatus('ready');
    }, [src]);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const startEpisode = (kind: 'waiting' | 'stalled' | 'error', extra?: Record<string, string>) => {
            if (episodeRef.current === null) {
                episodeRef.current = kind;
                log(kind, extra);
            }
        };
        const onWaiting = () => {
            startEpisode('waiting');
            setStatus((s) => (s === 'error' ? s : 'buffering'));
        };
        const onStalled = () => {
            startEpisode('stalled', { outcome: el.paused ? 'paused' : 'buffering' });
            if (!el.paused) setStatus((s) => (s === 'error' ? s : 'buffering'));
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
                log('recovered', { reason: episodeRef.current });
                episodeRef.current = null;
            }
            setStatus('ready');
        };
        const onEmptied = () => setStatus('ready');
        // Paused while buffering: nothing to wait for any more (the episode stays open).
        const onPause = () => setStatus((s) => (s === 'buffering' ? 'ready' : s));
        el.addEventListener('waiting', onWaiting);
        el.addEventListener('stalled', onStalled);
        el.addEventListener('error', onError);
        el.addEventListener('canplay', onReady);
        el.addEventListener('playing', onReady);
        el.addEventListener('emptied', onEmptied);
        el.addEventListener('pause', onPause);
        return () => {
            el.removeEventListener('waiting', onWaiting);
            el.removeEventListener('stalled', onStalled);
            el.removeEventListener('error', onError);
            el.removeEventListener('canplay', onReady);
            el.removeEventListener('playing', onReady);
            el.removeEventListener('emptied', onEmptied);
            el.removeEventListener('pause', onPause);
        };
    }, [ref, log]);

    const play = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        const report = (err: unknown) => log('play_rejected', { error_type: errorCode(err) });
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
