import { useState, useCallback, useEffect, useRef } from 'react';

type TranslationState = 'idle' | 'loading' | 'done' | 'error';

interface UseMessageTranslationReturn {
    translation: string | null;
    state: TranslationState;
    trigger: () => Promise<void>;
    /** Re-translate: clears cache and calls API fresh */
    retrigger: () => Promise<void>;
    error: string | null;
    clear: () => void;
}

// localStorage cache key format: translation:{type}:{id}:{lang}
function getCacheKey(
    type: 'message',
    contentId: string | number,
    targetLanguage: string,
): string {
    return `translation:${type}:${contentId}:${targetLanguage}`;
}

function getCachedTranslation(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function setCachedTranslation(key: string, translation: string): void {
    try {
        localStorage.setItem(key, translation);
    } catch {
        // localStorage full — silently ignore
    }
}

/**
 * Hook for translating a single message.
 * Manages localStorage cache and API calls.
 */
export function useMessageTranslation(params: {
    service: string | undefined;
    messageId: number | undefined;
    memberPath: string | undefined;
    targetLanguage: string;
    contextMessageIds?: number[];
    userNickname?: string;
}): UseMessageTranslationReturn {
    const { service, messageId, memberPath, targetLanguage, contextMessageIds, userNickname } = params;

    const cacheKey = messageId
        ? getCacheKey('message', messageId, targetLanguage)
        : '';

    // Lazy init from cache so we don't do a blocking localStorage read on every render.
    const [translation, setTranslation] = useState<string | null>(
        () => (cacheKey ? getCachedTranslation(cacheKey) : null)
    );
    const [state, setState] = useState<TranslationState>(
        () => ((cacheKey ? getCachedTranslation(cacheKey) : null) ? 'done' : 'idle')
    );
    const [error, setError] = useState<string | null>(null);

    // Track the cacheKey (target language) of the latest request so an in-flight
    // response for a previous language can't overwrite state after the reset
    // effect cleared it (which would show a wrong-language translation and lock
    // the button at 'done'). Updated synchronously at request start and on reset.
    const activeCacheKeyRef = useRef<string>(cacheKey);

    // Re-sync state when cacheKey changes (e.g., target language or provider changed)
    useEffect(() => {
        // Mark the new key as active so any request still in flight for the
        // previous key is treated as stale and won't overwrite this state.
        activeCacheKeyRef.current = cacheKey;
        const cachedValue = cacheKey ? getCachedTranslation(cacheKey) : null;
        setTranslation(cachedValue);
        setState(cachedValue ? 'done' : 'idle');
        setError(null);
    }, [cacheKey]);

    // Shared fetch+persist path for both trigger (cache-miss) and retrigger (forced).
    const doTranslate = useCallback(async () => {
        if (!service || !messageId || !memberPath) return;

        const requestCacheKey = cacheKey;
        activeCacheKeyRef.current = requestCacheKey;

        setState('loading');
        setError(null);
        try {
            const res = await fetch('/api/translation/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'message',
                    message_id: messageId,
                    service,
                    member_path: memberPath,
                    context_message_ids: contextMessageIds,
                    target_language: targetLanguage,
                    user_nickname: userNickname || undefined,
                }),
            });

            // Bail if the target language changed while this request was in flight —
            // its result is for a stale cacheKey and must not touch current state.
            if (activeCacheKeyRef.current !== requestCacheKey) return;

            if (!res.ok) {
                const detail = await res.json().catch(() => ({}));
                throw new Error(detail.detail || `Request failed: ${res.status}`);
            }

            const data = await res.json();
            if (activeCacheKeyRef.current !== requestCacheKey) return; // stale
            if (data.ok) {
                setTranslation(data.translation);
                setState('done');
                setCachedTranslation(requestCacheKey, data.translation);
            } else {
                throw new Error('Translation returned not ok');
            }
        } catch (e) {
            if (activeCacheKeyRef.current !== requestCacheKey) return; // stale — don't surface
            setState('error');
            setError(e instanceof Error ? e.message : 'Translation failed');
        }
    }, [service, messageId, memberPath, targetLanguage, contextMessageIds, userNickname, cacheKey]);

    const trigger = useCallback(async () => {
        if (!service || !messageId || !memberPath) return;
        const cachedValue = getCachedTranslation(cacheKey);
        if (cachedValue) {
            setTranslation(cachedValue);
            setState('done');
            return;
        }
        await doTranslate();
    }, [service, messageId, memberPath, cacheKey, doTranslate]);

    const retrigger = useCallback(async () => {
        // Clear cache first so the forced re-run doesn't short-circuit.
        if (cacheKey) {
            try { localStorage.removeItem(cacheKey); } catch {}
        }
        setTranslation(null);
        await doTranslate();
    }, [cacheKey, doTranslate]);

    const clear = useCallback(() => {
        setTranslation(null);
        setState('idle');
        setError(null);
    }, []);

    return { translation, state, trigger, retrigger, error, clear };
}

/**
 * Batch translate multiple messages. Returns translations keyed by message ID.
 */
export async function translateBatch(params: {
    messageIds: number[];
    service: string;
    memberPath: string;
    targetLanguage: string;
}): Promise<Record<string, string>> {
    const { messageIds, service, memberPath, targetLanguage } = params;

    const uncachedIds: number[] = [];
    const results: Record<string, string> = {};

    for (const id of messageIds) {
        const key = getCacheKey('message', id, targetLanguage);
        const cached = getCachedTranslation(key);
        if (cached) {
            results[String(id)] = cached;
        } else {
            uncachedIds.push(id);
        }
    }

    if (uncachedIds.length === 0) return results;

    const res = await fetch('/api/translation/translate-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: 'messages',
            message_ids: uncachedIds,
            service,
            member_path: memberPath,
            target_language: targetLanguage,
        }),
    });

    if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail || `Batch translation failed: ${res.status}`);
    }

    const data = await res.json();
    // Match the single-message path: a { ok: false } payload is a failure, not
    // an empty success — throw so callers don't silently treat it as done.
    if (!data.ok) {
        throw new Error(data.error || 'Batch translation returned not ok');
    }
    if (data.translations) {
        for (const [id, text] of Object.entries(data.translations)) {
            results[id] = text as string;
            const key = getCacheKey('message', id, targetLanguage);
            setCachedTranslation(key, text as string);
        }
    }

    return results;
}

/**
 * Clear all translation cache entries from localStorage.
 */
export function clearTranslationCache(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('translation:')) {
            keysToRemove.push(key);
        }
    }
    for (const key of keysToRemove) {
        localStorage.removeItem(key);
    }
}
