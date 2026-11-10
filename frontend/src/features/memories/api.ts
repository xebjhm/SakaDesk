/**
 * Typed client for the Memories core endpoints (`GET /api/memories/{service}/...`).
 *
 * One fetcher per endpoint. Each takes the caller's `AbortSignal` (`useMemoriesQuery` aborts
 * on change and unmount), percent-encodes every query value and resolves the parsed payload.
 * A non-2xx answer throws {@link MemoriesFetchError}; an abort rejects with the fetch's
 * `AbortError`. Logging is the caller's (`memories_load` in `useMemoriesQuery`).
 *
 * These are plain fetches, not `pollJson`: they are one-off loads, and a cache miss can take
 * a while to build, so they have no poll timeout and no skip-while-pending key.
 */
import type {
    AlbumColorsPayload, AlbumMembersPayload, AlbumMonthPayload, AlbumMonthsPayload, AlbumQuery,
    BinderPayload, DayPayload, DayQuery, FavoritesPayload, HubPayload, MemoirHeaderPayload,
    MemoirMembersPayload, NameMomentsPayload, OnThisDayPayload, TimelineMonthPayload, TimelineMonthsPayload,
} from './types';

/** A Memories request the backend answered with a non-2xx status. */
export class MemoriesFetchError extends Error {
    readonly httpStatus: number;

    constructor(httpStatus: number) {
        super(`memories request failed (${httpStatus})`);
        this.name = 'MemoriesFetchError';
        this.httpStatus = httpStatus;
    }
}

type Query = Record<string, string | number | boolean | undefined>;

function url(service: string, path: string, query: Query = {}): string {
    const params = Object.entries(query)
        .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
        .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`);
    const base = `/api/memories/${encodeURIComponent(service)}${path}`;
    return params.length ? `${base}?${params.join('&')}` : base;
}

async function getJson<T>(href: string, signal: AbortSignal): Promise<T> {
    const res = await fetch(href, { cache: 'no-store', signal });
    if (!res.ok) throw new MemoriesFetchError(res.status);
    return (await res.json()) as T;
}

/** A path segment (`YYYY-MM`), encoded like a query value. */
const seg = (value: string) => encodeURIComponent(value);

export function fetchHub(service: string, signal: AbortSignal): Promise<HubPayload> {
    return getJson(url(service, '/hub'), signal);
}

/** `monthDay` is `MM-DD`. */
export function fetchOnThisDay(service: string, monthDay: string, signal: AbortSignal): Promise<OnThisDayPayload> {
    return getJson(url(service, '/on-this-day', { date: monthDay }), signal);
}

export function fetchDay(service: string, query: DayQuery, signal: AbortSignal): Promise<DayPayload> {
    return getJson(url(service, '/day', {
        date: query.date, member: query.member, others: query.others ? true : undefined,
    }), signal);
}

export function fetchAlbumMembers(service: string, signal: AbortSignal): Promise<AlbumMembersPayload> {
    return getJson(url(service, '/album/members'), signal);
}

export function fetchAlbumMonths(service: string, query: AlbumQuery, signal: AbortSignal): Promise<AlbumMonthsPayload> {
    return getJson(url(service, '/album/months', { member: query.member, kind: query.kind }), signal);
}

/** `month` is `YYYY-MM`. */
export function fetchAlbumMonth(service: string, month: string, query: AlbumQuery, signal: AbortSignal): Promise<AlbumMonthPayload> {
    return getJson(url(service, `/album/month/${seg(month)}`, { member: query.member, kind: query.kind }), signal);
}

export function fetchAlbumColors(service: string, member: string | undefined, signal: AbortSignal): Promise<AlbumColorsPayload> {
    return getJson(url(service, '/album/colors', { member }), signal);
}

export function fetchFavorites(service: string, member: string | undefined, signal: AbortSignal): Promise<FavoritesPayload> {
    return getJson(url(service, '/favorites', { member }), signal);
}

export function fetchMemoirMembers(service: string, signal: AbortSignal): Promise<MemoirMembersPayload> {
    return getJson(url(service, '/memoir/members'), signal);
}

export function fetchMemoirHeader(service: string, member: string, signal: AbortSignal): Promise<MemoirHeaderPayload> {
    return getJson(url(service, '/memoir', { member }), signal);
}

export function fetchMemoirCards(service: string, member: string, signal: AbortSignal): Promise<BinderPayload> {
    return getJson(url(service, '/memoir/cards', { member }), signal);
}

/** `year` filters the items; the payload's `years` always lists every year. */
export function fetchNameMoments(service: string, member: string, year: number | undefined, signal: AbortSignal): Promise<NameMomentsPayload> {
    return getJson(url(service, '/memoir/names', { member, year }), signal);
}

export function fetchTimelineMonths(service: string, member: string, signal: AbortSignal): Promise<TimelineMonthsPayload> {
    return getJson(url(service, '/memoir/timeline', { member }), signal);
}

/** `month` is `YYYY-MM`. */
export function fetchTimelineMonth(service: string, member: string, month: string, signal: AbortSignal): Promise<TimelineMonthPayload> {
    return getJson(url(service, `/memoir/timeline/${seg(month)}`, { member }), signal);
}
