/**
 * Typed client for the Memories endpoints (`/api/memories/{service}/...`).
 *
 * One function per endpoint. Each takes the caller's `AbortSignal` (`useMemoriesQuery` aborts
 * on change and unmount), percent-encodes every query value and resolves the parsed payload
 * (`undefined` for a 204). Writes (`sendJson`: gacha pull, album cover, capsule notes) send a
 * JSON body and share the reads' timeout and error classes.
 * A non-2xx answer throws {@link MemoriesFetchError} (with the server's snake_case reason
 * `code` when it sent one, e.g. `store_unavailable`, `bad_note`); a request still unanswered after
 * {@link MEMORIES_TIMEOUT_MS} is aborted and throws {@link MemoriesTimeoutError}; a caller
 * abort rejects with the fetch's `AbortError`. Logging is the caller's (`memories_load` in
 * `useMemoriesQuery`).
 *
 * These are plain fetches, not `pollJson`: `pollJson` skips or replaces requests per key, so
 * two loads of one endpoint would collide. The timeout is long because a cache miss can take a
 * while to build; it exists so a stalled backend never leaves an endless spinner.
 */
import type {
    AlbumColorsPayload, AlbumCoverBody, AlbumMembersPayload, AlbumMonthPayload, AlbumMonthsPayload, AlbumQuery,
    BinderPayload, CalendarMonthPayload, CalendarMonthsPayload, CapsuleCreateBody, CapsuleNote, CapsuleNotesPayload,
    CapsuleQuery, CapsuleResurfacePayload, Day24Payload, DayPayload, DayQuery, FavoritesPayload, GachaPullPayload,
    GachaStatePayload, HubPayload, MemoirHeaderPayload, MemoirMembersPayload, NameMomentsPayload, OnThisDayPayload,
    RadioCassettesPayload, RadioMembersPayload, RadioProgramPayload, RadioProgramQuery, SameTimeMoment,
    ThenNowDayPayload, ThenNowDayQuery, ThenNowFirstWeekPayload, TimelineMonthPayload, TimelineMonthsPayload,
} from './types';

/** A server reason code (`detail`), kept only when it is a snake_case code, never free text. */
const REASON_CODE = /^[a-z0-9_]{1,40}$/;

/** A Memories request the backend answered with a non-2xx status. */
export class MemoriesFetchError extends Error {
    readonly httpStatus: number;
    /** The server's reason code (`store_unavailable`, `bad_note`, `no_pulls_left`, ...), or null. */
    readonly code: string | null;

    constructor(httpStatus: number, code: string | null = null) {
        super(`memories request failed (${httpStatus})`);
        this.name = 'MemoriesFetchError';
        this.httpStatus = httpStatus;
        this.code = code;
    }
}

/** The `detail` of an error answer when it is a reason code; null otherwise or when unreadable. */
async function reasonCode(res: Response): Promise<string | null> {
    try {
        const body: unknown = await res.json();
        const detail = (body as { detail?: unknown } | null)?.detail;
        return typeof detail === 'string' && REASON_CODE.test(detail) ? detail : null;
    } catch {
        return null;
    }
}

/** A Memories request gives up after this long (a cold-cache build stays well under it). */
export const MEMORIES_TIMEOUT_MS = 20000;

/** A Memories request that got no answer within {@link MEMORIES_TIMEOUT_MS}. */
export class MemoriesTimeoutError extends Error {
    constructor() {
        super('memories request timed out');
        this.name = 'MemoriesTimeoutError';
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

/**
 * Send one request under the caller's signal and the timeout, and parse the JSON answer
 * (`undefined` for a 204). The two signals are linked by hand (not `AbortSignal.any`, which
 * older webviews lack): either aborts one inner controller.
 */
async function request<T>(href: string, init: RequestInit, signal: AbortSignal): Promise<T> {
    const inner = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; inner.abort(); }, MEMORIES_TIMEOUT_MS);
    const onAbort = () => inner.abort();
    if (signal.aborted) inner.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
    try {
        const res = await fetch(href, { ...init, cache: 'no-store', signal: inner.signal });
        if (!res.ok) throw new MemoriesFetchError(res.status, await reasonCode(res));
        if (res.status === 204) return undefined as T;
        return (await res.json()) as T;
    } catch (err) {
        if (timedOut && !signal.aborted) throw new MemoriesTimeoutError();
        throw err;
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
    }
}

/** GET `href` as JSON. */
function getJson<T>(href: string, signal: AbortSignal): Promise<T> {
    return request<T>(href, {}, signal);
}

/** A write: `method` with an optional JSON `body`, same timeout and errors as {@link getJson}. */
function sendJson<T>(method: 'POST' | 'PUT' | 'DELETE', href: string, body: unknown, signal: AbortSignal): Promise<T> {
    const init: RequestInit = body === undefined
        ? { method }
        : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    return request<T>(href, init, signal);
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

// --- fun wave ---------------------------------------------------------------------------------

export function fetchRadioMembers(service: string, signal: AbortSignal): Promise<RadioMembersPayload> {
    return getJson(url(service, '/radio/members'), signal);
}

export function fetchRadioProgram(service: string, query: RadioProgramQuery, signal: AbortSignal): Promise<RadioProgramPayload> {
    return getJson(url(service, '/radio/program', { program: query.program, member: query.member, year: query.year }), signal);
}

export function fetchRadioCassettes(service: string, member: string | undefined, signal: AbortSignal): Promise<RadioCassettesPayload> {
    return getJson(url(service, '/radio/cassettes', { member }), signal);
}

export function fetchGacha(service: string, signal: AbortSignal): Promise<GachaStatePayload> {
    return getJson(url(service, '/gacha'), signal);
}

/** A gacha pull's answer: the pull, or no pulls left today (409, also after a racing click). */
export type GachaPullResult = { status: 'ok'; data: GachaPullPayload } | { status: 'no_pulls_left' };

/** Draw the next pull. 409 resolves `no_pulls_left`; every other failure throws like a read. */
export async function postGachaPull(service: string, signal: AbortSignal): Promise<GachaPullResult> {
    try {
        const data = await sendJson<GachaPullPayload>('POST', url(service, '/gacha/pull'), undefined, signal);
        return { status: 'ok', data };
    } catch (err) {
        if (err instanceof MemoriesFetchError && err.httpStatus === 409) return { status: 'no_pulls_left' };
        throw err;
    }
}

export function fetchCalendarMonths(service: string, member: string | undefined, signal: AbortSignal): Promise<CalendarMonthsPayload> {
    return getJson(url(service, '/calendar/months', { member }), signal);
}

/** `month` is `YYYY-MM` (JST). */
export function fetchCalendarMonth(service: string, month: string, member: string | undefined, signal: AbortSignal): Promise<CalendarMonthPayload> {
    return getJson(url(service, `/calendar/${seg(month)}`, { member }), signal);
}

/** Set a month's album cover (204). 400 `not_in_month` when the message is not a photo / video of that month in that scope. */
export function putAlbumCover(service: string, body: AlbumCoverBody, signal: AbortSignal): Promise<void> {
    return sendJson('PUT', url(service, '/album/cover'), body, signal);
}

/** Clear a month's album cover override (204 either way). */
export function deleteAlbumCover(service: string, query: { month: string; member?: string }, signal: AbortSignal): Promise<void> {
    return sendJson('DELETE', url(service, '/album/cover', { month: query.month, member: query.member }), undefined, signal);
}

/** A day's notes (`date`) or one person's notes on a card (`member` + `card`). 503 `store_unavailable` when the store fails. */
export function fetchCapsule(service: string, query: CapsuleQuery, signal: AbortSignal): Promise<CapsuleNotesPayload> {
    const q = 'date' in query ? { date: query.date } : { member: query.member, card: query.card };
    return getJson(url(service, '/capsule', q), signal);
}

/** `monthDay` is `MM-DD`: the notes resurfacing on it this JST year. */
export function fetchCapsuleDue(service: string, monthDay: string, signal: AbortSignal): Promise<CapsuleResurfacePayload> {
    return getJson(url(service, '/capsule/due', { month_day: monthDay }), signal);
}

/** Write a note; resolves the stored note. 400 `bad_note` / `bad_body`, 404 unknown member, 503 `store_unavailable`. */
export function postCapsule(service: string, body: CapsuleCreateBody, signal: AbortSignal): Promise<CapsuleNote> {
    return sendJson('POST', url(service, '/capsule'), body, signal);
}

/** Replace a note's body; resolves the note. 404 for an unknown or out-of-range id. */
export function putCapsule(service: string, noteId: number, body: string, signal: AbortSignal): Promise<CapsuleNote> {
    return sendJson('PUT', url(service, `/capsule/${seg(String(noteId))}`), { body }, signal);
}

/** Delete a note (204). 404 for an unknown or out-of-range id. */
export function deleteCapsule(service: string, noteId: number, signal: AbortSignal): Promise<void> {
    return sendJson('DELETE', url(service, `/capsule/${seg(String(noteId))}`), undefined, signal);
}

/** 同じ時刻 for the current JST minute, or null (hide the line). */
export function fetchSameTime(service: string, signal: AbortSignal): Promise<SameTimeMoment | null> {
    return getJson(url(service, '/same-time'), signal);
}

/** Her 24 hours; `seed` (🎲) rebuilds the day, else the JST date picks it. */
export function fetchDay24(service: string, member: string, seed: number | undefined, signal: AbortSignal): Promise<Day24Payload> {
    return getJson(url(service, '/memoir/day24', { member, seed }), signal);
}

/** あの日と今日 for a date, or null (hide the toggle). */
export function fetchThenNowDay(service: string, query: ThenNowDayQuery, signal: AbortSignal): Promise<ThenNowDayPayload | null> {
    return getJson(url(service, '/then-now/day', { date: query.date, member: query.member }), signal);
}

/** 初見 vs 今, or null when the weeks overlap or no row has both sides. */
export function fetchThenNowFirstWeek(service: string, member: string, signal: AbortSignal): Promise<ThenNowFirstWeekPayload | null> {
    return getJson(url(service, '/then-now/first-week', { member }), signal);
}
