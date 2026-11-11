import { fetchAlbumMonth, MemoriesFetchError, MemoriesTimeoutError } from '../api';
import { logMemoriesLoad, logMemoriesSkip } from '../memoriesLog';
import type { AlbumKind, AlbumMonthPayload } from '../types';

/**
 * The album's newest-month prefetch (D-M3). An album open used to chain its two slowest requests:
 * the months list first, then the top band's grid once the list named its month. The newest month
 * each scope (service, person, filter) showed is remembered for the session, and the next open of
 * that scope asks for its grid at once, beside the months list. When the list arrives and names
 * the same newest month, the top band takes the prefetched answer instead of starting its own
 * request; when it names another month (new photos after a sync), the prefetch is dropped. Both
 * requests are fresh (sent at the open), so nothing older than the open is ever shown.
 *
 * Breadcrumbs (codes and counts only): `memories_load` `album_prefetch` (`ok` with `count`,
 * `timeout`, or `error` with the HTTP status) when a prefetch settles; `memories_skip`
 * `album_prefetch` `prefetch_none` (nothing remembered for the scope: the first open) or
 * `prefetch_unused` (the list named another month, or the page left before the band took it).
 */

interface Pending {
    month: string;
    promise: Promise<AlbumMonthPayload>;
    controller: AbortController;
}

/** The newest month each scope showed last (this session, in memory). */
const newest = new Map<string, string>();
/** The prefetch in flight (or settled, not yet taken) per scope. */
const pending = new Map<string, Pending>();

const scopeOf = (service: string, member: string | undefined, kind: AlbumKind) =>
    JSON.stringify([service, member ?? null, kind]);

function drop(scope: string): void {
    const entry = pending.get(scope);
    if (!entry) return;
    pending.delete(scope);
    entry.controller.abort();
    logMemoriesSkip('album_prefetch', 'prefetch_unused');
}

/**
 * Start fetching the scope's remembered newest month (nothing remembered: logs `prefetch_none`).
 * Returns the cancel for the page's cleanup: it aborts the prefetch unless a band took it.
 */
export function prefetchNewestMonth(service: string, member: string | undefined, kind: AlbumKind): () => void {
    const scope = scopeOf(service, member, kind);
    drop(scope);
    const month = newest.get(scope);
    if (month === undefined) {
        logMemoriesSkip('album_prefetch', 'prefetch_none');
        return () => undefined;
    }
    const controller = new AbortController();
    const promise = fetchAlbumMonth(service, month, { member, kind }, controller.signal);
    const entry: Pending = { month, promise, controller };
    pending.set(scope, entry);
    promise.then(
        (data) => logMemoriesLoad('album_prefetch', 'ok', { count: data.items.length }),
        (err: unknown) => {
            if (controller.signal.aborted) return; // dropped: already logged as unused
            if (err instanceof MemoriesTimeoutError) logMemoriesLoad('album_prefetch', 'timeout');
            else logMemoriesLoad('album_prefetch', 'error', err instanceof MemoriesFetchError ? { error_code: err.httpStatus } : {});
        },
    );
    return () => {
        if (pending.get(scope) === entry) drop(scope);
    };
}

/**
 * The months list of the scope arrived: remember its newest month for the next open, and drop a
 * prefetch of another month (logged `prefetch_unused`).
 */
export function rememberNewestMonth(
    service: string, member: string | undefined, kind: AlbumKind, month: string | undefined,
): void {
    const scope = scopeOf(service, member, kind);
    if (month === undefined) newest.delete(scope);
    else newest.set(scope, month);
    const entry = pending.get(scope);
    if (entry && entry.month !== month) drop(scope);
}

/** The prefetched request for `month` of the scope, handed over once (the band owns it then); else null. */
export function takePrefetchedMonth(
    service: string, member: string | undefined, kind: AlbumKind, month: string,
): Promise<AlbumMonthPayload> | null {
    const scope = scopeOf(service, member, kind);
    const entry = pending.get(scope);
    if (!entry || entry.month !== month) return null;
    pending.delete(scope);
    return entry.promise;
}

/** Forget every remembered month and abort every prefetch (tests). */
export function resetAlbumPrefetch(): void {
    pending.forEach((entry) => entry.controller.abort());
    pending.clear();
    newest.clear();
}
