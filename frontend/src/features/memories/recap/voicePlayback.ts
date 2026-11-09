/**
 * Voice slide playback: plays a few clip openings in sequence on two audio
 * elements, crossfading each hand-over with volume ramps.
 *
 * Pure DOM, no React: the slide owns one sequencer per press of ▶ and stops
 * it when it unmounts. Tests pass a fake element factory.
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
}

export class ClipSequencer {
    private readonly slots: [Slot, Slot];
    private index = -1;
    private stopped = false;
    private subtitle: string | null = null;

    constructor(
        private readonly clips: readonly SequencerClip[],
        private readonly events: SequencerEvents,
        create: () => HTMLAudioElement = createAudioElement,
    ) {
        this.slots = [
            { el: create(), ramp: null, detach: null },
            { el: create(), ramp: null, detach: null },
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
        for (const slot of this.slots) {
            this.cancelRamp(slot);
            slot.detach?.();
            slot.detach = null;
            slot.el.pause();
        }
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
            handed = true;
            slot.detach?.();
            slot.detach = null;
            this.next(index, error);
        };
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
            slot.el.pause();
        } else {
            this.rampTo(slot, 0, () => slot.el.pause());
        }
        this.setSubtitle(null);
        if (index + 1 < this.clips.length) {
            this.play(index + 1, true);
            return;
        }
        // The last clip: let its fade-out finish, then hand back to the player.
        setTimeout(() => {
            if (!this.stopped) this.events.onEnd();
        }, CROSSFADE_MS);
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
