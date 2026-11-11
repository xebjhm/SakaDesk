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
 * `prefetch_unused` (the list named another month, or the page left before the band took it);
 * `prefetch_reveal_held` (`MonthSection`: the top band held its skeleton reveal for the prefetch
 * past the normal reveal delay).
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

/**
 * The prefetched request for `month` of the scope, handed over once (the band owns it then); else
 * null. The band's `signal` then owns its cancellation: aborting it (the band unmounts, or its
 * scope changes) aborts the prefetch's request.
 */
export function takePrefetchedMonth(
    service: string, member: string | undefined, kind: AlbumKind, month: string, signal?: AbortSignal,
): Promise<AlbumMonthPayload> | null {
    const scope = scopeOf(service, member, kind);
    const entry = pending.get(scope);
    if (!entry || entry.month !== month) return null;
    pending.delete(scope);
    if (signal) {
        if (signal.aborted) entry.controller.abort();
        else signal.addEventListener('abort', () => entry.controller.abort(), { once: true });
    }
    return entry.promise;
}

/**
 * The prefetched request for `month` of the scope while no band has taken it yet (it stays
 * pending); else null. The top band reads it at its first render to hold its skeleton reveal, and
 * the album window to run that band's fetch alone (D-M3 warm open).
 */
export function peekPrefetchedMonth(
    service: string, member: string | undefined, kind: AlbumKind, month: string,
): Promise<AlbumMonthPayload> | null {
    const entry = pending.get(scopeOf(service, member, kind));
    return entry && entry.month === month ? entry.promise : null;
}

/** The newest month the scope showed last this session (a reopen prefetches it); else undefined. */
export function rememberedNewestMonth(service: string, member: string | undefined, kind: AlbumKind): string | undefined {
    return newest.get(scopeOf(service, member, kind));
}

/**
 * Resolves (never rejects) once the scope's prefetch in flight lands, fails or is dropped; null
 * when there is none. The page defers the requests its first band does not need until then.
 */
export function prefetchSettled(service: string, member: string | undefined, kind: AlbumKind): Promise<void> | null {
    const entry = pending.get(scopeOf(service, member, kind));
    return entry ? entry.promise.then(() => undefined, () => undefined) : null;
}

/** Forget every remembered month and abort every prefetch (tests). */
export function resetAlbumPrefetch(): void {
    pending.forEach((entry) => entry.controller.abort());
    pending.clear();
    newest.clear();
}
