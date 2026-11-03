// frontend/src/features/messages/readStateStore.ts
// Single source of truth for per-conversation read state: the `read_state_<path>`
// conversation row (parsed by the sidebar and the backend tray summary) plus the
// search-copy PUT /api/read-states. Only the main window writes it.
import { persisted } from '../../core/persistence/persisted';
import { parseReadStatePath } from './readStatePath';

export interface ReadState {
    lastReadId: number;
    readCount: number;
    revealedIds: number[];
}

export const EMPTY_READ_STATE: ReadState = Object.freeze({
    lastReadId: 0,
    readCount: 0,
    revealedIds: Object.freeze([]) as unknown as number[],
}) as ReadState;

function emptyReadState(): ReadState {
    return { lastReadId: 0, readCount: 0, revealedIds: [] };
}

export function readStateKey(path: string): string {
    return `read_state_${path}`;
}

/** Parse a stored conversation row (`{ value: '<json>' }`); any failure yields an empty state. */
export function parseReadState(row: unknown): ReadState {
    try {
        const saved = (row as { value?: string } | null)?.value ?? null;
        return saved ? JSON.parse(saved) : emptyReadState();
    } catch {
        return emptyReadState();
    }
}

export function loadReadState(path: string): ReadState {
    return parseReadState(persisted.getConv<{ value?: string }>(readStateKey(path), {}));
}

export function saveReadState(path: string, state: ReadState): void {
    try {
        persisted.setConv(readStateKey(path), { value: JSON.stringify(state) });
    } catch {
        // Ignore localStorage errors
    }
    // Sync to backend for search filter support (fire-and-forget)
    const parsed = parseReadStatePath(path);
    if (parsed) {
        fetch('/api/read-states', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                service: parsed.service,
                group_id: parsed.groupId,
                member_id: parsed.memberId,
                last_read_id: state.lastReadId,
                read_count: state.readCount,
                revealed_ids: state.revealedIds,
            }),
        }).catch(() => {}); // Silent fail - localStorage is still the source of truth
    }
}

/**
 * Reveal one message. Pure: returns `prev` itself when the id is already
 * revealed. `messageIds` are the ids of the loaded chat, used to consolidate
 * contiguous revealed ids into `lastReadId`.
 */
export function applyReveal(prev: ReadState, msgId: number, messageIds: number[]): ReadState {
    if (prev.revealedIds.includes(msgId)) return prev;

    // Add the new revealed ID
    const newRevealedIds = [...prev.revealedIds, msgId];

    // Consolidate: If all messages from lastReadId+1 up to some point are now revealed,
    // advance lastReadId and remove those IDs from revealedIds.
    const unreadMsgIds = messageIds
        .filter(id => id > prev.lastReadId)
        .sort((a, b) => a - b);

    let newLastReadId = prev.lastReadId;

    for (const id of unreadMsgIds) {
        if (newRevealedIds.includes(id)) {
            const allPreviousRead = unreadMsgIds
                .filter(uid => uid <= id && uid > newLastReadId)
                .every(uid => newRevealedIds.includes(uid));

            if (allPreviousRead) {
                newLastReadId = id;
            }
        }
    }

    // Remove IDs that are now covered by newLastReadId
    const consolidatedRevealedIds = newRevealedIds.filter(id => id > newLastReadId);

    return {
        lastReadId: newLastReadId,
        revealedIds: consolidatedRevealedIds,
        readCount: (prev.readCount || 0) + 1,
    };
}

export function isUnreadIn(state: ReadState): (id: number) => boolean {
    return (id: number) => id > state.lastReadId && !state.revealedIds.includes(id);
}

export type ReadStateListener = (path: string) => void;

const listeners = new Set<ReadStateListener>();

export function subscribeReadState(listener: ReadStateListener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/**
 * Mark one voice heard in the primary store (used by the main window when the
 * popup answered it). Consolidation happens the next time the chat is open.
 */
export function revealInStore(path: string, msgId: number): boolean {
    const prev = loadReadState(path);
    if (!isUnreadIn(prev)(msgId)) return false;
    saveReadState(path, applyReveal(prev, msgId, []));
    for (const l of [...listeners]) {
        try { l(path); } catch (err) { console.debug('[readStateStore] listener failed', err); }
    }
    return true;
}
