/**
 * Voice slide playback: plays a few clip openings in sequence on two audio
 * elements, crossfading each hand-over with volume ramps.
 *
 * Pure DOM, no React: the slide owns one sequencer per press of ▶ and stops
 * it when it unmounts. `pause()` / `resume()` follow the recap player's pause:
 * every sounding element, every volume ramp and the final fade-out timer hold
 * where they are. Tests pass a fake element factory.
 */
import type { RecapTranscriptSegment } from './api';

/** Length of each crossfade (and of the final fade-out). */
export const CROSSFADE_MS = 300;
const RAMP_STEPS = 10;

export interface SequencerClip {
    /** Server media URL (a voice file, or a video whose audio plays). */
    url: string;
    /** Seconds into the media. */
    start: number;
    end: number;
    segments: RecapTranscriptSegment[] | null;
}

export type ClipErrorCode = 'media_error' | 'play_rejected';

export interface SequencerEvents {
    /** Clip `index` started playing. */
    onClip: (index: number) => void;
    /** The subtitle under the playhead changed (raw text, `%%%` kept), or null for none. */
    onSubtitle: (text: string | null) => void;
    /** Clip `index` could not play; the sequence moves on. */
    onClipError: (index: number, code: ClipErrorCode) => void;
    /** The last clip finished and faded out. */
    onEnd: () => void;
}

/** A real, detached audio element (an `<audio>` also plays a video file's audio track). */
export function createAudioElement(): HTMLAudioElement {
    const el = new Audio();
    el.preload = 'auto';
    return el;
}

interface Slot {
    el: HTMLAudioElement;
    ramp: ReturnType<typeof setInterval> | null;
    detach: (() => void) | null;
    /** The element is sounding (playing, or fading out): `resume()` plays it again. */
    live: boolean;
    /** Skips the slot's clip; a no-op once it has handed over. */
    fail: ((code: ClipErrorCode | null) => void) | null;
    /** A hand-over that arrived while paused (`null` = the clip ended); `resume()` runs it. */
    deferred: { code: ClipErrorCode | null } | null;
}

export class ClipSequencer {
    private readonly slots: [Slot, Slot];
    private index = -1;
    private stopped = false;
    private subtitle: string | null = null;
    private paused = false;
    /** The final fade-out timer, and whether it still has to run (it is re-armed on resume). */
    private endTimer: ReturnType<typeof setTimeout> | null = null;
    private endPending = false;

    constructor(
        private readonly clips: readonly SequencerClip[],
        private readonly events: SequencerEvents,
        create: () => HTMLAudioElement = createAudioElement,
    ) {
        this.slots = [
            { el: create(), ramp: null, detach: null, live: false, fail: null, deferred: null },
            { el: create(), ramp: null, detach: null, live: false, fail: null, deferred: null },
        ];
    }

    start(): void {
        if (this.index !== -1 || this.stopped) return;
        if (this.clips.length === 0) {
            this.events.onEnd();
            return;
        }
        this.play(0, false);
    }

    /** Silences both elements and drops every pending callback. */
    stop(): void {
        if (this.stopped) return;
        this.stopped = true;
        this.clearEndTimer();
        for (const slot of this.slots) {
            this.cancelRamp(slot);
            slot.detach?.();
            slot.detach = null;
            slot.live = false;
            slot.deferred = null;
            slot.el.pause();
        }
    }

    /** Holds playback: sounding elements pause, ramps and the final fade-out stop where they are. */
    pause(): void {
        if (this.paused || this.stopped) return;
        this.paused = true;
        for (const slot of this.slots) if (slot.live) slot.el.pause();
        if (this.endTimer !== null) {
            clearTimeout(this.endTimer);
            this.endTimer = null;
        }
    }

    /** Plays on from where {@link pause} held; a clip whose `play()` is now rejected is skipped. */
    resume(): void {
        if (!this.paused || this.stopped) return;
        this.paused = false;
        const handOvers: Array<() => void> = [];
        for (const slot of this.slots) {
            if (!slot.live) continue;
            const deferred = slot.deferred;
            slot.deferred = null;
            if (deferred && slot.fail) {
                const fail = slot.fail;
                handOvers.push(() => fail(deferred.code));
                continue;
            }
            const played = slot.el.play();
            if (played && typeof played.catch === 'function') {
                played.catch(() => slot.fail?.('play_rejected'));
            }
        }
        // After the loop: a hand-over starts the other slot, which must not be played twice.
        for (const run of handOvers) run();
        if (this.endPending) this.armEndTimer();
    }

    private slotOf(index: number): Slot {
        return this.slots[index % 2];
    }

    private play(index: number, fadeIn: boolean): void {
        this.index = index;
        const clip = this.clips[index];
        const slot = this.slotOf(index);
        const { el } = slot;
        this.cancelRamp(slot);
        slot.detach?.();
        let handed = false;
        const handOver = (error: ClipErrorCode | null) => {
            if (handed || this.stopped) return;
            if (this.paused) {
                // A paused player never moves on: a pending play() is rejected with
                // AbortError by the pause itself, and a queued ended/error event is late.
                // Resume plays this clip again, or moves on if it had ended.
                if (error !== 'play_rejected') slot.deferred = { code: error };
                return;
            }
            handed = true;
            slot.detach?.();
            slot.detach = null;
            slot.fail = null;
            slot.deferred = null;
            this.next(index, error);
        };
        slot.fail = handOver;
        const onTime = () => {
            this.showSubtitle(clip, el.currentTime);
            if (el.currentTime >= clip.end - CROSSFADE_MS / 1000) handOver(null);
        };
        const onEnded = () => handOver(null);
        const onError = () => handOver('media_error');
        el.addEventListener('timeupdate', onTime);
        el.addEventListener('ended', onEnded);
        el.addEventListener('error', onError);
        slot.detach = () => {
            el.removeEventListener('timeupdate', onTime);
            el.removeEventListener('ended', onEnded);
            el.removeEventListener('error', onError);
        };
        el.src = clip.url;
        el.currentTime = clip.start;
        el.volume = fadeIn ? 0 : 1;
        this.events.onClip(index);
        slot.live = true;
        const played = el.play();
        if (played && typeof played.catch === 'function') {
            played.catch(() => handOver('play_rejected'));
        }
        if (fadeIn) this.rampTo(slot, 1);
    }

    private next(index: number, error: ClipErrorCode | null): void {
        const slot = this.slotOf(index);
        if (error) {
            this.events.onClipError(index, error);
            this.cancelRamp(slot);
            slot.live = false;
            slot.el.pause();
        } else {
            this.rampTo(slot, 0, () => {
                slot.live = false;
                slot.el.pause();
            });
        }
        this.setSubtitle(null);
        if (index + 1 < this.clips.length) {
            this.play(index + 1, true);
            return;
        }
        // The last clip: let its fade-out finish, then hand back to the player.
        this.endPending = true;
        if (!this.paused) this.armEndTimer();
    }

    /** (Re)starts the final fade-out wait; a resume gives it its full length again. */
    private armEndTimer(): void {
        this.clearEndTimer();
        this.endTimer = setTimeout(() => {
            this.endTimer = null;
            if (this.stopped || this.paused) return;
            this.endPending = false;
            this.events.onEnd();
        }, CROSSFADE_MS);
    }

    private clearEndTimer(): void {
        if (this.endTimer !== null) clearTimeout(this.endTimer);
        this.endTimer = null;
    }

    private showSubtitle(clip: SequencerClip, t: number): void {
        const seg = clip.segments?.find((s) => s.start <= t && t < s.end && t < clip.end - CROSSFADE_MS / 1000);
        this.setSubtitle(seg ? seg.text : null);
    }

    private setSubtitle(text: string | null): void {
        if (text === this.subtitle) return;
        this.subtitle = text;
        this.events.onSubtitle(text);
    }

    private cancelRamp(slot: Slot): void {
        if (slot.ramp !== null) clearInterval(slot.ramp);
        slot.ramp = null;
    }

    /** Moves the slot's volume to `to` over {@link CROSSFADE_MS} in even steps. */
    private rampTo(slot: Slot, to: number, done?: () => void): void {
        this.cancelRamp(slot);
        const from = slot.el.volume;
        let step = 0;
        slot.ramp = setInterval(() => {
            if (this.stopped) {
                this.cancelRamp(slot);
                return;
            }
            // Paused: the ramp holds its volume and carries on from this step on resume.
            if (this.paused) return;
            step += 1;
            const v = from + (to - from) * Math.min(1, step / RAMP_STEPS);
            slot.el.volume = Math.max(0, Math.min(1, v));
            if (step >= RAMP_STEPS) {
                this.cancelRamp(slot);
                done?.();
            }
        }, CROSSFADE_MS / RAMP_STEPS);
    }
}
