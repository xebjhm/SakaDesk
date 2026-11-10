import { clientLog } from '../../utils/clientLog';

export type MemoriesPage = 'home' | 'recap' | 'onThisDay' | 'album' | 'memoir' | 'favorites';

/** `memories_open`: the Memories feature was shown. Pass only the service id. */
export function logMemoriesOpen(service: string): void {
    clientLog('memories_open', { service });
}

/** `memories_page`: the Memories router moved to a page. Never pass names, text or paths. */
export function logMemoriesPage(page: MemoriesPage): void {
    clientLog('memories_page', { target: page });
}

/** A Memories core view, as logged in `target` (a code, never a name or path). */
export type MemoriesView =
    | 'hub' | 'on_this_day' | 'day' | 'album' | 'favorites' | 'memoir' | 'binder' | 'names' | 'timeline';

/**
 * `memories_load`: a core view's request finished. `outcome` `ok` carries `count` (the view's
 * main list length, when it has one); `timeout` means no answer within the API timeout; `error`
 * carries `error_code` (the HTTP status) when the backend answered. An aborted request (change
 * or unmount) logs nothing.
 */
export function logMemoriesLoad(
    target: MemoriesView,
    outcome: 'ok' | 'error' | 'timeout',
    extra: { count?: number; error_code?: number } = {},
): void {
    clientLog('memories_load', { target, outcome, ...extra });
}

/** `memories_jump`: a Memories view opened her chat. `target` is the source view; `has_target` a message id was passed. */
export function logMemoriesJump(target: MemoriesView, hasTarget: boolean): void {
    clientLog('memories_jump', { target, has_target: hasTarget });
}

/**
 * A Memories control, as logged in `memories_toggle` `target` (screen tasks add their codes):
 * `other_services` the day view's 「包含其他團體」 switch; `day_mode` the day view's merged / lanes
 * toggle (`on` = lanes B, `off` = merged A); `member_filter` a day-view member chip (`on` = one
 * person, `off` = everyone); `lane_card` a swimlane card (`on` = expanded, `off` = collapsed).
 */
export type MemoriesToggle = 'other_services' | 'day_mode' | 'member_filter' | 'lane_card';

/** `memories_toggle`: a Memories control was switched. `target` is the control code. */
export function logMemoriesToggle(target: MemoriesToggle, on: boolean): void {
    clientLog('memories_toggle', { target, outcome: on ? 'on' : 'off' });
}

export type RecapLoadTarget = 'members' | 'member' | 'years';
export type RecapLoadOutcome = 'ok' | 'empty' | 'timeout' | 'rejected' | 'failed' | 'skipped';

/**
 * `recap_load`: a recap request finished. `outcome` `skipped`: the poll was refused because the
 * same request was already in flight (shown as the retry state, never an endless spinner).
 * `count` is the members with a recap
 * (overview), the playable slides (member) or the years on the shelf (years); `error_code` the HTTP status;
 * `fallback` is `no_nickname` when the fan's nickname is unset (a gentle word stands in).
 */
export function logRecapLoad(
    target: RecapLoadTarget,
    outcome: RecapLoadOutcome,
    extra: { count?: number; error_code?: number; member_id?: string; fallback?: string } = {},
): void {
    clientLog('recap_load', { target, outcome, ...extra });
}

export type RecapPlayPhase =
    | 'open' | 'step' | 'pause' | 'resume' | 'end' | 'close' | 'skip' | 'media_held'
    | 'voice_start' | 'voice_clip' | 'voice_error' | 'voice_end';

/**
 * `recap_play`: a player decision. `key` is a slide key, `index` its position,
 * `reason` the trigger (`auto`, `key`, `click`, `media`) or why a slide was
 * skipped (`not_built`, `no_media`) or a voice clip failed (`media_error`,
 * `play_rejected`), `fallback` a fallback code. The `voice_*` phases trace the
 * voice slide: ▶ pressed (`count` clips), a clip started (`index`), a clip
 * failed, the sequence finished. `media_held`: a media slide's playback ended
 * while the player was paused, so the step waits for resume. Ids and codes only.
 */
export function logRecapPlay(
    phase: RecapPlayPhase,
    extra: { key?: string; index?: number; count?: number; reason?: string; fallback?: string; member_id?: string } = {},
): void {
    clientLog('recap_play', { phase, ...extra });
}

export type RecapPosterPhase = 'open' | 'skip' | 'replay' | 'close' | 'font_fallback' | 'save' | 'save_failed';

/**
 * `recap_poster`: a year-poster decision. `open` carries `count` (numbers shown)
 * and `surface` (`end`, `list`); `skip` a `reason` (`no_poster`: the recap ended
 * without one); `font_fallback` one `fallback` code per event (`font_embed_failed`,
 * `font_embed_timeout`, `font_partial`, `font_truncated`; the last also carries
 * `count` faces needed and `dropped` faces cut); `save` an `outcome` (`handed_off`:
 * the save dialog was asked to open); `save_failed` a `reason` (`render_failed`,
 * `encode_failed`, `write_failed`) and, for a refused handoff, `error_code`
 * (`export_rejected`, `export_too_large`, `export_timeout`, `export_network`).
 * Ids, codes and counts only.
 */
export function logRecapPoster(
    phase: RecapPosterPhase,
    extra: {
        count?: number; dropped?: number; reason?: string; outcome?: string; fallback?: string;
        member_id?: string; surface?: string; error_code?: string;
    } = {},
): void {
    clientLog('recap_poster', { phase, ...extra });
}

export type RecapSharePhase =
    | 'open' | 'close' | 'option' | 'style' | 'sentence' | 'font_fallback' | 'photo_skip' | 'video_unsupported'
    | 'share_blur_fallback' | 'export_start' | 'export' | 'export_failed';

/**
 * `recap_share`: a share-export decision. `open` carries `count` (sentence candidates); `option`
 * a toggle `key` (`nickname`, `avatar`, `years`, `footer`) and `outcome` (`on`, `off`) or, for
 * the avatar picker, `outcome` `picked` / `rejected` (with a `reason`: `not_image`, `too_large`,
 * `load_failed`); `style` the `style` (`collage`, `colour`);
 * `sentence` an `outcome` (`added`, `removed`) and `count` chosen; `font_fallback` a `fallback`
 * (`font_timeout`, `font_failed`, `font_unsupported`); `photo_skip` a `reason` (`load_failed`)
 * and `count`; `video_unsupported` a `reason` (`no_media_recorder`, `no_capture_stream`,
 * `no_codec`); `share_blur_fallback` a `reason` (`filter_unsupported`: the canvas has no `filter`,
 * so photos are box-blurred by rescaling instead) and `count` (frosted photos); `export_start` the `kind` (`gif`, `webm`, `png`; a video that came out as MP4 reports `mp4` afterwards), `style` and `count` (sentences);
 * `export` the `kind` and `outcome` (`handed_off`: the save dialog was asked to open); and
 * `export_failed` the `kind`, a `reason` (`render_failed`, `encode_failed`, `record_failed`,
 * `write_failed`, `cancelled`: Cancel, closing or reopening aborted it) and `error_code` (the handoff's code, or the server's reason
 * code). Ids, codes and counts only: never her words, the nickname or file names.
 */
export function logRecapShare(
    phase: RecapSharePhase,
    extra: {
        kind?: string; style?: string; key?: string; outcome?: string; reason?: string; error_code?: string;
        fallback?: string; count?: number; member_id?: string;
    } = {},
): void {
    clientLog('recap_share', { phase, ...extra });
}

export type RecapOpeningPhase = 'show' | 'skip' | 'end' | 'close';

/**
 * `recap_opening`: the multi-member opening. `show` carries `count` (stars drawn); `skip` a
 * `reason` (`single_member`: fewer than two members have a recap) and `count` (members with a
 * recap); `end` `count` (slides played through); `close` (Esc or ✕; the player's own `recap_play` close
 * carries the slide index). Counts only.
 */
export function logRecapOpening(
    phase: RecapOpeningPhase,
    extra: { count?: number; reason?: string } = {},
): void {
    clientLog('recap_opening', { phase, ...extra });
}
