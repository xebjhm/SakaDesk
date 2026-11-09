// frontend/src/features/messages/readStateStore.ts
// Single source of truth for per-conversation read state: the `read_state_<path>`
// conversation row (parsed by the sidebar and the backend tray summary) plus the
// search-copy PUT /api/read-states. Only the main window writes it.
import { persisted } from '../../core/persistence/persisted';
import { clientLog } from '../../utils/clientLog';
import { breadcrumbCode } from '../../utils/breadcrumbCode';
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

/**
 * Make a parsed row safe to use. A well-formed row (numeric `lastReadId`, array
 * `revealedIds`) is returned untouched; a JSON `null`, a non-object, or a row
 * missing either field is repaired field by field so `isUnreadIn` / `applyReveal`
 * never throw on it.
 */
function normalizeReadState(parsed: unknown): ReadState {
    if (parsed === null || typeof parsed !== 'object') return emptyReadState();
    const o = parsed as Partial<ReadState>;
    if (Number.isFinite(o.lastReadId) && Array.isArray(o.revealedIds)) return o as ReadState;
    return {
        lastReadId: Number.isFinite(o.lastReadId) ? (o.lastReadId as number) : 0,
        readCount: Number.isFinite(o.readCount) ? (o.readCount as number) : 0,
        revealedIds: Array.isArray(o.revealedIds)
            ? o.revealedIds.filter((id): id is number => Number.isFinite(id))
            : [],
    };
}

/** Parse a stored conversation row (`{ value: '<json>' }`); any failure yields an empty state. */
export function parseReadState(row: unknown): ReadState {
    try {
        const saved = (row as { value?: string } | null)?.value ?? null;
        return saved ? normalizeReadState(JSON.parse(saved)) : emptyReadState();
    } catch {
        return emptyReadState();
    }
}

export function loadReadState(path: string): ReadState {
    return parseReadState(persisted.getConv<{ value?: string }>(readStateKey(path), {}));
}

/**
 * Persist `state` as the chat's read row and PUT the search copy (fire-and-forget).
 *
 * Skipped while the conversation cache has not loaded (`conversationsReady()`
 * is false: still loading, or the startup load failed): until then `state` may
 * be derived from the empty fallback, and writing it would overwrite the
 * stored progress. Logs `read_state_save_skipped` (reason `not_ready`, ids
 * only) once per chat per session. A failed or refused search-copy PUT logs `read_state_sync_failed`.
 */
/** Chats whose skipped save was already logged (see saveReadState). */
const skippedSaveLogged = new Set<string>();

export function saveReadState(path: string, state: ReadState): void {
    const parsed = parseReadStatePath(path);
    const ids = parsed ? { service: parsed.service, group_id: parsed.groupId, member_id: parsed.memberId } : {};
    if (!persisted.conversationsReady()) {
        // Once per chat per session: every reveal would otherwise log again.
        if (!skippedSaveLogged.has(path)) {
            skippedSaveLogged.add(path);
            clientLog('read_state_save_skipped', { reason: 'not_ready', ...ids });
        }
        return;
    }
    try {
        persisted.setConv(readStateKey(path), { value: JSON.stringify(state) });
    } catch {
        // Ignore cache errors; setConv logs a refused backend write itself
    }
    // Sync to backend for search filter support (fire-and-forget)
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
        })
            .then((res) => {
                if (!res.ok) clientLog('read_state_sync_failed', { error_type: 'http', error_code: res.status });
            })
            // The conversation row stays the source of truth; only the search copy is stale.
            .catch((err) => clientLog('read_state_sync_failed', { error_type: breadcrumbCode(err) }));
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

/** True when both states describe the same read progress. */
export function readStateEquals(a: ReadState, b: ReadState): boolean {
    return a.lastReadId === b.lastReadId
        && (a.readCount || 0) === (b.readCount || 0)
        && a.revealedIds.length === b.revealedIds.length
        && a.revealedIds.every(id => b.revealedIds.includes(id));
}

/**
 * Union of two states for the same chat: `lastReadId` is the max, `revealedIds`
 * the union above it, and `readCount` counts every reveal once (`base.readCount`
 * plus the ids only `other` knows about, never less than `other.readCount`).
 * Returns `base` itself when `other` adds nothing. Never loses a reveal, which is
 * what reconciles an in-flight in-chat update with a bridge write.
 */
export function mergeReadState(base: ReadState, other: ReadState): ReadState {
    const lastReadId = Math.max(base.lastReadId, other.lastReadId);
    const added = other.revealedIds.filter(id => !base.revealedIds.includes(id) && id > base.lastReadId);
    const revealedIds = [...base.revealedIds, ...added].filter(id => id > lastReadId);
    const readCount = Math.max((base.readCount || 0) + added.length, other.readCount || 0);
    const merged: ReadState = { lastReadId, revealedIds, readCount };
    return readStateEquals(base, merged) ? base : merged;
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
