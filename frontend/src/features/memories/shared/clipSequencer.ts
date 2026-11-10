/**
 * Memories clip playback: plays clips in sequence on two audio elements. By default each
 * hand-over is a crossfade with volume ramps (the recap's voice slide); with `crossfadeMs: 0`
 * and a `gapMs`, whole clips play back to back with a silent gap between them (the radio).
 *
 * Pure DOM, no React: the owner holds one sequencer per playback and stops it when it unmounts.
 * `pause()` / `resume()` hold every sounding element, every volume ramp, the gap and the final
 * fade-out timer where they are. `skipTo` / `next` / `prev` move between clips, `fadeOut` ramps
 * everything down and stops. The voice coordinator (`voicePlayback.ts`) decides who may play;
 * a sequencer only plays. Tests pass a fake element factory.
 */
import type { TranscriptSegment } from '../types';

/** Default length of each crossfade (and of the final fade-out). */
export const CROSSFADE_MS = 300;
const RAMP_STEPS = 10;
/** `prev()` restarts the current clip once it has played longer than this (seconds). */
const PREV_RESTART_S = 3;

export interface SequencerClip {
    /** Server media URL (a voice file, or a video whose audio plays). */
    url: string;
    /** Seconds into the media. */
    start: number;
    end: number;
    segments: TranscriptSegment[] | null;
}

export interface SequencerOptions {
    /** Crossfade (and final fade-out) length; 0 hands over with no overlap. Default {@link CROSSFADE_MS}. */
    crossfadeMs?: number;
    /** Silence between one clip's hand-over and the next clip's start. Default 0. */
    gapMs?: number;
}

export type ClipErrorCode = 'media_error' | 'play_rejected';

export interface SequencerEvents {
    /** Clip `index` started playing. */
    onClip: (index: number) => void;
    /** The subtitle under the playhead changed (raw text, `%%%` kept), or null for none. */
    onSubtitle: (text: string | null) => void;
    /** Clip `index` could not play; the sequence moves on. */
    onClipError: (index: number, code: ClipErrorCode) => void;
    /**
     * The sequence finished: the last clip faded out, or `next()` ran past it. Fires at most
     * once, and never after `stop()` or `fadeOut()` (an external stop is not an end).
     */
    onEnd: () => void;
    /** The current clip's playhead moved (seconds into the media). */
    onProgress?: (index: number, currentTime: number) => void;
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

const newSlot = (el: HTMLAudioElement): Slot => ({ el, ramp: null, detach: null, live: false, fail: null, deferred: null });

export class ClipSequencer {
    private readonly slots: [Slot, Slot];
    private readonly crossfadeMs: number;
    private readonly gapMs: number;
    private index = -1;
    private stopped = false;
    /** `onEnd` has fired; the sequence is over. */
    private ended = false;
    private subtitle: string | null = null;
    private paused = false;
    /** The final fade-out timer, and whether it still has to run (it is re-armed on resume). */
    private endTimer: ReturnType<typeof setTimeout> | null = null;
    private endPending = false;
    /** The silent gap before clip `gapNext` (re-armed in full on resume). */
    private gapTimer: ReturnType<typeof setTimeout> | null = null;
    private gapNext: number | null = null;
    /** Bumped by every jump: callbacks of a clip played before it are ignored. */
    private epoch = 0;
    private fading = false;
    private fadeWaiters: Array<() => void> = [];

    constructor(
        private readonly clips: readonly SequencerClip[],
        private readonly events: SequencerEvents,
        create: () => HTMLAudioElement = createAudioElement,
        options: SequencerOptions = {},
    ) {
        this.crossfadeMs = Math.max(0, options.crossfadeMs ?? CROSSFADE_MS);
        this.gapMs = Math.max(0, options.gapMs ?? 0);
        this.slots = [newSlot(create()), newSlot(create())];
    }

    start(): void {
        if (this.index !== -1 || this.stopped) return;
        if (this.clips.length === 0) {
            this.emitEnd();
            return;
        }
        this.play(0, false);
    }

    /** Silences both elements and drops every pending callback; a pending `fadeOut` resolves. */
    stop(): void {
        if (this.stopped) return;
        this.stopped = true;
        this.clearEndTimer();
        this.clearGap();
        for (const slot of this.slots) this.silence(slot);
        const waiters = this.fadeWaiters;
        this.fadeWaiters = [];
        for (const resolve of waiters) resolve();
    }

    /** Holds playback: sounding elements pause; ramps, the gap and the final fade-out stop where they are. */
    pause(): void {
        if (this.paused || this.stopped) return;
        this.paused = true;
        for (const slot of this.slots) if (slot.live) slot.el.pause();
        if (this.endTimer !== null) {
            clearTimeout(this.endTimer);
            this.endTimer = null;
        }
        if (this.gapTimer !== null) {
            clearTimeout(this.gapTimer);
            this.gapTimer = null;
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
        if (this.gapNext !== null && this.gapTimer === null) this.armGap();
    }

    /**
     * Jumps to clip `index`, from its start at full volume; whatever was sounding stops at once.
     * While paused the clip waits for `resume()`. Ignored out of range, after the end, after
     * `stop()` and during `fadeOut()`.
     */
    skipTo(index: number): void {
        if (this.stopped || this.ended || this.fading) return;
        if (!Number.isInteger(index) || index < 0 || index >= this.clips.length) return;
        this.epoch += 1;
        this.clearEndTimer();
        this.endPending = false;
        this.clearGap();
        for (const slot of this.slots) this.silence(slot);
        this.setSubtitle(null);
        this.play(index, false);
    }

    /** The next clip; past the last one the sequence ends (`onEnd`). */
    next(): void {
        if (this.stopped || this.ended || this.fading || this.index < 0) return;
        if (this.index + 1 < this.clips.length) {
            this.skipTo(this.index + 1);
            return;
        }
        this.stop();
        this.emitEnd();
    }

    /** The previous clip, or the current one from its start once it is more than 3 s in (or the first). */
    prev(): void {
        if (this.stopped || this.ended || this.fading || this.index < 0) return;
        const slot = this.slotOf(this.index);
        const elapsed = slot.live ? slot.el.currentTime - this.clips[this.index].start : 0;
        this.skipTo(elapsed > PREV_RESTART_S || this.index === 0 ? this.index : this.index - 1);
    }

    /**
     * Ramps every sounding element to 0 over `ms`, then {@link stop}s; resolves once stopped.
     * Nothing new starts during the fade and `onEnd` does not fire. Paused (nothing sounding),
     * not started, or `ms <= 0`: stops at once.
     */
    fadeOut(ms: number): Promise<void> {
        if (this.stopped) return Promise.resolve();
        const done = new Promise<void>((resolve) => this.fadeWaiters.push(resolve));
        if (this.fading) return done;
        const live = this.slots.filter((s) => s.live);
        if (this.paused || ms <= 0 || live.length === 0) {
            this.stop();
            return done;
        }
        this.fading = true;
        this.clearGap();
        this.clearEndTimer();
        this.endPending = false;
        let left = live.length;
        for (const slot of live) {
            this.rampTo(slot, 0, () => {
                left -= 1;
                if (left === 0) this.stop();
            }, ms);
        }
        return done;
    }

    /** The sounding element of the current clip (for a waveform), or null. */
    analyser(): HTMLAudioElement | null {
        if (this.stopped || this.index < 0) return null;
        const slot = this.slotOf(this.index);
        return slot.live ? slot.el : null;
    }

    private slotOf(index: number): Slot {
        return this.slots[index % 2];
    }

    /** Stops a slot at once and drops its listeners, ramp and pending hand-over. */
    private silence(slot: Slot): void {
        this.cancelRamp(slot);
        slot.detach?.();
        slot.detach = null;
        slot.fail = null;
        slot.live = false;
        slot.deferred = null;
        slot.el.pause();
    }

    private play(index: number, fadeIn: boolean): void {
        this.index = index;
        const epoch = this.epoch;
        const clip = this.clips[index];
        const slot = this.slotOf(index);
        const { el } = slot;
        this.cancelRamp(slot);
        slot.detach?.();
        let handed = false;
        const handOver = (error: ClipErrorCode | null) => {
            if (handed || this.stopped || epoch !== this.epoch) return;
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
            this.advance(index, error);
        };
        slot.fail = handOver;
        const onTime = () => {
            this.events.onProgress?.(index, el.currentTime);
            this.showSubtitle(clip, el.currentTime);
            if (el.currentTime >= clip.end - this.crossfadeMs / 1000) handOver(null);
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
        if (fadeIn) this.rampTo(slot, 1);
        // A jump while paused: the clip is set up and `resume()` plays it.
        if (this.paused) return;
        const played = el.play();
        if (played && typeof played.catch === 'function') {
            played.catch(() => handOver('play_rejected'));
        }
    }

    private advance(index: number, error: ClipErrorCode | null): void {
        // Fading out: the fade's own ramps finish and stop; nothing new starts.
        if (this.fading) return;
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
            if (this.gapMs > 0) {
                this.gapNext = index + 1;
                this.armGap();
            } else {
                this.play(index + 1, true);
            }
            return;
        }
        // The last clip: let its fade-out finish, then hand back to the owner.
        this.endPending = true;
        if (!this.paused) this.armEndTimer();
    }

    /** (Re)starts the silent gap before `gapNext`; a resume gives it its full length again. */
    private armGap(): void {
        if (this.gapTimer !== null) clearTimeout(this.gapTimer);
        this.gapTimer = setTimeout(() => {
            this.gapTimer = null;
            if (this.stopped || this.paused || this.fading) return;
            const next = this.gapNext;
            this.gapNext = null;
            if (next !== null) this.play(next, true);
        }, this.gapMs);
    }

    private clearGap(): void {
        if (this.gapTimer !== null) clearTimeout(this.gapTimer);
        this.gapTimer = null;
        this.gapNext = null;
    }

    /** (Re)starts the final fade-out wait; a resume gives it its full length again. */
    private armEndTimer(): void {
        this.clearEndTimer();
        this.endTimer = setTimeout(() => {
            this.endTimer = null;
            if (this.stopped || this.paused) return;
            this.emitEnd();
        }, this.crossfadeMs);
    }

    private clearEndTimer(): void {
        if (this.endTimer !== null) clearTimeout(this.endTimer);
        this.endTimer = null;
    }

    private emitEnd(): void {
        if (this.ended) return;
        this.ended = true;
        this.endPending = false;
        this.events.onEnd();
    }

    private showSubtitle(clip: SequencerClip, t: number): void {
        const cutoff = clip.end - this.crossfadeMs / 1000;
        const seg = clip.segments?.find((s) => s.start <= t && t < s.end && t < cutoff);
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

    /** Moves the slot's volume to `to` over `durationMs` (default: the crossfade) in even steps. */
    private rampTo(slot: Slot, to: number, done?: () => void, durationMs: number = this.crossfadeMs): void {
        this.cancelRamp(slot);
        if (durationMs <= 0) {
            slot.el.volume = to;
            done?.();
            return;
        }
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
        }, durationMs / RAMP_STEPS);
    }
}
