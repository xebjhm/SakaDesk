import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { MemoriesFetchError } from '../api';
import { logMemoriesLoad, type MemoriesView } from '../memoriesLog';

export type MemoriesQueryStatus = 'loading' | 'ready' | 'error';

export interface MemoriesQuery<T> {
    status: MemoriesQueryStatus;
    /** The last loaded payload; null while loading or after an error. */
    data: T | null;
    /** Load again (after an error). */
    retry: () => void;
}

/** The length of the payload's first top-level array (`members`, `items`, `months`, ...), if any. */
function topLevelCount(data: unknown): number | undefined {
    if (Array.isArray(data)) return data.length;
    if (data && typeof data === 'object') {
        for (const value of Object.values(data)) if (Array.isArray(value)) return value.length;
    }
    return undefined;
}

/**
 * Load one Memories view. `load` gets a fresh `AbortSignal` per run; a change of `deps`, a
 * `retry` or an unmount aborts the run in flight, and an aborted run never touches state or
 * logs. Every finished run logs `memories_load` (`target`, `outcome`, `count` = the top-level
 * list length when the payload has one, `error_code` = the HTTP status of a rejected request).
 * `load` is read through a ref: only `deps` and `retry` start a new run.
 */
export function useMemoriesQuery<T>(
    target: MemoriesView,
    load: (signal: AbortSignal) => Promise<T>,
    deps: DependencyList,
): MemoriesQuery<T> {
    const loadRef = useRef(load);
    loadRef.current = load;
    const [attempt, setAttempt] = useState(0);
    // Results are tagged with their run, so a newer run reads as loading until it finishes.
    const [state, setState] = useState<{ run: number; status: MemoriesQueryStatus; data: T | null }>({
        run: -1, status: 'loading', data: null,
    });
    const runRef = useRef(0);
    const [run, setRun] = useState(0);

    useEffect(() => {
        const id = ++runRef.current;
        setRun(id);
        const controller = new AbortController();
        loadRef.current(controller.signal).then(
            (data) => {
                if (controller.signal.aborted) return;
                const count = topLevelCount(data);
                logMemoriesLoad(target, 'ok', count === undefined ? {} : { count });
                setState({ run: id, status: 'ready', data });
            },
            (err: unknown) => {
                if (controller.signal.aborted) return;
                logMemoriesLoad(target, 'error', err instanceof MemoriesFetchError ? { error_code: err.httpStatus } : {});
                setState({ run: id, status: 'error', data: null });
            },
        );
        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller's deps decide when to reload
    }, [target, attempt, ...deps]);

    const retry = useCallback(() => setAttempt((n) => n + 1), []);
    const current = state.run === run && state.run === runRef.current;
    return current ? { status: state.status, data: state.data, retry } : { status: 'loading', data: null, retry };
}
