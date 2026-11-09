import { serviceOfPath } from '../readStatePath';
import { useMemberStreak } from './useMemberStreak';
import { useRoomLetters } from './useRoomLetters';

/** What the sent-letters overview shows: a spinner, the list, or "unavailable". */
export type LettersStatus = 'loading' | 'ready' | 'unavailable';

/**
 * The open room's archive extras: its sent letters (with the account profile) and the member
 * streak. Both hooks get the room only when its path lies in the active service's folder
 * (`serviceOfPath`), so the commit of a group switch, where the service is already new but the
 * path is still the old group's, makes no letters or streak request for a mismatched pair.
 *
 * `lettersReady` gates the chat list: it waits for the letters of a room in the active
 * service; the stale commit of a group switch is held back; anything else (no active service,
 * a path outside every service folder) has no letters to wait for and is not held back.
 */
export function useRoomExtras(
    activeService: string | null,
    groupDir: string | undefined,
    isGroupChat: boolean,
    refreshKey: number,
) {
    const pathService = groupDir ? serviceOfPath(groupDir) : undefined;
    const roomService = activeService && pathService === activeService ? activeService : null;
    const roomPath = roomService ? groupDir : undefined;
    const stale = !!activeService && !!pathService && pathService !== activeService;

    const letters = useRoomLetters(roomService, roomPath, isGroupChat, refreshKey);
    const { streak, retry: retryStreak } = useMemberStreak(roomPath, isGroupChat, roomService ?? undefined);

    const lettersReady = roomService ? letters.ready : !stale;
    let lettersStatus: LettersStatus;
    if (!roomService) lettersStatus = stale ? 'loading' : 'unavailable';
    else if (!letters.ready) lettersStatus = 'loading';
    else lettersStatus = letters.unavailable ? 'unavailable' : 'ready';

    return {
        letters: letters.letters,
        profile: letters.profile,
        lettersReady,
        lettersStatus,
        /** `service|path` of the room whose letters these are; null when none apply. */
        lettersRoomKey: roomService && roomPath ? `${roomService}|${roomPath}` : null,
        streak,
        retryStreak,
    };
}
