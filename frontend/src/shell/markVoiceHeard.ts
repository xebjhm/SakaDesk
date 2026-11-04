import { clientLog } from '../utils/clientLog';
import { persisted } from '../core/persistence/persisted';
import { parseReadStatePath } from '../features/messages/readStatePath';
import { revealInStore } from '../features/messages/readStateStore';

export interface VoiceHeardPayload { service: string; path: string; message_id: number }

declare global {
    interface Window {
        __sakadeskMarkVoiceHeard?: (payload: unknown) => boolean | null
    }
}

/**
 * Main-window heard bridge: the backend calls window.__sakadeskMarkVoiceHeard
 * after the popup answered a voice. The main window is the only writer of read
 * state.
 *
 * The desktop host maps `true` to "delivered" (final), `null` to "not_ready",
 * and a thrown JS error to "error"; both of those are retried up to 3 times.
 *
 * Returns `null` (logged as `call_popup_heard_ignored`, reason `not_ready`) and
 * applies nothing until the conversation cache has loaded successfully: before
 * that, an existing read row reads as empty, and writing "heard" over it would
 * reset the chat's read progress. If the cache never loads, the retries run out
 * and the voice stays unheard.
 *
 * Once the cache is loaded it always returns true. A malformed, mismatched or
 * failing request can never succeed on retry, so it is logged here
 * (`call_popup_heard_ignored`, reason `malformed` or `error`) and answered
 * `true` to stop the backend loop. The voice then stays unheard and B rings it
 * in the app later.
 */
export function markVoiceHeard(payload: unknown): boolean | null {
    if (!persisted.conversationsReady()) {
        clientLog('call_popup_heard_ignored', { reason: 'not_ready' });
        return null;
    }
    try {
        const p = payload as Partial<VoiceHeardPayload> | null;
        const ctx = p && typeof p.path === 'string' ? parseReadStatePath(p.path) : null;
        if (!p || typeof p.service !== 'string' || !ctx || ctx.service !== p.service
            || typeof p.message_id !== 'number'
            || !Number.isInteger(p.message_id) || p.message_id <= 0) {
            clientLog('call_popup_heard_ignored', { reason: 'malformed' });
            return true;
        }
        const changed = revealInStore(p.path as string, p.message_id);
        clientLog('call_popup_heard_applied', {
            service: ctx.service, group_id: ctx.groupId, member_id: ctx.memberId,
            message_id: p.message_id, changed,
        });
    } catch {
        // No error text: it could carry a path. The code is enough.
        clientLog('call_popup_heard_ignored', { reason: 'error' });
    }
    return true;
}
