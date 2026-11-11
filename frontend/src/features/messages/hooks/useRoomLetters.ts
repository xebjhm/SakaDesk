import { useCallback, useEffect, useRef, useState } from 'react';
import { clientLog } from '../../../utils/clientLog';
import { fetchAccountProfile, fetchLocalLetters, type AccountProfile, type Letter } from '../letters';

const NO_LETTERS: readonly Letter[] = [];
/** Last letters per room, so a revisited room renders at once (like the message cache). */
const lettersCache = new Map<string, readonly Letter[]>();
/** The chat waits at most this long for a room's letters, then renders without them. */
export const LETTERS_WAIT_MS = 3000;

export interface RoomLetters {
    letters: readonly Letter[];
    /** The account's nickname and avatar history; null until loaded or when unavailable. */
    profile: AccountProfile | null;
    /** True once THIS room's letters are known: loaded, cached, failed, timed out, or a group chat. */
    ready: boolean;
    /** True when this room's letters could not be loaded (failed or timed out, nothing cached). */
    unavailable: boolean;
}

interface Loaded {
    key: string;
    letters: readonly Letter[];
    unavailable: boolean;
}

/**
 * Sent letters of the open 1:1 room and the account profile, both from the local archive.
 * Group chats have no letters (no request). A failed request logs a breadcrumb and leaves the
 * room without letters; a request still pending after `waitMs` lets the room render without
 * them, so letters never block the messages. Such a late answer is cached for the next visit
 * (or the next refetch) but never applied to the open room, so its rows never shift.
 * `refreshKey` (the sync version) re-reads both. No room (`service` or `memberPath` missing)
 * makes no letters request and is never ready.
 */
export function useRoomLetters(
    service: string | null,
    memberPath: string | undefined,
    isGroupChat: boolean,
    refreshKey: number,
    waitMs: number = LETTERS_WAIT_MS,
): RoomLetters {
    const roomKey = service && memberPath ? `${service}|${memberPath}` : null;
    const [loaded, setLoadedState] = useState<Loaded | null>(null);
    // Mirror of `loaded` for the effect: a refetch of a room that is already ready needs no timeout.
    const loadedRef = useRef<Loaded | null>(null);
    const setLoaded = useCallback((next: Loaded) => {
        loadedRef.current = next;
        setLoadedState(next);
    }, []);
    const [profile, setProfile] = useState<{ service: string; profile: AccountProfile } | null>(null);

    useEffect(() => {
        if (!roomKey || !service || !memberPath) return;
        if (isGroupChat) {
            setLoaded({ key: roomKey, letters: NO_LETTERS, unavailable: false });
            clientLog('letters_load', { outcome: 'skipped_group' });
            return;
        }
        const alreadyReady = loadedRef.current?.key === roomKey;
        const cached = lettersCache.get(roomKey);
        if (cached) setLoaded({ key: roomKey, letters: cached, unavailable: false });
        const controller = new AbortController();
        // Without a list on screen the chat waits for the letters, but never longer than waitMs.
        let timedOut = false;
        const timer = cached || alreadyReady ? null : setTimeout(() => {
            timedOut = true;
            setLoaded({ key: roomKey, letters: NO_LETTERS, unavailable: true });
            clientLog('letters_load', { outcome: 'timeout' });
        }, waitMs);
        const stopWaiting = () => { if (timer !== null) clearTimeout(timer); };
        fetchLocalLetters(service, memberPath, controller.signal)
            .then((letters) => {
                if (controller.signal.aborted) return;
                stopWaiting();
                lettersCache.set(roomKey, letters);
                if (timedOut) {
                    // The room already renders without letters: keep them for the next visit.
                    clientLog('letters_load', { outcome: 'late', count: letters.length });
                    return;
                }
                setLoaded({ key: roomKey, letters, unavailable: false });
                clientLog('letters_load', { outcome: 'ok', count: letters.length });
            })
            .catch(() => {
                if (controller.signal.aborted) return;
                stopWaiting();
                clientLog('letters_load', { outcome: 'error' });
                // A cached or already shown list stays; a timed-out room already shows none.
                if (timedOut || cached || alreadyReady) return;
                setLoaded({ key: roomKey, letters: NO_LETTERS, unavailable: true });
            });
        return () => {
            stopWaiting();
            controller.abort();
        };
    }, [roomKey, service, memberPath, isGroupChat, refreshKey, waitMs, setLoaded]);

    useEffect(() => {
        if (!service) return;
        const controller = new AbortController();
        fetchAccountProfile(service, controller.signal)
            .then((p) => {
                if (controller.signal.aborted) return;
                setProfile({ service, profile: p });
                clientLog('account_profile_load', { outcome: 'ok' });
            })
            .catch(() => {
                if (!controller.signal.aborted) clientLog('account_profile_load', { outcome: 'error' });
            });
        return () => controller.abort();
    }, [service, refreshKey]);

    // Read while rendering, before the effect above commits them: a group chat (no letters) or a
    // room whose letters are cached is ready from its first render, so a cached room's list never
    // waits a frame for its letters (I1).
    const own = roomKey !== null && loaded?.key === roomKey ? loaded : null;
    const known = own ? own.letters : roomKey !== null ? (isGroupChat ? NO_LETTERS : lettersCache.get(roomKey)) : undefined;
    return {
        letters: known ?? NO_LETTERS,
        profile: profile && profile.service === service ? profile.profile : null,
        ready: known !== undefined,
        unavailable: own?.unavailable ?? false,
    };
}
