import { clientLog } from '../../utils/clientLog';
import type { CapsuleAnchorKind, GachaRarity, GachaReason, RadioProgram } from './types';

/** The Memories router's pages (route names, camelCase). */
export const MEMORIES_PAGES = [
    'home', 'recap', 'onThisDay', 'album', 'memoir', 'favorites', 'radio', 'gacha', 'calendar', 'day',
] as const;
export type MemoriesPage = (typeof MEMORIES_PAGES)[number];

/**
 * The code each page logs in `memories_page` `target`. The backend accepts snake_case codes only
 * (`^[a-z0-9_]{1,40}$`), so a camelCase route name must never be sent as is.
 */
export const MEMORIES_PAGE_CODES: Record<MemoriesPage, string> = {
    home: 'home',
    recap: 'recap',
    onThisDay: 'on_this_day',
    album: 'album',
    memoir: 'memoir',
    favorites: 'favorites',
    radio: 'radio',
    gacha: 'gacha',
    calendar: 'calendar',
    day: 'day',
};

/** `memories_open`: the Memories feature was shown. Pass only the service id. */
export function logMemoriesOpen(service: string): void {
    clientLog('memories_open', { service });
}

/** `memories_page`: the Memories router moved to a page. Never pass names, text or paths. */
export function logMemoriesPage(page: MemoriesPage): void {
    clientLog('memories_page', { target: MEMORIES_PAGE_CODES[page] });
}

/**
 * A Memories core view, as logged in `target` (a code, never a name or path). `album_members`,
 * `album_month` and `album_colors` are the album's member list, one month's grid and the colour
 * ribbon (`album` is its months); `film_strip` the film strip's day (favorites, names);
 * `timeline_month` the memoir timeline's selected month (`timeline` is its month rail);
 * `memoir_members` the memoir's member list (`memoir` is the selected person's header).
 * Fun wave: `radio` the radio page itself, `radio_members` / `radio_program` / `radio_cassettes`
 * its member list, a program's tracks and the cassette shelf; `gacha` the gacha state;
 * `calendar` one calendar month, `calendar_months` the month picker; `capsule` an anchor's notes,
 * `capsule_due` the notes resurfacing on a date; `same_time` the 同じ時刻 line; `day24` her 24
 * hours; `then_now` あの日と今日 (day mode and 初見 vs 今).
 */
export const MEMORIES_VIEWS = [
    'hub', 'on_this_day', 'day', 'album', 'favorites', 'memoir', 'binder', 'names', 'timeline',
    'album_members', 'album_month', 'album_colors', 'film_strip', 'timeline_month', 'memoir_members',
    'radio', 'radio_members', 'radio_program', 'radio_cassettes', 'gacha', 'calendar', 'calendar_months',
    'capsule', 'capsule_due', 'same_time', 'day24', 'then_now',
] as const;
export type MemoriesView = (typeof MEMORIES_VIEWS)[number];

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
 * toggle (`on` = lanes B, `off` = merged A); `member_filter` a day-view member chip or an album
 * member row (`on` = one person, `off` = everyone); `lane_card` a swimlane card (`on` = expanded,
 * `off` = collapsed); `album_filter` an album filter pill (`on` = narrowed, `off` = all; `kind`
 * carries the filter code); `album_burst` a burst's sequence (`on` = opened, `off` = closed); `film_strip` the film strip of a
 * favourite or a name moment (`on` = opened, `off` = closed).
 * Fun wave: `radio_program` a radio program was picked (`kind` = its {@link RadioProgram} code);
 * `cassette` a cassette year (`on` = loaded, `off` = ejected); `sleep_timer` the sleep timer
 * (`on` = set, `off` = cancelled); `then_now` the ⇆ toggle (`on` = あの日と今日 shown); `then_now_mode`
 * day / 初見 vs 今 (`on` = first week); `calendar_member` the calendar's member filter (`on` = one
 * person); `album_cover` 「この月の表紙にする」 (`on` = set, `off` = cleared).
 */
export const MEMORIES_TOGGLES = [
    'other_services', 'day_mode', 'member_filter', 'lane_card', 'album_filter', 'album_burst', 'film_strip',
    'radio_program', 'cassette', 'sleep_timer', 'then_now', 'then_now_mode', 'calendar_member', 'album_cover',
] as const;
export type MemoriesToggle = (typeof MEMORIES_TOGGLES)[number];

/**
 * `memories_toggle`: a Memories control was switched. `target` is the control code; `kind` a filter
 * code (an album kind or a radio program).
 */
export function logMemoriesToggle(target: MemoriesToggle, on: boolean, extra: { kind?: string } = {}): void {
    clientLog('memories_toggle', { target, outcome: on ? 'on' : 'off', ...extra });
}

/**
 * Why a Memories view skipped something or fell back (`memories_skip` `reason`):
 * `focus_missing` the film strip's message is not in its day (the strip opens on the day's first
 * message); `empty_note` a text favourite without text was left off the board; `unknown_card` binder
 * cards whose key this build has no copy for were left off the binder (`count`).
 * Fun wave: `transcript_missing` a radio track has no transcript to show (the words line is left
 * out); `pull_missing` a gacha pull's message is no longer in the archive (a date-only card);
 * `day24_thin` her day is too thin (the thin-data card instead); `note_empty` an empty capsule note
 * was not saved; `same_time_none` nothing at this JST minute (the line is hidden).
 */
export const MEMORIES_SKIP_REASONS = [
    'focus_missing', 'empty_note', 'unknown_card',
    'transcript_missing', 'pull_missing', 'day24_thin', 'note_empty', 'same_time_none',
] as const;
export type MemoriesSkipReason = (typeof MEMORIES_SKIP_REASONS)[number];

/** `memories_skip`: a Memories view skipped an item or fell back. Ids, codes and counts only. */
export function logMemoriesSkip(
    target: MemoriesView,
    reason: MemoriesSkipReason,
    extra: { message_id?: number; count?: number } = {},
): void {
    clientLog('memories_skip', { target, reason, ...extra });
}

export const MEMORIES_RADIO_PHASES = ['play', 'track', 'track_error', 'pause', 'resume', 'sleep_set', 'sleep_fade', 'end'] as const;
export type MemoriesRadioPhase = (typeof MEMORIES_RADIO_PHASES)[number];
/** `memories_radio` `reason`: why a track failed (`media_error`, `play_rejected`) or the radio ended. */
export const MEMORIES_RADIO_REASONS = ['media_error', 'play_rejected', 'queue_end', 'sleep_timer', 'user'] as const;
export type MemoriesRadioReason = (typeof MEMORIES_RADIO_REASONS)[number];
/** `memories_radio` `outcome`: whether a `play` / `resume` started audio. */
export const MEMORIES_RADIO_OUTCOMES = ['ok', 'failed'] as const;
export type MemoriesRadioOutcome = (typeof MEMORIES_RADIO_OUTCOMES)[number];

/**
 * `memories_radio`: a voice-radio decision. `kind` is the program code; `play` carries `count`
 * (tracks) and `outcome`; `track` the `index` started; `track_error` the `index` and a `reason`
 * (`media_error`, `play_rejected`; the radio moves on); `sleep_set` `count` (minutes); `sleep_fade`
 * the timer's fade began; `end` a `reason` (`queue_end`, `sleep_timer`, `user`). Codes and counts only.
 */
export function logMemoriesRadio(
    phase: MemoriesRadioPhase,
    extra: { kind?: RadioProgram; index?: number; count?: number; reason?: MemoriesRadioReason; outcome?: MemoriesRadioOutcome } = {},
): void {
    clientLog('memories_radio', { phase, ...extra });
}

export const MEMORIES_GACHA_PHASES = ['open', 'pull', 'reveal', 'refused', 'favorite', 'context'] as const;
export type MemoriesGachaPhase = (typeof MEMORIES_GACHA_PHASES)[number];
/**
 * `memories_gacha` `reason` for `refused` (a rarity's {@link GachaReason} otherwise):
 * `no_pulls_left` (409), `empty_pool` (nothing to draw), `request_failed` (any other failure).
 */
export const MEMORIES_GACHA_REFUSALS = ['no_pulls_left', 'empty_pool', 'request_failed'] as const;
export type MemoriesGachaRefusal = (typeof MEMORIES_GACHA_REFUSALS)[number];
/** `memories_gacha` `outcome` for `favorite`: the ★ was set (`on`) or cleared (`off`). */
export const MEMORIES_GACHA_OUTCOMES = ['on', 'off'] as const;
export type MemoriesGachaOutcome = (typeof MEMORIES_GACHA_OUTCOMES)[number];

/**
 * `memories_gacha`: a gacha decision. `open` carries `count` (pulls left); `pull` the `index`;
 * `reveal` the rarity `kind`, its `reason`, `index` and `message_id`; `refused` a refusal `reason`;
 * `favorite` `outcome` and `message_id`; `context` the pull's message was opened in its day
 * (`message_id`). Ids, codes and counts only.
 */
export function logMemoriesGacha(
    phase: MemoriesGachaPhase,
    extra: {
        kind?: GachaRarity; reason?: GachaReason | MemoriesGachaRefusal; count?: number; index?: number;
        outcome?: MemoriesGachaOutcome; message_id?: number;
    } = {},
): void {
    clientLog('memories_gacha', { phase, ...extra });
}

export const MEMORIES_CAPSULE_PHASES = ['open', 'save', 'delete', 'failed', 'resurface_open'] as const;
export type MemoriesCapsulePhase = (typeof MEMORIES_CAPSULE_PHASES)[number];
/** `memories_capsule` `outcome` for `save`: a new note or an edit. */
export const MEMORIES_CAPSULE_OUTCOMES = ['created', 'updated'] as const;
export type MemoriesCapsuleOutcome = (typeof MEMORIES_CAPSULE_OUTCOMES)[number];
/**
 * `memories_capsule` `error_code` for `failed`: the server's reason (`bad_note`, `bad_body`,
 * `store_unavailable`), `not_found` (404), `timeout`, or `request_failed` (anything else).
 */
export const MEMORIES_CAPSULE_ERROR_CODES = [
    'bad_note', 'bad_body', 'store_unavailable', 'not_found', 'timeout', 'request_failed',
] as const;
export type MemoriesCapsuleErrorCode = (typeof MEMORIES_CAPSULE_ERROR_CODES)[number];

/**
 * `memories_capsule`: a capsule-note decision. `kind` is the anchor (`day`, `card`); `open` carries
 * `count` (notes on the anchor); `save` an `outcome`; `failed` an `error_code`; `resurface_open` a
 * resurfaced note was opened. Never the note body (the fan's own words): there is no field for it.
 */
export function logMemoriesCapsule(
    phase: MemoriesCapsulePhase,
    extra: { kind?: CapsuleAnchorKind; count?: number; outcome?: MemoriesCapsuleOutcome; error_code?: MemoriesCapsuleErrorCode } = {},
): void {
    clientLog('memories_capsule', { phase, ...extra });
}

export const RECAP_LOAD_TARGETS = ['members', 'member', 'years'] as const;
export type RecapLoadTarget = (typeof RECAP_LOAD_TARGETS)[number];
export const RECAP_LOAD_OUTCOMES = ['ok', 'empty', 'timeout', 'rejected', 'failed', 'skipped'] as const;
export type RecapLoadOutcome = (typeof RECAP_LOAD_OUTCOMES)[number];

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

export const RECAP_PLAY_PHASES = [
    'open', 'step', 'pause', 'resume', 'end', 'close', 'skip', 'media_held',
    'voice_start', 'voice_clip', 'voice_error', 'voice_end',
] as const;
export type RecapPlayPhase = (typeof RECAP_PLAY_PHASES)[number];

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

export const RECAP_POSTER_PHASES = ['open', 'skip', 'replay', 'close', 'font_fallback', 'save', 'save_failed'] as const;
export type RecapPosterPhase = (typeof RECAP_POSTER_PHASES)[number];

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

export const RECAP_SHARE_PHASES = [
    'open', 'close', 'option', 'style', 'sentence', 'font_fallback', 'photo_skip', 'video_unsupported',
    'share_blur_fallback', 'export_start', 'export', 'export_failed',
] as const;
export type RecapSharePhase = (typeof RECAP_SHARE_PHASES)[number];

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

export const RECAP_OPENING_PHASES = ['show', 'skip', 'end', 'close'] as const;
export type RecapOpeningPhase = (typeof RECAP_OPENING_PHASES)[number];

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
