/**
 * Fire-and-forget UI breadcrumbs → backend debug.log (POST /api/client-log).
 * The backend whitelists events, keys and values; never pass names, text,
 * URLs or paths. Failures are swallowed so logging can't break a UI flow.
 */
export type ClientLogEvent =
    | 'call_ring' | 'call_skip' | 'call_answer' | 'call_decline'
    | 'call_timeout' | 'call_end' | 'call_cancel' | 'call_error'
    | 'notify_open_chat' | 'backend_sync_followed' | 'backend_sync_skipped'
    | 'call_popup_start' | 'call_popup_error'
    | 'call_popup_heard_applied' | 'call_popup_heard_ignored'
    | 'app_load_failed'
    | 'design_tokens_applied' | 'design_tokens_fallback' | 'avatar_fallback' | 'design_fonts_applied' | 'design_fonts_fallback'
    | 'timeline_jump' | 'letters_load' | 'account_profile_load' | 'letter_avatar' | 'streak_load'
    | 'blog_load' | 'dialog' | 'dialog_load' | 'call_layer' | 'sync_start_skipped'
    | 'menu_item_blocked' | 'blog_fallback' | 'group_marker_fallback' | 'entry_validation' | 'archive_stats_load' | 'celebration' | 'sync_sequence'
    | 'letter_viewer' | 'letter_jump' | 'display_density_change'
    | 'favorite_video_error' | 'favorite_video_lazy_unsupported' | 'diagnostics_disk_usage' | 'calendar_picker'
    | 'media_playback'
    | 'poll_timeout' | 'poll_skipped' | 'poll_failed'
    | 'poll_retry' | 'poll_gave_up'
    | 'translation_batch_failed';

export type ClientLogFieldKey =
    | 'service' | 'group_id' | 'member_id' | 'message_id' | 'reason'
    | 'phase' | 'ring_ms' | 'talk_ms' | 'error_type'
    | 'surface' | 'call_id' | 'changed' | 'has_target'
    | 'theme' | 'size'
    | 'target' | 'index' | 'corrections' | 'outcome' | 'jump_ms' | 'path' | 'count' | 'history' | 'fallback' | 'dppx_pct'
    | 'ready_state' | 'network_state' | 'error_code' | 'aborted' | 'key' | 'timeout_ms' | 'caller';

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
