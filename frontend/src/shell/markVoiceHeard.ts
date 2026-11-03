import { clientLog } from '../utils/clientLog';
import { parseReadStatePath } from '../features/messages/readStatePath';
import { revealInStore } from '../features/messages/readStateStore';

export interface VoiceHeardPayload { service: string; path: string; message_id: number }

declare global {
    interface Window {
        __sakadeskMarkVoiceHeard?: (payload: unknown) => boolean
    }
}

/**
 * Main-window heard bridge: the backend calls window.__sakadeskMarkVoiceHeard
 * after the popup answered a voice. The main window is the only writer of read
 * state. Returns true even for a malformed payload so the backend never retries
 * one that can never apply.
 */
export function markVoiceHeard(payload: unknown): boolean {
    const p = payload as Partial<VoiceHeardPayload> | null;
    const ctx = p && typeof p.path === 'string' ? parseReadStatePath(p.path) : null;
    if (!p || typeof p.service !== 'string' || !ctx || typeof p.message_id !== 'number'
        || !Number.isInteger(p.message_id) || p.message_id <= 0) {
        clientLog('call_popup_heard_ignored', { reason: 'malformed' });
        return true;
    }
    const changed = revealInStore(p.path as string, p.message_id);
    clientLog('call_popup_heard_applied', {
        service: ctx.service, group_id: ctx.groupId, member_id: ctx.memberId,
        message_id: p.message_id, changed,
    });
    return true;
}
