import { useState, useEffect, useRef, useCallback } from 'react';
import { persisted } from '../persistence/persisted';
import { clientLog } from '../../utils/clientLog';
import { breadcrumbCode } from '../../utils/breadcrumbCode';

const DEFAULT_VOLUME = 0.5; // 50% slider = gain 1.0 = original recording volume

/**
 * Hook for audio volume control with amplification beyond native browser limits.
 *
 * Uses Web Audio API GainNode to allow volume above 100% (original):
 * - Slider 0.0 = silence (gain 0.0)
 * - Slider 0.5 = original volume (gain 1.0)
 * - Slider 1.0 = 2x amplified (gain 2.0)
 *
 * The HTML media element's volume is always set to 1.0. All volume
 * control is done through the GainNode.
 *
 * @param storageKey - persisted app-state pref key for the volume preference
 */
export function useAmplifiedVolume(storageKey: string) {
    const [volume, setVolumeState] = useState(() => {
        const saved = persisted.getPref<string | null>(storageKey, null);
        if (saved !== null) {
            const vol = parseFloat(saved);
            if (!isNaN(vol) && vol >= 0 && vol <= 1) return vol;
        }
        return DEFAULT_VOLUME;
    });
    const [isMuted, setIsMuted] = useState(false);
    const savedVolumeRef = useRef(volume);
    const volumeRef = useRef(volume); // Track current volume for connectElement

    // Web Audio API refs
    const audioContextRef = useRef<AudioContext | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);
    const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
    const connectedElementRef = useRef<HTMLMediaElement | null>(null);
    // The element passed to connectElement (routed through the graph only once it plays)
    const registeredElementRef = useRef<HTMLMediaElement | null>(null);
    const playListenerRef = useRef<(() => void) | null>(null);

    // Keep volumeRef in sync with state
    useEffect(() => {
        volumeRef.current = volume;
    }, [volume]);

    const setVolume = useCallback((newVolume: number) => {
        const clamped = Math.max(0, Math.min(1, newVolume));
        setVolumeState(clamped);
        persisted.setPref(storageKey, clamped.toString());
        if (clamped > 0) {
            savedVolumeRef.current = clamped;
            setIsMuted(false);
        }
    }, [storageKey]);

    const toggleMute = useCallback(() => {
        setIsMuted(prev => {
            if (!prev) {
                // Muting: save current volume, set to 0
                savedVolumeRef.current = volume;
                setVolumeState(0);
                return true;
            } else {
                // Unmuting: restore saved volume
                const restored = savedVolumeRef.current || DEFAULT_VOLUME;
                setVolumeState(restored);
                persisted.setPref(storageKey, restored.toString());
                return false;
            }
        });
    }, [volume, storageKey]);

    /**
     * Route the registered element through the gain pipeline, creating the
     * AudioContext on first use, and resume the context if it is suspended.
     * Runs from the element's `play` event; players also call it right before
     * `play()` so the graph exists (and the resume happens inside the click)
     * before any sound comes out. No-op without a registered element.
     */
    // Each failure phase is logged once per hook instance.
    const loggedPhasesRef = useRef(new Set<string>());
    const logOnce = useCallback((phase: 'amp_connect_failed' | 'amp_resume_failed', err: unknown) => {
        if (loggedPhasesRef.current.has(phase)) return;
        loggedPhasesRef.current.add(phase);
        clientLog('media_playback', { phase, error_type: breadcrumbCode(err) });
    }, []);

    const prepareForPlayback = useCallback(() => {
        const element = registeredElementRef.current;
        if (!element) return;

        // If the AudioContext was closed (e.g., React StrictMode cleanup cycle),
        // reset all refs so we can reconnect. Per Web Audio spec, closing a
        // context frees its MediaElementSources, allowing the element to be
        // reconnected to a new context.
        if (audioContextRef.current?.state === 'closed') {
            audioContextRef.current = null;
            gainNodeRef.current = null;
            sourceNodeRef.current = null;
            connectedElementRef.current = null;
        }

        // Create the AudioContext on first playback, not on mount: a chat
        // full of video bubbles must not hold one context per bubble.
        if (!audioContextRef.current) {
            audioContextRef.current = new AudioContext();
        }
        const ctx = audioContextRef.current;

        if (connectedElementRef.current !== element) {
            // Drop the previous element's source when rebinding to a new element
            if (sourceNodeRef.current) {
                try { sourceNodeRef.current.disconnect(); } catch { /* already disconnected */ }
                sourceNodeRef.current = null;
            }

            if (!gainNodeRef.current) {
                gainNodeRef.current = ctx.createGain();
                gainNodeRef.current.connect(ctx.destination);
            }
            // Set the gain from the current volume (effects may have run before the context existed)
            gainNodeRef.current.gain.value = volumeRef.current * 2;

            try {
                const source = ctx.createMediaElementSource(element);
                source.connect(gainNodeRef.current);
                sourceNodeRef.current = source;
                connectedElementRef.current = element;
                // Ensure native volume is maxed — all control via GainNode
                element.volume = 1;
            } catch (err) {
                // Element may already be connected to an AudioContext (e.g., hot reload)
                logOnce('amp_connect_failed', err);
            }
        }

        // Playback starts from a user gesture, so a suspended context can resume now.
        if (ctx.state === 'suspended') {
            ctx.resume().catch((err) => logOnce('amp_resume_failed', err));
        }
    }, [logOnce]);

    /**
     * Register the media element whose sound this hook amplifies. Cheap: it only
     * listens for `play`; the AudioContext and the element's source node are
     * created by {@link prepareForPlayback} when playback first starts.
     * Safe to call multiple times (e.g. from a ref callback) — the same element is
     * registered once. If a context already exists, a new element is routed now.
     */
    const connectElement = useCallback((element: HTMLMediaElement | null) => {
        if (!element || element === registeredElementRef.current) return;

        // Drop the play listener of a previously registered element
        if (registeredElementRef.current && playListenerRef.current) {
            registeredElementRef.current.removeEventListener('play', playListenerRef.current);
        }
        registeredElementRef.current = element;
        element.addEventListener('play', prepareForPlayback);
        playListenerRef.current = prepareForPlayback;

        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            prepareForPlayback();
        }
    }, [prepareForPlayback]);

    // Update gain value whenever volume changes
    useEffect(() => {
        if (gainNodeRef.current) {
            gainNodeRef.current.gain.value = volume * 2;
        }
    }, [volume]);

    // Close the AudioContext and drop the play listener on unmount. Without this,
    // each player that has played holds an open AudioContext for its lifetime;
    // browsers cap concurrent contexts (~6 in Chrome), after which
    // `new AudioContext()` throws and amplification breaks. The element is
    // unregistered too, so a StrictMode mount→cleanup→mount registers it again;
    // the next play detects the closed context (state === 'closed'), resets its
    // refs and binds the element to a fresh context (createMediaElementSource is
    // wrapped in try/catch).
    useEffect(() => {
        return () => {
            if (registeredElementRef.current && playListenerRef.current) {
                registeredElementRef.current.removeEventListener('play', playListenerRef.current);
            }
            playListenerRef.current = null;
            registeredElementRef.current = null;
            const ctx = audioContextRef.current;
            if (ctx && ctx.state !== 'closed') {
                ctx.close().catch(() => { /* already closing/closed */ });
            }
        };
    }, []);

    return {
        /** Current volume (0-1 slider value). 0.5 = original recording volume. */
        volume,
        /** Set volume (0-1). Values are clamped. */
        setVolume,
        /** Whether audio is muted. */
        isMuted,
        /** Toggle mute on/off. */
        toggleMute,
        /** Register the media element to amplify (the audio graph is built on first play). */
        connectElement,
        /** Build the audio graph (first time) and resume it; call right before `play()`. */
        prepareForPlayback,
        /** The gain multiplier (0-2). Useful for display: gain 1.0 = original. */
        gain: volume * 2,
    };
}
