import { clientLog } from '../../utils/clientLog';

export type MemoriesPage = 'home' | 'recap';

/** `memories_open`: the Memories feature was shown. Pass only the service id. */
export function logMemoriesOpen(service: string): void {
    clientLog('memories_open', { service });
}

/** `memories_page`: the Memories router moved to a page. Never pass names, text or paths. */
export function logMemoriesPage(page: MemoriesPage): void {
    clientLog('memories_page', { target: page });
}

export type RecapLoadTarget = 'members' | 'member';
export type RecapLoadOutcome = 'ok' | 'empty' | 'timeout' | 'rejected' | 'failed';

/**
 * `recap_load`: a recap request finished. `count` is the members with a recap
 * (overview) or the playable slides (member); `error_code` the HTTP status;
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
