import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from '../i18n';
import { aiErrorKey } from '../i18n/aiError';

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

        let cancelled = false;
        const fetchCached = async () => {
            try {
                // Pass member_path so the backend can load the cached transcript
                // directly instead of brute-force scanning every member directory.
                const query = memberPath ? `?member_path=${encodeURIComponent(memberPath)}` : '';
                const res = await fetch(
                    `/api/transcription/${encodeURIComponent(service)}/${messageId}${query}`
                );
                if (res.ok) {
                    const data = await res.json();
                    if (!cancelled && data.ok) {
                        setTranscription(data.transcription);
                        setState('done');
                    }
                }
                // 404 = not transcribed yet, stay in 'idle'
            } catch {
                // Network error — stay idle, don't show error
            }
        };

        fetchCached();
        return () => {
            cancelled = true;
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
