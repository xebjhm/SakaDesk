import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../i18n';

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
                const res = await fetch(
                    `/api/transcription/${encodeURIComponent(service)}/${messageId}`
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
        return () => { cancelled = true; };
    }, [service, messageId]);

    const runTranscribe = useCallback(async (force: boolean) => {
        if (!service || !messageId || !memberPath) return;
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
            });

            if (!res.ok) {
                const detail = await res.json().catch(() => ({}));
                throw new Error(detail.detail || `Request failed: ${res.status}`);
            }

            const data = await res.json();
            if (data.ok) {
                setTranscription(data.transcription);
                setState('done');
            } else {
                throw new Error('Transcription returned not ok');  // internal; shown via t() below
            }
        } catch (e) {
            console.error('[Transcription] failed:', e);
            setState('error');
            setError(t('transcription.failed'));
        }
    }, [service, messageId, memberPath, t]);

    const trigger = useCallback(() => runTranscribe(false), [runTranscribe]);
    const retrigger = useCallback(() => runTranscribe(true), [runTranscribe]);

    return { transcription, state, trigger, retrigger, error };
}
