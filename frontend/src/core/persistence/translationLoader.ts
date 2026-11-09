/**
 * Batched read of the backend translation cache.
 *
 * Every mounted message bubble looks up its own cached translation. Chromium
 * (WebView2) allows six concurrent connections per host, so one request per
 * bubble starves media. `loadCachedTranslation` collects the keys requested
 * within `TRANSLATION_BATCH_WINDOW_MS` and answers them all from one
 * `GET /api/app-state/translations?keys=a,b,c` call (split into chunks of at
 * most `TRANSLATION_BATCH_MAX_KEYS`, the backend's limit). A key requested
 * while the same key is queued or in flight shares that lookup.
 *
 * A failed batch (network error or a non-2xx answer such as 422) rejects every caller waiting on it (they behave as the
 * single-key request did before) and logs one `translation_batch_failed`
 * breadcrumb with the key count and a code-like error type, never the keys.
 *
 * @module translationLoader
 */

import { clientLog } from '../../utils/clientLog';
import { breadcrumbCode } from '../../utils/breadcrumbCode';
import { persisted } from './persisted';
import { TRANSLATION_LOOKUP_MAX_KEYS } from './appStateApi';

export const TRANSLATION_BATCH_WINDOW_MS = 50;
export const TRANSLATION_BATCH_MAX_KEYS = TRANSLATION_LOOKUP_MAX_KEYS;

interface Waiter {
    resolve: (value: string | undefined) => void;
    reject: (reason: unknown) => void;
}

const lookups = new Map<string, Promise<string | undefined>>();
const waiters = new Map<string, Waiter>();
let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function fetchChunk(keys: string[]): Promise<void> {
    try {
        const found = await persisted.getTranslations(keys);
        for (const key of keys) waiters.get(key)?.resolve(found[key]);
    } catch (err) {
        clientLog('translation_batch_failed', { count: keys.length, error_type: breadcrumbCode(err) });
        for (const key of keys) waiters.get(key)?.reject(err);
    } finally {
        for (const key of keys) {
            waiters.delete(key);
            lookups.delete(key);
        }
    }
}

function flush(): void {
    timer = null;
    const keys = queue;
    queue = [];
    for (let i = 0; i < keys.length; i += TRANSLATION_BATCH_MAX_KEYS) {
        void fetchChunk(keys.slice(i, i + TRANSLATION_BATCH_MAX_KEYS));
    }
}

/** The cached translation for `key`, or `undefined` when not cached. Rejects when the batch lookup failed. */
export function loadCachedTranslation(key: string): Promise<string | undefined> {
    const existing = lookups.get(key);
    if (existing) return existing;
    const promise = new Promise<string | undefined>((resolve, reject) => {
        waiters.set(key, { resolve, reject });
    });
    lookups.set(key, promise);
    queue.push(key);
    if (timer === null) timer = setTimeout(flush, TRANSLATION_BATCH_WINDOW_MS);
    return promise;
}

/** Test-only: drop all queued and in-flight state and any pending timer. */
export function __resetTranslationLoaderForTests(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    queue = [];
    waiters.clear();
    lookups.clear();
}

/**
 * Cache read for a single user-initiated translation (`caller` names the call site).
 * A failed read is a cache miss: it logs `translation_batch_failed` and resolves
 * `undefined` so the caller goes on to the translate API.
 */
export async function readCachedTranslation(key: string, caller: 'trigger' | 'blog'): Promise<string | undefined> {
    try {
        return (await persisted.getTranslations([key]))[key];
    } catch (err) {
        clientLog('translation_batch_failed', { count: 1, error_type: breadcrumbCode(err), caller });
        return undefined;
    }
}
