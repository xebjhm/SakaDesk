import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../../../i18n';
import { parseErrorDetail } from '../../../utils/httpError';
import { clientLog } from '../../../utils/clientLog';
import { toLocalDateStr } from '../../../utils/dateFormatters';

export type StreakState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; days: number };

/**
 * App-session cache of the official subscription streak: at most one request per room per
 * local day. Successful answers only; a failure is never cached. In-flight requests are
 * shared, so the header and the profile popup (or a quick re-open) never ask twice.
 */
const streakCache = new Map<string, number>();
const inFlight = new Map<string, Promise<number>>();

/** Cache key: service, group id and the local day (toLocalDateStr) of `now`. */
export function streakCacheKey(service: string, groupId: string, now: Date): string {
    return `${service}|${groupId}|${toLocalDateStr(now)}`;
}

/** A member group id is the numeric prefix of the room's member directory. */
const MEMBER_GROUP_ID = /^\d+$/;

/**
 * The member group id whose streak the room shows: the numeric prefix of the path's member
 * directory (`<service>/messages/<id> <name>/…`). Undefined for a group chat (the streak is a
 * 1:1 subscription) or when the path has no numeric id, so the hook stays idle and never asks.
 */
export function streakGroupId(groupDir: string | null | undefined, isGroupChat: boolean): string | undefined {
    if (isGroupChat || !groupDir) return undefined;
    const id = groupDir.split('/')[2]?.split(' ')[0];
    return id && MEMBER_GROUP_ID.test(id) ? id : undefined;
}

/** Test seam: forget every cached and in-flight streak. */
export function resetStreakCache(): void {
    streakCache.clear();
    inFlight.clear();
}

/** One shared request per key; caches the days on success and logs one `streak_load` breadcrumb per request. */
function loadStreak(key: string, service: string, groupId: string, fallbackError: string): Promise<number> {
    const running = inFlight.get(key);
    if (running) return running;
    const request = (async () => {
        try {
            const url = `/api/chat/streak/${encodeURIComponent(groupId)}?service=${encodeURIComponent(service)}`;
            const res = await fetch(url);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(parseErrorDetail(body, fallbackError));
            }
            const data = await res.json() as { days?: number };
            const days = data.days ?? 0;
            streakCache.set(key, days);
            clientLog('streak_load', { outcome: 'ok' });
            return days;
        } catch (err: unknown) {
            clientLog('streak_load', { outcome: 'error' });
            throw err instanceof Error ? err : new Error(fallbackError);
        } finally {
            inFlight.delete(key);
        }
    })();
    inFlight.set(key, request);
    return request;
}

const IDLE: StreakState = { status: 'idle' };

/**
 * The subscription streak of the open room (GET /api/chat/streak/{groupId}), shared by the
 * chat header and the profile popup. `groupDir` is the open room's path (undefined: no room).
 * Served from the session cache when this room was already fetched today (local date),
 * otherwise fetched once (concurrent callers share the request). A group chat, or a path
 * without a numeric member group id (see `streakGroupId`), stays idle with no request.
 * The state is keyed by room: right after a room switch the hook reports the new room
 * (cached, loading or idle), never the previous room's count, and a late answer for a room
 * the user has left is ignored (SD-FE-GAP-B-01). On failure the state is 'error' (the header
 * omits the day count; the popup offers `retry`, which fetches again). Every decision logs
 * one `streak_load` breadcrumb: `ok` / `error` per request, `cache_hit`, `skipped_group`,
 * `skipped_no_id`; no room logs nothing. `now` is a test seam for the clock.
 */
export function useMemberStreak(
    groupDir: string | undefined,
    isGroupChat: boolean,
    service: string | undefined,
    now: () => Date = () => new Date(),
) {
    const { t } = useTranslation();
    const groupId = streakGroupId(groupDir, isGroupChat);
    const skip = !groupDir || groupId ? null : isGroupChat ? 'skipped_group' : 'skipped_no_id';
    const roomKey = groupId && service ? `${service}|${groupId}` : null;
    const [state, setState] = useState<{ key: string; streak: StreakState } | null>(null);
    const [attempt, setAttempt] = useState(0);
    const retry = useCallback(() => setAttempt((a) => a + 1), []);

    useEffect(() => {
        // No member room (none open, a group chat, or not a numeric id): idle, no request.
        if (!groupId) {
            if (skip) clientLog('streak_load', { outcome: skip });
            return;
        }
        // `service` is a required backend query param; without it the request would 422.
        if (!service || !roomKey) return;
        const key = streakCacheKey(service, groupId, now());
        const cached = streakCache.get(key);
        if (cached !== undefined) {
            setState({ key: roomKey, streak: { status: 'ready', days: cached } });
            clientLog('streak_load', { outcome: 'cache_hit' });
            return;
        }
        let cancelled = false;
        setState({ key: roomKey, streak: { status: 'loading' } });
        loadStreak(key, service, groupId, t('memberProfile.fetchFailed'))
            .then((days) => { if (!cancelled) setState({ key: roomKey, streak: { status: 'ready', days } }); })
            .catch((err: unknown) => {
                if (cancelled) return;
                const message = err instanceof Error ? err.message : t('memberProfile.fetchFailed');
                setState({ key: roomKey, streak: { status: 'error', message } });
            });
        return () => { cancelled = true; };
        // The clock is read when the effect runs (room open / retry); it is not a dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupId, skip, service, roomKey, attempt, t]);

    let streak: StreakState;
    if (!groupId) streak = IDLE;
    else if (!roomKey) streak = { status: 'error', message: t('memberProfile.noService') };
    else if (state?.key === roomKey) streak = state.streak;
    else {
        // The room changed and its effect has not run yet: show the new room, never the old one.
        const cached = service ? streakCache.get(streakCacheKey(service, groupId, now())) : undefined;
        streak = cached !== undefined ? { status: 'ready', days: cached } : { status: 'loading' };
    }
    return { streak, retry };
}
