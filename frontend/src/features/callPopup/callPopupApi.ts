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
