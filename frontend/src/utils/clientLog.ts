/**
 * Fire-and-forget UI breadcrumbs → backend debug.log (POST /api/client-log).
 * The backend whitelists events, keys and values; never pass names, text,
 * URLs or paths. Failures are swallowed so logging can't break a UI flow.
 */
export { breadcrumbCode } from './breadcrumbCode';

/**
 * Abort a breadcrumb POST after this long. Breadcrumbs fire exactly when the
 * backend is not answering; an unanswered one would hold one of Chromium's six
 * per-host connections. A timed-out POST fails silently like any other failure.
 * (Same value as `POLL_TIMEOUT_MS`, kept local: `pollJson` imports this module.)
 */
const CLIENT_LOG_TIMEOUT_MS = 4000;

export type ClientLogEvent =
    | 'call_ring' | 'call_skip' | 'call_answer' | 'call_decline'
    | 'call_timeout' | 'call_end' | 'call_cancel' | 'call_error'
    | 'notify_open_chat' | 'notify_open_login' | 'notify_open_memories' | 'backend_sync_followed' | 'backend_sync_skipped'
    | 'call_popup_start' | 'call_popup_error'
    | 'call_popup_heard_applied' | 'call_popup_heard_ignored'
    | 'app_load_failed'
    | 'design_tokens_applied' | 'design_tokens_fallback' | 'avatar_fallback' | 'design_fonts_applied' | 'design_fonts_fallback'
    | 'timeline_jump' | 'letters_load' | 'account_profile_load' | 'letter_avatar' | 'streak_load'
    | 'blog_load' | 'dialog' | 'dialog_load' | 'call_layer' | 'sync_start_skipped'
    | 'menu_item_blocked' | 'blog_fallback' | 'group_marker_fallback' | 'entry_validation' | 'archive_stats_load' | 'celebration' | 'sync_sequence'
    | 'sync_sequence_resumed' | 'sync_start_all_failed' | 'sync_cancel_failed'
    | 'letter_viewer' | 'letter_jump' | 'display_density_change'
    | 'favorite_video_error' | 'favorite_video_lazy_unsupported' | 'diagnostics_disk_usage' | 'calendar_picker'
    | 'media_playback'
    | 'poll_timeout' | 'poll_skipped' | 'poll_failed'
    | 'poll_retry' | 'poll_gave_up'
    | 'translation_batch_failed'
    | 'translation_legacy_reuse'
    | 'translation_legacy_resave_failed'
    | 'conv_hydrate_retry' | 'conv_hydrate_failed' | 'conv_hydrate_recovered' | 'conv_write_failed'
    | 'read_state_save_deferred' | 'read_state_pending_flushed' | 'read_state_sync_failed'
    | 'sidebar_load' | 'chat_load' | 'oshi_mirror_failed'
    | 'memories_open' | 'memories_page' | 'memories_load' | 'memories_jump' | 'memories_toggle' | 'memories_skip'
    | 'memories_radio' | 'memories_gacha' | 'memories_capsule'
    | 'recap_load' | 'recap_play'
    | 'recap_poster' | 'recap_share' | 'recap_opening'
    | 'ui_wait'
    | 'media_grid' | 'media_poster' | 'external_link' | 'csp_violation';

export type ClientLogFieldKey =
    | 'service' | 'group_id' | 'member_id' | 'message_id' | 'reason'
    | 'phase' | 'ring_ms' | 'talk_ms' | 'error_type'
    | 'surface' | 'call_id' | 'changed' | 'has_target' | 'delivered'
    | 'theme' | 'size'
    | 'target' | 'index' | 'corrections' | 'outcome' | 'jump_ms' | 'path' | 'count' | 'history' | 'fallback' | 'dppx_pct'
    | 'ready_state' | 'network_state' | 'error_code' | 'aborted' | 'key' | 'timeout_ms' | 'caller' | 'written' | 'dropped'
    | 'kind' | 'style' | 'wait_ms'
    | 'grid' | 'first_tile_ms' | 'visible';

export type ClientLogFields = Partial<Record<ClientLogFieldKey, number | boolean | string>>;

/** `AbortSignal.timeout` where available, else an `AbortController` on a timer. */
function timeoutSignal(ms: number): AbortSignal {
    if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
}

export function clientLog(event: ClientLogEvent, fields: ClientLogFields = {}): void {
    try {
        fetch('/api/client-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event, fields }),
            signal: timeoutSignal(CLIENT_LOG_TIMEOUT_MS),
        })
            .then(res => {
                if (!res.ok) console.debug('[clientLog] rejected', event, res.status);
            })
            .catch(err => console.debug('[clientLog] failed', event, err));
    } catch (err) {
        console.debug('[clientLog] failed', event, err);
    }
}
