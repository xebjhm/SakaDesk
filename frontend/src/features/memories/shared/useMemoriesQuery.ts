import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { settleDelay } from '../../../design/loading';
import { MemoriesFetchError, MemoriesTimeoutError } from '../api';
import { logMemoriesLoad, type MemoriesView } from '../memoriesLog';

export type MemoriesQueryStatus = 'loading' | 'ready' | 'error';
/** Why a load failed: `timeout` (no answer within `MEMORIES_TIMEOUT_MS`) or any other `error`. */
export type MemoriesQueryFailure = 'timeout' | 'error';

export interface MemoriesQuery<T> {
    status: MemoriesQueryStatus;
    /**
     * The payload of the current deps; null while loading or after an error. With `keepPrevious`,
     * while loading it is the previous payload of the same scope (`stale: true`).
     */
    data: T | null;
    /** Why the load failed (`status: 'error'`); null otherwise. */
    failure: MemoriesQueryFailure | null;
    /** True while `data` is the kept payload of the previous deps (`keepPrevious`). */
    stale: boolean;
    /** True while a quiet `refreshWhile` reload is scheduled or in flight (the cap not yet reached). */
    polling: boolean;
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
    /**
     * Keep the last ready payload on screen while the next deps load, when it was loaded under an
     * equal `scope` (`Object.is`; arrays compare element-wise, so `[service, member]` is fine) and
     * is not empty (`isEmpty`, e.g. no months: an empty view under the next selection would read
     * as its final answer). The query then reads `loading` with that payload and `stale: true`; a
     * different scope, an empty payload or the first load reads null data. A failed (non-quiet)
     * run forgets the kept payload, so neither its error nor the Retry after it brings back older
     * content.
     */
    keepPrevious?: { scope: unknown; isEmpty?: (data: T) => boolean };
    /**
     * Hold a visible result for `settleDelay` (default true). False commits on arrival, for loads
     * that must not wait out the hold: the album's month grids (the commit frees one of the
     * `MAX_IN_FLIGHT` fetch slots, D4; the band holds its skeleton on screen itself) and its months
     * list (it gates the first band's fetch, so the hold would add to the album's open time).
     */
    settle?: boolean;
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

/** `keepPrevious` scope equality: `Object.is`, element-wise for two arrays. */
const sameScope = (a: unknown, b: unknown) =>
    Array.isArray(a) && Array.isArray(b) ? sameKey(a, b) : Object.is(a, b);

interface QueryState<T> {
    key: unknown[];
    status: MemoriesQueryStatus;
    data: T | null;
    failure: MemoriesQueryFailure | null;
    polling: boolean;
}

/**
 * Load one Memories view. `load` gets a fresh `AbortSignal` per run; a change of `deps`, a
 * `retry` or an unmount aborts the run in flight, and an aborted run never touches state or
 * logs. A result is kept with the key (`target`, attempt, `deps`) it was loaded for, so on
 * the very render where the deps change the hook already reads `loading`, never the previous
 * deps' data as ready (with `keepPrevious` it reads `loading` with the previous non-empty
 * payload of the scope, `stale: true`; a failed run forgets it).
 * Every finished run logs `memories_load`: `outcome` `ok` with `count` (the `count` option, else
 * the first top-level list length), `timeout` (the API gave up, see `MEMORIES_TIMEOUT_MS`; the
 * query reads `failure: 'timeout'`) or `error` with `error_code` (the HTTP status of a rejected
 * request; `failure: 'error'`).
 * A run that settles `e` ms after it started commits after `settleDelay(e)`, so a loading
 * indicator revealed at `motion.loading.reveal` stays at least `minVisible`; quiet reloads and
 * `settle: false` queries commit at once. `load`, `count`, `refreshWhile`, `settle` and the
 * `keepPrevious` scope are read through refs (`isEmpty` at render): only `deps`, `retry` and
 * `enabled` start a new run. `refreshWhile` reloads the same key quietly (see the option);
 * `polling` is true while such a reload is scheduled or in flight.
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
    const keep = options.keepPrevious;
    const scopeRef = useRef<unknown>(keep?.scope);
    scopeRef.current = keep?.scope;
    const settleRef = useRef(options.settle ?? true);
    settleRef.current = options.settle ?? true;
    const [attempt, setAttempt] = useState(0);
    const enabled = options.enabled ?? true;
    const key: unknown[] = [target, attempt, enabled, ...deps];
    const [state, setState] = useState<QueryState<T> | null>(null);
    // The last ready payload and the scope it was loaded under (for `keepPrevious`).
    const lastReady = useRef<{ scope: unknown; data: T } | null>(null);

    useEffect(() => {
        if (!enabled) return undefined;
        const runKey = key;
        const runScope = scopeRef.current;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let settle: ReturnType<typeof setTimeout> | undefined;
        let reloads = 0;
        const run = (quiet: boolean) => {
            const startedAt = performance.now();
            // Hold a visible (non-quiet) result so a shown indicator stays `minVisible`.
            const commit = (apply: () => void) => {
                const delay = quiet || !settleRef.current ? 0 : settleDelay(performance.now() - startedAt);
                if (delay <= 0) apply();
                else settle = setTimeout(() => { if (!controller.signal.aborted) apply(); }, delay);
            };
            loadRef.current(controller.signal).then(
                (data) => {
                    if (controller.signal.aborted) return;
                    const count = countRef.current ? countRef.current(data) : topLevelCount(data);
                    logMemoriesLoad(target, 'ok', count === undefined ? {} : { count });
                    const again = Boolean(refreshRef.current?.(data)) && reloads < REFRESH_WHILE_MAX;
                    commit(() => {
                        lastReady.current = { scope: runScope, data };
                        setState({ key: runKey, status: 'ready', data, failure: null, polling: again });
                        if (again) {
                            reloads += 1;
                            timer = setTimeout(() => run(true), REFRESH_WHILE_MS);
                        }
                    });
                },
                (err: unknown) => {
                    if (controller.signal.aborted) return;
                    const timedOut = err instanceof MemoriesTimeoutError;
                    if (timedOut) logMemoriesLoad(target, 'timeout');
                    else logMemoriesLoad(target, 'error', err instanceof MemoriesFetchError ? { error_code: err.httpStatus } : {});
                    // A failed quiet reload keeps the payload on screen (and ends the polling).
                    if (quiet) {
                        setState((prev) => (prev && prev.polling ? { ...prev, polling: false } : prev));
                        return;
                    }
                    commit(() => {
                        // Its Retry must not resurface an older payload under this selection.
                        lastReady.current = null;
                        setState({ key: runKey, status: 'error', data: null, failure: timedOut ? 'timeout' : 'error', polling: false });
                    });
                },
            );
        };
        run(false);
        return () => {
            controller.abort();
            if (timer !== undefined) clearTimeout(timer);
            if (settle !== undefined) clearTimeout(settle);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is target + attempt + the caller's deps
    }, key);

    const retry = useCallback(() => setAttempt((n) => n + 1), []);
    if (!enabled) return { status: 'ready', data: null, failure: null, stale: false, polling: false, retry };
    if (state && sameKey(state.key, key)) {
        return { status: state.status, data: state.data, failure: state.failure, stale: false, polling: state.polling, retry };
    }
    const last = lastReady.current;
    const kept = keep && last && sameScope(last.scope, keep.scope) && !keep.isEmpty?.(last.data) ? last.data : null;
    return { status: 'loading', data: kept, failure: null, stale: kept !== null, polling: false, retry };
}
