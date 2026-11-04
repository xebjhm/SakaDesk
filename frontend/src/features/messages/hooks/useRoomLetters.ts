import { useEffect, useState } from 'react';
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
    /** True once THIS room's letters are known: loaded, cached, failed, or a group chat. */
    ready: boolean;
}

/**
 * Sent letters of the open 1:1 room and the account profile, both from the local archive.
 * Group chats have no letters (no request). A failed request logs a breadcrumb and leaves the
 * room without letters; a request still pending after `waitMs` lets the room render without
 * them, so letters never block the messages. `refreshKey` (the sync version) re-reads both.
 */
export function useRoomLetters(
    service: string | null,
    memberPath: string | undefined,
    isGroupChat: boolean,
    refreshKey: number,
    waitMs: number = LETTERS_WAIT_MS,
): RoomLetters {
    const roomKey = service && memberPath ? `${service}|${memberPath}` : null;
    const [loaded, setLoaded] = useState<{ key: string; letters: readonly Letter[] } | null>(null);
    const [profile, setProfile] = useState<{ service: string; profile: AccountProfile } | null>(null);

    useEffect(() => {
        if (!roomKey || !service || !memberPath) return;
        if (isGroupChat) {
            setLoaded({ key: roomKey, letters: NO_LETTERS });
            clientLog('letters_load', { outcome: 'skipped_group' });
            return;
        }
        const cached = lettersCache.get(roomKey);
        if (cached) setLoaded({ key: roomKey, letters: cached });
        const controller = new AbortController();
        // Without a cached list the chat waits for the letters, but never longer than waitMs.
        const timer = cached ? null : setTimeout(() => {
            setLoaded((prev) => (prev?.key === roomKey ? prev : { key: roomKey, letters: NO_LETTERS }));
            clientLog('letters_load', { outcome: 'timeout' });
        }, waitMs);
        const stopWaiting = () => { if (timer !== null) clearTimeout(timer); };
        fetchLocalLetters(service, memberPath, controller.signal)
            .then((letters) => {
                if (controller.signal.aborted) return;
                stopWaiting();
                lettersCache.set(roomKey, letters);
                setLoaded({ key: roomKey, letters });
                clientLog('letters_load', { outcome: 'ok', count: letters.length });
            })
            .catch(() => {
                if (controller.signal.aborted) return;
                stopWaiting();
                setLoaded({ key: roomKey, letters: cached ?? NO_LETTERS });
                clientLog('letters_load', { outcome: 'error' });
            });
        return () => {
            stopWaiting();
            controller.abort();
        };
    }, [roomKey, service, memberPath, isGroupChat, refreshKey, waitMs]);

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

    return {
        letters: loaded && loaded.key === roomKey ? loaded.letters : NO_LETTERS,
        profile: profile && profile.service === service ? profile.profile : null,
        ready: roomKey !== null && loaded?.key === roomKey,
    };
}
