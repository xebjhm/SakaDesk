import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from '../i18n';
import { aiErrorKey } from '../i18n/aiError';
import { persisted } from '../core/persistence/persisted';
import * as api from '../core/persistence/appStateApi';
import { loadCachedTranslation, readCachedTranslation } from '../core/persistence/translationLoader';
import { useAppStore } from '../store/appStore';
import { clientLog } from '../utils/clientLog';
import { breadcrumbCode } from '../utils/breadcrumbCode';

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

/**
 * Backend app-state cache key: `translation:{type}:{service}:{id}:{lang}`. Message ids are unique
 * per service only, so the service is part of the key (Memories mixes groups in one list).
 */
export function getCacheKey(
    type: 'message',
    service: string,
    contentId: string | number,
    targetLanguage: string,
): string {
    return `translation:${type}:${service}:${contentId}:${targetLanguage}`;
}

/** The key used before the service was added (`translation:{type}:{id}:{lang}`), read as a fallback only. */
export function getLegacyCacheKey(type: 'message', contentId: string | number, targetLanguage: string): string {
    return `translation:${type}:${contentId}:${targetLanguage}`;
}

/**
 * Legacy keys already consulted this session (missed, or hit and re-saved under the new key):
 * never asked for again, so a remounting bubble costs one key, not two.
 */
const consultedLegacy = new Set<string>();

/** Test-only: forget which legacy keys were consulted. */
export function __resetLegacyTranslationKeysForTests(): void {
    consultedLegacy.clear();
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

    const cacheKey = messageId && service
        ? getCacheKey('message', service, messageId, targetLanguage)
        : '';
    // Translations cached before the key carried the service were made in the chat of the group
    // on screen, so only a message of the active group may reuse one (it is then re-saved under
    // the new key, logged `translation_legacy_reuse`; a failed re-save logs
    // `translation_legacy_resave_failed`); another group's message with the same id never does.
    const activeService = useAppStore((s) => s.activeService);
    const legacyKey = messageId && service && service === activeService
        ? getLegacyCacheKey('message', messageId, targetLanguage)
        : '';

    // The backend cache read is async, so we can't populate these synchronously
    // at mount like the old localStorage version did. Start empty/idle and let
    // the effect below fetch the cached value (a brief original->translated
    // flash for already-cached messages is acceptable).
    const [translation, setTranslation] = useState<string | null>(null);
    const [state, setState] = useState<TranslationState>('idle');
    const [error, setError] = useState<string | null>(null);

    // Bumped by retrigger/clear so a cached lookup that is still pending when
    // either runs cannot overwrite the newer state.
    const localGen = useRef(0);

    // Re-sync state when cacheKey changes (e.g., target language or provider changed)
    useEffect(() => {
        let cancelled = false;
        const gen = localGen.current;
        setTranslation(null);
        setState('idle');
        setError(null);
        if (cacheKey) {
            // The legacy key is consulted once per session, in the same batch as the new key (one
            // request), and its answer is used only when the new key misses.
            const askLegacy = Boolean(legacyKey) && !consultedLegacy.has(legacyKey);
            if (askLegacy) consultedLegacy.add(legacyKey);
            const legacyLookup = askLegacy ? loadCachedTranslation(legacyKey) : Promise.resolve(undefined);
            // A failed or unused legacy lookup may be asked again by a later mount.
            const releaseLegacy = () => { if (askLegacy) consultedLegacy.delete(legacyKey); };
            legacyLookup.catch(releaseLegacy);
            // Batched with the lookups of every other bubble mounting now.
            loadCachedTranslation(cacheKey).then(async (cached) => {
                let value = cached;
                let fromLegacy = false;
                if (!value && askLegacy) {
                    value = await legacyLookup;
                    fromLegacy = Boolean(value);
                }
                // Checked before the re-save, so a stale legacy value never overwrites a fresh one.
                if (cancelled || gen !== localGen.current) {
                    if (fromLegacy) releaseLegacy();
                    return;
                }
                if (!value) return;
                setTranslation(value);
                setState('done');
                if (fromLegacy) {
                    clientLog('translation_legacy_reuse', { count: 1 });
                    persisted.putTranslations({ [cacheKey]: value }).catch((err: unknown) => {
                        releaseLegacy();
                        clientLog('translation_legacy_resave_failed', { error_type: breadcrumbCode(err) });
                    });
                }
            }).catch(() => {/* stay idle; trigger() will fall back to the API */});
        }
        return () => { cancelled = true; };
    }, [cacheKey, legacyKey]);

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
        const cachedValue = await readCachedTranslation(cacheKey, 'trigger');
        if (cachedValue) {
            setTranslation(cachedValue);
            setState('done');
            return;
        }
        await doTranslate();
    }, [service, messageId, memberPath, cacheKey, doTranslate]);

    const retrigger = useCallback(async () => {
        // No single-key delete endpoint; doTranslate() below overwrites the
        // cache entry once the fresh translation comes back, so there's
        // nothing to explicitly clear first — just reset local state.
        localGen.current += 1;
        setTranslation(null);
        await doTranslate();
    }, [doTranslate]);

    const clear = useCallback(() => {
        localGen.current += 1;
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
        messageIds.map((id) => [id, getCacheKey('message', service, id, targetLanguage)])
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
            const key = getCacheKey('message', service, id, targetLanguage);
            newItems[key] = text as string;
        }
        persisted.putTranslations(newItems).catch(() => {});
    }

    return results;
}

/**
 * Clear all translation cache entries from the backend translation cache.
 */
/** Clears the stored translations; rejects when the backend refuses or is unreachable. */
export async function clearTranslationCache(): Promise<void> {
    await api.clearTranslations();
}
