/**
 * Fire-and-forget UI breadcrumbs → backend debug.log (POST /api/client-log).
 * The backend whitelists events, keys and values; never pass names, text,
 * URLs or paths. Failures are swallowed so logging can't break a UI flow.
 */
export type ClientLogEvent =
    | 'call_ring' | 'call_skip' | 'call_answer' | 'call_decline'
    | 'call_timeout' | 'call_end' | 'call_cancel' | 'call_error'
    | 'notify_open_chat';

export type ClientLogFieldKey =
    | 'service' | 'group_id' | 'member_id' | 'message_id' | 'reason'
    | 'phase' | 'ring_ms' | 'talk_ms' | 'error_type';

export type ClientLogFields = Partial<Record<ClientLogFieldKey, number | boolean | string>>;

export function clientLog(event: ClientLogEvent, fields: ClientLogFields = {}): void {
    try {
        fetch('/api/client-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event, fields }),
        })
            .then(res => {
                if (!res.ok) console.debug('[clientLog] rejected', event, res.status);
            })
            .catch(err => console.debug('[clientLog] failed', event, err));
    } catch (err) {
        console.debug('[clientLog] failed', event, err);
    }
}
