import { useState, useEffect, useRef, useCallback } from 'react';

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
 * @param storageKey - localStorage key for persisting the volume preference
 */
export function useAmplifiedVolume(storageKey: string) {
    const [volume, setVolumeState] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem(storageKey);
            if (saved !== null) {
                const vol = parseFloat(saved);
                if (!isNaN(vol) && vol >= 0 && vol <= 1) return vol;
            }
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

    // Keep volumeRef in sync with state
    useEffect(() => {
        volumeRef.current = volume;
    }, [volume]);

    const setVolume = useCallback((newVolume: number) => {
        const clamped = Math.max(0, Math.min(1, newVolume));
        setVolumeState(clamped);
        localStorage.setItem(storageKey, clamped.toString());
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
                localStorage.setItem(storageKey, restored.toString());
                return false;
            }
        });
    }, [volume, storageKey]);

    /**
     * Connect a media element to the Web Audio API gain pipeline.
     * Call this once after the media element is available (e.g., in a ref callback or useEffect).
     * Safe to call multiple times — will only connect once per element.
     */
    const connectElement = useCallback((element: HTMLMediaElement | null) => {
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

        if (element === connectedElementRef.current) return;

        // Create AudioContext on first connection
        if (!audioContextRef.current) {
            audioContextRef.current = new AudioContext();
        }

        const ctx = audioContextRef.current;

        // Clean up previous source if reconnecting to a different element
        if (sourceNodeRef.current) {
            try { sourceNodeRef.current.disconnect(); } catch { /* ignore */ }
        }

        // Create gain node if not exists
        if (!gainNodeRef.current) {
            gainNodeRef.current = ctx.createGain();
            gainNodeRef.current.connect(ctx.destination);
        }

        // Set initial gain from current volume (effects may have run before context existed)
        gainNodeRef.current.gain.value = volumeRef.current * 2;

        // Create source from media element and connect through gain
        try {
            const source = ctx.createMediaElementSource(element);
            source.connect(gainNodeRef.current);
            sourceNodeRef.current = source;
            connectedElementRef.current = element;

            // Ensure native volume is maxed — all control via GainNode
            element.volume = 1;
        } catch {
            // Element may already be connected to an AudioContext (e.g., hot reload)
        }

        // Resume AudioContext when media starts playing (user click = user gesture)
        element.addEventListener('play', () => {
            if (audioContextRef.current?.state === 'suspended') {
                audioContextRef.current.resume();
            }
        });

        // Also try to resume now (works if user has already interacted with page)
        if (ctx.state === 'suspended') {
            ctx.resume();
        }
    }, []);

    // Update gain value whenever volume changes
    useEffect(() => {
        if (gainNodeRef.current) {
            gainNodeRef.current.gain.value = volume * 2;
        }
    }, [volume]);

    // NOTE: We intentionally do NOT close the AudioContext on unmount.
    // createMediaElementSource() permanently binds an element to its AudioContext.
    // Closing the context makes the binding dead, and the element cannot be rebound
    // to a new context. React StrictMode (mount→cleanup→mount) would break audio
    // because the second mount can't reconnect the same element. The AudioContext
    // is lightweight and will be GC'd when the component is truly destroyed.

    return {
        /** Current volume (0-1 slider value). 0.5 = original recording volume. */
        volume,
        /** Set volume (0-1). Values are clamped. */
        setVolume,
        /** Whether audio is muted. */
        isMuted,
        /** Toggle mute on/off. */
        toggleMute,
        /** Connect a media element to the amplification pipeline. */
        connectElement,
        /** The gain multiplier (0-2). Useful for display: gain 1.0 = original. */
        gain: volume * 2,
    };
}
