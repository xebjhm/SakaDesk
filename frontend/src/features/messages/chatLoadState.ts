/** A room's message list still loading after this many ms ends in the timeout state (with Retry). */
export const CHAT_LOAD_TIMEOUT_MS = 60_000;

/** Why the open room's message list failed to load: it ran past the deadline, or it failed. */
export type ChatLoadFailure = 'timeout' | 'error';

/** The media gallery's view of the room list (M6 `listStatus`). */
export type ChatListStatus = 'loading' | 'error' | 'ready';

export interface ChatLoadInput {
    /** The open room (undefined: none selected). */
    selectedGroupDir: string | undefined;
    /** The room the messages in state belong to (null: none). */
    messagesForDir: string | null;
    /** How many messages are in state. */
    messageCount: number;
    /** `useRoomExtras().lettersReady`: the open room's letters are known (or there are none to wait for). */
    lettersReady: boolean;
    /** The open room's last load failure (null: none). */
    failure: ChatLoadFailure | null;
}

export interface ChatLoadState {
    /** The fetch for this room has not landed, whatever the previous room left in state (F1). */
    roomPending: boolean;
    /** The messages are in, the letters that interleave with them are not yet (F2). */
    lettersPending: boolean;
    /** The room loaded successfully and has no messages: the timeline shows its empty line. */
    empty: boolean;
    /** The timeline shows the chat skeleton. */
    chatWaiting: boolean;
    /** The open room's failure, shown with Retry in place of the timeline. */
    failure: ChatLoadFailure | null;
    /**
     * The gallery's list state. Only the room's own list counts (not its letters): a loaded room,
     * empty or not, stays `ready` during a background refresh (M7).
     */
    listStatus: ChatListStatus;
}

/**
 * The one derivation of the chat's loading state. The timeline (skeleton, failure) and the media
 * gallery (`listStatus`) both read it, so they can never disagree. A cached room has
 * `messagesForDir === selectedGroupDir` from its first render (MessagesFeature applies the cache
 * while rendering) and, when its letters are cached too, `lettersReady` (useRoomLetters reads its
 * cache while rendering), so it never waits. Pure.
 */
export function deriveChatLoad({ selectedGroupDir, messagesForDir, messageCount, lettersReady, failure }: ChatLoadInput): ChatLoadState {
    const open = !!selectedGroupDir;
    const shownFailure = open ? failure : null;
    const loaded = open && messagesForDir === selectedGroupDir;
    const roomPending = open && !shownFailure && !loaded;
    const lettersPending = loaded && !shownFailure && messageCount > 0 && !lettersReady;
    return {
        roomPending,
        empty: loaded && !shownFailure && messageCount === 0,
        lettersPending,
        chatWaiting: roomPending || lettersPending,
        failure: shownFailure,
        listStatus: shownFailure ? 'error' : roomPending ? 'loading' : 'ready',
    };
}
