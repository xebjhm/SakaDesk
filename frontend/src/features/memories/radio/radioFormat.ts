import type { TFunction } from 'i18next';
import { formatDuration } from '../../../utils/classnames';
import type { RadioProgram, RadioTrack } from '../types';

/**
 * A total voice length for a list row or a tape label: 「3時間12分」, 「2時間」, 「42分」, or
 * 「1分未満」 under a minute. Null when unknown or zero, so the caller draws nothing (never a 0).
 */
export function formatVoiceLength(t: TFunction, seconds: number | null | undefined): string | null {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return null;
    if (seconds < 60) return t('memories.radio.lengthUnder');
    const totalMinutes = Math.floor(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return t('memories.radio.lengthMinutes', { count: minutes });
    if (minutes === 0) return t('memories.radio.lengthHoursOnly', { hours });
    return t('memories.radio.lengthHours', { hours, minutes });
}

/** A track's own length as the voice player shows it (`MM:SS`), or null when unknown. */
export function formatTrackLength(track: RadioTrack): string | null {
    const seconds = track.segments
        ? (track.end ?? 0) - track.start
        : track.message.duration_s ?? (track.end !== null ? track.end - track.start : null);
    return seconds !== null && seconds > 0 ? formatDuration(seconds) : null;
}

const PROGRAM_KEY: Record<RadioProgram, string> = {
    oyasumi: 'oyasumi',
    ohayo: 'ohayo',
    otsukare: 'otsukare',
    chrono: 'chrono',
    favorites: 'favorites',
    oyasumi_clips: 'oyasumiClips',
};

/** The i18n keys of a program card's title and subtitle (literal lookups, never built from input). */
export function programCopy(code: RadioProgram): { title: string; subtitle: string } {
    const key = PROGRAM_KEY[code];
    return { title: `memories.radio.programs.${key}`, subtitle: `memories.radio.programs.${key}Sub` };
}
