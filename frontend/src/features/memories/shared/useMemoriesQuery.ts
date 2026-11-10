import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { MemoriesFetchError, MemoriesTimeoutError } from '../api';
import { logMemoriesLoad, type MemoriesView } from '../memoriesLog';

export type MemoriesQueryStatus = 'loading' | 'ready' | 'error';

export interface MemoriesQuery<T> {
    status: MemoriesQueryStatus;
    /** The payload of the current deps; null while loading or after an error. */
    data: T | null;
    /** Load again (after an error or a timeout). */
    retry: () => void;
}

export interface MemoriesQueryOptions<T> {
    /** The number logged as `count` (the view's main list); default: the first top-level array. */
    count?: (data: T) => number;
    /**
     * False skips the view (nothing to ask for, e.g. no date): no request, no log, and the query
     * reads `ready` with null data. Default true.
     */
    enabled?: boolean;
    /**
     * While this returns true for the loaded payload (e.g. the hub's `refreshing`), the view is
     * loaded again after `REFRESH_WHILE_MS`, quietly: the current data stays on screen (no
     * `loading`), a newer payload replaces it and a failed reload keeps it. At most
     * `REFRESH_WHILE_MAX` reloads per key.
     */
    refreshWhile?: (data: T) => boolean;
}

/** Delay between quiet reloads of `refreshWhile`. */
export const REFRESH_WHILE_MS = 5000;
/** Cap on quiet reloads per key, so a stuck flag never polls forever. */
export const REFRESH_WHILE_MAX = 24;

/** The length of the payload's first top-level array (`members`, `items`, `months`, ...), if any. */
function topLevelCount(data: unknown): number | undefined {
    if (Array.isArray(data)) return data.length;
    if (data && typeof data === 'object') {
        for (const value of Object.values(data)) if (Array.isArray(value)) return value.length;
    }
    return undefined;
}

const sameKey = (a: readonly unknown[], b: readonly unknown[]) =>
    a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/**
 * Load one Memories view. `load` gets a fresh `AbortSignal` per run; a change of `deps`, a
 * `retry` or an unmount aborts the run in flight, and an aborted run never touches state or
 * logs. A result is kept with the key (`target`, attempt, `deps`) it was loaded for, so on
 * the very render where the deps change the hook already reads `loading`, never the previous
 * deps' data. Every finished run logs `memories_load`: `outcome` `ok` with `count` (the
 * `count` option, else the first top-level list length), `timeout` (the API gave up, see
 * `MEMORIES_TIMEOUT_MS`) or `error` with `error_code` (the HTTP status of a rejected request).
 * `load`, `count` and `refreshWhile` are read through refs: only `deps`, `retry` and `enabled`
 * start a new run. `refreshWhile` reloads the same key quietly (see the option).
 * A disabled query (`enabled: false`) never loads or logs and reads `ready` with null data.
 */
export function useMemoriesQuery<T>(
    target: MemoriesView,
    load: (signal: AbortSignal) => Promise<T>,
    deps: DependencyList,
    options: MemoriesQueryOptions<T> = {},
): MemoriesQuery<T> {
    const loadRef = useRef(load);
    loadRef.current = load;
    const countRef = useRef(options.count);
    countRef.current = options.count;
    const refreshRef = useRef(options.refreshWhile);
    refreshRef.current = options.refreshWhile;
    const [attempt, setAttempt] = useState(0);
    const enabled = options.enabled ?? true;
    const key: unknown[] = [target, attempt, enabled, ...deps];
    const [state, setState] = useState<{ key: unknown[]; status: MemoriesQueryStatus; data: T | null } | null>(null);

    useEffect(() => {
        if (!enabled) return undefined;
        const runKey = key;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let reloads = 0;
        const run = (quiet: boolean) => {
            loadRef.current(controller.signal).then(
                (data) => {
                    if (controller.signal.aborted) return;
                    const count = countRef.current ? countRef.current(data) : topLevelCount(data);
                    logMemoriesLoad(target, 'ok', count === undefined ? {} : { count });
                    setState({ key: runKey, status: 'ready', data });
                    if (refreshRef.current?.(data) && reloads < REFRESH_WHILE_MAX) {
                        reloads += 1;
                        timer = setTimeout(() => run(true), REFRESH_WHILE_MS);
                    }
                },
                (err: unknown) => {
                    if (controller.signal.aborted) return;
                    if (err instanceof MemoriesTimeoutError) logMemoriesLoad(target, 'timeout');
                    else logMemoriesLoad(target, 'error', err instanceof MemoriesFetchError ? { error_code: err.httpStatus } : {});
                    // A failed quiet reload keeps the payload on screen.
                    if (!quiet) setState({ key: runKey, status: 'error', data: null });
                },
            );
        };
        run(false);
        return () => {
            controller.abort();
            if (timer !== undefined) clearTimeout(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is target + attempt + the caller's deps
    }, key);

    const retry = useCallback(() => setAttempt((n) => n + 1), []);
    if (!enabled) return { status: 'ready', data: null, retry };
    return state && sameKey(state.key, key)
        ? { status: state.status, data: state.data, retry }
        : { status: 'loading', data: null, retry };
}
