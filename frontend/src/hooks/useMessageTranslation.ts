import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from '../i18n';
import { aiErrorKey } from '../i18n/aiError';
import { persisted } from '../core/persistence/persisted';
import * as api from '../core/persistence/appStateApi';

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

// backend app-state cache key format: translation:{type}:{id}:{lang}
function getCacheKey(
    type: 'message',
    contentId: string | number,
    targetLanguage: string,
): string {
    return `translation:${type}:${contentId}:${targetLanguage}`;
}

/**
 * Hook for translating a single message.
 * Manages the backend translation cache (app-state `translation_cache`) and API calls.
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
    const { t } = useTranslation();

    const cacheKey = messageId
        ? getCacheKey('message', messageId, targetLanguage)
        : '';

    // The backend cache read is async, so we can't populate these synchronously
    // at mount like the old localStorage version did. Start empty/idle and let
    // the effect below fetch the cached value (a brief original->translated
    // flash for already-cached messages is acceptable).
    const [translation, setTranslation] = useState<string | null>(null);
    const [state, setState] = useState<TranslationState>('idle');
    const [error, setError] = useState<string | null>(null);

    // Re-sync state when cacheKey changes (e.g., target language or provider changed)
    useEffect(() => {
        let cancelled = false;
        setTranslation(null);
        setState('idle');
        setError(null);
        if (cacheKey) {
            persisted.getTranslations([cacheKey]).then((m) => {
                if (!cancelled && m[cacheKey]) {
                    setTranslation(m[cacheKey]);
                    setState('done');
                }
            }).catch(() => {/* stay idle; trigger() will fall back to the API */});
        }
        return () => { cancelled = true; };
    }, [cacheKey]);

    // Shared fetch+persist path for both trigger (cache-miss) and retrigger (forced).
    const doTranslate = useCallback(async () => {
        if (!service || !messageId || !memberPath) return;

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

            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                const err = new Error(body.detail || `Request failed: ${res.status}`);
                (err as Error & { code?: string }).code = body.code;
                throw err;
            }

            const data = await res.json();
            if (data.ok) {
                setTranslation(data.translation);
                setState('done');
                persisted.putTranslations({ [cacheKey]: data.translation }).catch(() => {});
            } else {
                throw new Error('Translation returned not ok');
            }
        } catch (e) {
            setState('error');
            // Localized, actionable message keyed off the backend error code.
            setError(t(aiErrorKey((e as Error & { code?: string })?.code)));
        }
    }, [service, messageId, memberPath, targetLanguage, contextMessageIds, userNickname, cacheKey, t]);

    const trigger = useCallback(async () => {
        if (!service || !messageId || !memberPath) return;
        const cachedMap = await persisted.getTranslations([cacheKey]);
        if (cachedMap[cacheKey]) {
            setTranslation(cachedMap[cacheKey]);
            setState('done');
            return;
        }
        await doTranslate();
    }, [service, messageId, memberPath, cacheKey, doTranslate]);

    const retrigger = useCallback(async () => {
        // No single-key delete endpoint; doTranslate() below overwrites the
        // cache entry once the fresh translation comes back, so there's
        // nothing to explicitly clear first — just reset local state.
        setTranslation(null);
        await doTranslate();
    }, [doTranslate]);

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

    const keysById = new Map<number, string>(
        messageIds.map((id) => [id, getCacheKey('message', id, targetLanguage)])
    );
    const cachedMap = await persisted.getTranslations(Array.from(keysById.values()));

    for (const id of messageIds) {
        const key = keysById.get(id)!;
        if (cachedMap[key]) {
            results[String(id)] = cachedMap[key];
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
    if (data.ok && data.translations) {
        const newItems: Record<string, string> = {};
        for (const [id, text] of Object.entries(data.translations)) {
            results[id] = text as string;
            const key = getCacheKey('message', id, targetLanguage);
            newItems[key] = text as string;
        }
        persisted.putTranslations(newItems).catch(() => {});
    }

    return results;
}

/**
 * Clear all translation cache entries from the backend translation cache.
 */
export async function clearTranslationCache(): Promise<void> {
    await api.clearTranslations();
}
