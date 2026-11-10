/**
 * The radio's Web Audio graph, only for the waveform: one `AudioContext`, made on the first user
 * gesture (`ensure()`, from a click), one `AnalyserNode` into the speakers, and each audio element
 * routed through it once (`createMediaElementSource` may be called only once per element, so a
 * `WeakMap` remembers the routed ones and a refusal leaves the element playing directly).
 *
 * No context is made without `AudioContext`, or under `prefers-reduced-motion` (the waveform is
 * static then, so nothing needs analysing). An element is routed only while the context is
 * `running`: routed audio is silent in a suspended context. The owner `close()`s it on unmount.
 */

export function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false);
}

/** FFT size of the analyser: 32 frequency bins, one per waveform bar. */
export const ANALYSER_FFT_SIZE = 64;

export interface RadioAudioGraph {
    /** Make (or resume) the context; call from a user gesture. */
    ensure(): void;
    /** Route an element through the analyser (once per element; a no-op before `ensure()`). */
    attach(el: HTMLMediaElement): void;
    /** The analyser, or null without a context. */
    analyser(): AnalyserNode | null;
    close(): void;
}

type AudioContextCtor = new () => AudioContext;

function contextCtor(): AudioContextCtor | null {
    const g = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
    return g.AudioContext ?? g.webkitAudioContext ?? null;
}

export function createRadioAudioGraph(): RadioAudioGraph {
    let ctx: AudioContext | null = null;
    let node: AnalyserNode | null = null;
    let routed = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

    return {
        ensure() {
            if (ctx) {
                if (ctx.state === 'suspended') ctx.resume().catch(() => {});
                return;
            }
            const Ctor = contextCtor();
            if (!Ctor || prefersReducedMotion()) return;
            try {
                const made = new Ctor();
                const analyser = made.createAnalyser();
                analyser.fftSize = ANALYSER_FFT_SIZE;
                analyser.connect(made.destination);
                ctx = made;
                node = analyser;
            } catch {
                // No usable Web Audio: the waveform stays static.
                ctx = null;
                node = null;
            }
        },
        attach(el) {
            if (!ctx || !node || ctx.state !== 'running' || routed.has(el)) return;
            try {
                const source = ctx.createMediaElementSource(el);
                source.connect(node);
                routed.set(el, source);
            } catch {
                // Already routed elsewhere (InvalidStateError): it keeps playing directly.
            }
        },
        analyser() {
            return node;
        },
        close() {
            const closing = ctx;
            ctx = null;
            node = null;
            routed = new WeakMap();
            closing?.close().catch(() => {});
        },
    };
}
