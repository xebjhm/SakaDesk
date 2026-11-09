/** A ringtone played while a call rings. */
export interface Ringtone {
    start(): void;
    stop(): void;
}

/** No sound: the ringtone is silent for now. */
export const SILENT_RINGTONE: Ringtone = { start() {}, stop() {} };

/** The one swap point for a future synthesized (Web Audio) ringtone. */
export function getRingtone(): Ringtone {
    return SILENT_RINGTONE;
}
