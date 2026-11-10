/**
 * The radio's Web Audio graph, only for the waveform: one `AudioContext`, made on the first user
 * gesture (`ensure()`, from a click), one `AnalyserNode` into the speakers, and each audio element
 * routed through it once (`createMediaElementSource` may be called only once per element, so a
 * `WeakMap` remembers the routed ones and a refusal leaves the element playing directly).
 *
 * No context is made without `AudioContext`, or under `prefers-reduced-motion` (the waveform is
 * static then, so nothing needs analysing). An element is routed only while the context is
 * `running`: routed audio is silent in a suspended context.
 *
 * A routed element can never be un-routed, so the graph guards against silence: when the context
 * turns `suspended` while elements are routed (`statechange`), it resumes at once (and again on
 * the next gesture, `ensure()`); if the resume fails or the context is still not running after
 * {@link RESUME_TIMEOUT_MS}, the graph gives up for good. It disconnects every source, stops
 * routing, answers `analyser()` with null (the waveform turns static) and tells its `onUnroute`
 * listeners, which replay on fresh, unrouted elements. `release(el)` disconnects a finished
 * element; the owner `close()`s the graph on unmount.
 */

export function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false);
}

/** FFT size of the analyser: 32 frequency bins, one per waveform bar. */
export const ANALYSER_FFT_SIZE = 64;
/** How long a suspended context may take to resume before the graph unroutes. */
export const RESUME_TIMEOUT_MS = 1_000;

export interface RadioAudioGraph {
    /** Make (or resume) the context; call from a user gesture. */
    ensure(): void;
    /** Route an element through the analyser (once per element; a no-op before `ensure()`). */
    attach(el: HTMLMediaElement): void;
    /** Disconnect a finished element's source. */
    release(el: HTMLMediaElement): void;
    /** The element is routed through the analyser. */
    isRouted(el: HTMLMediaElement): boolean;
    /** The analyser, or null without a usable context. */
    analyser(): AnalyserNode | null;
    /** Called once if the graph gives up on a suspended context; returns an unsubscribe. */
    onUnroute(listener: () => void): () => void;
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
    const sources = new Set<MediaElementAudioSourceNode>();
    const listeners = new Set<() => void>();
    /** Gave up on the context: nothing is routed any more. */
    let disabled = false;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;

    const clearResumeTimer = () => {
        if (resumeTimer !== null) clearTimeout(resumeTimer);
        resumeTimer = null;
    };

    const unroute = () => {
        if (disabled) return;
        disabled = true;
        clearResumeTimer();
        for (const source of sources) {
            try {
                source.disconnect();
            } catch {
                // Already disconnected.
            }
        }
        sources.clear();
        routed = new WeakMap();
        node = null;
        for (const listener of [...listeners]) listener();
    };

    /** A suspended context with routed audio: resume now, give up if it fails or stalls. */
    const recover = () => {
        const c = ctx;
        if (!c || disabled || sources.size === 0 || c.state !== 'suspended') return;
        if (resumeTimer === null) {
            resumeTimer = setTimeout(() => {
                resumeTimer = null;
                if (ctx === c && c.state !== 'running') unroute();
            }, RESUME_TIMEOUT_MS);
        }
        c.resume().then(
            () => {
                if (ctx === c && c.state === 'running') clearResumeTimer();
            },
            () => {
                if (ctx === c) unroute();
            },
        );
    };

    const onStateChange = () => {
        if (ctx?.state === 'running') clearResumeTimer();
        else recover();
    };

    return {
        ensure() {
            if (disabled) return;
            if (ctx) {
                if (ctx.state === 'suspended') {
                    if (sources.size > 0) recover();
                    else ctx.resume().catch(() => {});
                }
                return;
            }
            const Ctor = contextCtor();
            if (!Ctor || prefersReducedMotion()) return;
            try {
                const made = new Ctor();
                const analyser = made.createAnalyser();
                analyser.fftSize = ANALYSER_FFT_SIZE;
                analyser.connect(made.destination);
                made.addEventListener?.('statechange', onStateChange);
                ctx = made;
                node = analyser;
            } catch {
                // No usable Web Audio: the waveform stays static.
                ctx = null;
                node = null;
            }
        },
        attach(el) {
            if (disabled || !ctx || !node || ctx.state !== 'running' || routed.has(el)) return;
            try {
                const source = ctx.createMediaElementSource(el);
                source.connect(node);
                routed.set(el, source);
                sources.add(source);
            } catch {
                // Already routed elsewhere (InvalidStateError): it keeps playing directly.
            }
        },
        release(el) {
            const source = routed.get(el);
            if (!source) return;
            routed.delete(el);
            sources.delete(source);
            try {
                source.disconnect();
            } catch {
                // Already disconnected.
            }
        },
        isRouted(el) {
            return routed.has(el);
        },
        analyser() {
            return disabled ? null : node;
        },
        onUnroute(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        close() {
            const closing = ctx;
            clearResumeTimer();
            closing?.removeEventListener?.('statechange', onStateChange);
            ctx = null;
            node = null;
            sources.clear();
            routed = new WeakMap();
            listeners.clear();
            closing?.close().catch(() => {});
        },
    };
}
