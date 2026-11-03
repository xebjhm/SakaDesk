import { clientLog } from '../../utils/clientLog';

/** A slow backend must not hold the call back for long: past this we stop waiting and ring. */
export const POPUP_CHECK_TIMEOUT_MS = 3000;

/** AbortSignal.timeout where supported, else an AbortController with a timer. */
function timeoutSignal(ms: number): AbortSignal {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        return AbortSignal.timeout(ms);
    }
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
}

/**
 * True when the backend's popup currently owns this voice (GET /api/call-popup/active).
 * Any failure (non-2xx, network error, timeout, malformed body) returns false, so the call
 * rings in the main window ("if we can't tell, we ring"); each failed check is logged once
 * as `call_error` / `popup_check_failed`.
 */
export async function isCallPopupActive(
    ctx: { service: string; groupId: number; memberId: number }, messageId: number,
): Promise<boolean> {
    try {
        const q = new URLSearchParams({
            service: ctx.service, group_id: String(ctx.groupId),
            member_id: String(ctx.memberId), message_id: String(messageId),
        });
        const res = await fetch(`/api/call-popup/active?${q}`, { signal: timeoutSignal(POPUP_CHECK_TIMEOUT_MS) });
        if (!res.ok) throw new Error('popup_check_status');
        const body = await res.json() as { active?: unknown };
        return body.active === true;
    } catch {
        clientLog('call_error', { message_id: messageId, phase: 'idle', error_type: 'popup_check_failed' });
        return false;
    }
}

/** What the popup page needs to know about a reserved call (GET /api/call-popup/calls/{id}). */
export interface CallPopupInfo {
    call_id: number;
    service: string;
    path: string;
    is_group_chat: boolean;
    group_id: string;
    member_id: string;
    message_id: number;
}

export type CallPopupEvent =
    'ringing' | 'skipped' | 'answered' | 'declined' | 'timeout' | 'ended' | 'cancelled' | 'error';

export interface CallEventExtra {
    reason?: string;
    error_type?: string;
    message_id?: number;
}

/** The reserved call's info, or null when the backend no longer knows it (404). Throws on any other failure. */
export async function fetchCallInfo(callId: number): Promise<CallPopupInfo | null> {
    const res = await fetch(`/api/call-popup/calls/${callId}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`call info ${res.status}`);
    return await res.json() as CallPopupInfo;
}

/** Report a call outcome to the backend controller. Fire-and-forget; a failed post is logged once. */
export function postCallEvent(callId: number, event: CallPopupEvent, extra: CallEventExtra = {}): void {
    const failed = () => clientLog('call_popup_error', { call_id: callId, error_type: 'event_post_failed' });
    try {
        fetch(`/api/call-popup/calls/${callId}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event, ...extra }),
        }).then(res => { if (!res.ok) failed(); }).catch(failed);
    } catch {
        failed();
    }
}
