import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from '../i18n';
import { aiErrorKey } from '../i18n/aiError';
import { clientLog } from '../utils/clientLog';

export interface TranscriptionSegment {
    start: number;
    end: number;
    text: string;
    confidence: number;
}

/** Index of the segment covering `currentTime`, or -1. Segments must be sorted by start. */
export function findActiveSegmentIndex(
    segments: TranscriptionSegment[],
    currentTime: number,
): number {
    return segments.findIndex(
        (seg, i) =>
            currentTime >= seg.start &&
            (i === segments.length - 1 || currentTime < segments[i + 1].start)
    );
}

export interface Transcription {
    message_id: number;
    media_type: string;
    language: string;
    model: string;
    created_at: string;
    duration_seconds: number;
    full_text: string;
    segments: TranscriptionSegment[];
    /** True when the media has no audible speech (empty transcript, not a failure). */
    no_speech?: boolean;
}

/**
 * The cached transcription of one message (`GET /api/transcription/{service}/{id}`), or null when
 * there is none (404, or a body without `ok`). Rejects on a network error, a non-404 failure
 * status or an abort. Pass `memberPath` so the backend loads the cached transcript directly
 * instead of scanning every member directory.
 */
export async function fetchCachedTranscription(
    service: string,
    messageId: number,
    memberPath: string | undefined,
    signal?: AbortSignal,
): Promise<Transcription | null> {
    const query = memberPath ? `?member_path=${encodeURIComponent(memberPath)}` : '';
    const res = await fetch(`/api/transcription/${encodeURIComponent(service)}/${messageId}${query}`, { signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`transcription request failed (${res.status})`);
    const data = await res.json();
    return data.ok ? (data.transcription as Transcription) : null;
}

type TranscriptionState = 'idle' | 'loading' | 'done' | 'error';

interface UseTranscriptionReturn {
    transcription: Transcription | null;
    state: TranscriptionState;
    /** Run transcription. Short-circuits on a cached result server-side. */
    trigger: () => Promise<void>;
    /** Force a fresh AI run, ignoring any cached result. */
    retrigger: () => Promise<void>;
    error: string | null;
}

/**
 * Hook for managing transcription state for a single message.
 * Fetches cached transcription on mount, provides trigger for on-demand.
 */
export function useTranscription(
    service: string | undefined,
    messageId: number | undefined,
    memberPath: string | undefined,
): UseTranscriptionReturn {
    const { t } = useTranslation();
    const [transcription, setTranscription] = useState<Transcription | null>(null);
    const [state, setState] = useState<TranscriptionState>('idle');
    const [error, setError] = useState<string | null>(null);
    // Aborts the in-flight transcribe POST when the target message changes or the
    // component unmounts, so a stale result can't be written under a new message.
    const abortRef = useRef<AbortController | null>(null);

    // Fetch cached transcription on mount, and reset state whenever the
    // target message changes so a previous message's transcription does
    // not momentarily appear under a newly-selected one.
    useEffect(() => {
        setTranscription(null);
        setState('idle');
        setError(null);
        if (!service || !messageId) return;

        // Aborted when the bubble scrolls away or the message changes: it must not hold one of the
        // six connections the media and the next lookups need.
        const controller = new AbortController();
        // 404 = not transcribed yet: stay idle. A failure stays idle too (no error shown) but leaves a
        // code-only breadcrumb; an abort is the normal way out and logs nothing.
        fetchCachedTranscription(service, messageId, memberPath, controller.signal).then(
            (cached) => {
                if (!controller.signal.aborted && cached) {
                    setTranscription(cached);
                    setState('done');
                }
            },
            () => {
                if (!controller.signal.aborted) clientLog('chat_load', { outcome: 'transcript_lookup_failed', message_id: messageId });
            },
        );
        return () => {
            controller.abort();
            // Cancel any in-flight transcribe POST for the message we're leaving.
            abortRef.current?.abort();
        };
    }, [service, messageId, memberPath]);

    const runTranscribe = useCallback(async (force: boolean) => {
        if (!service || !messageId || !memberPath) return;

        // Supersede any prior in-flight run and track this one so a message
        // change (effect cleanup) can abort it before it writes stale state.
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setState('loading');
        setError(null);

        try {
            const res = await fetch('/api/transcription/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message_id: messageId,
                    service,
                    member_path: memberPath,
                    force,
                }),
                signal: controller.signal,
            });

            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                const err = new Error(body.detail || `Request failed: ${res.status}`);
                (err as Error & { code?: string }).code = body.code;
                throw err;
            }

            const data = await res.json();
            if (controller.signal.aborted) return;  // message changed mid-flight
            if (data.ok) {
                setTranscription(data.transcription);
                setState('done');
            } else {
                throw new Error('Transcription returned not ok');
            }
        } catch (e) {
            // Aborted because the user navigated away — not a real failure.
            if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
            console.error('[Transcription] failed:', e);
            setState('error');
            // Localized, actionable message keyed off the backend error code.
            setError(t(aiErrorKey((e as Error & { code?: string })?.code)));
        }
    }, [service, messageId, memberPath, t]);

    const trigger = useCallback(() => runTranscribe(false), [runTranscribe]);
    const retrigger = useCallback(() => runTranscribe(true), [runTranscribe]);

    return { transcription, state, trigger, retrigger, error };
}
