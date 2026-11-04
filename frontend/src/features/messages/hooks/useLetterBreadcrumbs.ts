import { useEffect, useRef } from 'react';
import { clientLog } from '../../../utils/clientLog';

/** The counts of letterAvatars (letters the timeline shows). */
export interface LetterAvatarCounts {
    count: number;
    history: number;
    fallback: number;
}

/**
 * Letter breadcrumbs of the open room, each once per room visit (a sync refetch does not
 * repeat them): `letter_avatar` (how each shown letter's avatar was chosen) once the profile
 * is loaded and the room shows letters, and `letters_load` `dropped` with the count of letters
 * buildTimeline left out (unparseable created_at) when there are any. `roomKey` null: no room.
 */
export function useLetterBreadcrumbs(
    roomKey: string | null,
    avatars: LetterAvatarCounts,
    profileLoaded: boolean,
    droppedLetters: number,
): void {
    const avatarRoomRef = useRef<string | null>(null);
    const droppedRoomRef = useRef<string | null>(null);

    // A room change (or no room) starts a new visit.
    useEffect(() => {
        if (avatarRoomRef.current !== roomKey) avatarRoomRef.current = null;
        if (droppedRoomRef.current !== roomKey) droppedRoomRef.current = null;
    }, [roomKey]);

    useEffect(() => {
        if (!roomKey || !profileLoaded || avatars.count === 0 || avatarRoomRef.current === roomKey) return;
        avatarRoomRef.current = roomKey;
        clientLog('letter_avatar', { count: avatars.count, history: avatars.history, fallback: avatars.fallback });
    }, [roomKey, profileLoaded, avatars]);

    useEffect(() => {
        if (!roomKey || droppedLetters === 0 || droppedRoomRef.current === roomKey) return;
        droppedRoomRef.current = roomKey;
        clientLog('letters_load', { outcome: 'dropped', count: droppedLetters });
    }, [roomKey, droppedLetters]);
}
