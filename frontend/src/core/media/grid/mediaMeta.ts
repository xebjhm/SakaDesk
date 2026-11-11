/**
 * The batched placeholder store of the media pipeline (0.5.0): each media tile's content version
 * `v`, mean colour, 16 px blur, size and video poster state, from `POST /api/media/meta`.
 *
 * - **Batched.** `useMediaMeta` and `primeMediaMeta` queue unknown URLs; a 16 ms timer sends them
 *   in batches of at most `META_BATCH_MAX` (the server allows 500). Queued and in-flight URLs are
 *   never asked twice.
 * - **Bounded.** Answers live in an LRU of `META_CACHE_MAX` entries. An entry a mounted tile is
 *   reading is never evicted (it would refetch at once).
 * - **Never blocks a tile.** A failed batch marks its URLs `null` for this session (tiles then load
 *   the plain thumbnail without `v`) and logs `media_grid` `reason=meta_failed` (with `count`) at
 *   most once a minute. Only media-route URLs (`/api/content/media/...`) are sent; any other URL
 *   (CDN, the blog image route) is `null` at once.
 *
 * Logs carry a code and a count only, never a URL.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { clientLog } from '../../../utils/clientLog';
import { MEDIA_API_BASE } from '../../../features/messages/mediaUrl';

export interface MediaMeta {
    kind: 'picture' | 'video';
    /** The file's content version (12 hex chars); `thumbnailUrl(url, w, v)` makes it cache for a year. */
    v: string;
    /** `#rrggbb` mean colour, `null` until the background worker has processed this version. */
    color: string | null;
    /** A `data:image/webp;base64,…` 16 px preview, `null` until processed. */
    blur: string | null;
    w: number | null;
    h: number | null;
    /** A video's poster frame is ready (the thumbnail route serves it). May be stale: a 404 still falls back. */
    poster: boolean;
}

/** URLs per `POST /api/media/meta` (the server allows 500). */
export const META_BATCH_MAX = 200;
/** Answers kept (LRU). */
export const META_CACHE_MAX = 20_000;
/** The queue flush delay: every tile mounted in one frame goes in one batch. */
export const META_FLUSH_MS = 16;
/** At most one `meta_failed` breadcrumb per this many ms. */
export const META_FAIL_LOG_MS = 60_000;

const ENDPOINT = '/api/media/meta';
const MEDIA_PREFIX = `${MEDIA_API_BASE}/`;

const cache = new Map<string, MediaMeta | null>();
const queued = new Set<string>();
const inflight = new Set<string>();
const listeners = new Map<string, Set<() => void>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastFailLog = Number.NEGATIVE_INFINITY;
let cacheMax = META_CACHE_MAX;

/** A media-route URL the meta endpoint can answer. */
export function isMediaRouteUrl(url: string | null | undefined): url is string {
    return typeof url === 'string' && url.startsWith(MEDIA_PREFIX) && url.length > MEDIA_PREFIX.length;
}

/** The current answer for `url`: an item, `null` (none / not a media URL), or `undefined` while unknown. */
export function readMediaMeta(url: string | null | undefined): MediaMeta | null | undefined {
    if (!isMediaRouteUrl(url)) return null;
    return cache.get(url);
}

function notify(url: string): void {
    listeners.get(url)?.forEach((fn) => fn());
}

function store(url: string, value: MediaMeta | null): void {
    cache.delete(url);
    cache.set(url, value);
    if (cache.size <= cacheMax) return;
    for (const key of cache.keys()) {
        if (cache.size <= cacheMax) break;
        if (listeners.has(key)) continue; // a mounted tile reads it
        cache.delete(key);
    }
}

function isMeta(value: unknown): value is MediaMeta {
    if (!value || typeof value !== 'object') return false;
    const m = value as Record<string, unknown>;
    return (m.kind === 'picture' || m.kind === 'video') && typeof m.v === 'string';
}

function normalise(value: unknown): MediaMeta | null {
    if (!isMeta(value)) return null;
    const m = value as unknown as Record<string, unknown>;
    return {
        kind: value.kind,
        v: value.v,
        color: typeof m.color === 'string' ? m.color : null,
        blur: typeof m.blur === 'string' ? m.blur : null,
        w: typeof m.w === 'number' ? m.w : null,
        h: typeof m.h === 'number' ? m.h : null,
        poster: m.poster === true,
    };
}

function logFailure(count: number): void {
    const now = Date.now();
    if (now - lastFailLog < META_FAIL_LOG_MS) return;
    lastFailLog = now;
    clientLog('media_grid', { reason: 'meta_failed', count });
}

async function send(batch: string[]): Promise<void> {
    let items: Record<string, unknown> | null = null;
    try {
        const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: batch }),
        });
        if (res.ok) {
            const body: unknown = await res.json();
            const raw = body && typeof body === 'object' ? (body as { items?: unknown }).items : undefined;
            if (raw && typeof raw === 'object') items = raw as Record<string, unknown>;
        }
    } catch {
        items = null;
    }
    if (items === null) logFailure(batch.length);
    for (const url of batch) {
        inflight.delete(url);
        store(url, items === null ? null : normalise(items[url]));
        notify(url);
    }
}

function flush(): void {
    flushTimer = null;
    const urls = [...queued];
    queued.clear();
    for (let i = 0; i < urls.length; i += META_BATCH_MAX) {
        const batch = urls.slice(i, i + META_BATCH_MAX);
        batch.forEach((u) => inflight.add(u));
        void send(batch);
    }
}

function enqueue(url: string | null | undefined): void {
    if (!isMediaRouteUrl(url)) return;
    if (cache.has(url)) {
        // Touch: a primed or read entry is recently used.
        const value = cache.get(url) as MediaMeta | null;
        cache.delete(url);
        cache.set(url, value);
        return;
    }
    if (queued.has(url) || inflight.has(url)) return;
    queued.add(url);
    flushTimer ??= setTimeout(flush, META_FLUSH_MS);
}

/** Queue the meta of `urls` (skipping known, queued and in-flight ones), e.g. for rows about to render. */
export function primeMediaMeta(urls: readonly (string | null | undefined)[]): void {
    urls.forEach(enqueue);
}

/** Drop the entry of `url` (e.g. after a poster upload); the next read refetches it. */
export function invalidateMediaMeta(url: string): void {
    if (!cache.delete(url)) return;
    notify(url);
}

function subscribeUrl(url: string, fn: () => void): () => void {
    let set = listeners.get(url);
    if (!set) {
        set = new Set();
        listeners.set(url, set);
    }
    set.add(fn);
    return () => {
        const current = listeners.get(url);
        if (!current) return;
        current.delete(fn);
        if (current.size === 0) listeners.delete(url);
    };
}

const NOOP_UNSUBSCRIBE = () => {};

/**
 * The meta of one media URL: the item, `null` (no item, a failed batch, or not a media-route
 * URL), or `undefined` while it loads. Unknown URLs are queued (and an invalidated one refetched).
 */
export function useMediaMeta(url: string | null | undefined): MediaMeta | null | undefined {
    const subscribe = useCallback(
        (fn: () => void) => (isMediaRouteUrl(url) ? subscribeUrl(url, fn) : NOOP_UNSUBSCRIBE),
        [url],
    );
    const getSnapshot = useCallback(() => readMediaMeta(url), [url]);
    const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    useEffect(() => {
        if (value === undefined) enqueue(url);
    }, [url, value]);
    return value;
}

/** Test hook: empty the store and its timers. */
export function resetMediaMetaForTests(): void {
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
    cache.clear();
    queued.clear();
    inflight.clear();
    listeners.clear();
    lastFailLog = Number.NEGATIVE_INFINITY;
    cacheMax = META_CACHE_MAX;
}

/** Test hook: a small LRU cap. */
export function setMetaCacheMaxForTests(max: number): void {
    cacheMax = max;
}
