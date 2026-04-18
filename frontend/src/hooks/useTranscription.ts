import { useState, useEffect, useCallback } from 'react';

export interface TranscriptionSegment {
    start: number;
    end: number;
    text: string;
    confidence: number;
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
    trigger: () => Promise<void>;
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
    const [transcription, setTranscription] = useState<Transcription | null>(null);
    const [state, setState] = useState<TranscriptionState>('idle');
    const [error, setError] = useState<string | null>(null);

    // Fetch cached transcription on mount
    useEffect(() => {
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

    // Trigger on-demand transcription
    const trigger = useCallback(async () => {
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
                throw new Error('Transcription returned not ok');
            }
        } catch (e) {
            setState('error');
            setError(e instanceof Error ? e.message : 'Transcription failed');
        }
    }, [service, messageId, memberPath]);

    return { transcription, state, trigger, error };
}
