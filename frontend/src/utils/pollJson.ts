/**
 * Shared fetch wrapper for periodic `/api/` polls.
 *
 * - `cache: 'no-store'`: concurrent requests to one cacheable URL queue behind
 *   the in-flight one in Chromium's HTTP cache lock (up to ~20 s).
 * - Never overlaps: a call whose `key` still has a request pending is skipped
 *   (not queued). Skips are counted and reported with the key's next completion.
 * - Aborts after `timeoutMs` and logs `poll_timeout`; an abort caused by the
 *   caller's `signal` (unmount) resolves `aborted` and logs nothing.
 *
 * The result is a value, never a throw, so callers decide what each outcome
 * means for their own state.
 *
 * @module pollJson
 */

import { useCallback, useEffect, useRef } from 'react';
import { clientLog } from './clientLog';

export const POLL_TIMEOUT_MS = 4000;

export type PollResult<T> =
    | { status: 'ok'; data: T }
    | { status: 'skipped' | 'timeout' | 'aborted' }
    | { status: 'rejected'; httpStatus: number }
    | { status: 'failed'; error: unknown };

export interface PollOptions {
    timeoutMs?: number;
    /** Aborted by the caller on unmount: resolves `aborted`, no breadcrumb. */
    signal?: AbortSignal;
    /** Extra fetch options (method, headers, body). `cache` and `signal` are fixed. */
    init?: Omit<RequestInit, 'cache' | 'signal'>;
}

const pending = new Set<string>();
const skippedCount = new Map<string, number>();

/** Breadcrumb field values must match [a-z0-9_]{1,40}. */
function logKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
}

function errorType(err: unknown): string {
    const name = err instanceof Error ? err.name : 'unknown';
    return name.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40) || 'unknown';
}

function reportSkips(key: string): void {
    const count = skippedCount.get(key);
    if (!count) return;
    skippedCount.delete(key);
    clientLog('poll_skipped', { key: logKey(key), count });
}

export async function pollJson<T>(key: string, url: string, options: PollOptions = {}): Promise<PollResult<T>> {
    const { timeoutMs = POLL_TIMEOUT_MS, signal, init } = options;
    if (signal?.aborted) return { status: 'aborted' };
    if (pending.has(key)) {
        skippedCount.set(key, (skippedCount.get(key) ?? 0) + 1);
        return { status: 'skipped' };
    }
    pending.add(key);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const onCallerAbort = () => controller.abort();
    signal?.addEventListener('abort', onCallerAbort);

    try {
        const res = await fetch(url, { ...init, cache: 'no-store', signal: controller.signal });
        if (!res.ok) {
            clientLog('poll_failed', { key: logKey(key), error_code: res.status });
            return { status: 'rejected', httpStatus: res.status };
        }
        return { status: 'ok', data: (await res.json()) as T };
    } catch (error) {
        if (timedOut) {
            clientLog('poll_timeout', { key: logKey(key), timeout_ms: timeoutMs });
            return { status: 'timeout' };
        }
        if (signal?.aborted) return { status: 'aborted' };
        clientLog('poll_failed', { key: logKey(key), error_type: errorType(error) });
        return { status: 'failed', error };
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onCallerAbort);
        pending.delete(key);
        reportSkips(key);
    }
}

/**
 * Returns a getter for an AbortSignal that aborts when the component unmounts.
 * (Re-armed on re-mount so React StrictMode's mount/unmount/mount works.)
 */
export function useUnmountSignal(): () => AbortSignal {
    const ref = useRef<AbortController | null>(null);
    useEffect(() => {
        if (!ref.current || ref.current.signal.aborted) ref.current = new AbortController();
        return () => { ref.current?.abort(); };
    }, []);
    return useCallback(() => {
        if (!ref.current) ref.current = new AbortController();
        return ref.current.signal;
    }, []);
}
